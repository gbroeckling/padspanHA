import time
from playwright.sync_api import sync_playwright
from browser import launch, wait_ready   # the machine's browser (issue #95)
with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width": 1300, "height": 950})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8765/tools/live_aboard_harness/index.html?one=1&sky=sunny"); wait_ready(pg)
    pg.get_by_role("button", name="Views ▾", exact=True).first.click(); time.sleep(0.8)
    pg.get_by_text("How it works", exact=True).first.click(); time.sleep(1)
    pg.screenshot(path="help.png")
    print("link", pg.evaluate("(() => { const a = document.querySelector('.la3d-card a'); return a ? [a.textContent, a.href, a.target] : null })()"))
    print("errs", errs)
    b.close()
