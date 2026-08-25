#!/usr/bin/env python
"""Render a real Traceback playback as video, from position data rather than a screen capture.

    python scripts/make_traceback_animation.py <export.json>
    python scripts/make_traceback_animation.py <export.json> --frames   # frames only

WHY THIS EXISTS
Every marketing asset this project has is a still, because no recording of live
tracking exists. The obvious fix is to screen-record the Traceback view, which
means a cursor in frame, panel chrome, window-size luck, and one take.

It turns out none of that is necessary. `padspan_ha/traceback_get` returns the
underlying data — every positioned object's `x_m`, `y_m`, floor and room, stamped
in time — and `padspan_ha/model_get` returns the room fabric in metres. So the
animation can be RENDERED from the numbers: no cursor, no chrome, any frame rate,
any styling, and reproducible from a script instead of a lucky take.

Input is whatever the panel exported (see docs/traceback-export.md): rooms, floors,
scanners, names, and frames of [pid, x_m, y_m, floor, room].

THE PROJECTION is the product's own signature: floors stacked isometrically, so a
device crossing from Main up to Upper is visible AS a crossing rather than as a
number changing. Real elevation is not used for the stack offset — the floors are
spread further apart than life so the eye can separate them, which is exactly what
the panel's own 3D view does.

TIME is compressed. Eight hours of house at 30fps in about 35 seconds is roughly
800x. Positions are interpolated between samples so movement reads as movement
rather than as teleporting, and each device drags a fading trail — the trail is
the whole point, because "where it went" is the claim being made.
"""
from __future__ import annotations

import json
import math
import pathlib
import shutil
import subprocess
import sys
from collections import defaultdict

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
IMG = ROOT / "images"
WORK = ROOT / "build" / "traceback"
OUT = IMG / "padspan-traceback.mp4"

W, H = 1920, 1080
FPS = 30
SECONDS = 36.0
TRAIL = 90                      # rendered frames of trail behind each device
SKIP_FLOORS = {"__outside__"}   # a handful of samples, and it wrecks the framing

BG = (7, 14, 10)
GRID = (14, 26, 19)
INK = (238, 247, 242)
DIM = (150, 170, 160)
ACC = (52, 211, 153)
FLOOR_FILL = [(20, 34, 44), (24, 40, 30), (38, 30, 44)]
FLOOR_EDGE = [(64, 110, 130), (70, 140, 100), (110, 80, 130)]
DEVICE_COLS = [(94, 234, 212), (250, 204, 21), (244, 114, 182),
               (129, 140, 248), (248, 113, 113), (163, 230, 53)]

ISO_X = math.cos(math.radians(30))
ISO_Y = math.sin(math.radians(30))
FLOOR_GAP = 210                 # pixels between stacked floors


def font(names, size):
    for d in (pathlib.Path(r"C:\Windows\Fonts"), pathlib.Path("/usr/share/fonts")):
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
F_TITLE = font(BOLD, 46)
F_CLOCK = font(BOLD, 40)
F_ROOM = font(REG, 19)
F_DEV = font(BOLD, 22)
F_LEG = font(REG, 24)
F_MARK = font(REG, 24)


def load(path: pathlib.Path) -> dict:
    d = json.loads(path.read_text(encoding="utf-8"))
    order = [f["id"] for f in d.get("floors", []) if f["id"] not in SKIP_FLOORS]
    used = {v["f"] for v in d["rooms"].values() if v["f"] not in SKIP_FLOORS}
    d["_order"] = [f for f in order if f in used] or sorted(used)
    return d


def project(x, y, floor_idx, cx, cy, scale):
    """Metres -> screen, isometric, with the floor lifted by its index."""
    sx = (x - y) * ISO_X * scale
    sy = (x + y) * ISO_Y * scale - floor_idx * FLOOR_GAP
    return (cx + sx, cy + sy)


def build_view(d):
    """Scale and centre so every room on every kept floor is comfortably in frame."""
    pts = []
    for r in d["rooms"].values():
        if r["f"] in SKIP_FLOORS:
            continue
        pts += r["p"] if r["t"] == "p" else [[r["c"][0], r["c"][1]]]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    n = len(d["_order"])
    raw = [((x - y) * ISO_X, (x + y) * ISO_Y) for x, y in zip(xs, ys)]
    rw = max(p[0] for p in raw) - min(p[0] for p in raw)
    rh = max(p[1] for p in raw) - min(p[1] for p in raw)
    scale = min((W - 470) / max(rw, 1e-6), (H - 190 - (n - 1) * FLOOR_GAP) / max(rh, 1e-6))
    mx = (max(p[0] for p in raw) + min(p[0] for p in raw)) / 2
    my = (max(p[1] for p in raw) + min(p[1] for p in raw)) / 2
    cx = W / 2 - mx * scale
    cy = H / 2 - my * scale + (n - 1) * FLOOR_GAP / 2
    return cx, cy, scale


