# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
A WLED device's remembered look, and the exact requests that put it back
(Garry, 2026-09-27: "an exact, durable on/off that reproduces complex 5-6
channel strings 100% every time"). Pure: no Home Assistant, no network —
wled_exact.py does the talking.

WHY THE SAME "ON" LOOKED DIFFERENT (checked against WLED 0.14.4 / 0.15.4 /
16.0.1 json.cpp and HA 2026.7.4 wled/light.py): HA sends only the fields it
was given, so colours, W, CCT, effect, palette and the other segments are
whatever the last writer left. A look here is EVERY key WLED reports for
every segment (except len and lc, which it computes), with colours exactly as
reported — 4 values per slot on a white-capable unit, because a 3-value
colour sets W to 0 (json.cpp builds rgbw={0,0,0,0} and copies what is sent).

ORDER OF A TURN-ON (json.cpp deserializeState reads bri, on, transition, tt,
tb, nl, udpn, mainseg, then seg[]; a segment "on" never turns the master on):
while the strip is dark, the segments go in id order in chunks, the extra
segments are deleted last (WLED renumbers after a batch delete), and a final
request turns the master on at the brightness wanted over the look's fade.
Never sent: presets, playlists, the lasting transition, reboot, realtime
override, the legacy API, the settings PIN.
"""

import copy
import hashlib
import json
from typing import Any

LOOK_VERSION = 1

# Segments per request (not bytes: WLED's JSON pool costs ~0.7 KB per fully
# specified segment, and restore_bodies' text-length chunker let a 283-byte
# segment through where the parser needed ~700).
SEGS_PER_REQ_ESP8266 = 8
SEGS_PER_REQ_ESP32 = 24

# Keys WLED computes: never stored, never sent.
SEG_DROP = ("len", "lc")
# Never sent inside a segment: fxdef resets sx/ix/pal to the effect's
# defaults, i paints single LEDs (and freezes), rpt multiplies segments.
SEG_FORBIDDEN = frozenset({"fxdef", "i", "rpt"})
# Never sent at the top level by the exact path.
FORBIDDEN_KEYS = frozenset({"ps", "pl", "playlist", "transition", "psave", "pdel", "rb",
                            "lor", "live", "win", "pin"})
SEG_BOUNDS = ("start", "stop", "grp", "spc", "of", "startY", "stopY")

# The live "join" switched off. recv only matters on 0.14 (0.15+ ignore it,
# json.cpp:427-431); rgrp 0 is the only real "don't listen"; nn keeps this
# request from being broadcast.
UDPN_OFF = {"send": False, "recv": False, "sgrp": 0, "rgrp": 0, "nn": True}
# The saved "join" switched off — the ONE config change switching a device
# to PadSpan makes (live-only rgrp:0 came back as group 1 after a reboot on
# 10 of the 11 units). send.grp 0 also stops button/IR broadcasts on 0.14.
SYNC_OFF_PATCH = {"if": {"sync": {"send": {"en": False, "grp": 0}, "recv": {"grp": 0}}}}

# What the exact code may write through /json/cfg: the sync-off patch, or
# a device's own saved send/recv blocks put back. Nothing else, ever.
_CFG_SEND_KEYS = frozenset({"en", "dir", "btn", "va", "hue", "grp", "ret"})
_CFG_RECV_KEYS = frozenset({"bri", "col", "fx", "pal", "grp", "seg", "sb"})

# Palette 1 is "* Random Cycle"; these effects pick random colours
# (FX.h: Wipe Random, Random Colors, Dynamic, Dissolve Rnd, Chase Random,
# Chase Flash Rnd, Sweep Random, Running Random, Stream, Dynamic Smooth).
RANDOM_PALETTES = frozenset({1})
RANDOM_EFFECTS = frozenset({4, 5, 7, 19, 29, 32, 36, 39, 61, 117})

_BUS_TYPES = {
    18: "white (1 channel)", 19: "white (3 channels per chip)", 21: "WWA", 22: "RGB (WS281x)",
    23: "RGB (GS8608)", 24: "RGB (WS2811 400 kHz)", 25: "RGB (TM1829)", 26: "RGB (UCS8903)",
    27: "RGB (APA106)", 28: "RGB+CCT (FW1906)", 29: "RGBW (UCS8904)", 30: "RGBW (SK6812)",
    31: "RGBW (TM1814)", 32: "RGB+CCT (WS2805)", 33: "RGB (TM1914)", 34: "RGB+CCT (SM16825)",
    40: "on/off", 41: "PWM white", 42: "PWM CCT (2 channels)", 43: "PWM RGB", 44: "PWM RGBW",
    45: "5-channel PWM (RGB+CCT)", 46: "6-channel PWM", 50: "RGB (WS2801)", 51: "RGB (APA102)",
    52: "RGB (LPD8806)", 53: "RGB (P9813)", 54: "RGB (LPD6803)", 80: "network DDP RGB",
    88: "network DDP RGBW",
}
_WHITE_MODES = {0: "None", 1: "Brighter", 2: "Accurate", 3: "Dual", 4: "Max", 255: "per output"}
_ORDERS = {0: "GRB", 1: "RGB", 2: "BRG", 3: "RBG", 4: "BGR", 5: "GBR"}

# Plain words for what differs in a segment.
_SEG_WHAT = {
    "col": "colour", "cct": "white warmth", "fx": "effect", "sx": "effect speed", "ix": "effect intensity",
    "pal": "palette", "c1": "effect settings", "c2": "effect settings", "c3": "effect settings",
    "o1": "effect options", "o2": "effect options", "o3": "effect options", "bri": "brightness",
    "on": "on/off", "frz": "frozen", "n": "name", "sel": "selection", "rev": "direction", "mi": "mirror",
    "rY": "direction", "mY": "mirror", "tp": "rotation", "si": "sound", "m12": "2D mapping", "set": "set",
    "bm": "blending", "start": "size", "stop": "size", "startY": "size", "stopY": "size", "grp": "grouping",
    "spc": "spacing", "of": "offset", "missing": "missing", "extra": "extra part",
}


# ── Small helpers ────────────────────────────────────────────────────────────


def _jdump(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"))


def body_bytes(body: dict) -> int:
    return len(_jdump(body))


def _hash(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def segs_per_request(info: dict | None) -> int:
    arch = str((info or {}).get("arch", "")).lower()
    return SEGS_PER_REQ_ESP8266 if "8266" in arch else SEGS_PER_REQ_ESP32


def _leds(info: dict | None) -> dict:
    return (info or {}).get("leds") or {}


class Ctx:
    """What a compare or a request needs to know about the device NOW (from
    its live /json/info), not when the look was remembered."""

    def __init__(self, info: dict | None = None, *, geometry_ok: bool = True) -> None:
        leds = _leds(info)
        self.white = bool(leds.get("rgbw", True))
        self.total = int(leds.get("count") or 0) or None
        self.seglc = list(leds.get("seglc") or [])
        self.fxcount = int((info or {}).get("fxcount") or 0) or None
        self.max_segs = segs_per_request(info)
        self.geometry_ok = geometry_ok


# ── Capture ──────────────────────────────────────────────────────────────────


def capture_state(state: dict) -> dict:
    """The look's state part: master brightness, fade, main segment and every
    segment with every key WLED reports except len/lc (frz stored false — a
    frozen segment is never the look)."""
    segs = []
    for s in state.get("seg") or []:
        if not isinstance(s, dict):
            continue
        seg = {k: copy.deepcopy(v) for k, v in s.items() if k not in SEG_DROP}
        seg["frz"] = False
        segs.append(seg)
    return {"bri": state.get("bri", 128), "tt": state.get("transition", 7),
            "mainseg": state.get("mainseg", 0), "seg": segs}


def setup_record(info: dict | None, cfg: dict | None) -> dict:
    """The LED setup the look was made on — what decides how the same numbers
    render. Geometry (counts, outputs, types) decides whether segment bounds
    are still right; colour settings (auto-white, CCT blending, gamma, ABL…)
    only change how the numbers come out."""
    cfg = cfg or {}
    led = ((cfg.get("hw") or {}).get("led")) or {}
    light = cfg.get("light") or {}
    leds = _leds(info)
    buses = [b for b in (led.get("ins") or []) if isinstance(b, dict)]
    return {
        "geometry": {
            "total": led.get("total", leds.get("count")),
            "seglc": list(leds.get("seglc") or []),
            "rgbw": bool(leds.get("rgbw", False)),
            "matrix": leds.get("matrix") or None,
            "buses": [{k: b.get(k) for k in ("type", "start", "len", "skip", "rev")} for b in buses],
        },
        "colour": {
            "buses": [{k: b.get(k) for k in ("order", "rgbwm", "freq", "maxpwr", "ledma")} for b in buses],
            "rgbwm": led.get("rgbwm"), "cb": led.get("cb"), "cr": led.get("cr"), "cct": led.get("cct"),
            "ic": led.get("ic"), "gc": light.get("gc"), "scale_bri": light.get("scale-bri"),
            "maxpwr": led.get("maxpwr"), "ledma": led.get("ledma"),
        },
    }


def setup_hash(setup: dict) -> str:
    return _hash(setup)


def _covered_leds(state: dict, info: dict | None) -> int:
    matrix = _leds(info).get("matrix") or {}
    w = int(matrix.get("w") or 0)
    covered: set[int] = set()
    for s in state.get("seg") or []:
        start, stop = int(s.get("start", 0) or 0), int(s.get("stop", 0) or 0)
        if stop <= start:
            continue
        if w and "startY" in s:
            for y in range(int(s.get("startY", 0) or 0), int(s.get("stopY", 1) or 1)):
                covered.update(y * w + x for x in range(start, stop))
        else:
            covered.update(range(start, stop))
    return len(covered)


def warnings(info: dict | None, state: dict) -> list[str]:
    """What remembering this look should tell the person first."""
    out: list[str] = []
    for n, s in enumerate(state.get("seg") or [], 1):
        if s.get("pal") in RANDOM_PALETTES:
            out.append(f"Part {n} uses the Random Cycle palette — it changes by design and won't look the same twice")
        if s.get("fx") in RANDOM_EFFECTS:
            out.append(f"Part {n}'s effect picks random colours — it changes by design and won't look the same twice")
    if isinstance(state.get("pl"), int) and state["pl"] >= 0:
        out.append("A playlist is running — the look is its current step")
    if (state.get("nl") or {}).get("on"):
        out.append("The nightlight is on — it will fade or switch the light later; it is not part of the look")
    if (info or {}).get("live"):
        out.append("A realtime stream (E1.31/DDP) is driving the light right now — the look is what WLED holds underneath")
    total = int(_leds(info).get("count") or 0)
    covered = _covered_leds(state, info)
    if total and covered < total:
        out.append(f"{total - covered} of {total} LEDs aren't in any part of the look, so they stay dark")
    return out


def team_warnings(looks: list[dict]) -> list[str]:
    """Looks remembered together: different colour gamma renders the same
    numbers differently (PadSpan doesn't change that setting)."""
    gammas = {json.dumps(((lk.get("setup") or {}).get("colour") or {}).get("gc"), sort_keys=True) for lk in looks}
    if len(gammas) > 1:
        return ["Colour gamma differs between team members — the same colour numbers will look different"]
    return []


def capture(si: dict, cfg: dict | None, *, by: str, at: float) -> dict:
    """A whole look from GET /json/si then GET /json/cfg."""
    info, state = si.get("info") or {}, si.get("state") or {}
    setup = setup_record(info, cfg)
    return {
        "v": LOOK_VERSION, "at": at, "by": by, "fw": info.get("ver"), "arch": info.get("arch"),
        "state": capture_state(state), "setup": setup, "setup_hash": setup_hash(setup),
        "warnings": warnings(info, state),
    }


# ── Setup drift, in plain words ──────────────────────────────────────────────


def _bus_type(t: Any) -> str:
    return _BUS_TYPES.get(t, f"type {t}")


def _mode(m: Any) -> str:
    return _WHITE_MODES.get(m, str(m))


def _lc(lc: Any) -> str:
    if not isinstance(lc, int):
        return str(lc)
    parts = [n for bit, n in ((1, "RGB"), (2, "W"), (4, "CCT")) if lc & bit]
    return "+".join(parts) or "on/off"


def _ma(v: Any) -> str:
    return "none" if not v else f"{v} mA"


def setup_diff(old: dict | None, new: dict | None) -> dict[str, list[str]]:
    """{"geometry": [...], "colour": [...]} — every change between two setup
    records, each as one plain line. Geometry lines mean the segment bounds
    may no longer fit; colour lines only change how the same numbers look."""
    geo: list[str] = []
    col: list[str] = []
    og, ng = (old or {}).get("geometry") or {}, (new or {}).get("geometry") or {}
    oc, nc = (old or {}).get("colour") or {}, (new or {}).get("colour") or {}
    if og.get("total") != ng.get("total"):
        geo.append(f"LED count changed from {og.get('total')} to {ng.get('total')}")
    if (og.get("matrix") or None) != (ng.get("matrix") or None):
        geo.append("The 2D matrix layout changed")
    ob, nb = og.get("buses") or [], ng.get("buses") or []
    if len(ob) != len(nb):
        geo.append(f"Outputs changed from {len(ob)} to {len(nb)}")
    for i, (a, b) in enumerate(zip(ob, nb), 1):
        if a.get("type") != b.get("type"):
            geo.append(f"Output {i} changed from {_bus_type(a.get('type'))} to {_bus_type(b.get('type'))}")
        if a.get("start") != b.get("start") or a.get("len") != b.get("len"):
            geo.append(f"Output {i} now drives {b.get('len')} LEDs from {b.get('start')} "
                       f"(was {a.get('len')} from {a.get('start')})")
        if a.get("skip") != b.get("skip"):
            geo.append(f"Output {i} skips {b.get('skip')} LEDs (was {a.get('skip')})")
        if bool(a.get("rev")) != bool(b.get("rev")):
            geo.append(f"Output {i} is {'now' if b.get('rev') else 'no longer'} reversed")
    for i, (a, b) in enumerate(zip(oc.get("buses") or [], nc.get("buses") or []), 1):
        if a.get("order") != b.get("order"):
            col.append(f"Output {i} colour order {_ORDERS.get(a.get('order'), a.get('order'))} → "
                       f"{_ORDERS.get(b.get('order'), b.get('order'))}")
        if a.get("rgbwm") != b.get("rgbwm"):
            col.append(f"Output {i} white mode {_mode(a.get('rgbwm'))} → {_mode(b.get('rgbwm'))}")
        if a.get("freq") != b.get("freq"):
            col.append(f"Output {i} PWM frequency {a.get('freq')} Hz → {b.get('freq')} Hz")
        if a.get("maxpwr") != b.get("maxpwr"):
            col.append(f"Output {i} current limit {_ma(a.get('maxpwr'))} → {_ma(b.get('maxpwr'))}")
        if a.get("ledma") != b.get("ledma"):
            col.append(f"Output {i} mA per LED {a.get('ledma')} → {b.get('ledma')}")
    names = {"rgbwm": "White mode for every output", "cb": "White blending", "cr": "Colour temperature from RGB",
             "cct": "White balance correction", "ic": "Colour temperature on the last channel",
             "gc": "Gamma", "scale_bri": "Brightness factor", "maxpwr": "Current limit", "ledma": "mA per LED"}
    for key, label in names.items():
        a, b = oc.get(key), nc.get(key)
        if a != b:
            if key == "rgbwm":
                a, b = _mode(a), _mode(b)
            elif key == "maxpwr":
                a, b = _ma(a), _ma(b)
            elif key == "gc":
                a, b = (a or {}).get("col"), (b or {}).get("col")
            col.append(f"{label} {a} → {b}")
    for i, (a, b) in enumerate(zip(og.get("seglc") or [], ng.get("seglc") or []), 1):
        if a != b:
            col.append(f"Part {i} can now take {_lc(b)} (was {_lc(a)})")
    if bool(og.get("rgbw")) != bool(ng.get("rgbw")):
        col.append("A white channel was " + ("added" if ng.get("rgbw") else "removed"))
    return {"geometry": geo, "colour": col}


# ── Requests ─────────────────────────────────────────────────────────────────


def _pad_col(col: Any, white: bool) -> Any:
    """Every slot with 4 values on a white-capable unit: 3 would zero W. A
    slot remembered with 3 values (the unit had no white then) is sent as
    [r,g,b,0] — what WLED would do with it anyway, now stated."""
    if not isinstance(col, list) or not white:
        return copy.deepcopy(col)
    out = []
    for slot in col:
        if isinstance(slot, list) and len(slot) == 3:
            out.append([*slot, 0])
        else:
            out.append(copy.deepcopy(slot))
    return out


def seg_body(seg: dict, ctx: Ctx) -> dict:
    """One segment as sent: every remembered key, frz false, colours whole;
    without bounds when the LED geometry changed since it was remembered."""
    out: dict[str, Any] = {"id": seg.get("id")}
    for k, v in seg.items():
        if k in SEG_DROP or k in SEG_FORBIDDEN or k == "id":
            continue
        if not ctx.geometry_ok and k in SEG_BOUNDS:
            continue
        out[k] = _pad_col(v, ctx.white) if k == "col" else copy.deepcopy(v)
    out["frz"] = False
    return out


def _chunks(items: list, n: int) -> list[list]:
    return [items[i:i + n] for i in range(0, len(items), n)] or [[]]


def _look_segs(look_state: dict, ctx: Ctx, only: set | None = None) -> list[dict]:
    segs = sorted((s for s in look_state.get("seg") or [] if isinstance(s, dict)), key=lambda s: s.get("id", 0))
    return [seg_body(s, ctx) for s in segs if only is None or s.get("id") in only]


def extra_segment_ids(look_state: dict, live_state: dict) -> list[int]:
    """Segments the device has that the look doesn't (deleted last)."""
    mine = {s.get("id") for s in look_state.get("seg") or []}
    return sorted(s.get("id") for s in live_state.get("seg") or [] if s.get("id") not in mine)


def tail_body(ids: list[int]) -> dict:
    return {"seg": [{"id": i, "stop": 0} for i in sorted(ids)], "udpn": {"nn": True}, "v": True}


def on_bodies(look_state: dict, live_state: dict, ctx: Ctx, *, bri: int, tt: int,
              dark: bool, team: bool = False) -> list[dict]:
    """The whole look, then the master on.
    dark: segments in chunks with tt 0 while the strip is off, the tail, then
    {on, bri, tt} (+ tb 0 for a team member, so members' effects start in step).
    lit: the same content in one request with on/bri/tt; if it needs several
    chunks, each carries tt and the last carries on and bri; then the tail."""
    segs = _look_segs(look_state, ctx)
    chunks = _chunks(segs, ctx.max_segs)
    extra = extra_segment_ids(look_state, live_state)
    mainseg = look_state.get("mainseg", 0)
    bodies: list[dict] = []
    if dark:
        for chunk in chunks:
            bodies.append({"tt": 0, "nl": {"on": False}, "udpn": dict(UDPN_OFF), "mainseg": mainseg,
                           "seg": chunk, "v": True})
        if extra:
            bodies.append(tail_body(extra))
        final = {"on": True, "bri": bri, "tt": tt, "udpn": {"nn": True}, "v": True}
        if team:
            final["tb"] = 0
        bodies.append(final)
        return bodies
    for n, chunk in enumerate(chunks):
        body: dict[str, Any] = {"tt": tt, "nl": {"on": False}, "udpn": dict(UDPN_OFF), "mainseg": mainseg,
                                "seg": chunk, "v": True}
        if n == len(chunks) - 1:
            body = {"on": True, "bri": bri, **body}
        bodies.append(body)
    if extra:
        bodies.append(tail_body(extra))
    return bodies


def off_body(tt: int) -> dict:
    """Only the master goes off; the segments keep the look's on flags, so an
    outside "on" never comes up dark."""
    return {"on": False, "tt": tt, "nl": {"on": False}, "udpn": dict(UDPN_OFF), "v": True}


def dim_body(bri: int, sync_ok: bool = True) -> dict:
    return {"bri": bri, "tt": 2, "udpn": {"nn": True} if sync_ok else dict(UDPN_OFF), "v": True}


def resend_bodies(look_state: dict, ctx: Ctx, seg_ids: set, *, on: bool, bri: int, tt: int) -> list[dict]:
    """The differing segments, each whole, together with the master."""
    segs = _look_segs(look_state, ctx, only=seg_ids)
    head = {"on": on, "bri": bri, "tt": tt, "nl": {"on": False}, "udpn": dict(UDPN_OFF),
            "mainseg": look_state.get("mainseg", 0)}
    if not segs:
        return [{**head, "v": True}]
    return [{**head, "seg": chunk, "v": True} for chunk in _chunks(segs, ctx.max_segs)]


def forbidden_in(body: dict) -> list[str]:
    """Keys the exact path must never send (a test guard and a runtime one)."""
    bad = [k for k in body if k in FORBIDDEN_KEYS]
    for s in body.get("seg") or []:
        if isinstance(s, dict):
            bad += [f"seg.{k}" for k in s if k in SEG_FORBIDDEN]
    return bad


def check_exact_cfg_patch(patch: Any) -> str | None:
    """None if the exact code may send this /json/cfg patch: only
    if.sync.send / if.sync.recv, and only their own keys."""
    if not isinstance(patch, dict) or set(patch) != {"if"}:
        return "the exact look may only change the sync settings"
    iface = patch["if"]
    if not isinstance(iface, dict) or set(iface) != {"sync"}:
        return "the exact look may only change the sync settings"
    sync = iface["sync"]
    if not isinstance(sync, dict) or not sync or set(sync) - {"send", "recv"}:
        return "the exact look may only change the sync send/receive settings"
    for name, allowed in (("send", _CFG_SEND_KEYS), ("recv", _CFG_RECV_KEYS)):
        block = sync.get(name)
        if block is None:
            continue
        if not isinstance(block, dict) or set(block) - allowed:
            return f"'{name}' carries keys the exact look may not write"
    return None


def sync_off_patch() -> dict:
    return copy.deepcopy(SYNC_OFF_PATCH)


# ── Compare ──────────────────────────────────────────────────────────────────


def udpn_ok(state: dict) -> bool:
    u = state.get("udpn") or {}
    return u.get("sgrp", 0) == 0 and u.get("rgrp", 0) == 0 and not u.get("send", False)


def _seg_lc(ctx: Ctx, live_state: dict, seg_id: Any, live_seg: dict) -> int:
    if isinstance(live_seg.get("lc"), int):
        return live_seg["lc"]
    ids = [s.get("id") for s in live_state.get("seg") or []]
    try:
        return int(ctx.seglc[ids.index(seg_id)])
    except (ValueError, IndexError, TypeError):
        return 1 | (2 if ctx.white else 0)


def _norm(key: str, want: Any, seg: dict, ctx: Ctx) -> Any:
    if key == "grp":
        return want or 1
    if key == "c3" and isinstance(want, int):
        return min(want, 31)
    if key == "stop" and isinstance(want, int) and ctx.total and "startY" not in seg:
        return min(want, ctx.total)
    if key == "of" and isinstance(want, int):
        length = int(seg.get("stop", 0) or 0) - int(seg.get("start", 0) or 0)
        return want % length if length > 0 else want
    if key == "fx" and isinstance(want, int) and ctx.fxcount and want >= ctx.fxcount:
        return 0
    return want


def _col_equal(want: Any, got: Any, white: bool) -> bool:
    if not isinstance(want, list) or not isinstance(got, list):
        return want == got
    n = 4 if white else 3
    for i in range(3):
        a = list(want[i]) if i < len(want) and isinstance(want[i], list) else []
        b = list(got[i]) if i < len(got) and isinstance(got[i], list) else []
        a, b = (a + [0, 0, 0, 0])[:n], (b + [0, 0, 0, 0])[:n]
        if a != b:
            return False
    return True


def compare(look_state: dict, live_state: dict, ctx: Ctx, *, on: bool | None = None,
            bri: int | None = None, exact: bool = False) -> list[dict]:
    """What differs between the look and the device, normalized the way WLED
    reports it: of mod len, grp 0→1, c3 ≤31, stop ≤ the LED count, W ignored
    without a white channel, pal ignored on non-RGB segments, col ignored on
    on/off segments, a reported opacity 255 for a look's 0, an out-of-range
    effect id read as 0. Each: {"seg": id | None, "key": k, "what": words}.
    `exact`: the device is PadSpan's — sync must read off and no nightlight."""
    diffs: list[dict] = []
    if on is not None and bool(live_state.get("on")) != bool(on):
        diffs.append({"seg": None, "key": "on", "what": "power"})
    if on and bri is not None and live_state.get("bri") != bri:
        diffs.append({"seg": None, "key": "bri", "what": "brightness"})
    if exact:
        if not udpn_ok(live_state):
            diffs.append({"seg": None, "key": "udpn", "what": "sync"})
        if (live_state.get("nl") or {}).get("on"):
            diffs.append({"seg": None, "key": "nl", "what": "nightlight"})
    if on is False:
        return diffs
    live = {s.get("id"): s for s in live_state.get("seg") or [] if isinstance(s, dict)}
    look_ids = {s.get("id") for s in look_state.get("seg") or []}
    if "mainseg" in live_state and look_state.get("mainseg", 0) in live and \
            live_state.get("mainseg") != look_state.get("mainseg", 0):
        diffs.append({"seg": None, "key": "mainseg", "what": "main part"})
    for seg in sorted(look_state.get("seg") or [], key=lambda s: s.get("id", 0)):
        sid = seg.get("id")
        got = live.get(sid)
        if got is None:
            diffs.append({"seg": sid, "key": "missing", "what": _SEG_WHAT["missing"]})
            continue
        lc = _seg_lc(ctx, live_state, sid, got)
        seen: set[str] = set()
        for key, want in seg.items():
            if key in ("id", "len", "lc") or key not in got:
                continue
            if not ctx.geometry_ok and key in SEG_BOUNDS:
                continue
            if key == "col":
                if lc & 3 and not _col_equal(want, got[key], ctx.white):
                    diffs.append({"seg": sid, "key": key, "what": _SEG_WHAT[key]})
                continue
            if key == "pal" and not lc & 1:
                continue
            w = _norm(key, want, seg, ctx)
            g = (got[key] or 1) if key == "grp" else got[key]
            if key == "bri" and w == 0 and g == 255:
                continue
            if w != g:
                what = _SEG_WHAT.get(key, "settings")
                if what not in seen:
                    diffs.append({"seg": sid, "key": key, "what": what})
                    seen.add(what)
    for sid in sorted(set(live) - look_ids, key=lambda x: (x is None, x)):
        diffs.append({"seg": sid, "key": "extra", "what": _SEG_WHAT["extra"]})
    return diffs


def differing_segments(diffs: list[dict]) -> set:
    return {d["seg"] for d in diffs if d.get("seg") is not None and d.get("key") != "extra"}


def describe(diffs: list[dict]) -> list[str]:
    """Plain lines: ["part 2: colour, effect", "brightness"]."""
    by_seg: dict[Any, list[str]] = {}
    master: list[str] = []
    for d in diffs:
        if d.get("seg") is None:
            if d["what"] not in master:
                master.append(d["what"])
        else:
            words = by_seg.setdefault(d["seg"], [])
            if d["what"] not in words:
                words.append(d["what"])
    out = [f"part {sid + 1 if isinstance(sid, int) else sid}: {', '.join(words)}"
           for sid, words in sorted(by_seg.items(), key=lambda kv: (not isinstance(kv[0], int), kv[0]))]
    return out + master


# ── Teams ────────────────────────────────────────────────────────────────────


def team_bri(member_look_bri: Any, bri: int, ref_look_bri: Any) -> int:
    """A member's brightness when the team is set to `bri`, keeping each
    member's tuning ("Upper North 20% brighter"): member × bri / reference,
    within 1-255."""
    try:
        m, r = int(member_look_bri), int(ref_look_bri)
    except (TypeError, ValueError):
        return max(1, min(255, int(bri)))
    if r <= 0:
        return max(1, min(255, int(bri)))
    return max(1, min(255, round(m * int(bri) / r)))
