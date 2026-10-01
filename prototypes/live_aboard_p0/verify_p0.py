"""Live Aboard P0 verification (run: python verify_p0.py; needs Python Playwright + Chromium).
Serves this folder on 127.0.0.1:8767, drives it headless, rewrites the shot_*.png files and prints the checks.
P0 verification: desktop 1920x1080 and phone 390x844, real clicks/taps where it matters."""
import json, pathlib, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
PORT = 8767
URL = f"http://127.0.0.1:{PORT}/index.html"
OUT = str(HERE) + "/"
LIGHT = "light.kitchen_east"
ROT_CW, ROT_CCW = "⟳ 15°", "⟲ 15°"
results = {}


def wait_ready(pg):
    pg.wait_for_function("() => window.__la && window.__la.ready", timeout=60000)
    hide_toast(pg)


def hide_toast(pg):
    pg.evaluate("() => document.getElementById('toast').classList.remove('on')")
    time.sleep(0.35)


def screen_of_light(pg, eid):
    return pg.evaluate("(eid) => { const L = __la.lightAt(eid); const p = L.pick[0]; return __la.screen(p[0], p[1], p[2]); }", eid)


def drag_piece(pg, pid, tx, ty):
    pc = pg.evaluate("(id) => __la.pieceAt(id)", pid)
    sx, sy = pg.evaluate("(a) => __la.screen(a[0], a[1], a[2])", [pc["x"], pc["elev"] + 0.3, pc["y"]])
    ex, ey = pg.evaluate("(a) => __la.screen(a[0], a[1], a[2])", [tx, pc["elev"], ty])
    pg.mouse.move(sx, sy)
    pg.mouse.down()
    for i in range(1, 13):
        pg.mouse.move(sx + (ex - sx) * i / 12, sy + (ey - sy) * i / 12)
    pg.mouse.up()
    return pg.evaluate("(id) => __la.pieceAt(id)", pid)


def click_text(pg, sel, text, n=1):
    for _ in range(n):
        pg.locator(sel, has_text=text).first.click()


def page_checks(pg, tag):
    d = pg.evaluate("() => ({sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight})")
    results[tag + "_scroll"] = d
    assert d["sw"] <= d["iw"] and d["sh"] <= d["ih"], f"page scrolls: {d}"


def watch(pg, errors):
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("requestfailed", lambda r: errors.append("requestfailed: " + r.url))


