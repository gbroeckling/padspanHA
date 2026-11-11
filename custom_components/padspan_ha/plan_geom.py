# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Plan geometry for Build from plans (experimental, 2026-11): the measuring.

The one new module of the plan line-up (design: PadspanResearch
plan-build-design-2026-11.md, section 3.4; section 15 "one code path"). The
AI reads text; this measures. Pure functions on pictures and numbers, with
Pillow only (Home Assistant ships it; no numpy), run in the executor:

- parse_length    a printed dimension in metres: feet-inches with fractions,
                  metric, chains summed
- dimension_ticks the two outer ticks of a dimension line inside a box: its
                  span in pixels, so pixels per metre
- scan_tilt       how far a scan is turned (walls line up when it is undone)
- register        one plan's picture fitted onto another's by image matching
                  (six-parameter affine, coordinate ascent on the normalised
                  correlation of blurred ink, 4 → 2 → 1 px), and its seeds
- compose         the new placement of a fitted plan: the anchor's placement
                  after the fit, read off by fabric_truth's own decomposition
- corners, moves  what a placement change does to the picture, in metres

The method is the basement analysis of 2026-11-09 (its register.py, ticks.py,
compute.py), written once here. Nothing in this module reads or writes a store.
"""

from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .fabric_truth import placement_from_columns, placement_metres

# ── Tunable numbers (design 3.4; one block, each with why) ─────────────────
WORK_PX = 1024             # the fit runs at most this big on a picture's long side (design 3.4.6)
SEARCH_PX = 128            # the coarse search's size (design 3.4.6 b)
BLURS = (4.0, 2.0, 1.0)    # px at WORK_PX: wide first so a far start still sees the walls (register.py)
ROT_MAX = math.radians(5.0)      # a fit never turns a plan further than this
SHEAR_MAX = 0.01                 # rad: a scan's lean is a hair; more is a wrong match
SCALE_BAND = 0.10                # each axis within 10 % of what the printed dimensions predict
SEARCH_ROT_DEG = (-3, -2, -1, 0, 1, 2, 3)
FIT_SECS = 60.0                  # one pair, at most (design 8)
ACCEPT_CORR = 0.85               # at blur 1 (basement: 0.95)
ACCEPT_OVERLAP = 0.30            # of the smaller plan's ink
ACCEPT_RATIO = 0.03              # fitted scale against the printed dimensions' ratio
MARGIN_FRAC = 0.02               # the edge of a picture is left out of the score (register.py's 20 px)
TICK_HALF_PX = 6                 # how far either side of a dimension line a tick is looked for (ticks.py)
TICK_DARK = 0.6                  # share of that window dark for a tick (ticks.py)
TICK_NEAR = 0.12                 # a tick within this share of the span of where the AI says the dimension ends: the
                                 # design said 3 %; Claude's ends on Garry's plans were up to ~10 % short (dry run 2026-11-09)
TICK_REACH = 0.25                # the line is followed this share of the AI's box past each end (its boxes stop short too)
TICK_EXPECT = 0.03               # a single dimension's span within this of what the plan's chains predict
TICK_GAP = 12                    # a dimension line is followed across gaps this long (its text, a tick's slash)
INK_THRESHOLD = 160              # grey below this is ink (the outline-vs-ink check, design 3.2)
TILT_MAX_DEG, TILT_STEP_DEG, TILT_PX = 2.0, 0.05, 512   # design 3.4.4

_M_PER_FT, _M_PER_IN = 0.3048, 0.0254


# ── 1. Printed dimensions ────────────────────────────────────────────────────

_QUOTES = str.maketrans({"′": "'", "’": "'", "‘": "'", "`": "'", "´": "'",
                         "″": '"', "“": '"', "”": '"', "–": "-", "—": "-", "−": "-",
                         # A printed fraction character, as its digits: 30'-5⅜" is 30'-5 3/8".
                         "⅛": " 1/8", "¼": " 1/4", "⅜": " 3/8", "½": " 1/2", "⅝": " 5/8", "¾": " 3/4", "⅞": " 7/8"})
_FRAC = r"(\d+)\s*/\s*(\d+)"
_FT_IN = re.compile(r"^(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet)\s*-?\s*(?:(\d+(?:\.\d+)?)?(?:\s*-?\s*" + _FRAC + r")?\s*(?:\"|''|in\.?|inches)?)?$")
_IN = re.compile(r"^(\d+(?:\.\d+)?)?(?:\s*-?\s*" + _FRAC + r")?\s*(?:\"|''|in\.?|inches)$")
_METRIC = re.compile(r"^(\d{1,3}(?:[ ,]\d{3})+|\d+(?:[.,]\d+)?)\s*(mm|cm|m)?$")
_FT_IN_DASH = re.compile(r"^(\d+)\s*-\s*(\d+(?:\.\d+)?)(?:\s+" + _FRAC + r")?$")     # 66-7: feet and inches, no marks
ALT_AGREE = 0.02           # the other reading of an open form is taken only within this of the length expected (Claude's metres)


def parse_length(text: Any, expect_m: float | None = None, feet: bool = False) -> float | None:
    """A printed length in metres, or None when it isn't one. Feet and inches
    with fractions (30'-5 1/2", 9'-1", 8', 3 1/2", 1'-9 3/4", 30'-5⅜"), metric
    (9.284 m, 928 cm, 9284, 2 400, 12,48 m: a bare whole number of 100 or more
    is millimetres, a bare decimal under 100 metres), and a chain joined by +
    or | summed. `expect_m`, `feet`: see length_read."""
    return length_read(text, expect_m, feet)[0]


def length_read(text: Any, expect_m: float | None = None, feet: bool = False) -> tuple[float | None, str | None]:
    """parse_length's metres, and the unit a number typed with none was taken
    in ("metres", "millimetres", "centimetres", "feet and inches", joined for a
    chain that mixes them), or None when every unit was typed.

    `expect_m`: the length the caller already has for this text (Claude's own
    metres for the line). Only then are the two forms a bare string leaves
    open read the other way: feet and inches written with a dash and no marks
    (66-7 = 66'-7"), and a bare whole number in centimetres (435 = 4.35 m);
    and only when the usual reading doesn't agree with expect_m within
    ALT_AGREE and the other one does. With no expect_m nothing is guessed.

    `feet`: Settings → "Show lengths in feet and inches" is on, so a number
    typed with no unit is feet ("feet"); one typed with a unit is read as
    typed either way."""
    plain = _length_read(text, False, feet)
    if expect_m is None or agrees(plain[0], expect_m, ALT_AGREE):
        return plain
    alt = _length_read(text, True, feet)
    return alt if agrees(alt[0], expect_m, ALT_AGREE) else plain


def _length_read(text: Any, alt: bool, feet: bool = False) -> tuple[float | None, str | None]:
    s = str(text or "").translate(_QUOTES).strip().lower()
    if not s:
        return None, None
    if "+" in s or "|" in s:
        parts = [_length_read(p, alt, feet) for p in re.split(r"[+|]", s)]
        if not parts or any(p[0] is None for p in parts):
            return None, None
        said = sorted({p[1] for p in parts if p[1]})
        return round(sum(p[0] for p in parts), 6), " and ".join(said) or None  # type: ignore[misc]
    s = re.sub(r"\s+", " ", s.replace("=", "").strip())
    m = _FT_IN_DASH.match(s) if alt else None
    if m:
        inch = float(m.group(2)) + (float(m.group(3)) / float(m.group(4)) if m.group(3) and float(m.group(4)) else 0.0)
        return (round(float(m.group(1)) * _M_PER_FT + inch * _M_PER_IN, 6), "feet and inches") if inch < 12.0 else (None, None)
    m = _FT_IN.match(s)
    if m and ("'" in s or "ft" in s or "feet" in s):
        ft = float(m.group(1))
        inch = float(m.group(2) or 0)
        if m.group(3):
            den = float(m.group(4))
            if den == 0:
                return None, None
            inch += float(m.group(3)) / den
        if inch >= 12.0 + 1e-9:
            return None, None
        return round(ft * _M_PER_FT + inch * _M_PER_IN, 6), None
    m = _IN.match(s)
    if m and (m.group(1) or m.group(2)):
        inch = float(m.group(1) or 0)
        if m.group(2):
            den = float(m.group(3))
            if den == 0:
                return None, None
            inch += float(m.group(2)) / den
        return round(inch * _M_PER_IN, 6), None
    m = _METRIC.match(s)
    if m:
        raw, unit = m.group(1), m.group(2)
        # A comma: a decimal comma (12,48 m), unless it is followed by exactly
        # three digits, which stays a thousands separator as before (1,200 mm;
        # 2,400 with no unit is 2400 mm, the same metres as 2.400 m either way)
        # except where that can't be a building's length: with m ("1,250 m"
        # is 1.25 m), and with mm or cm when the decimal reading is already
        # 0.5 m or more ("600,000 mm" is 0.6 m).
        if re.fullmatch(r"\d+,\d+", raw):
            dec = float(raw.replace(",", "."))
            if not re.fullmatch(r"\d{1,3},\d{3}", raw) or unit == "m" or dec / {"mm": 1000.0, "cm": 100.0}.get(unit or "", math.inf) >= 0.5:
                raw = raw.replace(",", ".")
        grouped = bool(re.search(r"[ ,]\d{3}$", raw))
        v = float(raw.replace(" ", "").replace(",", ""))
        if unit is None and feet:
            return round(v * _M_PER_FT, 6), "feet"
        if unit is None and alt and "." not in raw and not grouped and v >= 100:
            return round(v / 100.0, 6), "centimetres"
        if unit == "mm" or (unit is None and (grouped or ("." not in raw and v >= 100))):
            return round(v / 1000.0, 6), None if unit else "millimetres"
        if unit == "cm":
            return round(v / 100.0, 6), None
        if unit == "m" or (unit is None and v < 100):
            return round(v, 6), None if unit else "metres"
    return None, None


def chain_length(parts: Any, expect_m: float | None = None) -> float | None:
    """The sum of a chain's printed segments, or None when any can't be read
    (`expect_m`: the whole chain's, as length_read's)."""
    if not isinstance(parts, (list, tuple)) or not parts:
        return None
    return length_read(" + ".join(str(p or "") for p in parts), expect_m)[0]


def agrees(a: float | None, b: float | None, tol: float) -> bool:
    """Two lengths within tol of each other (a share of the larger)."""
    if a is None or b is None or a <= 0 or b <= 0:
        return False
    return abs(a - b) <= tol * max(a, b)


# ── 2. Pictures ──────────────────────────────────────────────────────────────

def grey(im: Any) -> Any:
    """The picture as grey (L), white where it was transparent."""
    from PIL import Image  # noqa: PLC0415
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg
    return im.convert("L")


def ink_bbox(g: Any) -> tuple[int, int, int, int] | None:
    """The box round everything drawn: grey below INK_THRESHOLD, a speck's
    worth (2 px open) left out. None on a blank picture."""
    from PIL import ImageFilter  # noqa: PLC0415
    mask = g.point(lambda v: 255 if v < INK_THRESHOLD else 0).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    return mask.getbbox()


def outline_on_ink(g: Any, outline: Any, step: float = 3.0) -> float:
    """The share of an outline's edges (points every `step` px) that lie on
    ink: grey under INK_THRESHOLD within 3 px. Outer walls are drawn, so an
    outline in the picture's own pixels lies on them; one read in another
    frame, or shifted, mostly doesn't. 0 for fewer than three corners."""
    from PIL import ImageFilter  # noqa: PLC0415
    try:
        pts = [(float(p[0]), float(p[1])) for p in outline]
    except (TypeError, ValueError, IndexError):
        return 0.0
    if len(pts) < 3:
        return 0.0
    near = g.filter(ImageFilter.MinFilter(7))
    W, H = g.size
    hit = tot = 0
    for i, (x0, y0) in enumerate(pts):
        x1, y1 = pts[(i + 1) % len(pts)]
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        for k in range(n):
            x, y = x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n
            if 0 <= x < W and 0 <= y < H:
                tot += 1
                hit += near.getpixel((int(x), int(y))) < INK_THRESHOLD
    return hit / tot if tot else 0.0


def iou(a: Any, b: Any) -> float:
    """Intersection over union of two boxes [x1, y1, x2, y2]."""
    try:
        ax1, ay1, ax2, ay2 = (float(v) for v in a)
        bx1, by1, bx2, by2 = (float(v) for v in b)
    except (TypeError, ValueError):
        return 0.0
    iw, ih = max(0.0, min(ax2, bx2) - max(ax1, bx1)), max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = iw * ih
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


# ── 3. Dimension ticks ───────────────────────────────────────────────────────

def _pixels(im: Any) -> list:
    """A picture's values, row after row (Pillow 12 renamed getdata)."""
    return list(im.get_flattened_data() if hasattr(im, "get_flattened_data") else im.getdata())


def _runs(flags: list[bool]) -> list[tuple[int, int]]:
    out, start = [], None
    for i, f in enumerate(flags + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            out.append((start, i - 1))
            start = None
    return out


@dataclass
class Ticks:
    ends_px: list[list[float]]   # the two outer ticks on the line, picture px [[x, y], [x, y]]
    span: float                  # the length between them along the line, px
    n: int                       # how many ticks were seen on it
    matched: int = 0             # a chain's ticks found where its printed segments put them
    marks: list[float] = field(default_factory=list)   # every tick on the line, along it (straightened crop px)


def _dark_level(values: list[int]) -> float:
    """Darker than this is ink, in this crop: a quarter of the way from the
    paper (its median) to the ink (its darkest 1 %). A faint scan's grey
    dimension line counts; JPEG haze on white doesn't."""
    v = sorted(values)
    paper, inkv = v[len(v) // 2], v[max(0, len(v) // 100)]
    if paper - inkv < 40:
        return -1.0                    # no contrast: nothing drawn here
    return paper - 0.25 * (paper - inkv)


def dimension_ticks(g: Any, box: Any, axis: str, ends: Any = None, tilt: float = 0.0, chain: Any = None,
                    expect_span: float | None = None) -> Ticks | None:
    """The two outer ticks of the dimension line inside `box` (picture px,
    [x1, y1, x2, y2]), axis "x" for a line running across, "y" for one
    running down; `tilt` (rad, scan_tilt) is undone first, so a turned scan's
    line is straight. The line is the row (column) with the longest dark run;
    a tick is a place along it where the picture is dark across the line (a
    tick, a slash, an extension line): over TICK_DARK of TICK_HALF_PX on both
    sides, straight or on a diagonal (ticks.py, which looked one way only).
    The AI's box is only roughly where the line is: the line is followed
    TICK_REACH of the box's length past each end. `chain`: the printed
    segments in metres; the pair of ticks whose inner ticks fall where the
    segments put them is taken (at least 75 % of all its ticks, else None),
    its span the least-squares line through them. Otherwise `ends`,
    where the AI says the dimension starts and ends ([[x, y], [x, y]]): the
    tick nearest each within TICK_NEAR of their span; with `expect_span` (px,
    from the plan's chained dimensions), the pair within those windows whose
    span is nearest it, and none unless within TICK_EXPECT of it: a single
    dimension's ends sit among wall faces drawn double. With neither, the
    outermost pair. None when no line, fewer than two ticks, or none near the
    ends given."""
    from PIL import Image  # noqa: PLC0415
    try:
        x1, y1, x2, y2 = (int(round(float(v))) for v in box)
    except (TypeError, ValueError):
        return None
    W, H = g.size
    pad = TICK_HALF_PX + 4
    x1, x2, y1, y2 = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)
    length = (x2 - x1) if axis == "x" else (y2 - y1)
    reach = int(TICK_REACH * length) + 4
    x1, x2 = max(0, x1 - (pad if axis == "y" else reach)), min(W, x2 + (pad if axis == "y" else reach))
    y1, y2 = max(0, y1 - (pad if axis == "x" else reach)), min(H, y2 + (pad if axis == "x" else reach))
    if x2 - x1 < 8 or y2 - y1 < 3 or length < 8:
        return None
    part = g.crop((x1, y1, x2, y2))
    cx, cy = part.width / 2.0, part.height / 2.0
    deg = -math.degrees(tilt)
    if abs(deg) > 0.01:
        part = part.rotate(deg, resample=Image.BICUBIC, center=(cx, cy), fillcolor=255)
    ca, sa = math.cos(math.radians(deg)), math.sin(math.radians(deg))

    def back(u: float, v: float) -> list[float]:
        """A point of the straightened crop, in the picture's own pixels."""
        dx, dy = u - cx, v - cy
        return [round(x1 + cx + dx * ca - dy * sa, 1), round(y1 + cy + dx * sa + dy * ca, 1)]

    def into(x: float, y: float) -> tuple[float, float]:
        dx, dy = x - x1 - cx, y - y1 - cy
        return cx + dx * ca + dy * sa, cy - dx * sa + dy * ca

    if axis == "y":
        part = part.transpose(Image.Transpose.TRANSPOSE)   # a line running down becomes one running across
    pw, ph = part.size
    px = _pixels(part)
    level = _dark_level(px)
    if level < 0:
        return None
    dark = [[px[r * pw + c] < level for c in range(pw)] for r in range(ph)]
    best_row, best_len = None, 0
    for r in range(ph):
        longest = max((b - a + 1 for a, b in _runs(dark[r])), default=0)
        if longest > best_len:
            best_row, best_len = r, longest
    if best_row is None or best_len < 0.25 * length:
        return None
    hw = TICK_HALF_PX

    def share(c: int, rows: range, dc: int) -> float:
        """How many of these rows are dark at the column the mark would cross
        them at (1 px either way: a scan's mark is rarely one pixel true)."""
        got = []
        for k, r in enumerate(rows):
            at = c + dc * (k + 2)
            got.append(0 <= r < ph and any(dark[r][q] for q in range(max(0, at - 1), min(pw, at + 2))))
        return sum(got) / len(got) if got else 0.0

    up, dn = range(best_row - 2, best_row - hw - 1, -1), range(best_row + 2, best_row + hw + 1)
    up_s, dn_s = range(best_row - 2, best_row - 4, -1), range(best_row + 2, best_row + 4)
    # A tick CROSSES the line (an extension line, a slash, a dot): long on one
    # side and at least short on the other, straight across or on either
    # diagonal (a scan's slash can be 2-3 px; its extension line runs one way).
    # Text sits on one side only.
    score = [max(max(min(share(c, up, dc), share(c, dn_s, -dc)), min(share(c, up_s, dc), share(c, dn, -dc))) for dc in (0, 1, -1))
             for c in range(pw)]
    ticks = []
    for a, b in _runs([v > TICK_DARK for v in score]):
        if b - a < 5:
            ticks.append((a + b) / 2.0)
            continue
        # A wide mark is marks side by side (a wall line beside a tick): each local peak of it.
        peak = [score[c] >= (score[c - 1] if c > a else -1) and score[c] >= (score[c + 1] if c < b else -1) for c in range(a, b + 1)]
        for a2, b2 in _runs(peak):
            t = a + (a2 + b2) / 2.0
            if ticks and t - ticks[-1] < 3:
                ticks[-1] = (ticks[-1] + t) / 2.0
            else:
                ticks.append(t)
    if len(ticks) < 2:
        return None
    hint = None
    if ends is not None:
        try:
            pts = [into(float(e[0]), float(e[1])) for e in ends[:2]]
            k = 0 if axis == "x" else 1
            hint = tuple(sorted(p[k] for p in pts))
        except (TypeError, ValueError, IndexError):
            return None
        if hint[1] <= hint[0]:
            return None
    segs = [float(v) for v in (chain or []) if isinstance(v, (int, float)) and v > 0]
    best, matched = None, 0
    if len(segs) >= 2:
        # The chain's own segments say where every one of its ticks is: the
        # pair of ends whose chain finds the most ticks where the printed
        # lengths put them, then the line through all the ticks found (least
        # squares), so an end tick that is doubtful (a wall line beside it)
        # moves the span by a fraction of a pixel, not by its own error.
        tot = sum(segs)
        fr = [0.0]
        for v in segs:
            fr.append(fr[-1] + v / tot)
        need = max(3, math.ceil(0.75 * len(fr)))       # three in four of its ticks where its segments put them
        for i, a in enumerate(ticks):
            for b in ticks[i + 1:]:
                span = b - a
                if span < 0.5 * length:                   # a chain spans its line, not a stretch of it
                    continue
                tol = max(2.0, 0.01 * span)
                pairs = []
                for f in fr:
                    t = min(ticks, key=lambda t, at=a + f * span: abs(t - at))
                    if abs(t - (a + f * span)) <= tol:
                        pairs.append((f, t))
                if len(pairs) < need:
                    continue
                n = len(pairs)
                inner = [(f, t) for f, t in pairs if 0.0 < f < 1.0]
                if len(inner) >= 3:
                    pairs = inner                         # the line's ends sit among wall lines; its inner ticks don't
                k = len(pairs)
                mf, mt = sum(f for f, _ in pairs) / k, sum(t for _, t in pairs) / k
                sff = sum((f - mf) ** 2 for f, _ in pairs)
                if sff <= 1e-9:
                    continue
                sl = sum((f - mf) * (t - mt) for f, t in pairs) / sff
                off = mt - sl * mf
                rms = math.sqrt(sum((t - off - sl * f) ** 2 for f, t in pairs) / k)
                key = (n, -rms)
                if best is None or key > best[0]:
                    best = (key, off, off + sl)
        if best is None:
            return None                                   # the chain isn't on this line, or isn't what was read
        matched = best[0][0]
        p0, p1 = best[1], best[2]
    if best is None:
        if hint:
            near = TICK_NEAR * (hint[1] - hint[0])
            c0 = [t for t in ticks if abs(t - hint[0]) <= near]
            c1 = [t for t in ticks if abs(t - hint[1]) <= near]
            if not c0 or not c1:
                return None
            if expect_span:
                p0, p1 = min(((a, b) for a in c0 for b in c1 if b > a), key=lambda ab: abs(ab[1] - ab[0] - expect_span), default=(0.0, 0.0))
                if not p1 or abs(p1 - p0 - expect_span) > TICK_EXPECT * expect_span:
                    return None
            else:
                p0, p1 = min(c0, key=lambda t: abs(t - hint[0])), min(c1, key=lambda t: abs(t - hint[1]))
        else:
            p0, p1 = ticks[0], ticks[-1]
    if p1 - p0 < 8:
        return None
    ends_px = [back(p0, best_row), back(p1, best_row)] if axis == "x" else [back(best_row, p0), back(best_row, p1)]
    return Ticks(ends_px=ends_px, span=round(p1 - p0, 2), n=len(ticks), matched=matched, marks=[round(t, 1) for t in ticks])


def line_extent(g: Any, box: Any, axis: str, tilt: float = 0.0) -> float:
    """How long the dimension line in `box` is drawn, px: the darkest-run row
    (column) across the box, followed past both ends of the box (up to half
    its length again) across gaps of up to TICK_GAP px (its text, its ticks).
    0 when no line is there."""
    from PIL import Image  # noqa: PLC0415
    try:
        x1, y1, x2, y2 = (int(round(float(v))) for v in box)
    except (TypeError, ValueError):
        return 0.0
    x1, x2, y1, y2 = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)
    W, H = g.size
    length = (x2 - x1) if axis == "x" else (y2 - y1)
    if length < 8:
        return 0.0
    reach, pad = int(0.5 * length) + 4, TICK_HALF_PX + 4
    bx1, bx2 = max(0, x1 - (pad if axis == "y" else reach)), min(W, x2 + (pad if axis == "y" else reach))
    by1, by2 = max(0, y1 - (pad if axis == "x" else reach)), min(H, y2 + (pad if axis == "x" else reach))
    part = g.crop((bx1, by1, bx2, by2))
    deg = -math.degrees(tilt)
    if abs(deg) > 0.01:
        part = part.rotate(deg, resample=Image.BICUBIC, center=(part.width / 2.0, part.height / 2.0), fillcolor=255)
    if axis == "y":
        part = part.transpose(Image.Transpose.TRANSPOSE)
    pw, ph = part.size
    px = _pixels(part)
    level = _dark_level(px)
    if level < 0:
        return 0.0
    best = 0.0
    for r in range(ph):
        row = [px[r * pw + c] < level for c in range(pw)]
        runs = _runs(row)
        if not runs:
            continue
        # Join runs across short gaps; the longest joined stretch on this row.
        a, b = runs[0]
        for a2, b2 in runs[1:]:
            if a2 - b <= TICK_GAP:
                b = b2
            else:
                best = max(best, b - a + 1)
                a, b = a2, b2
        best = max(best, b - a + 1)
    return float(best)


# ── 4. Tilt ──────────────────────────────────────────────────────────────────

def scan_tilt(g: Any) -> float:
    """How far the drawing is turned, in radians, within ±TILT_MAX_DEG: the
    turn that, undone, makes the row and column projections of the ink
    sharpest (walls line up with the picture's edges). A copy at TILT_PX."""
    from PIL import Image, ImageOps  # noqa: PLC0415
    im = ImageOps.invert(g)
    k = TILT_PX / max(im.size)
    if k < 1:
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.BILINEAR)
    im = im.point(lambda v: 255 if v > 255 - INK_THRESHOLD else 0)

    def sharp(deg: float) -> float:
        r = im.rotate(deg, resample=Image.BILINEAR, expand=False)
        rows = _pixels(r.resize((1, r.height), Image.BOX))
        cols = _pixels(r.resize((r.width, 1), Image.BOX))
        return sum(v * v for v in rows) / len(rows) + sum(v * v for v in cols) / len(cols)

    steps = int(round(TILT_MAX_DEG / TILT_STEP_DEG))
    best = max(((sharp(i * TILT_STEP_DEG), i * TILT_STEP_DEG) for i in range(-steps, steps + 1)))
    # Pillow's rotate is counter-clockwise on screen; the drawing's own turn is the opposite of what undoes it.
    return -math.radians(best[1])


# ── 5. The fit ───────────────────────────────────────────────────────────────
# A fit maps a point of the MOVING picture (px) onto the ANCHOR picture (px):
#   anchor = M · moving + t,  M = [[sx cos θ, -sy sin(θ+σ)], [sx sin θ, sy cos(θ+σ)]]
# the placement model's own shape (fabric_truth.placement_metres), so a fit's
# turn and lean read as a placement's do.

@dataclass
class Fit:
    sx: float
    sy: float
    rot: float
    shear: float
    tx: float
    ty: float
    corr: float = 0.0
    overlap: float = 0.0
    secs: float = 0.0
    seed: str = ""
    stopped: str | None = None        # "capped" (out of time) or "cancelled"

    def matrix(self) -> tuple[float, float, float, float]:
        a = self.sx * math.cos(self.rot)
        b = -self.sy * math.sin(self.rot + self.shear)
        c = self.sx * math.sin(self.rot)
        d = self.sy * math.cos(self.rot + self.shear)
        return a, b, c, d

    def apply(self, x: float, y: float) -> tuple[float, float]:
        a, b, c, d = self.matrix()
        return a * x + b * y + self.tx, c * x + d * y + self.ty

    def params(self) -> list[float]:
        return [self.sx, self.sy, self.rot, self.shear, self.tx, self.ty]


def _with(f: Fit, p: list[float]) -> Fit:
    return Fit(*p, corr=f.corr, overlap=f.overlap, secs=f.secs, seed=f.seed)


class _Level:
    """Both pictures as blurred ink at one working size, and the sums the
    score needs that don't change with the fit."""

    def __init__(self, moving: Any, anchor: Any, work: int, blur: float) -> None:
        from PIL import Image, ImageFilter, ImageOps  # noqa: PLC0415
        self.km = min(1.0, work / max(moving.size))
        self.ka = min(1.0, work / max(anchor.size))

        def ink(g: Any, k: float) -> Any:
            im = ImageOps.invert(g)
            if k < 1:
                im = im.resize((max(8, round(g.width * k)), max(8, round(g.height * k))), Image.BOX)
            if blur > 0:
                im = im.filter(ImageFilter.GaussianBlur(blur * work / WORK_PX))
            return im.convert("F")

        self.A = ink(moving, self.km)
        self.B = ink(anchor, self.ka)
        self.ones = Image.new("F", self.B.size, 1.0)
        mw, mh = self.A.size
        m = max(2, round(MARGIN_FRAC * max(mw, mh)))
        self.box = (m, m, mw - m, mh - m)
        self.A = self.A.crop(self.box)
        self.A2 = _mul(self.A, self.A)
        self.n = self.A.width * self.A.height
        self.mw, self.mh = mw, mh

    def data(self, f: Fit) -> tuple[float, ...]:
        """Pillow's AFFINE data: for each output (moving, working, cropped)
        pixel, where in the anchor's working picture to read."""
        a, b, c, d = f.matrix()
        km, ka = self.km, self.ka
        ox, oy = self.box[0], self.box[1]
        # moving work (u+ox, v+oy) → moving px /km → anchor px → ×ka
        A_, B_ = ka * a / km, ka * b / km
        C_, D_ = ka * c / km, ka * d / km
        return (A_, B_, A_ * ox + B_ * oy + ka * f.tx, C_, D_, C_ * ox + D_ * oy + ka * f.ty)

    def score(self, f: Fit) -> tuple[float, float]:
        """The normalised correlation over where both pictures are, and the
        share of the moving picture the anchor covers."""
        from PIL import Image  # noqa: PLC0415
        size = self.A.size
        dat = self.data(f)
        Bw = self.B.transform(size, Image.AFFINE, dat, resample=Image.BILINEAR, fillcolor=0.0)
        Mw = self.ones.transform(size, Image.AFFINE, dat, resample=Image.NEAREST, fillcolor=0.0)
        sw = _mean(Mw)
        if sw < 0.05:
            return -1.0, sw
        sa, saa = _mean(_mul(Mw, self.A)), _mean(_mul(Mw, self.A2))
        sb, sbb, sab = _mean(Bw), _mean(_mul(Bw, Bw)), _mean(_mul(self.A, Bw))
        cov = sab - sa * sb / sw
        va, vb = saa - sa * sa / sw, sbb - sb * sb / sw
        if va <= 1e-9 or vb <= 1e-9:
            return -1.0, sw
        return cov / math.sqrt(va * vb), sw


def _mul(a: Any, b: Any) -> Any:
    from PIL import ImageMath  # noqa: PLC0415
    return ImageMath.lambda_eval(lambda e: e["a"] * e["b"], a=a, b=b)


def _mean(im: Any) -> float:
    from PIL import Image  # noqa: PLC0415
    return float(im.resize((1, 1), Image.BOX).getpixel((0, 0)))


def _bounded(p: list[float], scale0: tuple[float, float]) -> list[float]:
    sx, sy, rot, sh, tx, ty = p
    lo_x, hi_x = scale0[0] * (1 - SCALE_BAND), scale0[0] * (1 + SCALE_BAND)
    lo_y, hi_y = scale0[1] * (1 - SCALE_BAND), scale0[1] * (1 + SCALE_BAND)
    return [min(hi_x, max(lo_x, sx)), min(hi_y, max(lo_y, sy)), min(ROT_MAX, max(-ROT_MAX, rot)),
            min(SHEAR_MAX, max(-SHEAR_MAX, sh)), tx, ty]


def search_start(moving: Any, anchor: Any, scale0: tuple[float, float], *, deadline: float | None = None,
                 cancel: Callable[[], bool] | None = None) -> Fit | None:
    """Seed (b): a coarse search at SEARCH_PX over the printed dimensions'
    scale and SEARCH_ROT_DEG, every place the moving picture's middle could
    sit on the anchor's, 2 working px apart. The best few are kept and the
    best of them is refined at that size. None when cancelled."""
    lv = _Level(moving, anchor, SEARCH_PX, 2.0 * WORK_PX / SEARCH_PX / 4)
    aw, ah = anchor.size
    mw, mh = moving.size
    step = 2.0 / lv.ka                                      # 2 working px, in anchor px
    best: list[tuple[float, Fit]] = []
    for deg in SEARCH_ROT_DEG:
        rot = math.radians(deg)
        base = Fit(scale0[0], scale0[1], rot, 0.0, 0.0, 0.0)
        cx, cy = base.apply(mw / 2, mh / 2)
        ny, nx = int(ah / step) + 1, int(aw / step) + 1
        for j in range(ny):
            if cancel and cancel():
                return None
            if deadline and time.monotonic() > deadline:
                break
            for i in range(nx):
                f = Fit(scale0[0], scale0[1], rot, 0.0, i * step - cx, j * step - cy)
                s, cover = lv.score(f)
                if cover < ACCEPT_OVERLAP:
                    continue
                best.append((s, f))
        best.sort(key=lambda t: -t[0])
        best = best[:6]
    if not best:
        return None
    out = []
    for s, f in best[:3]:
        g = _ascend(lv, f, scale0, (0.02, 0.02, math.radians(0.5), 0.0, 2.0 / lv.ka, 2.0 / lv.ka), 25, deadline, cancel)
        out.append((g.corr, g))
    out.sort(key=lambda t: -t[0])
    f = out[0][1]
    f.seed = "search"
    return f


def stairs_start(moving_boxes: list, anchor_boxes: list, scale0: tuple[float, float]) -> Fit | None:
    """Seed (a): staircases the AI boxed on both plans, paired by size at the
    printed scale. One pair gives the offset at the printed scale; two or more
    their scale too (each axis kept within SCALE_BAND). None when no pair is
    alike enough (sides within 25 % at the printed scale)."""
    pairs = []
    for mb in moving_boxes or []:
        for ab in anchor_boxes or []:
            try:
                mx1, my1, mx2, my2 = (float(v) for v in mb)
                ax1, ay1, ax2, ay2 = (float(v) for v in ab)
            except (TypeError, ValueError):
                continue
            mwid, mhgt = (mx2 - mx1) * scale0[0], (my2 - my1) * scale0[1]
            awid, ahgt = ax2 - ax1, ay2 - ay1
            if min(mwid, mhgt, awid, ahgt) <= 0:
                continue
            err = max(abs(mwid - awid) / awid, abs(mhgt - ahgt) / ahgt)
            if err <= 0.25:
                pairs.append((err, ((mx1 + mx2) / 2, (my1 + my2) / 2), ((ax1 + ax2) / 2, (ay1 + ay2) / 2)))
    if not pairs:
        return None
    pairs.sort(key=lambda t: t[0])
    sx, sy = scale0
    if len(pairs) >= 2:
        (_, m0, a0), (_, m1, a1) = pairs[0], pairs[1]
        if abs(m1[0] - m0[0]) > 20:
            sx = min(scale0[0] * (1 + SCALE_BAND), max(scale0[0] * (1 - SCALE_BAND), (a1[0] - a0[0]) / (m1[0] - m0[0])))
        if abs(m1[1] - m0[1]) > 20:
            sy = min(scale0[1] * (1 + SCALE_BAND), max(scale0[1] * (1 - SCALE_BAND), (a1[1] - a0[1]) / (m1[1] - m0[1])))
    _, m0, a0 = pairs[0]
    return Fit(sx, sy, 0.0, 0.0, a0[0] - sx * m0[0], a0[1] - sy * m0[1], seed="stairs")


def taps_start(taps: list, sizes: tuple[tuple[int, int], tuple[int, int]]) -> Fit | None:
    """Seed (c): the person's two taps on each plan ([[fx, fy] × 4]: moving 1,
    anchor 1, moving 2, anchor 2, fractions of each picture): a similarity
    (scale, turn, offset) from the two pairs."""
    try:
        (m1, a1, m2, a2) = [(float(t[0]), float(t[1])) for t in taps[:4]]
    except (TypeError, ValueError, IndexError):
        return None
    (mw, mh), (aw, ah) = sizes
    p1, q1 = (m1[0] * mw, m1[1] * mh), (a1[0] * aw, a1[1] * ah)
    p2, q2 = (m2[0] * mw, m2[1] * mh), (a2[0] * aw, a2[1] * ah)
    dm, da = (p2[0] - p1[0], p2[1] - p1[1]), (q2[0] - q1[0], q2[1] - q1[1])
    lm, la = math.hypot(*dm), math.hypot(*da)
    if lm < 10 or la < 10:
        return None
    s = la / lm
    rot = math.atan2(da[1], da[0]) - math.atan2(dm[1], dm[0])
    rot = (rot + math.pi) % (2 * math.pi) - math.pi
    f = Fit(s, s, rot, 0.0, 0.0, 0.0, seed="taps")
    x, y = f.apply(*p1)
    f.tx, f.ty = q1[0] - x, q1[1] - y
    return f


def _ascend(lv: _Level, f: Fit, scale0: tuple[float, float], steps: tuple[float, ...], iters: int,
            deadline: float | None, cancel: Callable[[], bool] | None) -> Fit:
    """Coordinate ascent on the score (register.py): each parameter up and
    down by its step, keep what improves; halve the steps when nothing does."""
    p = _bounded(f.params(), scale0)
    best, cover = lv.score(_with(f, p))
    st = list(steps)
    for _ in range(iters):
        if (cancel and cancel()) or (deadline and time.monotonic() > deadline):
            break
        improved = False
        for i in range(6):
            if st[i] <= 0:
                continue
            for sgn in (1, -1):
                q = list(p)
                q[i] += sgn * st[i]
                q = _bounded(q, scale0)
                s, c = lv.score(_with(f, q))
                if s > best:
                    best, cover, p, improved = s, c, q, True
        if not improved:
            st = [v / 2 for v in st]
            if st[4] < 0.05 and st[0] < 1e-4:
                break
    out = _with(f, p)
    out.corr, out.overlap = best, cover
    return out


def register(moving: Any, anchor: Any, start: Fit, scale0: tuple[float, float], *,
             cancel: Callable[[], bool] | None = None, secs: float = FIT_SECS) -> Fit:
    """The moving picture fitted onto the anchor's from `start` (grey
    pictures): blurred 4 → 2 → 1 px at WORK_PX, coordinate ascent on the
    normalised correlation, each axis's scale within SCALE_BAND of `scale0`
    (the printed dimensions' prediction), the turn within ROT_MAX and the
    lean within SHEAR_MAX. Stops at `secs` ("capped") or a cancel."""
    t0 = time.monotonic()
    deadline = t0 + secs
    f = Fit(*start.params(), seed=start.seed)
    for blur in BLURS:
        if cancel and cancel():
            f.stopped = "cancelled"
            break
        if time.monotonic() > deadline:
            f.stopped = "capped"
            break
        lv = _Level(moving, anchor, WORK_PX, blur)
        px = 1.0 / lv.ka
        f = _ascend(lv, f, scale0, (0.01, 0.01, math.radians(0.25), 0.002 if blur <= 2 else 0.0, 4 * px * blur / 4, 4 * px * blur / 4),
                    60, deadline, cancel)
        f.seed = start.seed
    if f.stopped is None and time.monotonic() > deadline:
        f.stopped = "capped"
    f.secs = round(time.monotonic() - t0, 2)
    return f


def overlap_share(fit: Fit, moving_size: tuple[int, int], anchor_size: tuple[int, int]) -> float:
    """How much of the smaller picture the other covers under the fit (by
    area; a stand-in for its ink, which sits inside its frame)."""
    mw, mh = moving_size
    aw, ah = anchor_size
    n, inside_a = 0, 0
    for i in range(11):
        for j in range(11):
            x, y = fit.apply(mw * i / 10, mh * j / 10)
            n += 1
            inside_a += 1 if (-1 <= x <= aw + 1 and -1 <= y <= ah + 1) else 0
    share_m = inside_a / n
    a, b, c, d = fit.matrix()
    det = a * d - b * c
    if abs(det) < 1e-12:
        return 0.0
    inside_m = 0
    for i in range(11):
        for j in range(11):
            X, Y = aw * i / 10 - fit.tx, ah * j / 10 - fit.ty
            x, y = (d * X - b * Y) / det, (-c * X + a * Y) / det
            inside_m += 1 if (-1 <= x <= mw + 1 and -1 <= y <= mh + 1) else 0
    share_a = inside_m / n
    return share_m if mw * mh <= aw * ah else share_a


def accepted(fit: Fit, ratio_dims: tuple[float | None, float | None], overlap: float) -> str | None:
    """None when the fit is accepted (design 3.4.6: all three hold), else why
    not: low_corr, low_overlap, ratio_disagree."""
    if fit.corr < ACCEPT_CORR:
        return "low_corr"
    if overlap < ACCEPT_OVERLAP:
        return "low_overlap"
    for got, want in ((fit.sx, ratio_dims[0]), (fit.sy, ratio_dims[1])):
        if want and abs(got / want - 1) > ACCEPT_RATIO:
            return "ratio_disagree"
    return None


# ── 6. Placements ────────────────────────────────────────────────────────────

FIELDS = ("origin_x_m", "origin_y_m", "scale_x_m", "scale_y_m", "rotation_rad", "shear_rad")
SHEAR_STATED = 0.002            # rad: a lean under this is left unstated (design 3.4.7)


def corners(t: dict) -> list[list[float]]:
    """A placement's four picture corners in metres (fabric_truth's one evaluation)."""
    return [[round(v, 4) for v in placement_metres(t, fx, fy)] for fx, fy in ((0, 0), (1, 0), (1, 1), (0, 1))]


def max_move(a: dict, b: dict) -> float:
    """The largest distance a picture corner moves from placement a to b, m."""
    return max(math.dist(p, q) for p, q in zip(corners(a), corners(b)))


def _tidy(t: dict) -> dict[str, float]:
    out = {"origin_x_m": round(t["origin_x_m"], 4), "origin_y_m": round(t["origin_y_m"], 4),
           "scale_x_m": round(t["scale_x_m"], 4), "scale_y_m": round(t["scale_y_m"], 4),
           "rotation_rad": round(t["rotation_rad"], 6)}
    sh = float(t.get("shear_rad") or 0.0)
    if abs(sh) > SHEAR_STATED:
        out["shear_rad"] = round(sh, 6)
    return out


def compose(anchor_t: dict, anchor_size: tuple[int, int], moving_size: tuple[int, int], fit: Fit) -> dict[str, float] | None:
    """The moving plan's placement that puts it exactly where the fit says on
    the anchor as it is placed (compute.py compose): the anchor's placement
    after the fit, read off by fabric_truth.placement_from_columns."""
    aw, ah = anchor_size
    mw, mh = moving_size

    def at(fx: float, fy: float) -> tuple[float, float]:
        x, y = fit.apply(fx * mw, fy * mh)
        return placement_metres(anchor_t, x / aw, y / ah)

    o, ex, ey = at(0, 0), at(1, 0), at(0, 1)
    t = placement_from_columns(o, (ex[0] - o[0], ex[1] - o[1]), (ey[0] - o[0], ey[1] - o[1]))
    return _tidy(t) if t else None


def scale_only(t: dict, size: tuple[int, int], ppm: tuple[float | None, float | None], keep_frac: tuple[float, float]) -> dict[str, float] | None:
    """A placement with each axis at the printed pixels per metre (an axis
    with none keeps its scale), the turn and lean kept, and the point
    `keep_frac` of the picture left where it is (design 3.4.9: the middle of
    what is drawn on it, not the top-left corner the scale grows from)."""
    w, h = size
    sx = w / ppm[0] if ppm[0] else float(t["scale_x_m"])
    sy = h / ppm[1] if ppm[1] else float(t["scale_y_m"])
    new = {**{k: float(t.get(k) or 0.0) for k in FIELDS}, "scale_x_m": sx, "scale_y_m": sy}
    kx, ky = placement_metres(t, *keep_frac)
    nx, ny = placement_metres(new, *keep_frac)
    new["origin_x_m"] += kx - nx
    new["origin_y_m"] += ky - ny
    return _tidy(new)


@dataclass
class Shift:
    """What one stored picture position does under a new placement."""
    stored_m: tuple[float, float]
    click_m: tuple[float, float]
    moved_m: float = field(init=False)

    def __post_init__(self) -> None:
        self.moved_m = math.dist(self.stored_m, self.click_m)


def shift_of(new_t: dict, frac: tuple[float, float], stored_m: tuple[float, float]) -> Shift:
    """Where a click made on the picture at `frac` lands under the new
    placement, against where it is stored in metres (design 3.6)."""
    return Shift(stored_m=(float(stored_m[0]), float(stored_m[1])), click_m=placement_metres(new_t, float(frac[0]), float(frac[1])))


# ── Room outlines (Stage 2, design section 5) ────────────────────────────────
# Polygons in fabric metres, [[x, y], ...]. Overlaps on a 5 cm raster (the
# research's own scoring grid), merges as one clean polygon. Pillow only.

GRID_M = 0.05                   # the raster's cell (the 2026-11-10 test scored rooms on it)
CLOSE_M = (0.35, 0.6, 1.0)      # a merge closes gaps up to the first of these that makes one shape: neighbouring rooms are a
                                # wall apart (0.1-0.3 m); a thick foundation wall or a skipped hall needs more (his basement)
SIMPLIFY_M = 0.04               # a merged outline's corners kept to within this


def area(p: Any) -> float:
    """A polygon's area, m² (shoelace; either winding)."""
    n = len(p or [])
    return abs(sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(n))) / 2 if n >= 3 else 0.0


