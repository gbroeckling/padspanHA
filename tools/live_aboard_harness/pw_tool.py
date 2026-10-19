"""The setup wizard's way into Live Aboard: ?edit=1&tool=<t>[&teid=<light>] opens
Edit at that tool (views/live_aboard_edit.js startTool). Prints which tool button
is pressed and the hint, per tool."""
import sys
from playwright.sync_api import sync_playwright
from browser import launch, wait_ready   # the machine's browser (issue #95)

BASE = "http://127.0.0.1:8765/tools/live_aboard_harness/index.html?display=0&edit=1"
with sync_playwright() as p:
    b = launch(p)
    errs = []
    for tool in ["heights", "door", "window", "strip"]:
        # A fresh tab per tool, as the wizard opens it: reloading one tab keeps
        # the old WebGL contexts around, and under SwiftShader the later loads
        # got slow enough for Live Aboard to call the GPU slow.
        pg = b.new_page(viewport={"width": 1300, "height": 950})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        extra = "&teid=" + sys.argv[1] if tool == "strip" and len(sys.argv) > 1 else ""
        pg.goto(f"{BASE}&tool={tool}{extra}")
        wait_ready(pg)
        pg.wait_for_timeout(1000)   # the tool opens once the view is up
        pressed = pg.evaluate("""() => { const out = []; const walk = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) walk(e.shadowRoot);
            if (e.tagName === 'BUTTON' && e.getAttribute('aria-pressed') === 'true') out.push(e.textContent.trim()); } }; walk(document); return out; }""")
        hint = pg.evaluate("""() => { let t = ''; const walk = (r) => { for (const e of r.querySelectorAll('.la3d-hint')) t = e.textContent; for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return t; }""")
        print(tool, "| pressed:", pressed, "| hint:", hint[:80])
        pg.close()
    print("errors:", errs)
    b.close()
