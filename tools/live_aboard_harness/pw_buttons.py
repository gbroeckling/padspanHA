"""The ⋯ list's "Lights as buttons": off until ticked; then every light of the floors showing is a button on the house,
and the picture is saved to look at.

usage: python pw_buttons.py [out.png]   (the harness served on PADSPAN_HARNESS_PORT, default 8765)
"""
import sys, time
from playwright.sync_api import sync_playwright
from browser import HARNESS, launch, wait_ready

OUT = sys.argv[1] if len(sys.argv) > 1 else None

with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width": 1300, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
    pg.goto(f"{HARNESS}index.html?maponly=1"); wait_ready(pg)
    before = pg.locator(".la3d-btn").count()
    pg.locator("[data-la3d-more]").first.click(); time.sleep(0.4)
    row = pg.locator('[data-show="light_buttons"]')
    listed = row.count()
    if listed:
        row.first.locator('[role="switch"], [role="checkbox"], [aria-checked]').first.click(); time.sleep(0.4)
    pg.keyboard.press("Escape"); pg.mouse.click(650, 880); time.sleep(0.8)
    after = pg.locator(".la3d-btn").count()
    faces = pg.evaluate("""() => [...document.querySelectorAll('.la3d-btn')].map(g => g.getAttribute('data-on') + ':' + g.textContent)""")
    print("buttons before:", before, "listed:", listed, "after:", after, "faces:", faces)
    if OUT:
        pg.screenshot(path=OUT)
    print("errors:", errs)
    b.close()
    sys.exit(0 if (before == 0 and listed == 1 and after > 0 and not errs) else 1)
