"""Real-time walk-through of Live Aboard's build tools (Playwright, real mouse).

usage: python pw_flow.py <scenario> <outprefix>
"""
import sys, time, json
from playwright.sync_api import sync_playwright

scen, pre = sys.argv[1], sys.argv[2]
url = "http://127.0.0.1:8765/tools/live_aboard_harness/index.html?one=1&sky=sunny&edit=1" + (sys.argv[3] if len(sys.argv) > 3 else "")
SLOT = "const LA = await import('../../custom_components/padspan_ha/www/padspan-ha/views/live_aboard.js'); const s = LA.liveAboardSlot('atlas');"


def where(pg, fid, x, y, z=1.1):
    return pg.evaluate(f"async () => {{ {SLOT} return s._whereOf('{fid}', {x}, {y}, {z}); }}")


def state(pg):
    return pg.evaluate(f"async () => {{ {SLOT} const t = s._state(); return {{edit: {{tool: t.edit.tool, hint: t.edit.hint, hintBad: t.edit.hintBad, sel: t.edit.sel, dirty: t.edit.dirty, canUndo: t.edit.canUndo, canRedo: t.edit.canRedo, gesture: t.edit.gesture, pending: t.edit.pending}}, added: t.added}}; }}")


def shot(pg, name):
    pg.screenshot(path=f"{pre}_{name}.png")


with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1300, "height": 950})
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
    pg.goto(url); time.sleep(9)
    def press(name):
        for _ in range(4):
            try:
                pg.get_by_role("button", name=name, exact=True).first.click(timeout=5000); return
            except Exception as e:
                time.sleep(1)
        print("no button", name)
    press("Edit"); time.sleep(1)
    tools = pg.locator(".la3d-tools")

    def tool(name):
        press(name); time.sleep(2.5)

    def drag(a, c, steps=12, hold=None):
        pg.mouse.move(*a); pg.mouse.down()
        for i in range(1, steps + 1):
            pg.mouse.move(a[0] + (c[0] - a[0]) * i / steps, a[1] + (c[1] - a[1]) * i / steps); time.sleep(0.03)
            if hold and i == hold:
                time.sleep(0.5); shot(pg, "middrag"); print("mid", json.dumps(state(pg)))
        pg.mouse.up(); time.sleep(1.2)

    if scen == "draw":
        tool("Door")
        shot(pg, "picked"); print("picked", json.dumps(state(pg)))
        drag(where(pg, "main", 5.6, 10), where(pg, "main", 7.2, 10), hold=6)
        shot(pg, "after"); print("after", json.dumps(state(pg)))
    elif scen == "corner":
        tool("Window")
        # along the Laundry's outside wall, past its corner at x=11
        drag(where(pg, "main", 9.5, 10), where(pg, "main", 12.5, 10), hold=10)
        shot(pg, "after"); print("after", json.dumps(state(pg)))
    elif scen == "taps":
        tool("Window")
        a, c = where(pg, "main", 6, 10), where(pg, "main", 7.5, 10)
        pg.mouse.click(*a); time.sleep(0.8); shot(pg, "tap1"); print("tap1", json.dumps(state(pg)))
        pg.mouse.move(c[0] - 20, c[1]); time.sleep(0.6); shot(pg, "hover2")
        pg.mouse.click(*c); time.sleep(1.2); shot(pg, "after"); print("after", json.dumps(state(pg)))
    elif scen == "resize":
        tool("Door")
        drag(where(pg, "main", 6, 10), where(pg, "main", 7, 10))
        a = where(pg, "main", 7, 10)
        drag(a, where(pg, "main", 8.2, 10), hold=6)
        shot(pg, "after"); print("after", json.dumps(state(pg)))
    elif scen == "undo":
        tool("Door")
        drag(where(pg, "main", 6, 10), where(pg, "main", 7, 10))
        press("Undo"); time.sleep(1.2); shot(pg, "undone"); print("undone", json.dumps(state(pg)))
        press("Redo"); time.sleep(1.2); shot(pg, "redone"); print("redone", json.dumps(state(pg)))
        press("Discard"); time.sleep(1.2); shot(pg, "discard"); print("discard", json.dumps(state(pg)))
        btns = pg.locator(".la3d-ask button").all_text_contents(); print("ask", btns)
    elif scen == "keys":
        tool("Door")
        drag(where(pg, "main", 6, 10), where(pg, "main", 7, 10))
        print("drawn", json.dumps(state(pg)))
        pg.keyboard.press("Delete"); time.sleep(1); print("delete", json.dumps(state(pg)))
        pg.keyboard.press("Control+z"); time.sleep(1); print("undo", json.dumps(state(pg)))
        pg.keyboard.press("Control+z"); time.sleep(1); print("undo2", json.dumps(state(pg)))
        pg.keyboard.press("Control+y"); time.sleep(1); print("redo", json.dumps(state(pg)))
        a = where(pg, "main", 8, 10); pg.mouse.click(*a); time.sleep(0.8); print("tap1", json.dumps(state(pg)))
        pg.keyboard.press("Escape"); time.sleep(0.8); print("esc", json.dumps(state(pg)))
    elif scen == "strip":
        tool("Strip")
        shot(pg, "picked")
        print("buttons", [t for t in pg.evaluate("[...document.querySelectorAll('.la3d-sheet button, .la3d-sheet select, .la3d-sheet option')].filter(b=>b.offsetParent||b.tagName==='OPTION').map(b=>b.tagName+':'+b.textContent.trim()).slice(0,40)")])
        pg.locator(".la3d-sheet button", has_text="Living valance").first.click(); time.sleep(2.5)
        shot(pg, "chosen")
        print("sheet", pg.locator(".la3d-sheet").first.inner_text()[:600].replace(chr(10), " | "))
        print("sheetbtns", pg.evaluate("[...document.querySelectorAll('.la3d-sheet button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim())"))
        pg.locator(".la3d-sheet button", has_text="Round").first.click(); time.sleep(2.5)
        shot(pg, "round")
        print("sheet2", pg.locator(".la3d-sheet").first.inner_text()[:600].replace(chr(10), " | "))
        press("Iso"); time.sleep(2.5); shot(pg, "iso")
    print("errors", errs[:6])
    b.close()
