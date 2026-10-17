"""The setup wizard's way into Live Aboard: ?edit=1&tool=<t>[&teid=<light>] opens
Edit at that tool (views/live_aboard_edit.js startTool). Prints which tool button
is pressed and the hint, per tool."""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/tools/live_aboard_harness/index.html?display=0&edit=1"
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1300, "height": 950})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    for tool in ["heights", "door", "window", "strip"]:
        extra = "&teid=" + sys.argv[1] if tool == "strip" and len(sys.argv) > 1 else ""
        pg.goto(f"{BASE}&tool={tool}{extra}")
        pg.wait_for_timeout(5000)
        pressed = pg.evaluate("""() => { const out = []; const walk = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) walk(e.shadowRoot);
            if (e.tagName === 'BUTTON' && e.getAttribute('aria-pressed') === 'true') out.push(e.textContent.trim()); } }; walk(document); return out; }""")
        hint = pg.evaluate("""() => { let t = ''; const walk = (r) => { for (const e of r.querySelectorAll('.la3d-hint')) t = e.textContent; for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return t; }""")
        print(tool, "| pressed:", pressed, "| hint:", hint[:80])
    print("errors:", errs)
    b.close()