def centroid(p: Any) -> tuple[float, float]:
    """The middle of a polygon's corners (enough to say where a room is)."""
    return (sum(v[0] for v in p) / len(p), sum(v[1] for v in p) / len(p)) if p else (0.0, 0.0)


def inside(x: float, y: float, p: Any) -> bool:
    """Ray casting, as the room lookups do (model_store.beacon_room_from_geometry)."""
    c, n = False, len(p or [])
    for i in range(n):
        (x1, y1), (x2, y2) = p[i - 1][:2], p[i][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def _edge_dist(x: float, y: float, p: Any) -> float:
    """How far a point is from a polygon's nearest edge."""
    best = math.inf
    for i in range(len(p)):
        (x1, y1), (x2, y2) = p[i - 1][:2], p[i][:2]
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best


def inner_point(p: Any, rows: int = 15) -> tuple[float, float]:
    """A point inside a polygon, as far from its walls as a simple search finds: the middle of the corners when that is
    inside, and the middles of the inside runs of a few scanlines across it; of those, the one furthest from every edge wins.
    An L or a U room gets a point in the room, never the corners' middle out in the notch (the receivers' first
    place: ws_fabric.receivers_to_rooms)."""
    if not p or len(p) < 3:
        return centroid(p)
    cands = [centroid(p)] if inside(*centroid(p), p) else []
    lo, hi = min(v[1] for v in p), max(v[1] for v in p)
    for k in range(1, rows + 1):
        y = lo + (hi - lo) * k / (rows + 1)
        xs = sorted((p[i - 1][0] + (y - p[i - 1][1]) * (p[i][0] - p[i - 1][0]) / (p[i][1] - p[i - 1][1]))
                    for i in range(len(p)) if (p[i - 1][1] > y) != (p[i][1] > y))
        cands += [((xs[j] + xs[j + 1]) / 2, y) for j in range(0, len(xs) - 1, 2)]
    cands = [c for c in cands if inside(c[0], c[1], p)]
    return max(cands, key=lambda c: _edge_dist(c[0], c[1], p)) if cands else centroid(p)


def _box(polys: list, pad: float) -> tuple[float, float, float, float]:
    xs = [v[0] for p in polys for v in p]
    ys = [v[1] for p in polys for v in p]
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad


def _raster(polys: list, box: tuple[float, float, float, float]) -> list:
    """Each polygon filled on its own 8-bit picture of the box, 255 inside."""
    from PIL import Image, ImageDraw  # noqa: PLC0415
    x0, y0, x1, y1 = box
    w, h = max(1, int((x1 - x0) / GRID_M) + 1), max(1, int((y1 - y0) / GRID_M) + 1)
    out = []
    for p in polys:
        im = Image.new("L", (w, h), 0)
        if p and len(p) >= 3:
            ImageDraw.Draw(im).polygon([((x - x0) / GRID_M, (y - y0) / GRID_M) for x, y in p], fill=255)
        out.append(im)
    return out


def overlap(p: Any, q: Any) -> tuple[float, float, float]:
    """(cells of p, cells of q, cells in both), on one raster."""
    if len(p or []) < 3 or len(q or []) < 3:
        return 0.0, 0.0, 0.0
    bp, bq = _box([p], 0.0), _box([q], 0.0)
    if bp[0] > bq[2] or bq[0] > bp[2] or bp[1] > bq[3] or bq[1] > bp[3]:    # apart: no raster needed
        return area(p) / GRID_M ** 2, area(q) / GRID_M ** 2, 0.0
    from PIL import ImageChops  # noqa: PLC0415
    a, b = _raster([p, q], _box([p, q], GRID_M))
    return float(a.histogram()[255]), float(b.histogram()[255]), float(ImageChops.multiply(a, b).histogram()[255])


def union_iou(a: Any, b: Any) -> float:
    """Intersection over union of two sets of outlines, each taken as the
    union of its own (the test scored a room read as several printed rooms so)."""
    a = [p for p in a or [] if len(p or []) >= 3]
    b = [p for p in b or [] if len(p or []) >= 3]
    if not a or not b:
        return 0.0
    from PIL import ImageChops  # noqa: PLC0415
    ims = _raster(a + b, _box(a + b, GRID_M))
    ua, ub = ims[0], ims[len(a)]
    for im in ims[1:len(a)]:
        ua = ImageChops.lighter(ua, im)
    for im in ims[len(a) + 1:]:
        ub = ImageChops.lighter(ub, im)
    both, either = ImageChops.multiply(ua, ub).histogram()[255], ImageChops.lighter(ua, ub).histogram()[255]
    return both / either if either else 0.0


def poly_iou(p: Any, q: Any) -> float:
    """Intersection over union of two outlines."""
    na, nb, both = overlap(p, q)
    return both / (na + nb - both) if na + nb - both > 0 else 0.0


def share_inside(p: Any, q: Any) -> float:
    """How much of p lies inside q, 0-1."""
    na, _nb, both = overlap(p, q)
    return both / na if na else 0.0


def _trace(mask: Any, box: tuple[float, float, float, float]) -> list[list[float]]:
    """The outer boundary of a filled 0/255 picture, in metres: every cell
    side between inside and out, chained clockwise on the picture (the inside
    on the right), the loop of most area kept."""
    w, h = mask.size
    px = mask.tobytes()

    def on(x: int, y: int) -> bool:
        return 0 <= x < w and 0 <= y < h and px[y * w + x] == 255

    nxt: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for y in range(h):
        row = y * w
        for x in range(w):
            if px[row + x] != 255:
                continue
            if not on(x, y - 1):
                nxt.setdefault((x, y), []).append((x + 1, y))
            if not on(x + 1, y):
                nxt.setdefault((x + 1, y), []).append((x + 1, y + 1))
            if not on(x, y + 1):
                nxt.setdefault((x + 1, y + 1), []).append((x, y + 1))
            if not on(x - 1, y):
                nxt.setdefault((x, y + 1), []).append((x, y))
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop, at, came = [start], start, None
        while True:
            outs = nxt.get(at)
            if not outs:
                break
            if len(outs) > 1 and came is not None:        # two cells touching at a corner: the right turn keeps them apart
                dx, dy = at[0] - came[0], at[1] - came[1]
                outs.sort(key=lambda o: 0 if (o[0] - at[0], o[1] - at[1]) == (-dy, dx) else 1)
            to = outs.pop(0)
            if not outs:
                del nxt[at]
            came, at = at, to
            if at == start:
                break
            loop.append(at)
        if len(loop) >= 4:
            loops.append(loop)
    if not loops:
        return []
    best = max(loops, key=area)
    return [[box[0] + (cx - 0.5) * GRID_M, box[1] + (cy - 0.5) * GRID_M] for cx, cy in best]   # a filled cell is centred on its point


def _seg_dist(p: Any, a: Any, b: Any) -> float:
    vx, vy = b[0] - a[0], b[1] - a[1]
    L = vx * vx + vy * vy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L))
    return math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy)


