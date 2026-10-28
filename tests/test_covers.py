import io
import os
import xml.etree.ElementTree as ET
from pathlib import Path
import pytest
from PIL import Image
from backend.covers import CoverStore
from backend.remote import RemoteError

class LocalSFTP:
    def lstat(self,path):return os.lstat(path)
    def normalize(self,path):return os.path.realpath(path)
    def open(self,path,mode='rb'):return open(path,mode.replace('wx','xb'))
    def mkdir(self,path):os.mkdir(path)
    def remove(self,path):os.remove(path)
    def rename(self,a,b):
        if os.path.exists(b):raise FileExistsError(b)
        os.rename(a,b)
    def posix_rename(self,a,b):os.replace(a,b)
    def listdir_attr(self,path):
        from types import SimpleNamespace
        return [SimpleNamespace(filename=p.name,st_mode=p.lstat().st_mode,st_size=p.lstat().st_size,st_mtime=p.lstat().st_mtime) for p in Path(path).iterdir()]

def png(color='red'):
    output=io.BytesIO();Image.new('RGB',(80,120),color).save(output,'PNG');return output.getvalue()

@pytest.fixture
def library(tmp_path):
    folder=tmp_path/'snes';folder.mkdir();(folder/'images').mkdir()
    (folder/'ação #1.sfc').write_bytes(b'ROM')
    (folder/'images'/'original.png').write_bytes(png())
    raw=b'<gameList><game><path>./a\xc3\xa7\xc3\xa3o #1.sfc</path><name>Keep title</name><desc>Preserve description</desc><image>./images/original.png</image><rating>0.9</rating></game></gameList>'
    (folder/'gamelist.xml').write_bytes(raw)
    return CoverStore(str(tmp_path)),LocalSFTP(),folder,raw

def test_existing_gamelist_cover_unicode(library):
    store,sftp,_,_=library
    result=store.manifest(sftp,'snes')
    assert result['covers']['ação #1.sfc']['image']=='snes/images/original.png'
    assert result['revision']

def test_manual_upload_preserves_metadata_and_original_and_backs_up(library):
    store,sftp,folder,raw=library
    revision=store.detail(sftp,'snes/ação #1.sfc')['revision']
    store.assign(sftp,'snes/ação #1.sfc',revision,upload=png('blue'))
    tree=ET.fromstring((folder/'gamelist.xml').read_bytes());game=tree.find('game')
    assert game.findtext('name')=='Keep title';assert game.findtext('desc')=='Preserve description';assert game.findtext('rating')=='0.9'
    assert game.findtext('image')==game.findtext('thumbnail')
    assert (folder/'images'/'original.png').read_bytes()==png()
    assert any(p.read_bytes()==raw for p in (folder/'.romdock-backups').iterdir())
    image=(folder/game.findtext('image').removeprefix('./'));assert image.is_file()
    assert store.detail(sftp,'snes/ação #1.sfc')['cover']['image'].endswith('.png')

def test_manual_existing_image_and_clear_preserve_files(library):
    store,sftp,folder,_=library;(folder/'images'/'other.jpg').write_bytes(png('green'))
    info=store.detail(sftp,'snes/ação #1.sfc')
    store.assign(sftp,'snes/ação #1.sfc',info['revision'],image_path='snes/images/other.jpg')
    info=store.detail(sftp,'snes/ação #1.sfc');assert info['cover']['image']=='snes/images/other.jpg'
    store.assign(sftp,'snes/ação #1.sfc',info['revision'],remove=True)
    assert store.detail(sftp,'snes/ação #1.sfc')['cover'] is None
    assert (folder/'images'/'other.jpg').exists();assert (folder/'images'/'original.png').exists()

def test_stale_revision_and_invalid_image_do_not_change_gamelist(library):
    store,sftp,folder,raw=library
    with pytest.raises(RemoteError):store.assign(sftp,'snes/ação #1.sfc','outdated',upload=png())
    with pytest.raises(RemoteError):store.assign(sftp,'snes/ação #1.sfc',store.detail(sftp,'snes/ação #1.sfc')['revision'],upload=b'<svg><script/></svg>')
    assert (folder/'gamelist.xml').read_bytes()==raw

