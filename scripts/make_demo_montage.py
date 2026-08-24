#!/usr/bin/env python
"""Build a 20s silent looping montage from the product screenshots.

    python scripts/make_demo_montage.py            # frames + MP4 + GIF
    python scripts/make_demo_montage.py --frames   # frames only (fast iteration)
    python scripts/make_demo_montage.py --encode   # re-encode existing frames only

WHY THIS EXISTS
`images/demo-walkthrough.mp4` was assumed to be a demo of devices moving room to
room. It is not: it is a heatmap-tuning session — the top third is Gain/Contrast/
Warp sliders, the mouse cursor sits in frame, the video track is 22s (the 24.5s
container is audio), and the map is panned so far to one side that any crop is
either half empty or cuts the map off. It cannot be cut into a usable loop.

This builds an honest substitute out of the real screenshots: a slow Ken Burns
pan across six of them, cross-faded, captioned, and closed so the last shot
dissolves back into the first — a true loop with no seam.

It is stills, not live tracking. The clip that would actually sell the product is
30 seconds of Traceback playback (devices moving through the house over time).
When that recording exists, use it and retire this.

Output: images/demo-montage.mp4 (Reddit / YouTube) and images/demo-montage.gif
(README, forum — Discourse and GitHub both take a GIF where they will not take a
video).
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
IMG = ROOT / "images"
WORK = ROOT / "build" / "montage"
OUT_MP4 = IMG / "demo-montage.mp4"
OUT_GIF = IMG / "demo-montage.gif"

W, H = 1920, 1080
FPS = 30
HOLD = 100          # frames each shot is the primary
FADE = 20           # cross-fade length, frames
ACC = (52, 211, 153)
INK = (240, 250, 243)

# The arc: the money shot, then what you can do with it, then proof it is real.
# focus is where the SUBJECT actually is in that screenshot, as a fraction of
# the source. It is per-shot because these are real screenshots, not stock: the
# traceback map sits in the top 45% above a large control panel, while the
# beacon-tune 3D stack is at the bottom under a form. One pan rule showed the
# chrome instead of the product.
#   (file, caption, zoom direction, focus x, focus y)
SHOTS: list[tuple[str, str, str, float, float]] = [
    ("overview-3d-multifloor.jpg",  "Which room every Bluetooth device is in",       "in",  0.46, 0.46),
    ("traceback-playback-3d.png",   "Replay where everything went, minute by minute", "out", 0.50, 0.24),
    ("floor-plan-edit.png",         "Draw your rooms on your own floor plan",         "in",  0.50, 0.58),
    ("beacon-tune-calibration.jpg", "Walk-around calibration, scored against itself",  "out", 0.44, 0.78),
    ("overview-3d-heatmap.jpg",     "See the signal, not just the guess",             "in",  0.52, 0.52),
    ("wall-panel-in-situ.jpg",      "Running on the wall, every day",                 "out", 0.58, 0.50),
]

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


F_CAP = font(["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"], 46)
F_MARK = font(["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"], 25)


def _ease(t: float) -> float:
    """Smoothstep — a linear pan starts and stops with a visible jerk."""
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


OVER = 1.20                      # base is 20% larger than the output
BW, BH = int(W * OVER), int(H * OVER)


def _load(name: str, fx: float, fy: float) -> Image.Image:
    """The screenshot as a 16:9 base BW x BH, cropped around its focal point.

    Cover-fitting to the centre is what put the traceback control panel on
    screen instead of the map. The crop is taken around (fx, fy) and clamped,
    so the subject is in frame before any panning happens.
    """
    src = Image.open(IMG / name).convert("RGB")
    scale = max(BW / src.width, BH / src.height)
    src = src.resize((max(BW, int(src.width * scale)), max(BH, int(src.height * scale))), Image.LANCZOS)
    cx, cy = fx * src.width, fy * src.height
    left = int(min(max(cx - BW / 2, 0), src.width - BW))
    top = int(min(max(cy - BH / 2, 0), src.height - BH))
    return src.crop((left, top, left + BW, top + BH))


_CACHE: dict[str, Image.Image] = {}


def _scrim(img: Image.Image) -> None:
    """Darken the bottom so a caption is legible over any screenshot."""
    band = 300
    grad = Image.new("L", (1, band))
    for y in range(band):
        grad.putpixel((0, y), int(205 * (y / band) ** 1.4))
    mask = grad.resize((W, band))
    black = Image.new("RGB", (W, band), (4, 10, 6))
    region = img.crop((0, H - band, W, H))
    img.paste(Image.composite(black, region, mask), (0, H - band))


def render(idx: int, p: float) -> Image.Image:
    """One shot at progress p in 0..1, panned, zoomed and captioned."""
    name, caption, direction, fx, fy = SHOTS[idx]
    base = _CACHE.setdefault(name, _load(name, fx, fy))

    e = _ease(p)
    # View scale 1.0 = the output box, 1.18 = nearly the whole base. Zooming in
    # means the window shrinks toward the centre of an already-focused base.
    s0, s1 = (1.18, 1.02) if direction == "in" else (1.02, 1.18)
    vs = s0 + (s1 - s0) * e
    cw, ch = min(int(W * vs), BW), min(int(H * vs), BH)
    # A small drift so it is not a pure zoom, alternating per shot. Always
    # clamped inside the base, so an edge can never appear.
    slack_x, slack_y = BW - cw, BH - ch
    t = e if direction == "in" else 1 - e
    dx = slack_x * (0.5 + 0.30 * (t - 0.5) * (1 if idx % 2 == 0 else -1))
    dy = slack_y * (0.5 + 0.22 * (0.5 - t))
    dx = min(max(dx, 0), slack_x)
    dy = min(max(dy, 0), slack_y)
    frame = base.crop((int(dx), int(dy), int(dx) + cw, int(dy) + ch)).resize((W, H), Image.BICUBIC)

    _scrim(frame)
    d = ImageDraw.Draw(frame)
    d.rectangle([84, H - 168, 84 + 78, H - 162], fill=ACC)
    d.text((84, H - 140), caption, font=F_CAP, fill=INK)
    return frame


def build_frames() -> int:
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    n = len(SHOTS)
    total = n * HOLD
    life = HOLD + FADE
    mark_w = int(ImageDraw.Draw(Image.new("RGB", (10, 10))).textlength("padspan.traks.ca", font=F_MARK))

    for f in range(total):
        i = f // HOLD
        local = f % HOLD
        p_i = (f - (i * HOLD - FADE)) / life
        img = render(i, p_i)
        if local >= HOLD - FADE:
            j = (i + 1) % n
            # The next shot's progress measured from ITS own fade-in start,
            # which is what makes the wrap from the last shot to the first
            # continuous rather than a jump.
            p_j = (f - ((i + 1) * HOLD - FADE)) / life
            nxt = render(j, p_j)
            a = (local - (HOLD - FADE)) / FADE
            img = Image.blend(img, nxt, a)
        d = ImageDraw.Draw(img)
        d.text((W - mark_w - 84, H - 74), "padspan.traks.ca", font=F_MARK, fill=(150, 190, 165))
        img.save(WORK / f"f{f:04d}.png", "PNG", compress_level=1)
        if f % 60 == 0:
            print(f"  frame {f}/{total}")
    return total


def encode() -> None:
    ff = shutil.which("ffmpeg")
    if not ff:
        raise SystemExit("ffmpeg not on PATH")
    src = str(WORK / "f%04d.png")

    subprocess.run([ff, "-y", "-v", "error", "-framerate", str(FPS), "-i", src,
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                    "-movflags", "+faststart", str(OUT_MP4)], check=True)
    print(f"  {OUT_MP4.relative_to(ROOT)}  {OUT_MP4.stat().st_size/1024/1024:.1f} MB")

    # GIF: 12fps and 720 wide keeps it comfortably under the limits GitHub and
    # Discourse impose, and a per-clip palette avoids the dithered mud a global
    # palette makes of a dark UI.
    pal = WORK / "pal.png"
    gif_vf = "fps=10,scale=560:-1:flags=lanczos"
    subprocess.run([ff, "-y", "-v", "error", "-framerate", str(FPS), "-i", src,
                    "-vf", gif_vf + ",palettegen=stats_mode=diff:max_colors=128",
                    str(pal)], check=True)
    subprocess.run([ff, "-y", "-v", "error", "-framerate", str(FPS), "-i", src, "-i", str(pal),
                    "-lavfi", gif_vf + "[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4",
                    "-loop", "0", str(OUT_GIF)], check=True)
    print(f"  {OUT_GIF.relative_to(ROOT)}  {OUT_GIF.stat().st_size/1024/1024:.1f} MB")


def main() -> None:
    for name, *_ in SHOTS:
        if not (IMG / name).exists():
            raise SystemExit(f"missing screenshot: {name}")
    print(f"\n=== demo montage: {len(SHOTS)} shots, {len(SHOTS)*HOLD/FPS:.0f}s at {FPS}fps ===")
    if "--encode" in sys.argv:
        if not WORK.exists() or not any(WORK.glob("f*.png")):
            raise SystemExit("no frames on disk - run without --encode first")
        print("  re-encoding existing frames")
    else:
        total = build_frames()
        print(f"  {total} frames")
        if "--frames" in sys.argv:
            print("frames only.")
            return
    encode()
    print("\ndone.\n")


if __name__ == "__main__":
    main()