def _dp(pts: list, tol: float) -> list:
    """Douglas-Peucker on an open run (its ends kept)."""
    if len(pts) < 3:
        return pts
    far, at = -1.0, 0
    for i in range(1, len(pts) - 1):
        d = _seg_dist(pts[i], pts[0], pts[-1])
        if d > far:
            far, at = d, i
    if far <= tol:
        return [pts[0], pts[-1]]
    return _dp(pts[:at + 1], tol)[:-1] + _dp(pts[at:], tol)


def simplify(p: Any, tol: float = SIMPLIFY_M) -> list[list[float]]:
    """A closed outline with its stair-steps and needless corners taken out:
    split at the two corners furthest apart, each half Douglas-Peucker'd."""
    pts = [[float(v[0]), float(v[1])] for i, v in enumerate(p) if i == 0 or math.dist(v[:2], p[i - 1][:2]) > 1e-9]
    if len(pts) > 1 and math.dist(pts[0], pts[-1]) <= 1e-9:
        pts.pop()
    if len(pts) > 3:
        j = max(range(len(pts)), key=lambda i: math.dist(pts[0], pts[i]))
        out = _dp(pts[:j + 1], tol)[:-1] + _dp(pts[j:] + [pts[0]], tol)[:-1]
        pts = out if len(out) >= 3 else pts
    return [[round(x, 3), round(y, 3)] for x, y in pts]


