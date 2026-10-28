from fastapi.testclient import TestClient
import pytest
from backend.app import create_app

@pytest.fixture
def client():
    return TestClient(create_app(access_code='test-access'))

def test_all_file_endpoints_require_auth(client):
    for method, url in [('get','/api/status'), ('get','/api/files'), ('get','/api/download?path=snes/game.sfc'), ('put','/api/upload?path=x'), ('post','/api/folder'), ('post','/api/rename'), ('delete','/api/entry?path=x'), ('post','/api/connect')]:
        assert getattr(client, method)(url).status_code == 401

def test_login_and_session_cookie(client):
    assert client.post('/api/login', json={'code':'wrong'}).status_code == 401
    assert client.post('/api/login', json={'code':'test-access'}).status_code == 200
    assert client.cookies.get('romdock_session')
    response = client.get('/api/status')
    assert response.status_code == 200
    assert response.json()['connected'] is False
    assert 'password' not in response.text

def test_reject_cross_origin_mutation(client):
    client.post('/api/login', json={'code':'test-access'})
    assert client.post('/api/connect', json={}, headers={'origin':'https://evil.example'}).status_code == 403

def test_not_connected_is_clear_error(client):
    client.post('/api/login', json={'code':'test-access'})
    response = client.get('/api/files')
    assert response.status_code == 409
    assert 'detail' in response.json()

def test_logout_revokes_access(client):
    client.post('/api/login', json={'code':'test-access'})
    assert client.post('/api/logout').status_code == 200
    assert client.get('/api/status').status_code == 401

from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
import os
import backend.app as app_module
from backend.remote import RemoteError

class FakeRemote:
    def __init__(self, root): self.root=root; self.generation='original'; self.active=0
    @contextmanager
    def open(self, generation=None):
        if generation is not None and generation!=self.generation: raise RemoteError('A ligação mudou.',409)
        self.active+=1
        try: yield DiskSFTP(),None
        finally: self.active-=1
    def info(self,check=True): return {'connected':True,'generation':self.generation,'host':'test'}

class DiskSFTP:
    def lstat(self,p): return os.lstat(p)
    def normalize(self,p): return os.path.realpath(p)
    def listdir(self,p): return os.listdir(p)
    def listdir_attr(self,p):
        return [SimpleNamespace(filename=e.name, st_mode=e.lstat().st_mode, st_size=e.lstat().st_size, st_mtime=e.lstat().st_mtime) for e in Path(p).iterdir()]
    def mkdir(self,p): os.mkdir(p)
    def rmdir(self,p): os.rmdir(p)
    def remove(self,p): os.remove(p)
    def open(self,p,mode): return open(p, mode.replace('wx','xb'))
    def rename(self,a,b):
        if os.path.exists(b): raise FileExistsError(b)
        os.rename(a,b)
    def posix_rename(self,a,b): os.replace(a,b)

@pytest.fixture
def connected(tmp_path,monkeypatch):
    monkeypatch.setattr(app_module,'ROM_ROOT',str(tmp_path))
    remote=FakeRemote(tmp_path)
    client=TestClient(create_app(remote=remote,access_code='test'))
    client.post('/api/login',json={'code':'test'})
    return client,remote,tmp_path

def test_create_upload_download_rename_delete_unicode(connected):
    client,remote,root=connected
    assert client.post('/api/folder',json={'path':'snes','generation':'original'}).status_code==200
    name='snes/Jogo ação #1.sfc'
    data=bytes(range(256))*4000
    result=client.put('/api/upload',params={'path':name,'generation':'original'},content=data)
    assert result.status_code==200,result.text
    listed=client.get('/api/files',params={'path':'snes'}).json()['entries']
    assert listed[0]['name']=='Jogo ação #1.sfc'
    assert listed[0]['size']==len(data)
    result=client.get('/api/download',params={'path':name,'generation':'original'})
    assert result.content==data
    assert "filename*=UTF-8''Jogo%20a%C3%A7%C3%A3o%20%231.sfc"==result.headers['content-disposition'].split('; ')[1]
    assert client.post('/api/rename',json={'path':name,'name':'Renomeado.sfc','generation':'original'}).status_code==200
    assert client.delete('/api/entry',params={'path':'snes/Renomeado.sfc','generation':'original'}).status_code==200
    assert client.delete('/api/entry',params={'path':'snes','generation':'original'}).status_code==200
    assert not list(root.iterdir())
    assert remote.active==0

def test_replacement_requires_explicit_flag(connected):
    client,_,root=connected
    (root/'test.sfc').write_bytes(b'original')
    params={'path':'test.sfc','generation':'original'}
    assert client.put('/api/upload',params=params,content=b'new').status_code==409
    assert (root/'test.sfc').read_bytes()==b'original'
    assert client.put('/api/upload',params={**params,'overwrite':'true'},content=b'new').status_code==200
    assert (root/'test.sfc').read_bytes()==b'new'
    assert list(root.iterdir())==[root/'test.sfc']

def test_stale_queue_cannot_write(connected):
    client,remote,root=connected
    remote.generation='different-device'
    assert client.put('/api/upload',params={'path':'test.sfc','generation':'original'},content=b'new').status_code==409
    assert not list(root.iterdir())

