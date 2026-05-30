#!/usr/bin/env python3
"""Generate dark app icons with an orange crescent moon. Pure stdlib (zlib)."""
import struct, zlib, os

def make_png(path, size):
    bg = (10, 10, 15)
    accent = (255, 106, 0)
    cx, cy, r = size * 0.5, size * 0.46, size * 0.30
    ox, oy = cx + r * 0.55, cy - r * 0.30  # cut-out circle for crescent

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        for x in range(size):
            dx, dy = x - cx, y - cy
            in_moon = dx * dx + dy * dy <= r * r
            in_cut = (x - ox) ** 2 + (y - oy) ** 2 <= (r * 0.85) ** 2
            raw += bytes(accent if (in_moon and not in_cut) else bg)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + \
          chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path)

if __name__ == "__main__":
    base = os.path.join(os.path.dirname(__file__), "..", "icons")
    make_png(os.path.join(base, "icon-192.png"), 192)
    make_png(os.path.join(base, "icon-512.png"), 512)
