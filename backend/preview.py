"""Bounded read-only previews. HTML/SVG/source are text, never executed."""
import io
import posixpath
import stat
import warnings
from PIL import Image,ImageOps,UnidentifiedImageError
from .remote import RemoteError,safe_path

MEDIA_TYPES={'.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.ogv':'video/ogg','.mov':'video/quicktime','.mkv':'video/x-matroska','.mp3':'audio/mpeg','.m4a':'audio/mp4','.aac':'audio/aac','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac','.pdf':'application/pdf'}
IMAGE_TYPES={'.png','.jpg','.jpeg','.webp','.gif','.bmp','.avif','.tif','.tiff'}
TEXT_TYPES={'.txt','.log','.xml','.json','.yaml','.yml','.ini','.cfg','.conf','.csv','.md','.html','.htm','.svg','.css','.js','.ts','.py','.sh','.cue','.m3u','.srt','.nfo','.gdi'}

def file_info(sftp,root,path):
    absolute=safe_path(sftp,root,path);entry=sftp.lstat(absolute)
    if not stat.S_ISREG(entry.st_mode):raise RemoteError('Selecionar um ficheiro normal para pré-visualizar.')
    return absolute,entry

def metadata(sftp,root,path):
    absolute,entry=file_info(sftp,root,path);extension=posixpath.splitext(path)[1].lower()
    data={'name':posixpath.basename(path),'size':entry.st_size,'modified':entry.st_mtime}
    if extension in IMAGE_TYPES:return {**data,'kind':'image'}
    if extension in MEDIA_TYPES:
        mime=MEDIA_TYPES[extension]
        return {**data,'kind':'pdf' if extension=='.pdf' else mime.split('/')[0],'mime':mime}
    with sftp.open(absolute,'rb') as stream:prefix=stream.read(65537)
    if extension in TEXT_TYPES or (b'\0' not in prefix and _utf8(prefix[:65536])):
        text=prefix[:65536].decode('utf-8-sig',errors='replace')
        return {**data,'kind':'text','text':text,'truncated':entry.st_size>65536}
    prefix=prefix[:512]
    lines=[]
    for offset in range(0,len(prefix),16):
        chunk=prefix[offset:offset+16];hexadecimal=' '.join(f'{value:02x}' for value in chunk)
        readable=''.join(chr(value) if 32<=value<127 else '.' for value in chunk)
        lines.append(f'{offset:08x}  {hexadecimal:<47}  {readable}')
    return {**data,'kind':'binary','text':'\n'.join(lines),'truncated':entry.st_size>512}

def _utf8(data):
    try:data.decode('utf-8');return True
    except UnicodeDecodeError:return False

def thumbnail(sftp,root,path):
    absolute,entry=file_info(sftp,root,path)
    if posixpath.splitext(path)[1].lower() not in IMAGE_TYPES:raise RemoteError('Formato de imagem não permitido.',415)
    if entry.st_size>24*1024*1024:raise RemoteError('A imagem excede o limite de pré-visualização de 24 MB.',413)
    with sftp.open(absolute,'rb') as stream:data=stream.read(24*1024*1024+1)
    if len(data)>24*1024*1024:raise RemoteError('A imagem excede o limite de pré-visualização.',413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.width*source.height>32_000_000:raise RemoteError('A imagem é demasiado grande para a pré-visualização.',413)
                source.seek(0);image=ImageOps.exif_transpose(source).convert('RGBA');image.thumbnail((1600,1600))
                image.info.clear();output=io.BytesIO();image.save(output,'WEBP',quality=88);return output.getvalue()
    except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError,Image.DecompressionBombWarning):
        raise RemoteError('Não foi possível descodificar esta imagem. O ficheiro original pode ser descarregado.',415)

def byte_range(value,size):
    if not value:return 0,max(0,size-1),False
    try:
        if not value.startswith('bytes=') or ',' in value:raise ValueError()
        left,right=value[6:].split('-',1)
        if not left:
            count=int(right)
            if count<=0:raise ValueError()
            start=max(0,size-count);end=size-1
        else:
            start=int(left);end=min(size-1,int(right)) if right else size-1
        if start<0 or start>=size or end<start:raise ValueError()
        return start,end,True
    except (ValueError,TypeError):raise RemoteError('O intervalo de leitura não é válido.',416)
