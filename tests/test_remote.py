import os
from pathlib import Path
import pytest
from backend.remote import safe_path, publish_upload, RemoteError

class LocalSFTP:
    def lstat(self, path): return os.lstat(path)
    def stat(self, path): return os.stat(path)
    def normalize(self, path): return os.path.realpath(path)
    def open(self, path, mode='r'): return open(path, mode)
    def remove(self, path): os.remove(path)
    def rename(self, source, dest):
        if os.path.exists(dest): raise FileExistsError(dest)
        os.rename(source, dest)
    def posix_rename(self, source, dest): os.replace(source, dest)

@pytest.fixture
def root(tmp_path):
    (tmp_path / 'snes').mkdir()
    (tmp_path / 'snes' / 'Jogo ação #1.sfc').write_bytes(b'original')
    return tmp_path

def test_unicode_and_nested_path(root):
    assert safe_path(LocalSFTP(), str(root), 'snes/Jogo ação #1.sfc') == str(root / 'snes/Jogo ação #1.sfc')

@pytest.mark.parametrize('path', ['../outside', 'snes/../../etc', '/etc/passwd', 'snes/../snes', 'bad\x00name', 'snes\\bad'])
def test_rejects_unsafe_paths(root, path):
    with pytest.raises(RemoteError): safe_path(LocalSFTP(), str(root), path)

def test_rejects_symlink_even_inside_root(root):
    (root / 'alias').symlink_to(root / 'snes', target_is_directory=True)
    with pytest.raises(RemoteError): safe_path(LocalSFTP(), str(root), 'alias/Jogo ação #1.sfc')

def test_missing_leaf_only_for_creation(root):
    assert safe_path(LocalSFTP(), str(root), 'snes/new.sfc', allow_missing=True).endswith('/snes/new.sfc')
    with pytest.raises(RemoteError): safe_path(LocalSFTP(), str(root), 'missing/new.sfc', allow_missing=True)

def test_upload_conflict_preserves_original(root):
    staged = root / 'snes' / '.romdock-test.part'
    staged.write_bytes(b'new')
    with pytest.raises(RemoteError): publish_upload(LocalSFTP(), str(root), str(staged), 'snes/Jogo ação #1.sfc', False)
    assert (root / 'snes' / 'Jogo ação #1.sfc').read_bytes() == b'original'

def test_atomic_replacement(root):
    staged = root / 'snes' / '.romdock-test.part'
    staged.write_bytes(b'new')
    publish_upload(LocalSFTP(), str(root), str(staged), 'snes/Jogo ação #1.sfc', True)
    assert (root / 'snes' / 'Jogo ação #1.sfc').read_bytes() == b'new'

def test_unsupported_atomic_replace_preserves_original(root):
    class Unsupported(LocalSFTP):
        def posix_rename(self, source, dest): raise OSError('unsupported')
    staged = root / 'snes' / '.romdock-test.part'
    staged.write_bytes(b'new')
    with pytest.raises(RemoteError): publish_upload(Unsupported(), str(root), str(staged), 'snes/Jogo ação #1.sfc', True)
    assert (root / 'snes' / 'Jogo ação #1.sfc').read_bytes() == b'original'

def test_changed_root_symlink_cannot_be_used_for_creation(tmp_path):
    outside=tmp_path/'outside';outside.mkdir()
    root=tmp_path/'roms';root.symlink_to(outside,target_is_directory=True)
    with pytest.raises(RemoteError):safe_path(LocalSFTP(),str(root),'new.sfc',allow_missing=True)

def test_reconnect_rejected_while_transfer_active(tmp_path):
    from backend.remote import Remote
    remote=Remote(trust_path=tmp_path/'hosts.json');remote.active=1
    with pytest.raises(RemoteError,match='fim das operações'):
        remote.connect('example.test',22,'root','not-used')

def test_host_identity_requires_confirmation_and_detects_change(tmp_path,monkeypatch):
    import backend.remote as module
    class Key:
        def __init__(self,value):self.value=value
        def asbytes(self):return self.value
    class Transport:
        def __init__(self,key):self.key=Key(key);self.authenticated=False
        def get_remote_server_key(self):return self.key
        def auth_password(self,*args,**kwargs):self.authenticated=True
        def close(self):pass
    class SFTP:
        def normalize(self,p):return p
        def lstat(self,p):return type('Attrs',(),{'st_mode':0o40755})()
        def close(self):pass
    remote=module.Remote(trust_path=tmp_path/'hosts.json')
    transport=Transport(b'first-key')
    monkeypatch.setattr(remote,'_transport',lambda host,port:transport)
    monkeypatch.setattr(module.paramiko.SFTPClient,'from_transport',lambda t:SFTP())
    with pytest.raises(RemoteError) as caught:remote.connect('console',22,'root','secret')
    assert caught.value.data['type']=='host_key'
    assert not caught.value.data['changed']
    assert not transport.authenticated
    assert not remote.trust_path.exists()
    key=module.fingerprint(transport.key)
    info=remote.connect('console',22,'root','secret',accepted_key=key)
    assert transport.authenticated
    assert info['connected']
    assert 'secret' not in str(info)
    first_generation=info['generation']
    assert remote.connect('console',22,'root','secret')['generation']!=first_generation
    transport=Transport(b'changed-key')
    with pytest.raises(RemoteError) as caught:remote.connect('console',22,'root','secret')
    assert caught.value.data['changed']
    assert caught.value.data['previous']==key
    assert not transport.authenticated
