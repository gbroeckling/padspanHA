"""Real-time: draw a door, then work its sheet (hinge, swing, type, shown) and Save."""
import sys, time
from playwright.sync_api import sync_playwright
from browser import launch, wait_ready   # the machine's browser (issue #95)

out = sys.argv[1]
url = "http://127.0.0.1:8765/tools/live_aboard_harness/index.html?one=1&sky=sunny&edit=1"
SLOT = "async () => { const LA = await import('../../custom_components/padspan_ha/www/padspan-ha/views/live_aboard.js'); return LA.liveAboardSlot('atlas'); }"

with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width": 1300, "height": 950})
    bad = []
    pg.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    pg.on("pageerror", lambda e: bad.append("pageerror " + str(e)))
    pg.goto(url); wait_ready(pg)
    pg.get_by_role("button", name="Edit", exact=True).click(); time.sleep(1)
    pg.get_by_role("button", name="Door", exact=True).first.click(); time.sleep(2.5)
    a, c = pg.evaluate("""async () => { const LA = await import('../../custom_components/padspan_ha/www/padspan-ha/views/live_aboard.js');
        const s = LA.liveAboardSlot('atlas'); return [s._whereOf('main', 6, 10, 1.1), s._whereOf('main', 7, 10, 1.1)]; }""")
    pg.mouse.move(*a); pg.mouse.down()
    for i in range(1, 11): pg.mouse.move(a[0] + (c[0] - a[0]) * i / 10, a[1] + (c[1] - a[1]) * i / 10); time.sleep(0.03)
    pg.mouse.up(); time.sleep(1.5)
    sheet = pg.locator(".la3d-sheet")
    sheet.get_by_role("button", name="Right", exact=True).click(); time.sleep(0.6)
    sheet.get_by_role("button", name="Out", exact=True).click(); time.sleep(0.6)
    sheet.get_by_role("button", name="Open", exact=True).click(); time.sleep(1.2)
    pg.get_by_role("button", name="Iso", exact=True).click(); time.sleep(2.5)
    pg.screenshot(path=out.replace(".png", "_hinged.png"))
    opts = sheet.locator("select").first.locator("option").all_text_contents()
    print("types", opts)
    pick = next((o for o in opts if "Sliding" in o or "sliding" in o), None)
    if pick:
        sheet.locator("select").first.select_option(label=pick); time.sleep(4)
        pg.screenshot(path=out.replace(".png", "_sliding.png"))
        pg.get_by_role("button", name="Top", exact=True).click(); time.sleep(3)
        pg.screenshot(path=out.replace(".png", "_slidingtop.png"))
        print("arcs", pg.evaluate("""async () => { const LA = await import('../../custom_components/padspan_ha/www/padspan-ha/views/live_aboard.js');
            const s = LA.liveAboardSlot('atlas')._state(); return {arcs: s.edit.arcs, doors: s.doors}; }"""))
    st = pg.evaluate("""async () => { const LA = await import('../../custom_components/padspan_ha/www/padspan-ha/views/live_aboard.js');
        const s = LA.liveAboardSlot('atlas')._state(); return {dirty: s.edit.dirty, changes: s.edit.changes, failed: s.failed}; }""")
    print("before save", st)
    pg.get_by_role("button", name="Save", exact=True).click(); time.sleep(2)
    st = pg.evaluate("""async () => { const LA = await import('../../custom_components/padspan_ha/www/padspan-ha/views/live_aboard.js');
        const s = LA.liveAboardSlot('atlas')._state(); return {dirty: s.edit.dirty, saving: s.edit.saving, hint: s.edit.hint, failed: s.failed}; }""")
    print("after save", st)
    pg.screenshot(path=out)
    print("bad", bad[:8])
    b.close()