server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=HERE,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
  with sync_playwright() as p:
      b = p.chromium.launch(args=["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])

      # ---------------- desktop / kiosk 1920x1080 ----------------
      ctx = b.new_context(viewport={"width": 1920, "height": 1080})
      pg = ctx.new_page()
      errors = []
      watch(pg, errors)
      pg.goto(URL)
      wait_ready(pg)
      results["info"] = pg.evaluate("() => __la.info()")
      page_checks(pg, "1920")
      pg.screenshot(path=OUT + "shot_1920_default.png")

      f0 = pg.evaluate("() => __la.frames")
      time.sleep(2.0)
      results["idle_frames_in_2s"] = pg.evaluate("() => __la.frames") - f0

      click_text(pg, "#floors button", "Main")
      click_text(pg, "#views button", "Fit")
      time.sleep(0.4)
      results["chip_pressed"] = pg.evaluate("() => document.querySelector('#floors button[aria-pressed=\"true\"]').textContent")

      before = pg.evaluate("(e) => __la.lightAt(e).on", LIGHT)
      x, y = screen_of_light(pg, LIGHT)
      pg.mouse.click(x, y)
      time.sleep(0.5)
      results["light_click"] = {"light": LIGHT, "before": before, "after": pg.evaluate("(e) => __la.lightAt(e).on", LIGHT), "toast": pg.inner_text("#toast")}
      hide_toast(pg)
      pg.screenshot(path=OUT + "shot_1920_main_floor.png")

      click_text(pg, "#add button", "Sofa")
      time.sleep(0.4)
      results["sofa_after_drag"] = drag_piece(pg, "fur_1", 4.3, -1.7)
      click_text(pg, "#panel .actions button", ROT_CW, 12)
      click_text(pg, "#panel .seg button", "rolled")
      results["sofa_dims"] = pg.inner_text("#panel .dims")

      click_text(pg, "#add button", "Bed")
      time.sleep(0.4)
      results["bed_after_drag"] = drag_piece(pg, "fur_2", 1.85, 7.9)
      click_text(pg, "#panel .actions button", ROT_CCW, 6)
      click_text(pg, "#panel .seg button", "slatted")
      pg.locator("#panel .seg button", has_text="Yes").first.click()
      pg.evaluate("""() => { const r = [...document.querySelectorAll('#panel input[type=range]')].find(i => i.getAttribute('aria-label') === 'Headboard height');
                             r.value = 1.3; r.dispatchEvent(new Event('input', {bubbles: true})); }""")
      results["bed_dims"] = pg.inner_text("#panel .dims")
      results["pieces"] = [pg.evaluate("(id) => __la.pieceAt(id)", i) for i in ("fur_1", "fur_2")]
      pg.evaluate("() => __la.look(17.5, 17, 15, 3.4, 3, 2.6)")
      time.sleep(0.6)
      pg.screenshot(path=OUT + "shot_1920_furniture.png")

      pg.evaluate("() => __la.select(null)")
      pg.evaluate("() => __la.look(13.5, 11.5, 3.5, 3.4, 3, -1.5)")
      click_text(pg, "[data-q]", "High")
      time.sleep(0.8)
      pg.screenshot(path=OUT + "shot_1920_high.png")
      results["high"] = pg.evaluate("() => { const i = __la.info(); return {calls: i.calls, triangles: i.triangles, quality: i.quality}; }")
      click_text(pg, "#bench", "Test")
      time.sleep(6.5)
      results["bench_high_swiftshader"] = pg.inner_text("#readout")
      click_text(pg, "[data-q]", "Low")
      time.sleep(0.8)
      hide_toast(pg)
      pg.screenshot(path=OUT + "shot_1920_low.png")
      results["low"] = pg.evaluate("() => { const i = __la.info(); return {calls: i.calls, triangles: i.triangles, quality: i.quality}; }")
      click_text(pg, "#bench", "Test")
      time.sleep(6.5)
      results["bench_low_swiftshader"] = pg.inner_text("#readout")
      pg.evaluate("() => __la.setWalls('up')")
      pg.evaluate("() => __la.setWalls('down')")
      pg.evaluate("() => __la.setWalls('cut')")
      time.sleep(0.4)
      results["errors_1920"] = errors
      ctx.close()

      # ---------------- phone 390x844 ----------------
      ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
      pg = ctx.new_page()
      errors = []
      watch(pg, errors)
      pg.goto(URL)
      wait_ready(pg)
      results["phone_quality_default"] = pg.evaluate("() => __la.info().quality")
      page_checks(pg, "390")
      pg.screenshot(path=OUT + "shot_390_default.png")
      pg.locator("#floors button", has_text="Main").first.tap()
      pg.locator("#views button", has_text="Fit").first.tap()
      time.sleep(0.4)
      before = pg.evaluate("(e) => __la.lightAt(e).on", LIGHT)
      x, y = screen_of_light(pg, LIGHT)
      pg.touchscreen.tap(x, y)
      time.sleep(0.5)
      results["phone_light_tap"] = {"before": before, "after": pg.evaluate("(e) => __la.lightAt(e).on", LIGHT)}
      hide_toast(pg)
      pg.screenshot(path=OUT + "shot_390_main_floor.png")
      pg.locator("#add button", has_text="Bed").first.tap()
      time.sleep(0.6)
      results["phone_panel"] = pg.evaluate("() => { const e = document.getElementById('panel'), r = e.getBoundingClientRect(); return {top: Math.round(r.top), bottom: Math.round(r.bottom), left: r.left, right: r.right, hidden: e.hidden, scrollable: e.scrollHeight > e.clientHeight}; }")
      page_checks(pg, "390_panel")
      pg.screenshot(path=OUT + "shot_390_furniture.png")
      results["errors_390"] = errors
      ctx.close()
      b.close()

finally:
    server.terminate()

print(json.dumps(results, indent=1, default=str))