def test_nonempty_folder_and_root_cannot_be_deleted(connected):
    client,_,root=connected
    (root/'snes').mkdir(); (root/'snes'/'game').write_bytes(b'keep')
    assert client.delete('/api/entry',params={'path':'snes','generation':'original'}).status_code==409
    assert client.delete('/api/entry',params={'path':'','generation':'original'}).status_code==400
    assert (root/'snes'/'game').read_bytes()==b'keep'

def test_write_failure_cleans_temporary_file(connected,monkeypatch):
    client,remote,root=connected
    original=DiskSFTP.open
    class Broken:
        def __init__(self,stream): self.stream=stream
        def write(self,data): self.stream.write(data[:2]); raise OSError('disk full')
        def close(self): self.stream.close()
    monkeypatch.setattr(DiskSFTP,'open',lambda self,p,mode:Broken(original(self,p,mode)))
    result=client.put('/api/upload',params={'path':'game.sfc','generation':'original'},content=b'abcdef')
    assert result.status_code==502
    assert not list(root.iterdir())
    assert remote.active==0

def test_partial_body_does_not_publish(connected):
    client,remote,root=connected
    response=client.put('/api/upload',params={'path':'game.sfc','generation':'original'},content=b'partial',headers={'content-length':'100'})
    assert response.status_code==400
    assert not list(root.iterdir())
    assert remote.active==0

def test_folder_summary_counts_real_direct_entries_only(connected):
    client,_,root=connected
    (root/'snes').mkdir();(root/'snes'/'images').mkdir()
    (root/'snes'/'game.sfc').write_bytes(b'12345')
    (root/'snes'/'second.sfc').write_bytes(b'abc')
    (root/'snes'/'images'/'cover.png').write_bytes(b'large-image')
    result=client.get('/api/folder-info',params={'path':'snes','generation':'original'})
    assert result.status_code==200
    data=result.json();assert data['files']==2;assert data['folders']==1;assert data['bytes']==8
    assert client.get('/api/folder-info',params={'path':'snes','generation':'old'}).status_code==409
    client.post('/api/logout')
    assert client.get('/api/folder-info',params={'path':'snes','generation':'original'}).status_code==401

def test_cover_routes_require_authentication(client):
    for method,path in [('get','/api/covers?path=snes&generation=x'),('get','/api/cover?rom=snes/game.sfc&generation=x'),('get','/api/image?path=snes/images/x.png&generation=x'),('post','/api/cover'),('put','/api/cover?rom=snes/game.sfc&generation=x&revision=x')]:
        assert getattr(client,method)(path).status_code==401

def test_cover_api_upload_read_and_remove(connected):
    from PIL import Image
    import io
    client,remote,root=connected
    (root/'snes').mkdir();(root/'snes'/'game.sfc').write_bytes(b'ROM')
    info=client.get('/api/cover',params={'rom':'snes/game.sfc','generation':'original'})
    assert info.status_code==200;assert info.json()['revision']=='missing'
    output=io.BytesIO();Image.new('RGB',(40,60),'green').save(output,'PNG')
    uploaded=client.put('/api/cover',params={'rom':'snes/game.sfc','generation':'original','revision':'missing'},content=output.getvalue())
    assert uploaded.status_code==200,uploaded.text
    manifest=client.get('/api/covers',params={'path':'snes','generation':'original'}).json()
    cover=manifest['covers']['game.sfc']
    for _ in range(2):
        image=client.get('/api/image',params={**{'path':cover['image'],'generation':'original'},'version':cover['version']})
        assert image.status_code==200;assert image.headers['content-type']=='image/webp'
    assert client.get('/api/image',params={'path':cover['image'],'generation':'stale'}).status_code==409
    removed=client.post('/api/cover',json={'rom':'snes/game.sfc','generation':'original','revision':manifest['revision'],'remove':True})
    assert removed.status_code==200
    assert client.get('/api/cover',params={'rom':'snes/game.sfc','generation':'original'}).json()['cover'] is None
    assert (root/cover['image']).exists()

def test_browser_policy_allows_local_image_previews(client):
    response=client.get('/')
    assert 'blob:' in response.headers['content-security-policy']

@pytest.mark.parametrize('failure,status,message', [
    (TimeoutError(),504,'não respondeu'),
    (ConnectionRefusedError(111,'refused'),502,'serviço SSH'),
    (OSError(113,'unreachable'),502,'rede local'),
])
def test_connection_errors_explain_recovery(failure,status,message):
    class FailedRemote:
        def connect(self,**kwargs): raise failure
    with TestClient(create_app(remote=FailedRemote(),access_code='test')) as client:
        client.post('/api/login',json={'code':'test'})
        response=client.post('/api/connect',json={'host':'192.0.2.10','password':'example'})
        assert response.status_code==status
        assert message in response.json()['detail']

def test_system_scan_requires_auth_and_preserves_generation(connected):
    client, remote, root = connected
    (root/'snes').mkdir(); (root/'snes'/'game.sfc').write_bytes(b'rom')
    (root/'gba').mkdir(); (root/'gba'/'gamelist.xml').write_text('<gameList/>')
    response=client.get('/api/systems?generation=original')
    assert response.status_code==200
    assert response.json()['systems']=={'snes':True,'gba':False}
    assert client.get('/api/systems?generation=old').status_code==409
    client.post('/api/logout')
    assert client.get('/api/systems?generation=original').status_code==401
