"""Generate PWA icons and a content-derived cache version (standard library only)."""
import hashlib
import re
import struct
import zlib
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / 'web'


def chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))


def icon(size):
    # Same simple dumbbell geometry as icon.svg; keep it inside maskable safe area.
    boxes = [(152, 232, 360, 280), (120, 176, 160, 336), (168, 152, 208, 360),
             (304, 152, 344, 360), (352, 176, 392, 336)]
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            inside = any(a <= x * 512 / size < c and b <= y * 512 / size < d for a, b, c, d in boxes)
            raw.extend((213, 236, 180) if inside else (21, 59, 49))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


for size in (192, 512):
    (WEB / f'icon-{size}.png').write_bytes(icon(size))
worker = WEB / 'service-worker.js'
source = worker.read_text(encoding='utf-8')
neutral = re.sub(r"const RELEASE = '[^']*';", "const RELEASE = '';", source)
digest = hashlib.sha256(neutral.encode())
for file in sorted(WEB.iterdir()):
    if file.is_file() and file != worker:
        digest.update(file.name.encode())
        digest.update(file.read_bytes())
version = digest.hexdigest()[:16]
worker.write_text(re.sub(r"const RELEASE = '[^']*';", f"const RELEASE = '{version}';", source), encoding='utf-8')
print(f'Gotowy pakiet statyczny web/; wersja cache: {version}')
