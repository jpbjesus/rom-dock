from backend.systems import has_roms
from tests.test_api import DiskSFTP

def test_rom_detection_ignores_media_and_follows_nested_games(tmp_path):
    system=tmp_path/'snes'; system.mkdir()
    images=system/'images'; images.mkdir(); (images/'box.png').write_bytes(b'image')
    (system/'gamelist.xml').write_text('<gameList/>')
    assert has_roms(DiskSFTP(),str(tmp_path),'snes') is False
    child=system/'games'; child.mkdir(); (child/'example.SFC').write_bytes(b'game')
    assert has_roms(DiskSFTP(),str(tmp_path),'snes') is True

def test_detection_does_not_follow_symlinks_and_reports_scan_limits(tmp_path):
    system=tmp_path/'snes'; system.mkdir()
    outside=tmp_path/'outside.sfc'; outside.write_bytes(b'game')
    (system/'linked.sfc').symlink_to(outside)
    assert has_roms(DiskSFTP(),str(tmp_path),'snes') is False
    (system/'child').mkdir()
    assert has_roms(DiskSFTP(),str(tmp_path),'snes',limit=1) is None

def test_missing_folder_is_indeterminate_and_request_budget_is_shared(tmp_path):
    assert has_roms(DiskSFTP(),str(tmp_path),'missing') is None
    for name in ('one','two'): (tmp_path/name).mkdir()
    budget=[1]
    assert has_roms(DiskSFTP(),str(tmp_path),'one',budget=budget) is False
    assert has_roms(DiskSFTP(),str(tmp_path),'two',budget=budget) is None
