"""What stands on a line keeps clear of the words: overlaps counted before and after, at several orbits (real time).

usage: python pw_raised.py [outprefix]

Before is every marker at its real height; after is where it settles. Printed, and bad [...] when
after is ever worse than before, when anything is left moving at rest, or when a view works out twice.
"""
import json, math, sys, time
from playwright.sync_api import sync_playwright
from browser import HARNESS, SLOT, launch, wait_ready   # the machine's browser (issue #95)

pre = sys.argv[1] if len(sys.argv) > 1 else None
VIEWS = [(0, 0.1, 1), (0, 20, 1), (0, 55, 1), (45, 55, 1), (90, 40, 1), (135, 55, 1), (180, 55, 1), (270, 70, 1), (0, 0.1, 0.6), (45, 55, 0.6)]


def ev(pg, body):
    return pg.evaluate(f"async () => {{ {SLOT} {body} }}")


def rest(pg, secs=6):
    end = time.time() + secs
    while time.time() < end:
        if ev(pg, "const r = s._state().raised; return r && !r.armed && !r.easing;"):
            break
        time.sleep(0.1)
    time.sleep(0.2)


with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    errs, bad = [], []
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
    pg.goto(f"{HARNESS}index.html?one=1&sky=sunny"); wait_ready(pg)
    c0 = ev(pg, "return s._state().cam;")
    total = [0, 0]
    for t, ph, k in VIEWS:
        ev(pg, f"s._look({math.radians(t)}, {math.radians(ph)}, {json.dumps(c0['target'])}, {c0['radius'] * k}); return 1;")
        rest(pg)
        after = ev(pg, "return s._raised.overlaps();")
        st = ev(pg, "const r = s._state().raised; return { runs: r.runs, ms: r.lastMs, far: Math.max(0, ...r.items.map(i => Math.hypot(...i.lift))) };")
        if pre:
            pg.screenshot(path=f"{pre}_t{t}_p{ph}_r{k}_after.png")
        ev(pg, "s._raised.disable(true); return 1;"); time.sleep(0.4)
        before = ev(pg, "return s._raised.overlaps();")
        ev(pg, "s._raised.disable(false); return 1;"); rest(pg)
        total[0] += before["count"]; total[1] += after["count"]
        print(json.dumps({"view": [t, ph, k], "items": after["items"], "words": after["words"], "before": before["count"], "after": after["count"], "far": round(st["far"], 2), "ms": round(st["ms"], 2)}), flush=True)
        if after["area"] > before["area"]:
            bad.append(f"worse at {t},{ph},{k}: {before['area']} -> {after['area']}")
    # At rest: a poll's worth of waiting works nothing out and draws nothing of its own.
    a = ev(pg, "const t = s._state(); return { runs: t.raised.runs, moves: t.raised.moves, frames: t.frames, liveMs: t.liveMs };")
    time.sleep(3)
    z = ev(pg, "const t = s._state(); return { runs: t.raised.runs, moves: t.raised.moves, frames: t.frames, liveMs: t.liveMs };")
    print("rest", a, z)
    if z["moves"] != a["moves"] or z["runs"] != a["runs"] or (not a["liveMs"] and z["frames"] != a["frames"]):
        bad.append(f"not at rest: {a} {z}")
    print("total before", total[0], "after", total[1])
    print("errs", errs)
    print("bad", bad)
    b.close()
