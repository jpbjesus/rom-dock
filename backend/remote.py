"""SFTP boundary: credentials live in memory; every operation stays below ROM_ROOT."""
import base64
import hashlib
import json
import os
import posixpath
import secrets
import socket
import stat
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import paramiko

ROM_ROOT = '/storage/roms'

class RemoteError(Exception):
    def __init__(self, message, status=400, data=None):
        super().__init__(message)
        self.status = status
        self.data = data


def safe_path(sftp, root: str, relative: str, allow_missing=False) -> str:
    if not isinstance(relative, str) or '\x00' in relative or '\\' in relative or relative.startswith('/'):
        raise RemoteError('Caminho inválido.')
    if stat.S_ISLNK(sftp.lstat(root).st_mode) or sftp.normalize(root) != root:
        raise RemoteError('A raiz de ROMs mudou ou é uma ligação simbólica.')
    parts = relative.split('/') if relative else []
    if any(p in ('', '.', '..') for p in parts):
        raise RemoteError('O caminho tem de ficar dentro da pasta de ROMs.')
    current = root
    for index, part in enumerate(parts):
        current = posixpath.join(current, part)
        try:
            mode = sftp.lstat(current).st_mode
        except FileNotFoundError:
            if allow_missing and index == len(parts) - 1:
                return current
            raise RemoteError('O ficheiro ou pasta já não existe.', 404)
        if stat.S_ISLNK(mode):
            raise RemoteError('Ligações simbólicas não são permitidas.')
        if index < len(parts) - 1 and not stat.S_ISDIR(mode):
            raise RemoteError('O caminho contém um ficheiro em vez de uma pasta.')
    normalized = sftp.normalize(current)
    if normalized != root and not normalized.startswith(root + '/'):
        raise RemoteError('O caminho está fora da pasta de ROMs.')
    return current


def exists(sftp, path):
    try:
        return sftp.lstat(path)
    except FileNotFoundError:
        return None


def publish_upload(sftp, root, temporary, relative, overwrite):
    destination = safe_path(sftp, root, relative, allow_missing=True)
    entry = exists(sftp, destination)
    if entry and not stat.S_ISREG(entry.st_mode):
        raise RemoteError('O destino não é um ficheiro normal.', 409)
    if entry and not overwrite:
        raise RemoteError('Já existe um ficheiro com este nome.', 409)
    if overwrite:
        try:
            sftp.posix_rename(temporary, destination)
        except OSError:
            raise RemoteError('A consola não permitiu a substituição atómica. O original foi preservado.', 409)
    else:
        # Standard SFTP rename must fail when the destination already exists.
        try:
            sftp.rename(temporary, destination)
        except OSError:
            raise RemoteError('Não foi possível concluir o envio. O nome de destino poderá já existir.', 409)


def fingerprint(key):
    return 'SHA256:' + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')

@dataclass(repr=False)
class Configuration:
    host: str
    port: int
    username: str
    password: str
    key: str
    generation: str


class Remote:
    def __init__(self, trust_path=None):
        self.trust_path = Path(trust_path or Path(__file__).resolve().parents[1] / '.runtime' / 'trusted-hosts.json')
        self.config = None
        self.lock = threading.RLock()
        self.active = 0

    def _transport(self, host, port):
        sock = socket.create_connection((host, port), timeout=8)
        transport = paramiko.Transport(sock)
        transport.banner_timeout = 8
        transport.auth_timeout = 10
        try:
            transport.start_client(timeout=10)
            if not transport.is_active():
                raise RemoteError('A consola não iniciou a ligação SSH.', 502)
            return transport
        except BaseException:
            transport.close()
            raise

    def connect(self, host, port, username, password, accepted_key=None):
        with self.lock:
            if self.active:
                raise RemoteError('É necessário aguardar pelo fim das operações antes de estabelecer nova ligação.', 409)
            transport = self._transport(host, port)
            try:
                key = fingerprint(transport.get_remote_server_key())
                known = json.loads(self.trust_path.read_text()) if self.trust_path.exists() else {}
                identifier = f'{host}:{port}'
                previous = known.get(identifier)
                if previous != key and accepted_key != key:
                    raise RemoteError('É necessário confirmar a identidade SSH da consola.', 409, {
                        'type': 'host_key', 'fingerprint': key, 'changed': previous is not None,
                        'host': host, 'previous': previous,
                    })
                transport.auth_password(username, password, fallback=False)
                sftp = paramiko.SFTPClient.from_transport(transport)
                try:
                    if sftp.normalize(ROM_ROOT) != ROM_ROOT:
                        raise RemoteError('A raiz de ROMs não corresponde ao caminho esperado.')
                    if not stat.S_ISDIR(sftp.lstat(ROM_ROOT).st_mode):
                        raise RemoteError('A pasta de ROMs não foi encontrada.', 404)
                finally:
                    sftp.close()
                if previous != key:
                    self.trust_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    known[identifier] = key
                    temporary = self.trust_path.with_suffix('.tmp')
                    temporary.write_text(json.dumps(known))
                    temporary.chmod(0o600)
                    temporary.replace(self.trust_path)
                self.config = Configuration(host, port, username, password, key, secrets.token_urlsafe(18))
            finally:
                transport.close()
        return self.info(check=False)

    @contextmanager
    def open(self, generation=None):
        with self.lock:
            config = self.config
            if not config:
                raise RemoteError('É necessário estabelecer ligação à consola.', 409)
            if generation is not None and generation != config.generation:
                raise RemoteError('A ligação mudou. É necessário selecionar novamente os ficheiros.', 409)
            self.active += 1
        transport = None
        sftp = None
        try:
            transport = self._transport(config.host, config.port)
            if fingerprint(transport.get_remote_server_key()) != config.key:
                raise RemoteError('A identidade SSH da consola mudou. É necessária uma nova confirmação.', 409)
            transport.auth_password(config.username, config.password, fallback=False)
            sftp = paramiko.SFTPClient.from_transport(transport)
            sftp.get_channel().settimeout(30)
            yield sftp, transport
        finally:
            if sftp:
                sftp.close()
            if transport:
                transport.close()
            with self.lock:
                self.active -= 1

    def info(self, check=True):
        with self.lock:
            config = self.config
            if not config:
                return {'connected': False}
            result = {'connected': True, 'host': config.host, 'port': config.port,
                      'username': config.username, 'generation': config.generation, 'root': ROM_ROOT}
        if check:
            with self.open(config.generation) as (sftp, transport):
                safe_path(sftp, ROM_ROOT, '')
                channel = transport.open_session(timeout=8)
                try:
                    channel.settimeout(8)
                    channel.exec_command('df -Pk /storage/roms')
                    output = channel.makefile('r').read(16384).decode()
                    values = output.strip().splitlines()[-1].split()
                    result['storage'] = {'total': int(values[1]) * 1024, 'used': int(values[2]) * 1024,
                                         'free': int(values[3]) * 1024}
                except (OSError, ValueError, IndexError, paramiko.SSHException):
                    result['storage'] = None
                finally:
                    channel.close()
        return result
