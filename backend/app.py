from collections import OrderedDict
import hmac
import os
import posixpath
import secrets
import socket
import errno
import stat
import threading
import time
from pathlib import Path
from urllib.parse import quote, urlsplit

import paramiko
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.background import BackgroundTask
from . import preview as file_preview
from .systems import has_roms

from .covers import CoverStore, MAX_IMAGE_BYTES
from .remote import ROM_ROOT, Remote, RemoteError, exists, publish_upload, safe_path

class Login(BaseModel):
    code: str = Field(max_length=200)

class Connection(BaseModel):
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(default='root', min_length=1, max_length=100)
    password: str = Field(max_length=1024)
    accepted_key: str | None = None

class Folder(BaseModel):
    path: str
    generation: str

class CoverChange(BaseModel):
    rom: str
    generation: str
    revision: str
    image_path: str | None = None
    remove: bool = False

class Rename(BaseModel):
    path: str
    name: str = Field(min_length=1, max_length=255)
    generation: str


def create_app(remote=None, access_code=None):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    remote = remote or Remote()
    covers = CoverStore(ROM_ROOT)
    image_cache = OrderedDict()
    image_lock = threading.Lock()
    code = access_code or secrets.token_urlsafe(9)
    app.state.access_code = code
    app.state.remote = remote
    sessions = {}
    attempts = {}
    auth_lock = threading.Lock()

    @app.middleware('http')
    async def boundary(request, call_next):
        origin = request.headers.get('origin')
        if request.url.path.startswith('/api/') and origin and urlsplit(origin).netloc != request.headers.get('host'):
            return JSONResponse({'detail': 'Este pedido veio de outra origem.'}, status_code=403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN' if request.url.path in ('/api/download','/api/media') else 'DENY'
        response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api/') else 'no-cache'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
        if request.url.path in ('/api/download','/api/media'):
            response.headers['Content-Security-Policy'] = response.headers['Content-Security-Policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'")
        return response

    @app.exception_handler(RemoteError)
    async def remote_error(request, exc):
        return JSONResponse({'detail': exc.data or str(exc)}, status_code=exc.status)

    @app.exception_handler(paramiko.AuthenticationException)
    async def auth_error(request, exc):
        return JSONResponse({'detail': 'O utilizador ou a palavra-passe SSH não foram aceites.'}, status_code=401)

    @app.exception_handler(paramiko.SSHException)
    async def ssh_error(request, exc):
        return JSONResponse({'detail': 'A ligação SSH falhou. Verificar a rede e estabelecer nova ligação.'}, status_code=502)

    @app.exception_handler(OSError)
    async def io_error(request, exc):
        if isinstance(exc, FileNotFoundError):
            return JSONResponse({'detail': 'O ficheiro ou pasta já não existe.'}, status_code=404)
        return JSONResponse({'detail': 'Não foi possível concluir a operação. Verificar a ligação, as permissões e o espaço livre.'}, status_code=502)

    def authenticated(request: Request):
        token = request.cookies.get('romdock_session', '')
        with auth_lock:
            if sessions.get(token, 0) < time.monotonic():
                raise RemoteError('É necessário introduzir o código de acesso da aplicação.', 401)
        return token

    @app.post('/api/login')
    def login(body: Login, request: Request):
        address = request.client.host if request.client else 'local'
        now = time.monotonic()
        with auth_lock:
            recent = [t for t in attempts.get(address, []) if t > now - 60]
            if len(recent) >= 10:
                raise RemoteError('Demasiadas tentativas. Aguarda um minuto.', 429)
            if not hmac.compare_digest(body.code.encode(), code.encode()):
                attempts[address] = recent + [now]
                raise RemoteError('Código de acesso incorreto.', 401)
            attempts.pop(address, None)
            for key, expiry in list(sessions.items()):
                if expiry < now:
                    del sessions[key]
            if len(sessions) >= 128:
                raise RemoteError('Demasiadas sessões abertas.', 429)
            token = secrets.token_urlsafe(32)
            sessions[token] = now + 12 * 3600
        response = JSONResponse({'ok': True})
        response.set_cookie('romdock_session', token, httponly=True, samesite='strict', max_age=12*3600)
        return response

    @app.post('/api/logout')
    def logout(token=Depends(authenticated)):
        with auth_lock:
            sessions.pop(token, None)
        response = JSONResponse({'ok': True})
        response.delete_cookie('romdock_session')
        return response

    @app.get('/api/status', dependencies=[Depends(authenticated)])
    def status():
        return remote.info()

    @app.post('/api/connect', dependencies=[Depends(authenticated)])
    def connect(body: Connection):
        try:
            return remote.connect(**body.model_dump())
        except (TimeoutError, socket.timeout):
            raise RemoteError('A consola não respondeu. Confirmar que está ligada, na mesma rede e com o endereço IP indicado.', 504)
        except OSError as exc:
            if exc.errno == errno.ECONNREFUSED:
                raise RemoteError('A consola recusou a ligação SSH. Confirmar que o serviço SSH está ativo e que a porta está correta.', 502)
            if exc.errno in (errno.EHOSTUNREACH, errno.ENETUNREACH):
                raise RemoteError('Não foi possível alcançar a consola. Confirmar o endereço IP e a ligação à rede local.', 502)
            raise

    @app.get('/api/systems', dependencies=[Depends(authenticated)])
    def systems(generation: str):
        with remote.open(generation) as (sftp, _):
            root = safe_path(sftp, ROM_ROOT, '')
            result = {}
            budget = [500]
            for entry in sftp.listdir_attr(root):
                if entry.filename.startswith('.') or not stat.S_ISDIR(entry.st_mode) or stat.S_ISLNK(entry.st_mode):
                    continue
                result[entry.filename] = has_roms(sftp, ROM_ROOT, entry.filename, budget=budget)
            return {'systems': result}

    @app.get('/api/files', dependencies=[Depends(authenticated)])
    def files(path: str = ''):
        with remote.open() as (sftp, _):
            directory = safe_path(sftp, ROM_ROOT, path)
            if not stat.S_ISDIR(sftp.lstat(directory).st_mode):
                raise RemoteError('É necessário selecionar uma pasta.')
            entries = []
            for entry in sftp.listdir_attr(directory):
                if entry.filename.startswith('.romdock-') and entry.filename.endswith('.part'):
                    continue
                entries.append({'name': entry.filename, 'size': entry.st_size, 'modified': entry.st_mtime,
                                'directory': stat.S_ISDIR(entry.st_mode), 'symlink': stat.S_ISLNK(entry.st_mode)})
            entries.sort(key=lambda e: (not e['directory'], e['name'].casefold()))
            return {'path': path, 'entries': entries}

    def summarize(sftp, path):
        directory = safe_path(sftp, ROM_ROOT, path)
        if not stat.S_ISDIR(sftp.lstat(directory).st_mode):
            raise RemoteError('O destino não é uma pasta.')
        entries = [entry for entry in sftp.listdir_attr(directory)
                   if not stat.S_ISLNK(entry.st_mode)
                   and not (entry.filename.startswith('.romdock-') and entry.filename.endswith('.part'))]
        files = [entry for entry in entries if stat.S_ISREG(entry.st_mode)]
        return {'path': path, 'files': len(files),
                'folders': sum(stat.S_ISDIR(entry.st_mode) for entry in entries),
                'bytes': sum(entry.st_size for entry in files),
                'modified': max((entry.st_mtime for entry in entries), default=0)}

    @app.get('/api/folder-info', dependencies=[Depends(authenticated)])
    def folder_info(path: str, generation: str):
        with remote.open(generation) as (sftp, _):
            return summarize(sftp, path)

    @app.get('/api/preview', dependencies=[Depends(authenticated)])
    def preview_metadata(path: str, generation: str):
        with remote.open(generation) as (sftp, _):
            return file_preview.metadata(sftp, ROM_ROOT, path)

    @app.get('/api/preview-image', dependencies=[Depends(authenticated)])
    def preview_image(path: str, generation: str):
        with remote.open(generation) as (sftp, _):
            return Response(file_preview.thumbnail(sftp, ROM_ROOT, path), media_type='image/webp')

    @app.get('/api/media', dependencies=[Depends(authenticated)])
    def preview_media(request: Request, path: str, generation: str):
        mime = file_preview.MEDIA_TYPES.get(posixpath.splitext(path)[1].lower())
        if not mime:
            raise RemoteError('Este formato utiliza a pré-visualização de texto ou binária.', 415)
        lease = remote.open(generation)
        sftp, _ = lease.__enter__()
        try:
            absolute, entry = file_preview.file_info(sftp, ROM_ROOT, path)
            start, end, partial = file_preview.byte_range(request.headers.get('range'), entry.st_size)
            stream = sftp.open(absolute, 'rb')
            stream.seek(start)
        except BaseException:
            lease.__exit__(None, None, None)
            raise
        closed = False
        def close():
            nonlocal closed
            if closed: return
            closed = True
            try: stream.close()
            finally: lease.__exit__(None, None, None)
        length = end-start+1 if entry.st_size else 0
        def chunks():
            remaining = length
            try:
                while remaining > 0:
                    data = stream.read(min(256*1024, remaining))
                    if not data: break
                    remaining -= len(data)
                    yield data
            finally: close()
        headers = {'Accept-Ranges':'bytes','Content-Length':str(length),
                   'Content-Disposition':"inline; filename*=UTF-8''"+quote(posixpath.basename(path),safe='')}
        if partial: headers['Content-Range'] = f'bytes {start}-{end}/{entry.st_size}'
        return StreamingResponse(chunks(), status_code=206 if partial else 200, media_type=mime,
                                 headers=headers, background=BackgroundTask(close))

    @app.get('/api/covers', dependencies=[Depends(authenticated)])
    def cover_manifest(path: str, generation: str):
        with remote.open(generation) as (sftp, _):
            return covers.manifest(sftp, path)

    @app.get('/api/cover', dependencies=[Depends(authenticated)])
    def cover_detail(rom: str, generation: str):
        with remote.open(generation) as (sftp, _):
            return covers.detail(sftp, rom)

    @app.get('/api/image', dependencies=[Depends(authenticated)])
    def cover_image(path: str, generation: str, version: str = ''):
        # Still validate the current connection generation before serving cached data.
        if remote.info(check=False).get('generation') != generation:
            raise RemoteError('A ligação mudou. Atualizar a pasta.', 409)
        key = (generation, path, version)
        with image_lock:
            cached = image_cache.get(key) if version else None
            if cached is not None:
                image_cache.move_to_end(key)
                return Response(cached, media_type='image/webp')
        with remote.open(generation) as (sftp, _):
            data = covers.thumbnail(sftp, path)
        if version:
            with image_lock:
                image_cache[key] = data
                while len(image_cache) > 64:
                    image_cache.popitem(last=False)
        return Response(data, media_type='image/webp')

    @app.post('/api/cover', dependencies=[Depends(authenticated)])
    def change_cover(body: CoverChange):
        with remote.open(body.generation) as (sftp, _):
            result = covers.assign(sftp, body.rom, body.revision, image_path=body.image_path, remove=body.remove)
        with image_lock:
            image_cache.clear()
        return result

    @app.put('/api/cover', dependencies=[Depends(authenticated)])
    async def upload_cover(request: Request, rom: str, generation: str, revision: str):
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_IMAGE_BYTES:
                raise RemoteError('A imagem deve ter até 8 MB.', 413)
            data.extend(chunk)
        def save():
            with remote.open(generation) as (sftp, _):
                return covers.assign(sftp, rom, revision, upload=bytes(data))
        result = await run_in_threadpool(save)
        with image_lock:
            image_cache.clear()
        return result

    @app.post('/api/folder', dependencies=[Depends(authenticated)])
    def folder(body: Folder):
        if not body.path:
            raise RemoteError('É necessário indicar o nome da pasta.')
        with remote.open(body.generation) as (sftp, _):
            destination = safe_path(sftp, ROM_ROOT, body.path, allow_missing=True)
            existing = exists(sftp, destination)
            if existing:
                raise RemoteError('Já existe um ficheiro ou pasta com este nome.', 409)
            sftp.mkdir(destination)
        return {'ok': True}

    @app.post('/api/rename', dependencies=[Depends(authenticated)])
    def rename(body: Rename):
        if not body.path or '/' in body.name or '\\' in body.name or body.name in ('.', '..') or '\x00' in body.name:
            raise RemoteError('O nome deve ser válido e não pode conter barras.')
        with remote.open(body.generation) as (sftp, _):
            source = safe_path(sftp, ROM_ROOT, body.path)
            destination = safe_path(sftp, ROM_ROOT, posixpath.join(posixpath.dirname(body.path), body.name), allow_missing=True)
            if source == destination:
                return {'ok': True}
            if exists(sftp, destination):
                raise RemoteError('Já existe um ficheiro ou pasta com este nome.', 409)
            sftp.rename(source, destination)
        return {'ok': True}

    @app.delete('/api/entry', dependencies=[Depends(authenticated)])
    def delete(path: str, generation: str):
        if not path:
            raise RemoteError('A pasta principal de ROMs não pode ser eliminada.')
        with remote.open(generation) as (sftp, _):
            source = safe_path(sftp, ROM_ROOT, path)
            mode = sftp.lstat(source).st_mode
            if stat.S_ISDIR(mode):
                if sftp.listdir(source):
                    raise RemoteError('Só é possível eliminar pastas vazias.', 409)
                sftp.rmdir(source)
            elif stat.S_ISREG(mode):
                sftp.remove(source)
            else:
                raise RemoteError('Este tipo de ficheiro não pode ser eliminado.')
        return {'ok': True}

    @app.put('/api/upload', dependencies=[Depends(authenticated)])
    async def upload(request: Request, path: str, generation: str, overwrite: bool = False):
        if not path:
            raise RemoteError('É necessário indicar o nome do ficheiro.')
        lease = remote.open(generation)
        sftp, _ = await run_in_threadpool(lease.__enter__)
        temporary = None
        stream = None
        received = 0
        try:
            destination = await run_in_threadpool(safe_path, sftp, ROM_ROOT, path, True)
            entry = await run_in_threadpool(exists, sftp, destination)
            if entry and (not overwrite or not stat.S_ISREG(entry.st_mode)):
                raise RemoteError('Já existe um ficheiro com este nome.', 409)
            temporary = posixpath.join(posixpath.dirname(destination), f'.romdock-{secrets.token_hex(16)}.part')
            stream = await run_in_threadpool(sftp.open, temporary, 'wx')
            async for chunk in request.stream():
                if chunk:
                    await run_in_threadpool(stream.write, chunk)
                    received += len(chunk)
            await run_in_threadpool(stream.close)
            stream = None
            length = request.headers.get('content-length')
            if length is not None and received != int(length):
                raise RemoteError('O envio foi interrompido antes de receber o ficheiro completo.', 400)
            await run_in_threadpool(publish_upload, sftp, ROM_ROOT, temporary, path, overwrite)
            temporary = None
            return {'ok': True, 'bytes': received}
        finally:
            # Shield cleanup from disconnect cancellation. Never publish an incomplete file.
            async def cleanup():
                if stream:
                    try:
                        await run_in_threadpool(stream.close)
                    except Exception:
                        pass
                if temporary:
                    try:
                        await run_in_threadpool(sftp.remove, temporary)
                    except Exception:
                        pass
                await run_in_threadpool(lease.__exit__, None, None, None)
            import anyio
            with anyio.CancelScope(shield=True):
                await cleanup()

    @app.get('/api/download', dependencies=[Depends(authenticated)])
    def download(path: str, generation: str):
        lease = remote.open(generation)
        sftp, _ = lease.__enter__()
        try:
            source = safe_path(sftp, ROM_ROOT, path)
            entry = sftp.lstat(source)
            if not stat.S_ISREG(entry.st_mode):
                raise RemoteError('Só é possível descarregar ficheiros normais.')
            stream = sftp.open(source, 'rb')
        except BaseException:
            lease.__exit__(None, None, None)
            raise
        def chunks():
            try:
                while chunk := stream.read(256 * 1024):
                    yield chunk
            finally:
                stream.close()
                lease.__exit__(None, None, None)
        return StreamingResponse(chunks(), media_type='application/octet-stream', headers={
            'Content-Length': str(entry.st_size),
            'Content-Disposition': "attachment; filename*=UTF-8''" + quote(posixpath.basename(path), safe=''),
        })

    dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
    if dist.is_dir():
        app.mount('/', StaticFiles(directory=dist, html=True), name='frontend')
    return app


def main():
    import uvicorn
    app = create_app(access_code=os.environ.get('ROMDOCK_ACCESS_CODE'))
    import socket
    port = int(os.environ.get('ROMDOCK_PORT', '8765'))
    lan = 'IP-DO-PC'
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(('192.0.2.1', 80))
            lan = probe.getsockname()[0]
    except OSError:
        pass
    print(f'\n  ROM DOCK · Gestor de ROMs\n  Local: http://localhost:{port}\n  Rede: http://{lan}:{port}\n  Código de acesso: ' + app.state.access_code + '\n', flush=True)
    uvicorn.run(app, host='0.0.0.0', port=port, access_log=False)

if __name__ == '__main__':
    main()
