import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1300, "height": 950})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8765/tools/live_aboard_harness/index.html?one=1&sky=sunny"); time.sleep(9)
    pg.get_by_role("button", name="Views ▾", exact=True).first.click(); time.sleep(0.8)
    pg.get_by_text("How it works", exact=True).first.click(); time.sleep(1)
    pg.screenshot(path="help.png")
    print("link", pg.evaluate("(() => { const a = document.querySelector('.la3d-card a'); return a ? [a.textContent, a.href, a.target] : null })()"))
    print("errs", errs)
    b.close()