def merge_outline(polys: Any, close_m: Any = CLOSE_M) -> tuple[list[list[float]], int]:
    """Several outlines as ONE clean polygon (design 5: a merged room is one
    shape): raster at GRID_M, union, closed over gaps up to the first of
    close_m that leaves one piece, with a square kernel (square corners stay
    square), holes filled, the outer boundary traced and simplified.
    (outline, how many pieces it was after the widest closing; more than 1:
    some parts didn't reach the largest, which alone is kept). One polygon
    in: itself, tidied."""
    polys = [p for p in polys or [] if len(p or []) >= 3 and (area(p) > 0 or not _simple(p))]   # a bow-tie's halves may cancel out
    if not polys:
        return [], 0
    if len(polys) == 1 and _simple(polys[0]):
        return simplify(polys[0], 0.0), 1
    # A one-part room whose corners cross (a bow-tie) goes through the raster too (review B7). The raster is laid
    # along the walls (their main direction), so a rotated plan's rectangle stays four corners, not a stair (B6).
    a = _wall_angle(polys)
    turn = abs(a) > 1e-4
    if turn:
        cx, cy = centroid([v for p in polys for v in p])
        polys = [[[round(x, 3), round(y, 3)] for x, y in _rotate(p, -a, cx, cy)] for p in polys]   # a side's ends on one row of cells
    out: tuple[list[list[float]], int] = ([], 0)
    for c in (close_m if isinstance(close_m, (list, tuple)) else (close_m,)):
        out = _merged(polys, float(c))
        if out[1] <= 1:
            break
    if turn:
        out = ([[round(x, 3), round(y, 3)] for x, y in _rotate(out[0], a, cx, cy)], out[1])
    return out


