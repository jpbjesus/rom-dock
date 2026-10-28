"""Manual cover associations using the console's existing gamelist, not a game catalogue."""
import hashlib
import io
import posixpath
import secrets
import stat
import threading
import warnings
import xml.etree.ElementTree as ET
from PIL import Image, ImageOps, UnidentifiedImageError
from defusedxml import ElementTree as SafeET
from defusedxml.common import DefusedXmlException
from .remote import RemoteError, exists, safe_path

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_XML_BYTES = 4 * 1024 * 1024
IMAGE_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp')
NON_GAME_EXTENSIONS = {'.xml','.txt','.json','.cfg','.ini','.db','.png','.jpg','.jpeg','.webp','.gif','.svg','.mp4','.mp3','.wav','.ogg','.srm','.sav','.state','.bak','.pdf','.log'}

def eligible(name):
    return not name.startswith('.') and posixpath.splitext(name)[1].lower() not in NON_GAME_EXTENSIONS

class CoverStore:
    def __init__(self, root):
        self.root = root
        self.lock = threading.RLock()

    def _read(self, sftp, relative, maximum):
        path = safe_path(sftp, self.root, relative)
        item = sftp.lstat(path)
        if not stat.S_ISREG(item.st_mode) or item.st_size > maximum:
            raise RemoteError('O ficheiro é demasiado grande ou não é um ficheiro normal.', 413)
        with sftp.open(path, 'rb') as stream:
            data = stream.read(maximum + 1)
        if len(data) > maximum:
            raise RemoteError('O ficheiro excede o limite permitido.', 413)
        return data

    def _resolve(self, system, value):
        if not value or '\\' in value or '\x00' in value or '://' in value or value.lower().startswith(('data:', 'file:')):
            return None
        if value.startswith(self.root + '/'):
            relative = posixpath.normpath(value[len(self.root) + 1:])
        elif value.startswith('/'):
            return None
        else:
            relative = posixpath.normpath(posixpath.join(system, value))
        return None if relative in ('.','..') or relative.startswith('../') else relative

    def _load(self, sftp, system):
        safe_path(sftp, self.root, system)
        relative = system + '/gamelist.xml'
        if not exists(sftp, posixpath.join(self.root, relative)):
            return ET.Element('gameList'), b'', 'missing'
        data = self._read(sftp, relative, MAX_XML_BYTES)
        try:
            tree = ET.fromstring(data, parser=SafeET.DefusedXMLParser(target=ET.TreeBuilder(insert_comments=True), forbid_dtd=True))
            if tree.tag != 'gameList':
                raise ValueError('root')
        except (ET.ParseError, DefusedXmlException, ValueError):
            raise RemoteError('O gamelist.xml não é válido. Foi preservado sem alterações.', 409)
        return tree, data, hashlib.sha256(data).hexdigest()

    def _directory(self, sftp, relative):
        try:
            path = safe_path(sftp, self.root, relative)
            return {entry.filename:entry for entry in sftp.listdir_attr(path)
                    if stat.S_ISREG(entry.st_mode) and not stat.S_ISLNK(entry.st_mode)}
        except (RemoteError, OSError):
            return {}

    def manifest(self, sftp, directory):
        if not directory:
            return {'covers':{},'revision':'missing'}
        safe_path(sftp, self.root, directory)
        system = directory.split('/')[0]
        tree, _, revision = self._load(sftp, system)
        listed = self._directory(sftp, directory)
        records = {}
        for node in tree.findall('game'):
            rom = self._resolve(system, node.findtext('path'))
            if rom and rom.startswith(system+'/') and posixpath.dirname(rom)==directory:
                records[posixpath.basename(rom)] = node
        directory_cache = {}
        def candidate(relative):
            if not relative or posixpath.splitext(relative)[1].lower() not in IMAGE_EXTENSIONS:
                return None
            parent,name=posixpath.split(relative)
            if parent not in directory_cache:
                directory_cache[parent]=self._directory(sftp,parent)
            entry=directory_cache[parent].get(name)
            if not entry or entry.st_size>MAX_IMAGE_BYTES:
                return None
            return {'image':relative,'version':f'{revision[:16]}-{entry.st_mtime}-{entry.st_size}'}
        covers={}
        for name in listed:
            if not eligible(name):continue
            node=records.get(name)
            if node is not None:
                image=node.find('image')
                # Empty explicit image is a manual removal; do not resurrect fallbacks.
                if image is not None:
                    resolved=candidate(self._resolve(system,image.text))
                    if resolved:covers[name]=resolved
                    continue
                thumbnail=node.findtext('thumbnail')
                if thumbnail:
                    resolved=candidate(self._resolve(system,thumbnail))
                    if resolved:
                        covers[name]=resolved;continue
            stem=posixpath.splitext(name)[0]
            for parent in dict.fromkeys([directory+'/images',system+'/images']):
                for suffix in ['-image','-cover','-box','']:
                    for extension in IMAGE_EXTENSIONS:
                        resolved=candidate(parent+'/'+stem+suffix+extension)
                        if resolved:
                            covers[name]=resolved;break
                    if name in covers:break
                if name in covers:break
        return {'covers':covers,'revision':revision}

    def _rom(self, sftp, rom):
        path=safe_path(sftp,self.root,rom)
        if '/' not in rom or not stat.S_ISREG(sftp.lstat(path).st_mode) or not eligible(posixpath.basename(rom)):
            raise RemoteError('Selecionar um ficheiro de jogo dentro de um sistema.')
        return rom.split('/')[0]

    def detail(self, sftp, rom):
        system=self._rom(sftp,rom)
        manifest=self.manifest(sftp,posixpath.dirname(rom))
        images=[]
        for name,entry in self._directory(sftp,system+'/images').items():
            if posixpath.splitext(name)[1].lower() in IMAGE_EXTENSIONS and entry.st_size<=MAX_IMAGE_BYTES:
                images.append({'name':name,'image':system+'/images/'+name,'version':f'{entry.st_mtime}-{entry.st_size}'})
        images.sort(key=lambda item:item['name'].casefold())
        return {'cover':manifest['covers'].get(posixpath.basename(rom)), 'revision':manifest['revision'],'images':images}

    @staticmethod
    def _raster(data):
        if not data or len(data)>MAX_IMAGE_BYTES:
            raise RemoteError('A imagem deve ter até 8 MB.',413)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as source:
                    if source.format not in ('PNG','JPEG','WEBP') or source.width*source.height>16_000_000:
                        raise RemoteError('Utilizar uma imagem PNG, JPEG ou WebP com até 16 megapíxeis.')
                    source.load()
                    return ImageOps.exif_transpose(source).convert('RGBA')
        except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError,Image.DecompressionBombWarning):
            raise RemoteError('Não foi possível validar a imagem. Utilizar PNG, JPEG ou WebP.')

    def thumbnail(self,sftp,relative):
        if posixpath.splitext(relative)[1].lower() not in IMAGE_EXTENSIONS:
            raise RemoteError('Formato de imagem não permitido.')
        image=self._raster(self._read(sftp,relative,MAX_IMAGE_BYTES))
        image.thumbnail((640,640))
        output=io.BytesIO();image.save(output,'WEBP',quality=85)
        return output.getvalue()

    def _write_new(self,sftp,relative,data):
        path=safe_path(sftp,self.root,relative,allow_missing=True)
        stream=sftp.open(path,'wx')
        try:
            with stream:stream.write(data)
        except BaseException:
            try:sftp.remove(path)
            except OSError:pass
            raise
        return path

    def _ensure_folder(self,sftp,relative):
        path=safe_path(sftp,self.root,relative,allow_missing=True)
        entry=exists(sftp,path)
        if entry and not stat.S_ISDIR(entry.st_mode):raise RemoteError('O destino de imagens não é uma pasta.',409)
        if not entry:sftp.mkdir(path)

    def assign(self,sftp,rom,revision,image_path=None,upload=None,remove=False):
        with self.lock:
            system=self._rom(sftp,rom)
            tree,raw,current=self._load(sftp,system)
            if revision!=current:raise RemoteError('As capas foram alteradas noutra sessão. Atualizar e tentar novamente.',409)
            if sum([image_path is not None,upload is not None,bool(remove)])!=1:
                raise RemoteError('Selecionar apenas uma operação de capa.')
            created=None;temporary=None;published=False;commit_attempted=False
            try:
                if upload is not None:
                    image=self._raster(upload);image.thumbnail((1600,1600));output=io.BytesIO();image.save(output,'PNG')
                    if len(output.getvalue())>MAX_IMAGE_BYTES:raise RemoteError('A imagem convertida excede 8 MB.',413)
                    self._ensure_folder(sftp,system+'/images')
                    image_path=system+'/images/romdock-'+hashlib.sha256(rom.encode()).hexdigest()[:12]+'-'+secrets.token_hex(5)+'.png'
                    created=self._write_new(sftp,image_path,output.getvalue())
                elif image_path is not None:
                    if not image_path.startswith(system+'/'):
                        raise RemoteError('A imagem deve pertencer à pasta deste sistema.')
                    if posixpath.splitext(image_path)[1].lower() not in IMAGE_EXTENSIONS:
                        raise RemoteError('Formato de imagem não permitido.')
                    self._raster(self._read(sftp,image_path,MAX_IMAGE_BYTES))
                node=next((node for node in tree.findall('game') if self._resolve(system,node.findtext('path'))==rom),None)
                if node is None:
                    node=ET.SubElement(tree,'game');ET.SubElement(node,'path').text='./'+posixpath.relpath(rom,system)
                reference='' if remove else './'+posixpath.relpath(image_path,system)
                for key in ('image','thumbnail'):
                    child=node.find(key)
                    if child is None:child=ET.SubElement(node,key)
                    child.text=reference
                payload=ET.tostring(tree,encoding='utf-8',xml_declaration=True)
                if len(payload)>MAX_XML_BYTES:raise RemoteError('O gamelist.xml excederia o limite permitido.',413)
                if raw:
                    self._ensure_folder(sftp,system+'/.romdock-backups')
                    self._write_new(sftp,system+'/.romdock-backups/gamelist-'+current[:12]+'-'+secrets.token_hex(5)+'.xml',raw)
                temporary=self._write_new(sftp,system+'/.romdock-'+secrets.token_hex(12)+'.part',payload)
                _,_,latest=self._load(sftp,system)
                if latest!=current:raise RemoteError('O gamelist.xml mudou durante a operação. A alteração foi cancelada.',409)
                destination=safe_path(sftp,self.root,system+'/gamelist.xml',allow_missing=True)
                commit_attempted=True
                if current=='missing':sftp.rename(temporary,destination)
                else:sftp.posix_rename(temporary,destination)
                temporary=None;published=True
                return {'ok':True,'revision':hashlib.sha256(payload).hexdigest()}
            finally:
                for path in [temporary,created if not published and not commit_attempted else None]:
                    if path:
                        try:sftp.remove(path)
                        except OSError:pass
