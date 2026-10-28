import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from backend.app import create_app

# Reuse the filesystem transport boundary used by API integration tests.
from test_api import FakeRemote
import backend.app as app_module

@pytest.fixture
def browser(tmp_path,monkeypatch):
    monkeypatch.setattr(app_module,'ROM_ROOT',str(tmp_path))
    client=TestClient(create_app(remote=FakeRemote(tmp_path),access_code='test'))
    client.post('/api/login',json={'code':'test'})
    return client,tmp_path

def test_text_preview_is_bounded_and_html_is_plain_text(browser):
    client,root=browser
    (root/'page.html').write_text('<script>alert(1)</script>')
    response=client.get('/api/preview',params={'path':'page.html','generation':'original'})
    assert response.status_code==200;assert response.json()['kind']=='text';assert '<script>' in response.json()['text']
    (root/'large.log').write_text('hello\n'*20000)
    preview=client.get('/api/preview',params={'path':'large.log','generation':'original'}).json()
    assert preview['truncated'];assert len(preview['text'])<=65536

def test_binary_preview_and_path_protection(browser):
    client,root=browser;(root/'game.sfc').write_bytes(bytes(range(256)))
    response=client.get('/api/preview',params={'path':'game.sfc','generation':'original'})
    assert response.status_code==200;assert response.json()['kind']=='binary';assert '00 01 02' in response.json()['text']
    assert client.get('/api/preview',params={'path':'../outside','generation':'original'}).status_code==400
    assert client.get('/api/preview',params={'path':'game.sfc','generation':'old'}).status_code==409

def test_media_stream_supports_ranges_and_never_serves_html(browser):
    client,root=browser;(root/'clip.mp4').write_bytes(b'0123456789')
    response=client.get('/api/media',params={'path':'clip.mp4','generation':'original'},headers={'range':'bytes=2-5'})
    assert response.status_code==206;assert response.content==b'2345';assert response.headers['content-range']=='bytes 2-5/10'
    suffix=client.get('/api/media',params={'path':'clip.mp4','generation':'original'},headers={'range':'bytes=-3'})
    assert suffix.status_code==206;assert suffix.content==b'789'
    assert client.get('/api/media',params={'path':'clip.mp4','generation':'original'},headers={'range':'bytes=100-200'}).status_code==416
    (root/'page.html').write_text('<script/>')
    assert client.get('/api/media',params={'path':'page.html','generation':'original'}).status_code==415

def test_image_preview_is_decoded_and_auth_is_required(browser):
    client,root=browser;output=io.BytesIO();Image.new('RGB',(50,80),'blue').save(output,'PNG');(root/'photo.png').write_bytes(output.getvalue())
    preview=client.get('/api/preview',params={'path':'photo.png','generation':'original'}).json();assert preview['kind']=='image'
    response=client.get('/api/preview-image',params={'path':'photo.png','generation':'original'});assert response.status_code==200
    assert Image.open(io.BytesIO(response.content)).format=='WEBP'
    client.post('/api/logout')
    for endpoint in ('preview','preview-image','media'):
        assert client.get('/api/'+endpoint,params={'path':'photo.png','generation':'original'}).status_code==401
