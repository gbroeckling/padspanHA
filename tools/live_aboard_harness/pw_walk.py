"""Real-time check of Live Aboard's walk-through (Playwright, real keyboard, mouse and touch).

usage: python pw_walk.py <out prefix>

On the fixture house with a straight staircase in the Living Room up to the
Bedroom: Walk on the bar, the bars give way to Stop walking; real keys walk
(the view has the keyboard once Walk is pressed); a wall stops you; up the
stairs to the floor above; a drag looks round; a touch shows the stick and
it walks; standing still no frame is drawn; Stop walking puts the orbit view
back. Prints its state and an error list (check_log.py reads them).
"""
import sys
import time
from playwright.sync_api import sync_playwright
from browser import HARNESS, SLOT, launch, wait_ready   # the machine's browser (issue #95)

out = sys.argv[1] if len(sys.argv) > 1 else "walk"
url = f"{HARNESS}index.html?sky=sunny&quality=low&stairs=auto:balustrade:straight:closed"   # Low: as a slow tablet draws it
WALK = (f"async () => {{ {SLOT} const t = s._state(); return {{walk: t.walk, frames: t.frames, cam: t.cam, failed: t.failed || null, "
        "explode: t.levels.explode, liveMs: t.liveMs}; }")


def state(pg):
    return pg.evaluate(WALK)


with sync_playwright() as p:
    b = launch(p)
    ctx = b.new_context(viewport={"width": 1300, "height": 950}, has_touch=True)
    pg = ctx.new_page()
    errs, bad = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    pg.goto(url)
    wait_ready(pg)
    time.sleep(1.0)
    # What the orbit view draws by itself, at rest (a fan turning, a motion pulse: liveMs); walking may draw no more.
    f0 = state(pg)["frames"]
    time.sleep(1.5)
    orbit = state(pg)
    orbit_rest = orbit["frames"] - f0
    print("orbit frames at rest", orbit_rest, "liveMs", orbit["liveMs"])
    pg.get_by_role("button", name="Walk", exact=True).click()
    time.sleep(1.0)
    s = state(pg)
    print("walking", s["walk"]["on"], "at", s["walk"]["walker"], "explode", s["explode"], "fov", s["walk"]["fov"])
    if not s["walk"]["on"]:
        bad.append("Walk did not start")
    stop = pg.get_by_role("button", name="✕ Stop walking", exact=True)
    if not stop.is_visible():
        bad.append("no Stop walking button")
    if pg.get_by_role("button", name="Walk", exact=True).is_visible():
        bad.append("the bar still shows while walking")
    pg.screenshot(path=f"{out}_start.png")
    # Real keys, with the view's keyboard as Walk left it: W for a second.
    w0 = s["walk"]["walker"]
    pg.keyboard.down("w")
    time.sleep(1.0)
    pg.keyboard.up("w")
    time.sleep(0.4)
    s = state(pg)
    moved = ((s["walk"]["walker"]["x"] - w0["x"]) ** 2 + (s["walk"]["walker"]["y"] - w0["y"]) ** 2) ** 0.5
    print("keys moved", round(moved, 2))
    if moved < 0.5:
        bad.append(f"W moved only {moved:.2f} m")
    # Standing still: no frames of its own (only what moves by itself, as in orbit).
    f0 = state(pg)["frames"]
    time.sleep(1.5)
    f1 = state(pg)["frames"]
    print("frames at rest", f1 - f0, "liveMs", state(pg)["liveMs"])
    if f1 - f0 > orbit_rest + 2:
        bad.append(f"{f1 - f0} frames drawn standing still (orbit: {orbit_rest})")
    # Up the stairs: at their foot (the Living Room, y 4.5), facing up them.
    pg.evaluate(f"async () => {{ {SLOT} s._walk().place(8, 5.7, 0, 0); }}")
    time.sleep(0.5)
    pg.screenshot(path=f"{out}_stairs.png")
    pg.keyboard.down("ArrowUp")
    time.sleep(4.0)
    pg.keyboard.up("ArrowUp")
    time.sleep(0.6)
    s = state(pg)
    print("after the stairs", s["walk"]["walker"])
    if s["walk"]["walker"]["floor"] != "upper" or abs(s["walk"]["walker"]["foot"] - 2.8) > 1e-6:
        bad.append("the stairs did not take the walker upstairs")
    # Upstairs, from the Bedroom's far side, looking back over the opening.
    pg.evaluate(f"async () => {{ {SLOT} s._walk().place(8, 5.6, 2.8, 0); }}")
    time.sleep(0.5)
    pg.screenshot(path=f"{out}_upstairs.png")
    # A drag looks round.
    yaw0 = s["walk"]["walker"]["yaw"]
    pg.mouse.move(650, 500)
    pg.mouse.down()
    for i in range(1, 9):
        pg.mouse.move(650 - i * 25, 500)
        time.sleep(0.02)
    pg.mouse.up()
    time.sleep(0.3)
    s = state(pg)
    print("drag turned", round(s["walk"]["walker"]["yaw"] - yaw0, 3))
    if abs(s["walk"]["walker"]["yaw"] - yaw0) < 0.1:
        bad.append("a drag did not look round")
    # A touch shows the stick; pushed up, it walks.
    pg.touchscreen.tap(650, 400)
    time.sleep(0.3)
    s = state(pg)
    print("stick shown", s["walk"]["stickShown"])
    if not s["walk"]["stickShown"]:
        bad.append("a touch did not show the stick")
    box = pg.locator("[data-la3d-walkstick]").bounding_box()
    pg.screenshot(path=f"{out}_stick.png")
    w0 = s["walk"]["walker"]
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(cx, cy)
    pg.mouse.down()
    pg.mouse.move(cx, cy - box["height"] / 2, steps=4)
    time.sleep(1.0)
    pg.mouse.up()
    time.sleep(0.4)
    s = state(pg)
    moved = ((s["walk"]["walker"]["x"] - w0["x"]) ** 2 + (s["walk"]["walker"]["y"] - w0["y"]) ** 2) ** 0.5
    print("stick moved", round(moved, 2))
    if moved < 0.3:
        bad.append(f"the stick moved only {moved:.2f} m")
    # Stop walking: the orbit view as it was.
    stop.click()
    time.sleep(1.0)
    s = state(pg)
    same = all(abs(s["cam"][k] - orbit["cam"][k]) < 1e-6 for k in ("theta", "phi", "radius"))
    print("stopped", not s["walk"]["on"], "camera back", same, "explode", s["explode"], "was", orbit["explode"])
    if s["walk"]["on"] or not same or s["explode"] != orbit["explode"]:
        bad.append("Stop walking did not put the orbit view back")
    pg.screenshot(path=f"{out}_stopped.png")
    print("state", {"failed": s["failed"]})
    print("bad", bad)
    print("errors", errs[:8])
    b.close()
