"""Live cover verification; all mutations stay inside a unique temporary system folder."""
import getpass
import os
import io
import secrets
import xml.etree.ElementTree as ET
import httpx
from PIL import Image

def main():
    host = os.environ.get('ROMDOCK_CONSOLE_HOST') or input('Console IP: ').strip()
    code=getpass.getpass('App access code: ')
    client=httpx.Client(base_url='http://127.0.0.1:8765',timeout=60)
    client.post('/api/login',json={'code':code}).raise_for_status()
    current=client.get('/api/status');current.raise_for_status()
    if current.json().get('connected') and current.json().get('host')==host:
        generation=current.json()['generation']
    else:
        password=getpass.getpass('Console SSH password: ')
        connection=client.post('/api/connect',json={'host':host,'port':22,'username':'root','password':password})
        connection.raise_for_status();generation=connection.json()['generation']
    params={'generation':generation}
    # Read existing artwork, never modify existing systems.
    response=client.get('/api/covers',params={**params,'path':'snes'});response.raise_for_status()
    existing=response.json()['covers'];assert existing
    cover=next(iter(existing.values()))
    image=client.get('/api/image',params={**params,'path':cover['image'],'version':cover['version']});image.raise_for_status()
    assert Image.open(io.BytesIO(image.content)).format=='WEBP'
    print('PASS: existing SNES covers read and decoded without changes')
    folder='.romdock-cover-validation-'+secrets.token_hex(6);made=False
    def upload(path,data):
        response=client.put('/api/upload',params={**params,'path':path},content=data);response.raise_for_status()
    def detail():
        response=client.get('/api/cover',params={**params,'rom':folder+'/ação #1.sfc'});response.raise_for_status();return response.json()
    def change(body):
        response=client.post('/api/cover',json={**params,'rom':folder+'/ação #1.sfc',**body});response.raise_for_status();return response
    try:
        client.post('/api/folder',json={**params,'path':folder}).raise_for_status();made=True
        upload(folder+'/ação #1.sfc',b'ROMDOCK-TEST')
        original='<gameList><game><path>./ação #1.sfc</path><name>Preserve this title</name><desc>Test metadata</desc></game></gameList>'.encode()
        upload(folder+'/gamelist.xml',original)
        output=io.BytesIO();Image.new('RGB',(90,140),'navy').save(output,'PNG')
        info=detail()
        response=client.put('/api/cover',params={**params,'rom':folder+'/ação #1.sfc','revision':info['revision']},content=output.getvalue());response.raise_for_status()
        info=detail();assert info['cover']
        first=info['cover']['image']
        data=client.get('/api/download',params={**params,'path':folder+'/gamelist.xml'});data.raise_for_status()
        assert ET.fromstring(data.content).findtext('game/name')=='Preserve this title'
        backups=client.get('/api/files',params={'path':folder+'/.romdock-backups'});backups.raise_for_status();assert backups.json()['entries']
        output=io.BytesIO();Image.new('RGB',(80,120),'teal').save(output,'PNG')
        upload(folder+'/images/alternative.png',output.getvalue())
        change({'revision':info['revision'],'image_path':folder+'/images/alternative.png'})
        info=detail();assert info['cover']['image']==folder+'/images/alternative.png'
        stale=client.post('/api/cover',json={**params,'rom':folder+'/ação #1.sfc','revision':'stale','remove':True});assert stale.status_code==409
        change({'revision':info['revision'],'remove':True});assert detail()['cover'] is None
        original_image=client.get('/api/download',params={**params,'path':first});original_image.raise_for_status()
        print('PASS: manual cover upload, existing-image association, metadata backup/preservation, stale conflict and removal preserving images')
    finally:
        if made:
            def cleanup(directory):
                assert directory==folder or directory.startswith(folder+'/')
                result=client.get('/api/files',params={'path':directory});result.raise_for_status()
                for entry in result.json()['entries']:
                    path=directory+'/'+entry['name'];assert not entry['symlink']
                    if entry['directory']:cleanup(path)
                    else:client.delete('/api/entry',params={**params,'path':path}).raise_for_status()
                client.delete('/api/entry',params={**params,'path':directory}).raise_for_status()
            cleanup(folder)
            print('PASS: all isolated cover-test files removed; existing library untouched')
    client.close()
if __name__=='__main__':main()
