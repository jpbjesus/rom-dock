"""Read-only, bounded detection of recognized ROM files in system folders."""
import posixpath
import stat
from .remote import RemoteError, safe_path

ROM_EXTENSIONS = frozenset('zip 7z nes fds sfc smc fig swc gb gbc gba nds 3ds cia n64 z64 v64 md gen smd sms gg sg pce sgx cue bin iso chd cso pbp cdi gdi m3u a26 a52 a78 lnx jag j64 ndx ngp ngc ws wsc vb vec col int rom dsk adf ipf hdf tap t64 d64 prg crt xex atr aob dol elf wad wbfs gcm rvz wud wux nsp xci vpk'.split())
ASSET_FOLDERS = frozenset(('images', 'videos', 'manuals', 'media', 'screenshots', 'bezels', 'savestates', 'saves', 'bios'))

def has_roms(sftp, root, relative, limit=200, budget=None):
    pending = [relative]
    inspected = 0
    unknown = False
    while pending:
        if inspected >= limit or (budget is not None and budget[0] <= 0):
            return None
        current = pending.pop()
        inspected += 1
        if budget is not None:
            budget[0] -= 1
        try:
            directory = safe_path(sftp, root, current)
            entries = sftp.listdir_attr(directory)
            children = []
            for entry in entries:
                name = entry.filename
                if name.startswith('.') or name in ('.', '..') or '/' in name or '\\' in name:
                    continue
                if stat.S_ISLNK(entry.st_mode):
                    continue
                if stat.S_ISREG(entry.st_mode) and name.rsplit('.', 1)[-1].lower() in ROM_EXTENSIONS:
                    return True
                if stat.S_ISDIR(entry.st_mode) and name.lower() not in ASSET_FOLDERS:
                    children.append(posixpath.join(current, name))
            pending.extend(children)
        except (OSError, ValueError, RemoteError):
            unknown = True
    return None if unknown else False
