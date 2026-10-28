"""Explicit, isolated integration test against the user's running console.
Requires the app running. Password is requested interactively, never persisted.
"""
import getpass
import os
import hashlib
import secrets
from pathlib import Path
import httpx
import paramiko
from backend.remote import fingerprint


def main():
    host = os.environ.get('ROMDOCK_CONSOLE_HOST') or input('Console IP: ').strip()
    code = getpass.getpass('App access code: ')
    password = getpass.getpass('Console SSH password: ')
    client = httpx.Client(base_url='http://127.0.0.1:8765',timeout=60)
    response = client.post('/api/login',json={'code':code}); response.raise_for_status()
    connection={'host':host,'port':22,'username':'root','password':password}
    response=client.post('/api/connect',json=connection)
    if response.status_code==409:
        detail=response.json()['detail']
        if not isinstance(detail,dict) or detail.get('type')!='host_key': response.raise_for_status()
        # Pin the key already accepted by the earlier direct SSH connection.
        keys=paramiko.HostKeys(str(Path.home()/'.ssh'/'known_hosts'))
        trusted=keys.lookup(host)
        assert trusted and detail['fingerprint'] in [fingerprint(k) for k in trusted.values()], 'SSH identity differs from previously verified console'
        response=client.post('/api/connect',json={**connection,'accepted_key':detail['fingerprint']})
    response.raise_for_status()
    generation=response.json()['generation']
    status=client.get('/api/status'); status.raise_for_status()
    assert status.json()['storage']['free']>0
    root=client.get('/api/files'); root.raise_for_status()
    assert any(e['name']=='snes' for e in root.json()['entries'])
    folder='.romdock-validation-'+secrets.token_hex(6)
    made=False
    try:
        response=client.post('/api/folder',json={'path':folder,'generation':generation});response.raise_for_status(); made=True
        subfolder=folder+'/Manual/RPG'
        for directory in [folder+'/Manual',subfolder]:
            response=client.post('/api/folder',json={'path':directory,'generation':generation});response.raise_for_status()
        name=subfolder+'/Teste ação #1.bin'
        payload=bytes(range(256))*8192
        response=client.put('/api/upload',params={'path':name,'generation':generation},content=payload);response.raise_for_status()
        downloaded=client.get('/api/download',params={'path':name,'generation':generation});downloaded.raise_for_status()
        assert hashlib.sha256(downloaded.content).digest()==hashlib.sha256(payload).digest()
        response=client.put('/api/upload',params={'path':name,'generation':generation},content=b'replacement')
        assert response.status_code==409
        response=client.put('/api/upload',params={'path':name,'generation':generation,'overwrite':'true'},content=b'replacement');response.raise_for_status()
        assert client.get('/api/download',params={'path':name,'generation':generation}).content==b'replacement'
        response=client.post('/api/rename',json={'path':name,'name':'Renomeado.bin','generation':generation});response.raise_for_status()
        response=client.delete('/api/entry',params={'path':folder,'generation':generation});assert response.status_code==409
        print('PASS: live connect, root listing, free space, 2 MB upload, SHA256-verified download, conflict, atomic replacement, Unicode rename, nested folder creation, nonempty directory protection')
    finally:
        if made:
            def cleanup(directory):
                assert directory==folder or directory.startswith(folder+'/')
                listing=client.get('/api/files',params={'path':directory});listing.raise_for_status()
                for entry in listing.json()['entries']:
                    path=directory+'/'+entry['name']
                    assert not entry['symlink']
                    if entry['directory']:cleanup(path)
                    else:
                        response=client.delete('/api/entry',params={'path':path,'generation':generation});response.raise_for_status()
                response=client.delete('/api/entry',params={'path':directory,'generation':generation});response.raise_for_status()
            cleanup(folder)
            print('PASS: isolated test folder and files removed; existing ROMs untouched')
    client.close()

if __name__=='__main__':main()
