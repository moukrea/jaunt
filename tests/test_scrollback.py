import os
from pathlib import Path
from jaunt.scrollback import Scrollback, purge, SEGMENT_BYTES

def test_segments_rotate_read_spans_and_oldest_drops(tmp_path, monkeypatch):
    monkeypatch.setattr('jaunt.scrollback.SEGMENT_BYTES', 1000)
    sb = Scrollback(tmp_path, 'abc', max_bytes=3500)
    offset = 0
    for i in range(12):
        chunk = (f'{i:02d}' * 200).encode()[:400]
        sb.append(offset, chunk); offset += len(chunk)
    assert sb.end == offset and sb.start is not None and sb.start > 0, 'oldest segments are dropped beyond the cap'
    assert sum(s[1] for s in sb.segments) <= 3500 + 1000
    begin, data = sb.read(offset, 1200)
    assert begin == offset - 1200 and len(data) == 1200 and data.endswith(b'11' * 200)
    assert data[:2] == (f'{(offset - 1200) // 400:02d}').encode()
    begin, data = sb.read(offset, 10 ** 9)
    assert begin == sb.start and len(data) == offset - sb.start
    assert oct(os.stat(sb.dir).st_mode & 0o777) == oct(0o700) and all(oct(p.stat().st_mode & 0o777) == oct(0o600) for _, _, p in sb.segments)
    # Reopen (host updated in place): the same directory yields the same stream.
    sb.close(); again = Scrollback(tmp_path, 'abc', max_bytes=3500)
    assert (again.start, again.end) == (sb.start, sb.end)
    again.append(offset, b'tail'); assert again.read(offset + 4, 4) == (offset, b'tail')
    again.delete(); assert not sb.dir.exists()

def test_purge_keeps_live_sessions(tmp_path):
    Scrollback(tmp_path, 'live').append(0, b'x'); Scrollback(tmp_path, 'dead').append(0, b'y')
    purge(tmp_path, {'live'})
    assert (tmp_path / 'scrollback' / 'live').exists() and not (tmp_path / 'scrollback' / 'dead').exists()