def test_malicious_reference_and_symlink_are_never_served(library,tmp_path):
    store,sftp,folder,_=library
    (folder/'gamelist.xml').write_text('<gameList><game><path>./ação #1.sfc</path><image>../../outside.png</image></game></gameList>')
    assert store.manifest(sftp,'snes')['covers']=={}
    (tmp_path/'outside.png').write_bytes(png());(folder/'images'/'link.png').symlink_to(tmp_path/'outside.png')
    with pytest.raises(RemoteError):store.thumbnail(sftp,'snes/images/link.png')
    with pytest.raises(RemoteError):store.thumbnail(sftp,'../outside.png')

def test_corrupt_metadata_cannot_be_overwritten(library):
    store,sftp,folder,_=library;(folder/'gamelist.xml').write_bytes(b'<invalid')
    with pytest.raises(RemoteError):store.assign(sftp,'snes/ação #1.sfc','anything',upload=png())
    assert (folder/'gamelist.xml').read_bytes()==b'<invalid'

def test_fallback_exact_filename_only(library):
    store,sftp,folder,_=library;(folder/'gamelist.xml').unlink();(folder/'images'/'ação #1-image.png').write_bytes(png())
    assert store.manifest(sftp,'snes')['covers']['ação #1.sfc']['image']=='snes/images/ação #1-image.png'
    assert store.detail(sftp,'snes/ação #1.sfc')['revision']=='missing'
    store.assign(sftp,'snes/ação #1.sfc','missing',remove=True)
    assert store.detail(sftp,'snes/ação #1.sfc')['cover'] is None

def test_image_response_is_a_valid_bounded_raster(library):
    store,sftp,_,_=library
    data=store.thumbnail(sftp,'snes/images/original.png')
    im=Image.open(io.BytesIO(data));assert im.format=='WEBP';assert max(im.size)<=640

def test_concurrent_external_metadata_change_is_preserved(library,monkeypatch):
    store,sftp,folder,_=library
    info=store.detail(sftp,'snes/ação #1.sfc')
    original=store._write_new
    external=b'<gameList><game><path>./other.sfc</path><name>External update</name></game></gameList>'
    def race(sftp,path,data):
        result=original(sftp,path,data)
        if path.endswith('.part'):(folder/'gamelist.xml').write_bytes(external)
        return result
    monkeypatch.setattr(store,'_write_new',race)
    with pytest.raises(RemoteError,match='mudou durante'):
        store.assign(sftp,'snes/ação #1.sfc',info['revision'],upload=png('blue'))
    assert (folder/'gamelist.xml').read_bytes()==external
    assert [p.name for p in (folder/'images').iterdir()]==['original.png']

def test_xml_entities_are_rejected(library):
    store,sftp,folder,_=library
    payload=b'<!DOCTYPE gameList [<!ENTITY x "expanded">]><gameList><game><name>&x;</name></game></gameList>'
    (folder/'gamelist.xml').write_bytes(payload)
    with pytest.raises(RemoteError):store.manifest(sftp,'snes')
    assert (folder/'gamelist.xml').read_bytes()==payload

def test_ambiguous_remote_commit_never_deletes_a_referenced_cover(library,monkeypatch):
    store,sftp,folder,_=library;info=store.detail(sftp,'snes/ação #1.sfc')
    original=sftp.posix_rename
    def lost_reply(a,b):original(a,b);raise OSError('connection lost after commit')
    monkeypatch.setattr(sftp,'posix_rename',lost_reply)
    with pytest.raises(OSError):store.assign(sftp,'snes/ação #1.sfc',info['revision'],upload=png('blue'))
    reference=ET.fromstring((folder/'gamelist.xml').read_bytes()).findtext('game/image')
    assert (folder/reference.removeprefix('./')).is_file()

def test_colons_in_local_filenames_are_not_treated_as_urls(library):
    store,sftp,folder,_=library
    (folder/'Game: Special.sfc').write_bytes(b'ROM')
    revision=store.detail(sftp,'snes/Game: Special.sfc')['revision']
    store.assign(sftp,'snes/Game: Special.sfc',revision,image_path='snes/images/original.png')
    assert store.detail(sftp,'snes/Game: Special.sfc')['cover']['image']=='snes/images/original.png'
