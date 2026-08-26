#!/usr/bin/env python
"""Build a YouTube thumbnail for one of the traks channel's videos.

    python scripts/make_youtube_thumbnail.py tour

WHY THIS EXISTS
The channel's first thumbnail (images/youtube-thumbnail.png) was made by hand and
committed as a PNG with nothing behind it. That is the same drift the landing page
had before deploy_site.py: an artefact nobody can regenerate, so the next one is
made from scratch and looks like a different channel.

A channel of two videos cannot use one image twice. In a subscriptions feed the
thumbnail IS the difference between them, so each entry below carries its own
source render and its own two lines of type, and only the layout is shared.

SIZING: YouTube serves this at roughly 360x202 in a feed and 210x118 in sidebars,
so the headline is set far larger than looks sensible at 1280x720. If it is
readable in the 210px preview the script prints, it works.
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
IMG = ROOT / "images"

W, H = 1280, 720
BG = (6, 13, 10)
INK = (255, 255, 255)
ACC = (52, 211, 153)
SUB = (200, 214, 206)

# Each thumbnail: the render behind it, where to bias the crop, and the type.
SHOTS = {
    "tour": {
        "source": "3d-stack-rooms.png",
        "bias": 0.62,          # 0 = crop from the left edge, 1 = from the right
        "out": "youtube-thumbnail-tour.png",
        "line1": "The whole",
        "line2": "tour, in 45s",
        "sub": ["Floor plans, calibration, replay", "PadSpan HA for Home Assistant"],
    },
}


def font(names, size):
    for d in (pathlib.Path(r"C:\Windows\Fonts"), pathlib.Path("/usr/share/fonts/truetype/dejavu")):
        for n in names:
            p = d / n
            if p.exists():
                try:
                    return ImageFont.truetype(str(p), size)
                except OSError:
                    pass
    return ImageFont.load_default()


BOLD = ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
REG = ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]


def cover(src: Image.Image, bias: float) -> Image.Image:
    """Fill 1280x720 without distorting, keeping the interesting side in frame."""
    scale = max(W / src.width, H / src.height)
    im = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
    x = round((im.width - W) * bias)
    y = round((im.height - H) * 0.5)
    return im.crop((x, y, x + W, y + H))


def build(key: str) -> pathlib.Path:
    spec = SHOTS[key]
    src = Image.open(IMG / spec["source"]).convert("RGB")
    im = Image.new("RGB", (W, H), BG)
    im.paste(cover(src, spec["bias"]), (0, 0))

    # A left-to-right scrim, so the type sits on quiet ground and the render
    # still reads on the right. Drawn per-column rather than as a gradient image
    # because the falloff wants to be steeper than linear.
    scrim = Image.new("L", (W, 1))
    px = scrim.load()
    for x in range(W):
        t = min(1.0, max(0.0, (x - 40) / 830.0))
        px[x, 0] = int(246 * (1.0 - t) ** 1.35)
    mask = scrim.resize((W, H))
    im = Image.composite(Image.new("RGB", (W, H), BG), im, mask)

    dr = ImageDraw.Draw(im)
    f1 = font(BOLD, 96)
    f2 = font(REG, 34)
    f3 = font(BOLD, 34)

    dr.text((76, 214), spec["line1"], font=f1, fill=INK)
    dr.text((76, 316), spec["line2"], font=f1, fill=ACC)
    w2 = dr.textlength(spec["line2"], font=f1)
    dr.line([(78, 424), (78 + w2 * 0.62, 424)], fill=ACC, width=6)

    y = 460
    for line in spec["sub"]:
        dr.text((76, y), line, font=f2, fill=SUB)
        y += 47

    dr.text((76, 636), "traks", font=f3, fill=SUB)
    dr.line([(78, 676), (162, 676)], fill=ACC, width=4)

    out = IMG / spec["out"]
    im.save(out, "PNG", optimize=True)

    # What YouTube actually shows in a sidebar. If it is illegible here, it is
    # illegible where it counts.
    im.resize((210, 118), Image.LANCZOS).save(ROOT / "build" / f"{key}-preview-210.png")
    return out


def main() -> None:
    keys = sys.argv[1:] or list(SHOTS)
    (ROOT / "build").mkdir(exist_ok=True)
    for k in keys:
        if k not in SHOTS:
            sys.exit(f"unknown thumbnail {k!r}; known: {', '.join(SHOTS)}")
        p = build(k)
        print(f"{p}  {p.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
