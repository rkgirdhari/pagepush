#!/usr/bin/env python3
"""Generate placeholder toolbar icons (16/48/128px) for Page Push using only the
Python standard library (zlib + struct), so no image dependencies are required
in the build/CI environment. Produces a simple blue rounded-square with a white
"push" arrow/target glyph -- swap these for final branding before Chrome Web
Store submission (see LAUNCH_CHECKLIST.md)."""
import struct
import zlib
import os

BLUE = (24, 119, 242, 255)  # #1877F2, Facebook brand blue
WHITE = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)


def rounded_square_with_arrow(size):
    """Return a size x size RGBA pixel grid: blue rounded square, white upward arrow."""
    pixels = [[TRANSPARENT for _ in range(size)] for _ in range(size)]
    radius = max(2, size // 6)

    def in_rounded_square(x, y):
        # Inside the square minus rounded-off corners.
        if radius <= 0:
            return True
        corners = [
            (radius, radius),
            (size - radius - 1, radius),
            (radius, size - radius - 1),
            (size - radius - 1, size - radius - 1),
        ]
        if x < radius and y < radius:
            cx, cy = corners[0]
            return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
        if x >= size - radius and y < radius:
            cx, cy = corners[1]
            return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
        if x < radius and y >= size - radius:
            cx, cy = corners[2]
            return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
        if x >= size - radius and y >= size - radius:
            cx, cy = corners[3]
            return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
        return True

    for y in range(size):
        for x in range(size):
            if in_rounded_square(x, y):
                pixels[y][x] = BLUE

    # Draw a simple white upward "push" arrow triangle in the center (apex at top,
    # base at bottom) plus a short stem, evoking an upload/send arrow.
    cx, cy = size / 2, size / 2
    half = size * 0.24
    for y in range(size):
        for x in range(size):
            nx, ny = (x - cx) / half, (y - cy) / half
            if -1 <= ny <= 0.3 and abs(nx) <= (ny + 1) * 0.95:
                if pixels[y][x] != TRANSPARENT:
                    pixels[y][x] = WHITE
            if 0.3 <= ny <= 0.95 and abs(nx) <= 0.28:
                if pixels[y][x] != TRANSPARENT:
                    pixels[y][x] = WHITE

    return pixels


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0 (none) per scanline
        for (r, g, b, a) in row:
            raw += bytes([r, g, b, a])

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    for size in (16, 48, 128):
        write_png(os.path.join(out_dir, f"icon{size}.png"), rounded_square_with_arrow(size))
        print(f"wrote icon{size}.png")
