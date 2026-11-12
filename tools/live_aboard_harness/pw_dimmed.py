"""A tap on a device the class chips dim says why it did nothing, and "Show all" asks the host for every class.

usage: python pw_dimmed.py   (the harness served on PADSPAN_HARNESS_PORT, default 8765)
"""
import sys, time
from playwright.sync_api import sync_playwright
from browser import HARNESS, launch, wait_ready


def taps(pg, want_toast):
    box = pg.locator("canvas").first.bounding_box()
    n = 0
    for fy in (0.3, 0.4, 0.5, 0.6, 0.7):
        for fx in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
            pg.mouse.click(box["x"] + box["width"] * fx, box["y"] + box["height"] * fy)
            n += 1
            time.sleep(0.7)                                   # past the double-tap window
            t = pg.locator(".la3d-toast")
            if t.count():
                return n, t.first.inner_text()
    return n, None


with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width": 1300, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
    pg.goto(f"{HARNESS}index.html?maponly=1&cls=motion"); wait_ready(pg)
    n, said = taps(pg, True)
    print("motion chip:", n, "taps, note:", repr(said))
    ok = bool(said) and "Only Motion takes taps" in said and "Show all" in said
    if said:
        pg.locator(".la3d-toast button").first.click(); time.sleep(0.3)
    asked = pg.evaluate("window.__cls || []")
    print("asked the host for:", asked)
    ok = ok and asked == ["all"]
    pg.goto(f"{HARNESS}index.html?maponly=1"); wait_ready(pg)
    n2, said2 = taps(pg, False)
    print("every class:", n2, "taps, note:", repr(said2))
    ok = ok and said2 is None and not errs
    print("errors:", errs)
    b.close()
    sys.exit(0 if ok else 1)
