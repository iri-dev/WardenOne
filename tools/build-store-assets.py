# WardenOne — Copyright (C) 2026 iri
# Licensed under the GNU General Public License v3 or later. See LICENSE.
# Official source: https://github.com/iri-dev/WardenOne
#
# Build the Chrome Web Store screenshot candidates from docs/store/candidates.json.
#
# The Store wants exactly 1280x800 (or 640x400). The product captures in docs/screenshots are
# high-DPI crops of whatever size the surface was, so each one is scaled to fit a 1280x800 frame
# on the brand background, with its caption drawn into the frame -- the Store has no caption
# field of its own, and a controlled threat example has to say it is one on the image itself.
#
# Everything about a candidate comes from the manifest: the source capture, the output name and
# the caption. Nothing here is typed twice, and tools/test-store-assets.js checks that the
# folder matches the manifest, so a stale frame cannot sit beside the current ones unnoticed.
#
# Run: python tools/build-store-assets.py
"""Letterbox the chosen product captures into Store-sized frames."""
import io
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(ROOT, 'docs', 'store')
MANIFEST = os.path.join(STORE, 'candidates.json')

TOP = (232, 214, 246)       # lavender, the brand ground
BOTTOM = (247, 231, 240)    # towards the pink edge of the gradient
INK = (45, 27, 64)          # plum text
SHADOW = (90, 50, 120)


def gradient(width, height):
    img = Image.new('RGB', (width, height), TOP)
    px = img.load()
    for y in range(height):
        t = y / max(1, height - 1)
        row = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        for x in range(width):
            px[x, y] = row
    return img


def font(size):
    # Pillow bundles a scalable face for load_default since 10.1; no system font is assumed.
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def wrap(draw, text, face, max_width):
    words = text.split()
    lines, line = [], ''
    for word in words:
        trial = (line + ' ' + word).strip()
        if draw.textlength(trial, font=face) <= max_width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def rounded(image, radius):
    mask = Image.new('L', image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width - 1, image.height - 1), radius=radius, fill=255)
    out = image.convert('RGBA')
    out.putalpha(mask)
    return out


def build(entry, frame_w, frame_h):
    src = os.path.join(ROOT, entry['source'].replace('/', os.sep))
    shot = Image.open(src).convert('RGB')

    # The caption band takes the bottom; the capture gets the rest, with margins.
    caption_h = 96
    margin = 48
    box_w = frame_w - 2 * margin
    box_h = frame_h - caption_h - 2 * margin
    scale = min(box_w / shot.width, box_h / shot.height)
    size = (max(1, int(shot.width * scale)), max(1, int(shot.height * scale)))
    shot = shot.resize(size, Image.LANCZOS)

    canvas = gradient(frame_w, frame_h).convert('RGBA')
    x = (frame_w - size[0]) // 2
    y = margin + (box_h - size[1]) // 2

    # A soft shadow under the capture, so it reads as a card rather than a pasted rectangle.
    shadow = Image.new('RGBA', (size[0] + 80, size[1] + 80), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((40, 48, size[0] + 40, size[1] + 48), radius=18,
                                             fill=SHADOW + (70,))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(shadow, (x - 40, y - 40))
    canvas.alpha_composite(rounded(shot, 14), (x, y))

    draw = ImageDraw.Draw(canvas)
    face = font(26)
    lines = wrap(draw, entry['caption'], face, frame_w - 2 * margin)[:2]
    line_h = 34
    total = line_h * len(lines)
    ty = frame_h - caption_h + (caption_h - total) // 2
    for line in lines:
        tw = draw.textlength(line, font=face)
        draw.text(((frame_w - tw) / 2, ty), line, font=face, fill=INK)
        ty += line_h
    return canvas.convert('RGB')


def main():
    with io.open(MANIFEST, 'r', encoding='utf-8') as handle:
        manifest = json.load(handle)
    frame_w = int(manifest['frame']['width'])
    frame_h = int(manifest['frame']['height'])
    entries = manifest['screenshots']
    if len(entries) > 5:
        print('the Store shows at most five screenshots; the manifest lists ' + str(len(entries)))
        return 1
    for entry in entries:
        out = os.path.join(STORE, entry['file'])
        image = build(entry, frame_w, frame_h)
        image.save(out, 'PNG', optimize=True)
        print('  wrote ' + entry['file'] + ' (' + str(image.width) + 'x' + str(image.height) + ') from ' + entry['source'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
