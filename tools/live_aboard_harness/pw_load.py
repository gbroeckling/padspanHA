import time
from playwright.sync_api import sync_playwright
from browser import HARNESS, launch, wait_ready   # the machine's browser (issue #95)
with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width": 1300, "height": 950})
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text[:200]) if m.type in ("error", "warning") else None)
    pg.on("response", lambda r: errs.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    pg.goto(f"{HARNESS}index.html?one=1&sky=sunny&edit=1"); wait_ready(pg)
    pg.screenshot(path="load.png")
    print("buttons", pg.evaluate("[...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim()).slice(0,30)"))
    print("errs", errs[:10])
    b.close()
