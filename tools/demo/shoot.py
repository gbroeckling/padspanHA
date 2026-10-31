"""Take the demo's pictures: tools/demo/media/estate-*.jpg and preview.jpg.

    python -X utf8 tools/demo/shoot.py [--port 8909] [--only NAME ...] [--out DIR]

Builds the demo into a temporary folder, serves it on 127.0.0.1:<port>
(stopped at the end) and opens each picture's page in Playwright's Chrome on
the machine's graphics card (real WebGL, not the software fallback). Writes
the pictures into tools/demo/media and tools/demo (or --out), same names and
sizes as the guides and the creators page link. Prints one line per picture
with any page errors; exit 0 only with none.

Each picture: its page and query (?page=, ?kiosk=1, ?night=1, ?look=),
the window (CSS px, device scale 1), whether the demo bar shows (only on the
phone pictures), and what is done before the shot: "full" the map alone (the
⛶ button), "all" every floor, "explode" the floors pulled apart, "zoom" the
camera nearer (radius times, the target moved toward the guest's tag).
"""

from __future__ import annotations

import argparse
import functools
import http.server
import io
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build import build  # noqa: E402

MEDIA = HERE / "media"
HD, UHD, PHONE = (1920, 1080), (3840, 2160), (390, 844)
# name: (file, query, window, bar shown, steps, JPEG quality)
SHOTS = {
    "3d-main-floor": ("media/estate-3d-main-floor.jpg", "page=atlas3d&quality=high", HD, False, {}, 94),
    "3d-main-floor-night": ("media/estate-3d-main-floor-night.jpg", "page=atlas3d&quality=high&night=1", HD, False, {}, 94),
    "3d-guest-tag": ("media/estate-3d-guest-tag.jpg", "page=atlas3d&quality=high", HD, False,
                     {"full": True, "zoom": {"radius": 0.5, "toward": "guest", "pull": 0.6}}, 94),
    "3d-three-floors": ("media/estate-3d-three-floors.jpg", "page=atlas3d&quality=high&look=studio", HD, False,
                        {"full": True, "all": True, "explode": True}, 94),
    "3d-three-floors-4k": ("media/estate-3d-three-floors-4k.jpg", "page=atlas3d&quality=high&look=studio", UHD, False,
                           {"full": True, "all": True, "explode": True}, 92),
    "wall-3d": ("media/estate-wall-3d.jpg", "page=atlas3d&kiosk=1&quality=high", HD, False, {}, 94),
    "wall-3d-4k": ("media/estate-wall-3d-4k.jpg", "page=atlas3d&kiosk=1&quality=high", UHD, False, {}, 92),
    "wall-atlas": ("media/estate-wall-atlas.jpg", "page=atlas&kiosk=1", HD, False, {}, 94),
    "wall-atlas-4k": ("media/estate-wall-atlas-4k.jpg", "page=atlas&kiosk=1", UHD, False, {}, 92),
    "phone-panel": ("media/estate-phone-panel.jpg", "page=panel&narrow=1", PHONE, True, {}, 95),
    "phone-atlas": ("media/estate-phone-atlas.jpg", "page=atlas&narrow=1", PHONE, True, {}, 95),
    "phone-3d": ("media/estate-phone-3d.jpg", "page=atlas3d&narrow=1&quality=high", PHONE, True, {}, 95),
    # The link preview (1200x630): the main floor up close, the map alone.
    "preview": ("preview.jpg", "page=atlas3d&quality=high", (1200, 630), False, {"full": True, "zoom": {"radius": 0.62}}, 90),
}
HIDE_BAR = ("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style');"
            " s.textContent = '#demo-bar { display: none !important; }'; document.head.appendChild(s); });")
# "full": the ⛶ button with full screen not allowed, so it shows the map alone in the page
# (live_aboard.js toggleFull: no bars, only the ☰ that brings them back).
NO_FULL = ("for (const k of ['fullscreenEnabled', 'webkitFullscreenEnabled'])"
           " Object.defineProperty(Document.prototype, k, { get: () => false, configurable: true });")
# Live Aboard's own window on what it draws (as check_render.py): the module the page loaded.
SLOT = ("async () => { const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/views/live_aboard.js?'));"
        " const s = u && (await import(u)).liveAboardSlot('atlas'); return s ? s._state() : null; }")
LOOK = ("async ([theta, phi, target, radius]) => { const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/views/live_aboard.js?'));"
        " (await import(u)).liveAboardSlot('atlas')._look(theta, phi, target, radius); }")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def click(page, selector: str) -> None:
    for b in page.locator(selector).all():
        if b.is_visible():
            b.click()
            page.wait_for_timeout(1500)
            return
    raise RuntimeError(f"no visible {selector}")


def shoot(page, base: str, name: str, spec: tuple, out: Path, settle_ms: int) -> list[str]:
    from PIL import Image  # noqa: PLC0415

    file, query, (w, h), bar, steps, quality = spec
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    if not bar:
        page.add_init_script(HIDE_BAR)
    if steps.get("full"):
        page.add_init_script(NO_FULL)
    page.goto(f"{base}?{query}")
    page.wait_for_selector("html[data-demo-ready]", timeout=30000)
    page.wait_for_timeout(settle_ms)
    if steps.get("all"):
        click(page, '[data-la3d-floor] button[title="Every floor"]')
    if steps.get("explode"):
        click(page, '[data-la3d-floor] button[title^="Explode"]')
    if steps.get("full"):
        click(page, "[data-la3d-full] button")
    zoom = steps.get("zoom")
    if zoom:
        st = page.evaluate(SLOT)
        cam = st["cam"]
        target = list(cam["target"])
        if zoom.get("toward"):
            thing = next((t for t in st.get("tracked") or [] if str(t.get("name") or "").endswith(" · Guest")), None)
            at = thing and thing.get("at")
            if at:
                k = zoom.get("pull", 0.5)
                target = [target[i] + (at[i] - target[i]) * k for i in range(3)]
        page.evaluate(LOOK, [cam["theta"], cam["phi"], target, cam["radius"] * zoom["radius"]])
    page.wait_for_timeout(2500)
    png = page.screenshot(type="png")
    dest = out / file
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.open(io.BytesIO(png)).convert("RGB").save(dest, "JPEG", quality=quality, optimize=True)
    return [e for e in errors if "favicon" not in e]


def main() -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8909)
    ap.add_argument("--only", nargs="*", choices=sorted(SHOTS))
    ap.add_argument("--out", type=Path, default=HERE)
    ap.add_argument("--settle", type=int, default=8000, help="ms to let the house load and people walk before the shot")
    a = ap.parse_args()
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        dist = build(Path(tmp) / "dist")
        server = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(Quiet, directory=str(dist)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{a.port}/index.html"
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(channel="chrome", headless=True,
                                            args=["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"])
                for name in a.only or SHOTS:
                    spec = SHOTS[name]
                    ctx = browser.new_context(viewport={"width": spec[2][0], "height": spec[2][1]}, device_scale_factor=1,
                                              locale="en-US", reduced_motion="reduce")
                    page = ctx.new_page()
                    try:
                        errs = shoot(page, base, name, spec, a.out, a.settle)
                    except Exception as e:  # noqa: BLE001
                        errs = [f"{type(e).__name__}: {e}"]
                    ctx.close()
                    bad += bool(errs)
                    print(f"{'ok  ' if not errs else 'FAIL'}  {name}" + (f"  ({'; '.join(errs)[:400]})" if errs else ""), flush=True)
                browser.close()
        finally:
            server.shutdown()
            server.server_close()
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
