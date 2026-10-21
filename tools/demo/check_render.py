"""Build the demo and check it renders in headless Chrome.

    python -X utf8 tools/demo/check_render.py [out_dir]

Builds into a temporary folder, serves it on the first free port of
127.0.0.1:8790-8799 (stopped at the end), and opens each page (the panel,
the flat Atlas, Live Aboard 3D) with Playwright's Chrome. Prints one line per
check and a screenshot per page into out_dir (default tools/demo/out). Exit 0
only when every check passes.
"""

from __future__ import annotations

import functools
import http.server
import socket
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build import build  # noqa: E402

BANNER = "Demo — nothing here is a real house"


def free_port() -> int:
    for port in range(8790, 8800):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("no free port in 8790-8799")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main(out: Path) -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    out.mkdir(parents=True, exist_ok=True)
    results: list[tuple[str, bool, str]] = []
    with tempfile.TemporaryDirectory() as tmp:
        dist = build(Path(tmp) / "dist")
        port = free_port()
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=str(dist)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{port}/index.html"
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(channel="chrome", headless=True, args=["--enable-unsafe-swiftshader"])
                for page_name in ("panel", "atlas", "atlas3d"):
                    page = browser.new_page(viewport={"width": 1400, "height": 900})
                    errors: list[str] = []
                    page.on("pageerror", lambda e, errors=errors: errors.append(str(e)))
                    page.on("console", lambda m, errors=errors: errors.append(m.text) if m.type == "error" else None)
                    page.goto(f"{base}?page={page_name}")
                    try:
                        page.wait_for_selector(f"html[data-demo-ready='{page_name}']", timeout=20000)
                        ready = True
                    except Exception:  # noqa: BLE001
                        ready = False
                    page.wait_for_timeout(7000)
                    results.append((f"{page_name}: ready", ready, ""))
                    results.append((f"{page_name}: banner", page.locator("#demo-bar").inner_text().find(BANNER) >= 0, ""))
                    # Shadow-piercing text of the mounted app: something real drew.
                    text = page.evaluate("""() => { const walk = (n) => { let t = ''; for (const c of n.childNodes) t += c.nodeType === 3 ? c.textContent : walk(c); if (n.shadowRoot) t += walk(n.shadowRoot); return t; }; return walk(document.getElementById('app')); }""")
                    want = {"panel": "PadSpan", "atlas": "Kitchen", "atlas3d": "Kitchen"}[page_name]
                    results.append((f"{page_name}: drew ({want})", want in text, f"{len(text)} chars"))
                    if page_name == "atlas3d":
                        canvas = page.evaluate("""() => { const find = (n) => { if (n.tagName === 'CANVAS' && n.width > 100) return true; for (const c of n.children || []) if (find(c)) return true; return n.shadowRoot ? find(n.shadowRoot) : false; }; return find(document.getElementById('app')); }""")
                        results.append(("atlas3d: 3D canvas", bool(canvas), ""))
                    if page_name == "atlas":
                        # A write: a light toggled lives in memory, and a reload puts it back.
                        before = page.evaluate("() => window.__demo.hass.states['light.living_lamp'].state")
                        page.evaluate("() => window.__demo.hass.callService('light', 'toggle', { entity_id: 'light.living_lamp' })")
                        after = page.evaluate("() => window.__demo.hass.states['light.living_lamp'].state")
                        results.append(("atlas: light toggles", before != after, f"{before} -> {after}"))
                        page.reload()
                        page.wait_for_selector("html[data-demo-ready='atlas']", timeout=20000)
                        again = page.evaluate("() => window.__demo.hass.states['light.living_lamp'].state")
                        results.append(("atlas: reload resets", again == before, again))
                        moved = page.evaluate("async () => { const a = (await window.__demo.route({type:'padspan_ha/live_snapshot'})).snapshot.objects.list[0]; await new Promise(r => setTimeout(r, 2500)); const b = (await window.__demo.route({type:'padspan_ha/live_snapshot'})).snapshot.objects.list[0]; return [a.x_m, a.y_m, b.x_m, b.y_m]; }")
                        results.append(("atlas: people move", moved[:2] != moved[2:], str(moved)))
                    page.screenshot(path=str(out / f"demo_{page_name}.png"))
                    real = [e for e in errors if "favicon" not in e]
                    results.append((f"{page_name}: no page errors", not real, "; ".join(real)[:400]))
                    page.close()
                browser.close()
        finally:
            server.shutdown()
            server.server_close()
    for name, ok, note in results:
        print(f"{'pass' if ok else 'FAIL'}  {name}" + (f"  ({note})" if note else ""))
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "out"))