def _simple(p: Any) -> bool:
    """No two sides of the outline cross (a bow-tie's do)."""
    n = len(p)

    def ccw(a: Any, b: Any, c: Any) -> float:
        return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0])
    for i in range(n):
        a, b = p[i - 1], p[i]
        for j in range(i + 1, n):
            if j == i + 1 or (i == 0 and j == n - 1):
                continue                                   # neighbours share a corner
            c, d = p[j - 1], p[j]
            if ccw(a, b, c) * ccw(a, b, d) < 0 and ccw(c, d, a) * ccw(c, d, b) < 0:
                return False
    return True


def _wall_angle(polys: list) -> float:
    """The walls' main direction, -45..45 degrees in radians: each side's angle
    taken four times over (so a side and one square to it agree), weighted by
    its length."""
    sx = sy = 0.0
    for p in polys:
        for i in range(len(p)):
            dx, dy = p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]
            L = math.hypot(dx, dy)
            if L > 0:
                t = 4 * math.atan2(dy, dx)
                sx, sy = sx + L * math.cos(t), sy + L * math.sin(t)
    return math.atan2(sy, sx) / 4 if sx or sy else 0.0


def _rotate(p: Any, a: float, cx: float, cy: float) -> list[list[float]]:
    c, s = math.cos(a), math.sin(a)
    return [[cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c] for x, y, *_ in p]