def main() -> None:
    src = pathlib.Path(sys.argv[1])
    d = load(src)
    frames = d["frames"]
    order = d["_order"]
    fidx = {f: i for i, f in enumerate(order)}
    cx, cy, scale = build_view(d)

    pids = list(dict.fromkeys(p for f in frames for p, *_ in f["o"]))
    seen_names = {}
    for pid in pids:
        nm = d["names"].get(pid, pid)
        if nm in seen_names:
            seen_names[nm] += 1
            d["names"][pid] = f"{nm} ({seen_names[nm]})"
        else:
            seen_names[nm] = 1
    col = {p: DEVICE_COLS[i % len(DEVICE_COLS)] for i, p in enumerate(pids)}

    # per-device track, so a position can be interpolated at any instant
    track = defaultdict(list)
    for f in frames:
        for pid, x, y, fl, rm in f["o"]:
            if fl not in SKIP_FLOORS:
                track[pid].append((f["t"], x, y, fl, rm))

    t0, t1 = frames[0]["t"], frames[-1]["t"]
    total = int(SECONDS * FPS)

    def at(pid, t):
        tr = track[pid]
        if not tr or t < tr[0][0] - 900 or t > tr[-1][0] + 900:
            return None
        lo, hi = 0, len(tr) - 1
        while lo < hi:
            m = (lo + hi) // 2
            if tr[m][0] < t:
                lo = m + 1
            else:
                hi = m
        b = tr[lo]
        a = tr[max(0, lo - 1)]
        if b[0] == a[0]:
            return b[1], b[2], b[3], b[4]
        # only interpolate within a floor; a floor change is a cut, not a slide
        if a[3] != b[3]:
            return (b if t - a[0] > b[0] - t else a)[1:]
        k = (t - a[0]) / (b[0] - a[0])
        k = max(0.0, min(1.0, k))
        return a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, b[3], b[4]

    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)

    hist = defaultdict(list)
    for i in range(total):
        t = t0 + (t1 - t0) * (i / max(1, total - 1))
        im = Image.new("RGB", (W, H), BG)
        dr = ImageDraw.Draw(im, "RGBA")
        for gx in range(0, W, 64):
            dr.line([(gx, 0), (gx, H)], fill=GRID)
        for gy in range(0, H, 64):
            dr.line([(0, gy), (W, gy)], fill=GRID)

        # floors painted bottom-up so upper storeys overlap the ones below
        for li, fl in enumerate(order):
            fill = FLOOR_FILL[li % len(FLOOR_FILL)]
            edge = FLOOR_EDGE[li % len(FLOOR_EDGE)]
            for rname, r in d["rooms"].items():
                if r["f"] != fl or r["t"] != "p":
                    continue
                poly = [project(px, py, li, cx, cy, scale) for px, py in r["p"]]
                dr.polygon(poly, fill=fill + (150,), outline=edge + (220,))
                mxp = sum(p[0] for p in poly) / len(poly)
                myp = sum(p[1] for p in poly) / len(poly)
                dr.text((mxp, myp), rname, font=F_ROOM, fill=(200, 216, 208, 150), anchor="mm")
            nm = next((f["name"] for f in d["floors"] if f["id"] == fl), fl)
            dr.text((70, cy - li * FLOOR_GAP - 10), nm.upper(), font=F_DEV, fill=edge + (255,))

        for sid, (sx, sy, sfl) in d.get("scanners", {}).items():
            if sfl in SKIP_FLOORS or sfl not in fidx:
                continue
            p = project(sx, sy, fidx[sfl], cx, cy, scale)
            dr.ellipse([p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4], outline=(90, 130, 110, 200))

        for pid in pids:
            pos = at(pid, t)
            if pos is None:
                continue
            x, y, fl, rm = pos
            if fl not in fidx:
                continue
            p = project(x, y, fidx[fl], cx, cy, scale)
            hist[pid].append((p, fl))
            hist[pid] = hist[pid][-TRAIL:]
            c = col[pid]
            pts = hist[pid]
            for k in range(1, len(pts)):
                (p0, f0), (p1, f1) = pts[k - 1], pts[k]
                # a storey change is a cut, not a path - joining them drew a
                # long diagonal streak across the whole stack. A jump longer
                # than a room is a bad fix, not a walk; drop that segment too.
                if f0 != f1:
                    continue
                if math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 150:
                    continue
                a = int(150 * (k / len(pts)) ** 2)
                dr.line([p0, p1], fill=c + (a,), width=3)
            dr.ellipse([p[0] - 13, p[1] - 13, p[0] + 13, p[1] + 13], fill=c + (55,))
            dr.ellipse([p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6], fill=c + (255,))
            dr.text((p[0] + 16, p[1] - 10), d["names"].get(pid, pid), font=F_DEV, fill=c + (255,))

        dr.rectangle([0, 0, W, 96], fill=(5, 11, 8, 225))
        dr.text((60, 26), "Traceback \u2014 eight hours of one house", font=F_TITLE, fill=INK)
        import datetime
        clock = datetime.datetime.fromtimestamp(t).strftime("%a %H:%M")
        dr.text((W - 60, 30), clock, font=F_CLOCK, fill=ACC, anchor="ra")

        ly = H - 60 - 34 * len(pids)
        for pid in pids:
            c = col[pid]
            dr.ellipse([60, ly + 8, 74, ly + 22], fill=c + (255,))
            dr.text((88, ly + 4), d["names"].get(pid, pid), font=F_LEG, fill=(214, 228, 220))
            ly += 34
        dr.text((W - 60, H - 52), "traks", font=F_MARK, fill=(206, 222, 214), anchor="ra")
        dr.line([(W - 108, H - 22), (W - 60, H - 22)], fill=ACC, width=3)

        im.save(WORK / f"f{i:05d}.png")
        if i % 150 == 0:
            print(f"  {i}/{total}", flush=True)

    print(f"{total} frames -> {WORK}  ({total/FPS:.1f}s)")
    if "--frames" in sys.argv:
        return
    ff = shutil.which("ffmpeg")
    if not ff:
        sys.exit("ffmpeg not on PATH")
    subprocess.run([ff, "-y", "-framerate", str(FPS), "-i", str(WORK / "f%05d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                    "-movflags", "+faststart", "-an", str(OUT)], check=True)
    print(f"{OUT}  {OUT.stat().st_size/1e6:.2f} MB")


if __name__ == "__main__":
    main()
