"""Real-time check of Live Aboard's Door / Window tools (Playwright, real mouse).

usage: python pw_door.py <tool> <fid,x0,y0,x1,y1> <out.png> [extra query]
"""
import sys, time
from playwright.sync_api import sync_playwright
from browser import HARNESS, launch, wait_ready   # the machine's browser (issue #95)

tool, seg, out = sys.argv[1], sys.argv[2], sys.argv[3]
extra = sys.argv[4] if len(sys.argv) > 4 else ""
fid, x0, y0, x1, y1 = seg.split(",")
url = f"{HARNESS}index.html?one=1&sky=sunny&edit=1{extra}"

with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width": 1300, "height": 950})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    pg.goto(url)
    wait_ready(pg)
    pg.get_by_role("button", name="Edit", exact=True).click()
    time.sleep(1)
    pg.get_by_role("button", name=tool, exact=True).click()
    time.sleep(2.5)
    a, c = pg.evaluate(f"""async () => {{ const LA = await import('../../custom_components/padspan_ha/www/padspan-ha/views/live_aboard.js');
        const s = LA.liveAboardSlot('atlas'); return [s._whereOf('{fid}', {x0}, {y0}, 1.1), s._whereOf('{fid}', {x1}, {y1}, 1.1)]; }}""")
    print("ends", a, c)
    pg.mouse.move(a[0], a[1]); pg.mouse.down()
    for i in range(1, 11):
        pg.mouse.move(a[0] + (c[0] - a[0]) * i / 10, a[1] + (c[1] - a[1]) * i / 10)
        time.sleep(0.03)
    pg.mouse.up()
    time.sleep(2.5)
    pg.screenshot(path=out.replace(".png", "_drawn.png"))
    st = pg.evaluate("""async () => { const LA = await import('../../custom_components/padspan_ha/www/padspan-ha/views/live_aboard.js');
        const s = LA.liveAboardSlot('atlas')._state(); return {frames: s.frames, shells: s.work.shells, added: s.added, failed: s.failed}; }""")
    print("state", st)
    pg.get_by_role("button", name="Iso", exact=True).click()
    time.sleep(3)
    pg.screenshot(path=out)
    print("errors", errs[:8])
    b.close()