def _merged(polys: list, close_m: float) -> tuple[list[list[float]], int]:
    from PIL import ImageChops, ImageDraw, ImageFilter  # noqa: PLC0415
    r = max(1, math.ceil(close_m / 2 / GRID_M - 1e-9))
    box = _box(polys, (r + 3) * GRID_M)
    # Pillow cuts a corner's position down to whole cells: drawn half a cell on, a side lands on its nearest cell
    # (within half a cell either way, as on the cells' own grid), never up to a cell and a half out (review B6).
    ims = _raster(polys, (box[0] - GRID_M / 2, box[1] - GRID_M / 2, box[2], box[3]))
    u = ims[0]
    for im in ims[1:]:
        u = ImageChops.lighter(u, im)
    u = u.filter(ImageFilter.MaxFilter(2 * r + 1)).filter(ImageFilter.MinFilter(2 * r + 1))
    u = u.point(lambda v: 255 if v >= 128 else 0)
    ImageDraw.floodfill(u, (0, 0), 100)                  # the outside is what a fill from the corner reaches
    u = u.point(lambda v: 0 if v == 100 else 255)          # the rest, holes too, is inside
    sizes, label = {}, 1
    while label < 250:                                     # each piece filled with its own number
        bb = u.point(lambda v: 255 if v == 255 else 0).getbbox()
        if not bb:
            break
        row = u.crop((bb[0], bb[1], bb[2], bb[1] + 1)).tobytes()
        ImageDraw.floodfill(u, (bb[0] + row.index(255), bb[1]), label)
        sizes[label] = u.histogram()[label]
        label += 1
    if not sizes:
        return [], 0
    keep = max(sizes, key=lambda k: sizes[k])
    return simplify(_trace(u.point(lambda v: 255 if v == keep else 0), box)), len(sizes)


def nearest_edge(p: Any, x: float, y: float) -> dict[str, Any] | None:
    """The point of a polygon's boundary nearest (x, y): {d, at, u (the edge's
    direction), t (metres along the edge), length}."""
    best = None
    for i in range(len(p or [])):
        a, b = p[i - 1], p[i]
        vx, vy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(vx, vy)
        if L < 1e-9:
            continue
        t = max(0.0, min(L, ((x - a[0]) * vx + (y - a[1]) * vy) / L))
        q = (a[0] + vx / L * t, a[1] + vy / L * t)
        d = math.hypot(x - q[0], y - q[1])
        if best is None or d < best["d"]:
            best = {"d": d, "at": q, "u": (vx / L, vy / L), "t": t, "length": L}
    return best
