"""Build the demo and check it renders in headless Chrome.

    python -X utf8 tools/demo/check_render.py [out_dir]

Builds into a temporary folder, serves it on the first free port of
127.0.0.1:8790-8799 (stopped at the end), and opens each page (the panel,
the flat Atlas, Live Aboard 3D) with Playwright's Chrome, at a desktop size
(1600x900) and a phone's (390x844). Prints one line per check and a
screenshot per page and size into out_dir (default tools/demo/out). Exit 0
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

BANNER = "Demo — a sample house, made-up people and devices"
SIZES = {"": (1600, 900), "_phone": (390, 844)}
SHAPE = "(() => { const walk = (n) => { let t = ''; for (const c of n.childNodes) t += c.nodeType === 3 ? c.textContent : walk(c); if (n.shadowRoot) t += walk(n.shadowRoot); return t; }; return walk(document.getElementById('app')); })()"
# Live Aboard's own window on what it draws (live_aboard.js _state), through
# the module the page loaded (its ?b= build id), never a second copy.
SLOT = ("async () => { const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/views/live_aboard.js?'));"
        " const s = u && (await import(u)).liveAboardSlot('atlas'); return s ? s._state().tracked : null; }")


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
                browser = p.chromium.launch(channel="chrome", headless=True, args=["--enable-gpu", "--enable-unsafe-swiftshader"])
                for page_name, size in [(n, s) for s in SIZES for n in ("panel", "atlas", "atlas3d")]:
                    w, h = SIZES[size]
                    # English, whatever the machine's language: a German browser gets a German bar.
                    page = browser.new_page(viewport={"width": w, "height": h}, locale="en-US")
                    tag = page_name + size
                    errors: list[str] = []
                    page.on("pageerror", lambda e, errors=errors: errors.append(str(e)))
                    page.on("console", lambda m, errors=errors: errors.append(m.text) if m.type == "error" else None)
                    page.goto(f"{base}?page={page_name}" + ("&narrow=1" if size else ""))
                    try:
                        page.wait_for_selector(f"html[data-demo-ready='{page_name}']", timeout=20000)
                        ready = True
                    except Exception:  # noqa: BLE001
                        ready = False
                    page.wait_for_timeout(7000)
                    results.append((f"{tag}: ready", ready, ""))
                    results.append((f"{tag}: banner", page.locator("#demo-bar").inner_text().find(BANNER) >= 0, ""))
                    # Shadow-piercing text of the mounted app: something real drew.
                    text = page.evaluate("() => " + SHAPE)
                    want = {"panel": "PadSpan", "atlas": "Kitchen", "atlas3d": "Kitchen"}[page_name]
                    results.append((f"{tag}: drew ({want})", want in text, f"{len(text)} chars"))
                    if page_name == "panel":
                        # Overview's People in building: the two people, home, and where.
                        who = page.evaluate("() => { const t = " + SHAPE + "; const i = t.indexOf('People in building'); return i < 0 ? '' : t.slice(i, i + 200); }")
                        home = "Nobody home" not in who and "Alex ·" in who and "Sam ·" in who
                        results.append((f"{tag}: Overview has people home", home, who[:120]))
                    if page_name == "atlas3d":
                        # Both people drawn as their figures (not markers), on a floor that shows;
                        # the guest's lent tag drawn under the guest's name.
                        drawn = page.evaluate(SLOT) or []
                        people = {d["key"]: d for d in drawn if d.get("kind") == "person"}
                        ok = set(people) == {"person.alex", "person.sam"} and all(not d["marker"] and d["shown"] for d in people.values())
                        results.append((f"{tag}: people drawn as figures", ok, "; ".join(f"{k} marker={d['marker']} shown={d['shown']}" for k, d in people.items()) or "none"))
                        guest = [d for d in drawn if str(d.get("name") or "").endswith(" · Guest")]
                        results.append((f"{tag}: the guest's tag", bool(guest), "; ".join(str(d.get("name")) for d in guest) or "none"))
                        # The first-time card covers the house: Got it, for the picture.
                        for _ in range(3):
                            got = [b for b in page.get_by_role("button", name="Got it").all() if b.is_visible()]
                            if not got:
                                break
                            got[0].click()
                            page.wait_for_timeout(300)
                        page.wait_for_timeout(1500)
                    if page_name == "atlas3d" and not size:
                        canvas = page.evaluate("""() => { const find = (n) => { if (n.tagName === 'CANVAS' && n.width > 100) return true; for (const c of n.children || []) if (find(c)) return true; return n.shadowRoot ? find(n.shadowRoot) : false; }; return find(document.getElementById('app')); }""")
                        results.append(("atlas3d: 3D canvas", bool(canvas), ""))
                    if page_name == "atlas" and not size:
                        # A write: a light toggled lives in memory, and a reload puts it back.
                        before = page.evaluate("() => window.__demo.hass.states['light.living_room_pot_1'].state")
                        page.evaluate("() => window.__demo.hass.callService('light', 'toggle', { entity_id: 'light.living_room_pot_1' })")
                        after = page.evaluate("() => window.__demo.hass.states['light.living_room_pot_1'].state")
                        results.append(("atlas: light toggles", before != after, f"{before} -> {after}"))
                        page.reload()
                        page.wait_for_selector("html[data-demo-ready='atlas']", timeout=20000)
                        again = page.evaluate("() => window.__demo.hass.states['light.living_room_pot_1'].state")
                        results.append(("atlas: reload resets", again == before, again))
                        moved = page.evaluate("async () => { const a = (await window.__demo.route({type:'padspan_ha/live_snapshot'})).snapshot.objects.list[0]; await new Promise(r => setTimeout(r, 2500)); const b = (await window.__demo.route({type:'padspan_ha/live_snapshot'})).snapshot.objects.list[0]; return [a.x_m, a.y_m, b.x_m, b.y_m]; }")
                        results.append(("atlas: people move", moved[:2] != moved[2:], str(moved)))
                    page.screenshot(path=str(out / f"demo_{tag}.png"))
                    real = [e for e in errors if "favicon" not in e]
                    results.append((f"{tag}: no page errors", not real, "; ".join(real)[:400]))
                    page.close()
                # The bar in German on a 360 px phone: its words, and the notice whole.
                page = browser.new_page(viewport={"width": 360, "height": 780}, locale="de-DE")
                page.goto(f"{base}?page=atlas3d&narrow=1")
                page.wait_for_selector("html[data-demo-ready='atlas3d']", timeout=20000)
                bar = page.locator("#demo-bar").inner_text()
                results.append(("de_phone: German bar", all(w in bar for w in ("Beispielhaus", "Wanddisplay", "Teilen", "Kostenlos installieren")), ""))
                results.append(("de_phone: notice whole", page.evaluate("() => { const b = document.querySelector('#demo-bar b'); return b.scrollWidth <= b.clientWidth; }"), ""))
                page.screenshot(path=str(out / "demo_de_phone.png"))
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
