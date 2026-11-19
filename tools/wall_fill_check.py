"""How much of the screen the house fills when a wall Atlas opens: the check for the far-back view.

    python -X utf8 tools/wall_fill_check.py                      the demo house, built from this tree
    PADSPAN_HA_URL=http://<ha>:8123 PADSPAN_HA_TOKEN_FILE=<file> python -X utf8 tools/wall_fill_check.py   a real one

Opens /padspan-lights?kiosk=1 (the demo: ?page=atlas&kiosk=1) at each screen size, clicks nothing, and reads what the
page says about itself (views/atlas_fit.js shortfall, written on the stage as data-fill-* by views/lights_map.js): the
size the house is drawn at against the size the screen allows, and whether the page calls that the far-back view ("low").
Prints one line per size and saves a picture of each. Exit 1 if any size is low or could not be read.

    --sizes 1920x1080 3840x2160 ...   screen sizes (default: a 1080p wall, a 4K wall, a 1080p wall turned, a tablet)
    --out DIR                         where the pictures go (default tools/live_out/wall-fill-<time>)
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "demo"))

SIZES = ["1920x1080", "3840x2160", "1080x1920", "1280x800"]
READ = """() => {
  const deep = (root, sel) => { const hit = root.querySelector(sel); if (hit) return hit;
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const f = deep(el.shadowRoot, sel); if (f) return f; } return null; };
  const stage = deep(document, '[data-fill-ratio]');
  if (!stage) return null;
  const svg = stage.querySelector('svg'), vb = svg && svg.viewBox ? svg.viewBox.baseVal : null;
  return { w: Number(stage.dataset.fillW), h: Number(stage.dataset.fillH), low: stage.dataset.fillLow === '1',
           ratio: Number(stage.dataset.fillRatio), closer: stage.dataset.fillCloser === '1',
           fitted: stage.dataset.fitted || '', zoom: stage.dataset.fillZoom || '',
           box: vb ? [Math.round(vb.width), Math.round(vb.height)] : null, stage: [stage.clientWidth, stage.clientHeight] };
}"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # noqa: D102
        pass


def main() -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sizes", nargs="*", default=SIZES)
    ap.add_argument("--out", type=Path, default=HERE / "live_out" / ("wall-fill-" + time.strftime("%Y%m%d-%H%M%S")))
    ap.add_argument("--port", type=int, default=8923)
    ap.add_argument("--arrange", action="store_true", help="the wall's own arrangement (?arrange=1), not the saved stack")
    ap.add_argument("--settle", type=int, default=9000, help="ms to let the page load and draw")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    ha = os.environ.get("PADSPAN_HA_URL", "").rstrip("/")
    init, server, tmp = None, None, None
    if ha:
        token = Path(os.path.expanduser(os.environ["PADSPAN_HA_TOKEN_FILE"])).read_text(encoding="utf-8").strip()
        ten = 315360000
        tokens = json.dumps({"access_token": token, "token_type": "Bearer", "expires_in": ten, "hassUrl": ha, "clientId": ha + "/",
                             "refresh_token": "", "expires": int(time.time() * 1000) + ten * 1000})
        init = f"if (location.origin === {json.dumps(ha)}) localStorage.setItem('hassTokens', {json.dumps(tokens)});"
        url = ha + "/padspan-lights?kiosk=1" + ("&arrange=1" if a.arrange else "")
    else:
        from build import build  # noqa: PLC0415
        tmp = tempfile.TemporaryDirectory()
        dist = build(Path(tmp.name) / "dist")
        server = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(Quiet, directory=str(dist)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{a.port}/index.html?page=atlas&kiosk=1" + ("&arrange=1" if a.arrange else "")
    bad = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True, args=["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"])
            for size in a.sizes:
                w, h = (int(n) for n in size.lower().split("x"))
                ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, reduced_motion="reduce")
                if init:
                    ctx.add_init_script(init)
                pg = ctx.new_page()
                pg.goto(url, wait_until="domcontentloaded")
                pg.wait_for_timeout(a.settle)
                got = pg.evaluate(READ)
                pg.screenshot(path=str(a.out / f"wall-{size}.png"))
                ctx.close()
                if not got:
                    bad += 1
                    print(f"FAIL  {size}: the page did not say how full it is (no data-fill on the stage)")
                    continue
                state = "LOW " if got["low"] else "ok  "
                bad += bool(got["low"])
                print(f"{state}  {size}: drawn at {round(100 * got['ratio'])}% of the size this screen allows"
                      f" | house {round(100 * got['w'])}% of the width, {round(100 * got['h'])}% of the height"
                      f" | arranged {got['fitted'] or 'by the saved spacing'} | zoom {got['zoom']}{' (moved in by the wall)' if got['closer'] else ''}"
                      f" | drawing {got['box']} in stage {got['stage']}")
            browser.close()
    finally:
        if server:
            server.shutdown()
            server.server_close()
        if tmp:
            tmp.cleanup()
    print(f"pictures: {a.out}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
