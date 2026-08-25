#!/usr/bin/env python
"""Build the ~45s PadSpan HA marketing video from the product screenshots.

    python scripts/make_marketing_video.py            # frames + MP4
    python scripts/make_marketing_video.py --frames   # frames only (fast iteration)
    python scripts/make_marketing_video.py --encode   # re-encode existing frames

HOW THIS DIFFERS FROM make_demo_montage.py, AND WHY BOTH EXIST
`make_demo_montage.py` builds a 20s seamless LOOP with one-line labels. Its job is
to be native media on a Reddit post: it has to read in three seconds, in a feed,
muted, and never end. It is deliberately not explanatory.

This builds a VIDEO — a beginning, an argument and an end. It opens on the
question the product answers, spends one beat per capability explaining what you
are looking at, and closes on how to get it. It is for YouTube and the website,
where somebody has already chosen to watch and will give it forty seconds.

BOTH ARE STILLS. Neither shows live tracking, because no recording of live
tracking exists. The clip that would genuinely sell this is ~30s of Traceback
playback — devices crossing rooms over time — or Follow mode. When that exists,
this script's shot list is the storyboard for it: keep the arc, replace the
stills with the real thing.

The focal points below were tuned in make_demo_montage.py against these exact
screenshots and are reused verbatim. They are per-shot because these are real
captures, not stock: the traceback map sits in the top quarter above a large
control panel, the beacon-tune stack sits at the bottom under a form. One shared
pan rule put the chrome on screen instead of the product.

Output: images/padspan-marketing.mp4
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
IMG = ROOT / "images"
WORK = ROOT / "build" / "marketing"
OUT_MP4 = IMG / "padspan-marketing.mp4"

W, H = 1920, 1080
FPS = 30
FADE = 24                    # cross-fade length, frames
ACC = (52, 211, 153)         # the product accent
INK = (240, 250, 243)
DIM = (168, 186, 178)
GROUND = (6, 13, 9)

# (file, headline, sub, zoom direction, focus x, focus y, seconds, dim)
# `dim` multiplies the source brightness. The architectural plan is a near-white
# scan; at full brightness it strobes against a sequence that is otherwise dark,
# and the caption scrim cannot save the top two thirds. Darkening the SOURCE
# keeps the beat and the meaning ("this is your own plan") without the flash.
SHOTS: list[tuple[str, str, str, str, float, float, float, float]] = [
    ("overview-3d-multifloor.jpg",
     "Which room, not just home or away",
     "Every Bluetooth device placed room by room, across every floor",
     "in", 0.46, 0.46, 6.0, 1.00),
    ("floor-plan-edit.png",
     "Your own floor plan, in metres",
     "Draw the rooms once. Re-crop the plan and nothing moves.",
     "in", 0.50, 0.58, 5.5, 0.62),
    # beacon-tune-calibration.jpg was here first and is the wrong capture for a
    # video: its form occupies the top two thirds, so every wide moment of the
    # pan shows chrome instead of the product. This one is the same feature with
    # the 3D stack filling the frame and only a thin control strip above it.
    ("calibration-tune-3d.png",
     "Place scanners where they really are",
     "Then walk the house to calibrate - it scores itself as you go",
     "in", 0.52, 0.62, 5.5, 1.00),
    ("overview-3d-heatmap.jpg",
     "Walls are modelled, not guessed",
     "RF barriers carry real attenuation; floors carry an elevation",
     "in", 0.52, 0.52, 5.5, 1.00),
    ("traceback-playback-3d.png",
     "Replay where anything went",
     "Minute by minute, across floors, after the fact",
     "out", 0.50, 0.24, 5.5, 1.00),
    ("training-hub.png",
     "Try all of it before buying hardware",
     "Full sample mode, plus 14 walkthroughs in the training hub",
     "in", 0.50, 0.45, 5.0, 0.88),
    ("wall-panel-in-situ.jpg",
     "Running on the wall, every day",
     "Local only. No cloud, no subscription, no custom firmware.",
     "out", 0.58, 0.50, 5.0, 1.00),
]

TITLE_S = 3.2
END_S = 4.6

_FONT_DIRS = [pathlib.Path(r"C:\Windows\Fonts"), pathlib.Path("/usr/share/fonts")]


def font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    for d in _FONT_DIRS:
        for n in names:
            p = d / n
            if p.exists():
                try:
                    return ImageFont.truetype(str(p), size)
                except OSError:
                    pass
        if d.exists():
            for p in d.rglob(names[-1]):
                try:
                    return ImageFont.truetype(str(p), size)
                except OSError:
                    pass
    return ImageFont.load_default()


BOLD = ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
REG = ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]

F_HEAD = font(BOLD, 62)
F_SUB = font(REG, 38)
F_TITLE = font(BOLD, 104)
F_TITLE_SUB = font(REG, 44)
F_END = font(BOLD, 76)
F_END_SUB = font(REG, 40)
F_MARK = font(REG, 26)


def _ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


OVER = 1.20
BW, BH = int(W * OVER), int(H * OVER)
_CACHE: dict[str, Image.Image] = {}


def _load(name: str, fx: float, fy: float, dim: float = 1.0) -> Image.Image:
    src = Image.open(IMG / name).convert("RGB")
    scale = max(BW / src.width, BH / src.height)
    src = src.resize((max(BW, int(src.width * scale)), max(BH, int(src.height * scale))),
                     Image.LANCZOS)
    cx, cy = fx * src.width, fy * src.height
    left = int(min(max(cx - BW / 2, 0), src.width - BW))
    top = int(min(max(cy - BH / 2, 0), src.height - BH))
    out = src.crop((left, top, left + BW, top + BH))
    if dim < 0.999:
        out = Image.eval(out, lambda v: int(v * dim))
    return out


def _scrim(img: Image.Image, band: int = 400) -> None:
    """Darken the bottom so two lines of type are legible over any screenshot."""
    grad = Image.new("L", (1, band))
    for y in range(band):
        grad.putpixel((0, y), int(215 * (y / band) ** 1.3))
    mask = grad.resize((W, band))
    black = Image.new("RGB", (W, band), (4, 10, 6))
    region = img.crop((0, H - band, W, H))
    img.paste(Image.composite(black, region, mask), (0, H - band))


def _mark(d: ImageDraw.ImageDraw) -> None:
    d.text((W - 168, H - 62), "traks", font=F_MARK, fill=(206, 222, 214))
    d.line([(W - 168, H - 30), (W - 118, H - 30)], fill=ACC, width=3)


def render_shot(idx: int, p: float) -> Image.Image:
    name, head, sub, direction, fx, fy, _, dim = SHOTS[idx]
    base = _CACHE.setdefault(name, _load(name, fx, fy, dim))
    e = _ease(p)
    s0, s1 = (1.18, 1.02) if direction == "in" else (1.02, 1.18)
    vs = s0 + (s1 - s0) * e
    vw = int(BW / vs)
    vh = int(BH / vs)
    left = (BW - vw) // 2
    top = (BH - vh) // 2
    img = base.crop((left, top, left + vw, top + vh)).resize((W, H), Image.LANCZOS)

    _scrim(img)
    d = ImageDraw.Draw(img)
    # the caption slides up a few pixels as it settles - motion the eye reads as
    # "this is new information" without being a transition effect
    dy = int(14 * (1 - _ease(min(1.0, p * 6))))
    d.line([(120, H - 236 + dy), (120 + 96, H - 236 + dy)], fill=ACC, width=5)
    d.text((120, H - 214 + dy), head, font=F_HEAD, fill=INK)
    d.text((120, H - 132 + dy), sub, font=F_SUB, fill=DIM)
    _mark(d)
    return img


def render_title(p: float) -> Image.Image:
    img = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(img)
    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill=(11, 22, 16))
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=(11, 22, 16))
    t = "Which room is every device in?"
    s = "PadSpan HA \u00b7 room-level Bluetooth presence for Home Assistant"
    tw = d.textlength(t, font=F_TITLE)
    sw = d.textlength(s, font=F_TITLE_SUB)
    e = _ease(min(1.0, p * 3))
    dy = int(20 * (1 - e))
    d.text(((W - tw) / 2, H / 2 - 128 + dy), t, font=F_TITLE, fill=INK)
    d.line([(W / 2 - 150, H / 2 + 6), (W / 2 + 150, H / 2 + 6)], fill=ACC, width=5)
    d.text(((W - sw) / 2, H / 2 + 44), s, font=F_TITLE_SUB, fill=DIM)
    return img


def render_end(p: float) -> Image.Image:
    img = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(img)
    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill=(11, 22, 16))
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=(11, 22, 16))
    lines = [
        (F_END, "traks", INK, -180),
        (F_END_SUB, "Works with HA Bluetooth proxies, Bermuda and ESPresense", DIM, -70),
        (F_END_SUB, "No custom firmware. Nothing leaves your network.", DIM, -16),
        (F_END_SUB, "Install through HACS", ACC, 62),
        (F_END_SUB, "padspan.traks.ca", INK, 132),
    ]
    for f, txt, col, off in lines:
        w = d.textlength(txt, font=f)
        d.text(((W - w) / 2, H / 2 + off), txt, font=f, fill=col)
    d.line([(W / 2 - 130, H / 2 - 86), (W / 2 + 130, H / 2 - 86)], fill=ACC, width=5)
    return img


def build_frames() -> int:
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)

    seq: list[Image.Image] = []
    seq += [render_title(i / max(1, int(TITLE_S * FPS) - 1)) for i in range(int(TITLE_S * FPS))]
    for idx, shot in enumerate(SHOTS):
        n = int(shot[6] * FPS)
        seq += [render_shot(idx, i / max(1, n - 1)) for i in range(n)]
    seq += [render_end(i / max(1, int(END_S * FPS) - 1)) for i in range(int(END_S * FPS))]

    # cross-fade at every boundary, computed from the segment lengths so a shot
    # never fades into itself
    bounds, acc = [], 0
    for n in ([int(TITLE_S * FPS)] + [int(s[6] * FPS) for s in SHOTS] + [int(END_S * FPS)]):
        acc += n
        bounds.append(acc)
    for b in bounds[:-1]:
        for k in range(FADE):
            i = b - FADE // 2 + k
            j = b + FADE // 2 - k
            if 0 <= i < len(seq) and 0 <= j < len(seq) and i != j:
                a = k / FADE
                seq[i] = Image.blend(seq[i], seq[min(j, len(seq) - 1)], a * 0.5)

    for i, im in enumerate(seq):
        im.save(WORK / f"f{i:05d}.png")
    print(f"{len(seq)} frames -> {WORK}  ({len(seq)/FPS:.1f}s at {FPS}fps)")
    return len(seq)


def encode() -> None:
    ff = shutil.which("ffmpeg")
    if not ff:
        sys.exit("ffmpeg not found on PATH")
    OUT_MP4.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        ff, "-y", "-framerate", str(FPS), "-i", str(WORK / "f%05d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
        "-movflags", "+faststart", "-an", str(OUT_MP4),
    ], check=True)
    print(f"{OUT_MP4}  {OUT_MP4.stat().st_size/1e6:.2f} MB")


if __name__ == "__main__":
    args = set(sys.argv[1:])
    if "--encode" not in args:
        build_frames()
    if "--frames" not in args:
        encode()
