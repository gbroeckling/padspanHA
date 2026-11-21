"""Click through every screen of the panel, on the demo build (tools/demo).

    python tools/ui_click_through/crawl.py [--minutes 40] [--depth 3] [--workers 4] [--out DIR]

Builds the demo (the real panel over a fake Home Assistant), serves it on
127.0.0.1 and, in headless Chrome, opens every view the panel's own menu and
links offer (read from panel.js), in both skins, at phone and desktop size,
plus the Atlas page flat, in 3D and as a wall screen. On each it presses every
control it finds, one at a time from a known state, and goes deeper into what
a press opens (dialogs, sheets, menus, wizards). After each press it checks
for errors, a blank page, a sideways scrollbar on the phone, an overlay that
cannot be closed, a spinner that never ends, junk text (undefined, NaN, ...)
and focus lost into nowhere. Results: <out>/results.json, <out>/results.md and
a screenshot per finding in <out>/shots. Nothing leaves the computer: every
request that is not to the local demo server is refused. See README.md.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import multiprocessing as mp
import re
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
SIZES = {"phone": (390, 844), "desk": (1920, 1080)}
LAUNCH_ARGS = ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"]

# What to type: every text field gets these, number fields the second list too.
TEXTS = [("text", "Garden shed"), ("empty", ""), ("long", "A very long name for a small room " * 9)]
NUMBERS = [("negative", "-5"), ("zero", "0"), ("huge", "999999999"), ("letters", "abc"), ("empty", "")]
# A press that leads to the next step of a wizard: followed without counting against the depth.
NEXT = re.compile(r"^(next|continue|next step|start|begin|let's go|go|i'm ready|ready|→|next →|continue →|start →|skip)\b", re.I)
SEVERITY = {"stuck": 1, "error": 2, "junk": 3, "polish": 4}
WARN = re.compile(r"fail|error|exception|cannot|could not|undefined|is not a function|null", re.I)
EVENT_NAMES = {"error": "page error", "console": "console error", "request": "failed request", "http": "HTTP error",
               "warning": "warning logged (a caught failure)"}
TINY_PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                         "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2213"
                         "fbc0000000049454e44ae426082".replace(" ", ""))


def panel_views() -> tuple[list[str], list[str]]:
    """The menu's views (MENU, in order) and those reached only by a link (_VIEW_PATHS)."""
    src = (WWW / "panel.js").read_text(encoding="utf-8")
    menu = re.findall(r'^\s*\["([a-z_]+)","[^"]*","mdi:', src, re.M)
    block = re.search(r"const _VIEW_PATHS = \{(.*?)\n\};", src, re.S)
    linked = [v for v in re.findall(r'^\s*([a-z_]+):\s*"\./views/', block.group(1), re.M) if v not in menu]
    if not menu:
        raise SystemExit("no MENU found in panel.js")
    return menu, linked


def menu_labels() -> dict[str, str]:
    src = (WWW / "panel.js").read_text(encoding="utf-8")
    return dict(re.findall(r'^\s*\["([a-z_]+)","([^"]*)","mdi:', src, re.M))


def jobs_for(args) -> list[dict]:
    """Every page to crawl, in a fixed order."""
    menu, linked = panel_views()
    out = []
    for skin in args.skins:
        for size in args.sizes:
            for v in menu + linked:
                if args.pages and v not in args.pages:
                    continue
                out.append({"page": "panel", "view": v, "size": size, "skin": skin,
                            "url": f"?page=panel&view={v}" + ("&narrow=1" if size == "phone" else "")})
    # The Atlas page has no skin of its own: crawled once per size.
    for size in args.sizes:
        for name, q in (("atlas", "?page=atlas"), ("atlas3d", "?page=atlas3d"), ("wall", "?page=atlas3d&kiosk=1")):
            if args.pages and name not in args.pages:
                continue
            out.append({"page": name, "view": name, "size": size, "skin": "-",
                        "url": q + ("&narrow=1" if size == "phone" else "")})
    for i, j in enumerate(out):
        j["id"] = f"{i:03d}-{j['view']}-{j['size']}-{j['skin']}"
        # The second skin shares every view's code with the first: a lighter pass.
        j["weight"] = 2.0 if j["page"] != "panel" else (1.0 if j["skin"] == args.skins[0] else 0.4)
        j["depth"] = args.depth if j["skin"] in (args.skins[0], "-") else min(args.depth, args.second_skin_depth)
    return out


# ── One page, crawled ─────────────────────────────────────────────────────────

class Crawl:
    def __init__(self, browser, job, opts, base, settings_body, shots: Path):
        self.b, self.job, self.opts, self.base, self.shots = browser, job, opts, base, shots
        self.settings_body = settings_body
        self.phone = job["size"] == "phone"
        self.labels = menu_labels()
        self.findings: list[dict] = []
        self.controls: list[dict] = []      # every control used, and what happened
        self.events: list[tuple] = []       # errors from the browser, in order
        self.blocked: list[str] = []
        self.dialogs: list[str] = []
        self.ws_rows: list[dict] = []       # what the page asked the fake Home Assistant
        self.states_seen: set = set()
        self.n_actions = 0
        self.n_reloads = 0
        self.n_repeats_skipped = 0
        self.volatile: list[str] = []
        self.load_junk: set = set()
        self.ctx = self.page = self.cdp = None

    # ── Browser plumbing ─────────────────────────────────────────────────────
    def open(self):
        w, h = SIZES[self.job["size"]]
        self.ctx = self.b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1,
                                      reduced_motion="reduce", has_touch=self.phone, accept_downloads=True)
        self.ctx.add_init_script("try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}")
        # The demo's own bar (links to the site, Share) is not the product, and it would lie over the panel's drawer.
        self.ctx.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style');"
                                 " s.textContent = '#demo-bar { display: none !important; }'; document.head.appendChild(s); });")
        self.ctx.add_init_script(path=str(HERE / "probe.js"))
        self.ctx.route("**/*", self._route)
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(9000)
        self.ctx.on("page", lambda p: p.close() if p is not self.page else None)   # a new tab: never followed
        pg = self.page
        pg.on("pageerror", lambda e: self.events.append(("error", f"{e.name}: {e.message}", (e.stack or "")[:900])))
        pg.on("console", self._console)
        pg.on("requestfailed", self._reqfail)
        pg.on("response", lambda r: self.events.append(("http", f"{r.status} {r.url}", "")) if r.status >= 400 else None)
        pg.on("dialog", self._dialog)
        pg.on("filechooser", self._file)
        if self.phone:
            self.cdp = self.ctx.new_cdp_session(pg)

    def close(self):
        try:
            self.ctx.close()
        except Exception:
            pass

    def _route(self, route):
        url = route.request.url
        if not url.startswith(self.base):
            self.blocked.append(url[:200])
            return route.abort()
        if url.split("?")[0].endswith("/demo_settings.json"):
            return route.fulfill(status=200, content_type="application/json", body=self.settings_body)
        return route.continue_()

    def _console(self, m):
        loc = m.location or {}
        if m.type == "error":
            self.events.append(("console", m.text[:600], f"{loc.get('url', '')}:{loc.get('lineNumber', '')}"))
        elif m.type == "warning" and WARN.search(m.text):
            # A failure the panel caught and only logged: nothing on screen may show it.
            self.events.append(("warning", m.text[:600], f"{loc.get('url', '')}:{loc.get('lineNumber', '')}"))

    def _reqfail(self, r):
        # ERR_ABORTED: the crawler's own reload cut the request short.
        if r.url.startswith(self.base) and "ERR_ABORTED" not in str(r.failure):
            self.events.append(("request", f"{r.method} {r.url} failed: {r.failure}", ""))

    def _dialog(self, d):
        self.dialogs.append(f"{d.type}: {d.message[:200]}")
        try:
            d.accept(d.default_value or "") if d.type == "prompt" else d.accept()
        except Exception:
            pass

    def _file(self, fc):
        try:
            fc.set_files({"name": "plan.png", "mimeType": "image/png", "buffer": TINY_PNG})
        except Exception:
            pass

    def js(self, expr, arg=None):
        return self.page.evaluate(expr, arg)

    def look(self):
        return self.js("v => __ct.look({ volatile: v })", self.volatile)

    def wait(self, ms):
        self.page.wait_for_timeout(ms)

    # ── Known state: load, settle, replay ────────────────────────────────────
    def load(self, first=False) -> dict | None:
        self.n_reloads += 1
        try:
            self.page.goto(self.base + "index.html" + self.job["url"], wait_until="domcontentloaded", timeout=20000)
            self.page.wait_for_function("document.documentElement.dataset.demoReady", timeout=20000)
        except Exception as e:
            if first:
                self.find("stuck", "page did not finish loading", str(e)[:300], [])
            return None
        looks = []
        t0 = time.time()
        need = 3 if first else 2              # the same controls this many looks running: settled
        while time.time() - t0 < 15:          # a view's module can take a while with several browsers at work
            self.wait(250)
            lk = self.look()
            looks.append(lk)
            if len(looks) >= need + 1 and not lk["busy"] and not lk["blank"]:
                sigs = {frozenset(c["sig"] for c in x["controls"] if c["sig"] not in self.volatile) for x in looks[-need:]}
                if len(sigs) == 1:
                    break
        if first:
            # Controls that come and go on their own (people walking, live counts) never make the state
            # "different": watched for a moment once the page has settled.
            seen = [set(c["sig"] for c in lk["controls"])]
            for _ in range(4):
                self.wait(450)
                seen.append(set(c["sig"] for c in self.look()["controls"]))
            self.volatile = sorted(set.union(*seen) - set.intersection(*seen))
            lk = self.look()
        return lk

    def reach(self, path) -> dict | None:
        """Reload and replay the steps that lead to a state."""
        lk = self.load()
        if lk is None:
            return None
        for step in path:
            if not self.perform(step)[0]:
                return None
            self.wait(450)
        return self.look()

    # ── Pressing things ──────────────────────────────────────────────────────
    def press(self, x, y):
        if self.phone:
            self.page.touchscreen.tap(x, y)
        else:
            self.page.mouse.click(x, y)

    def handle(self, sig):
        h = self.page.evaluate_handle("s => __ct.find(s)", sig)
        el = h.as_element()
        return el

    def perform(self, step) -> tuple[bool, str]:
        """Do one step; (done, what happened if not). A row drawn again under the crawler is found again, once."""
        try:
            return self._perform(step)
        except Exception as e:
            if "not attached" not in str(e):
                raise
            self.wait(300)
            return self._perform(step)

    def _perform(self, step) -> tuple[bool, str]:
        sig, do = step["sig"], step["do"]
        aim = self.js("s => __ct.aim(s)", sig)
        if not aim.get("found"):
            return False, "gone"
        # Under something else (the flat Atlas's list under the 3D house): no person can reach it either.
        if aim.get("covered") and not step.get("force"):
            return False, "covered by " + aim["covered"]
        if do in ("click",):
            if not aim.get("onscreen"):
                return False, "off screen"
            self.press(aim["x"], aim["y"])
            return True, ""
        el = self.handle(sig)
        if el is None:
            return False, "gone"
        if do == "type":
            el.focus()
            self.page.keyboard.press("Control+A")
            self.page.keyboard.press("Delete")
            v = step["value"]
            if v:
                if step.get("keys"):
                    self.page.keyboard.type(v, delay=5)
                else:
                    self.page.keyboard.insert_text(v)
            self.page.keyboard.press("Tab")
            return True, ""
        if do == "select":
            el.select_option(step["value"])
            return True, ""
        if do == "key":
            el.focus()
            for k in step["value"].split(","):
                self.page.keyboard.press(k)
            return True, ""
        if do == "other":
            el.fill(step["value"])
            el.dispatch_event("change")
            return True, ""
        if do == "file":
            el.set_input_files({"name": "plan.png", "mimeType": "image/png", "buffer": TINY_PNG})
            return True, ""
        if do.startswith("canvas"):
            if not aim.get("onscreen"):
                return False, "off screen"
            x0, y0, w, h = aim["rect"]
            x0, y0 = max(x0, 0), max(y0, 0)
            w = min(w, SIZES[self.job["size"]][0] - x0)
            h = min(h, SIZES[self.job["size"]][1] - y0)
            cx, cy = x0 + w / 2, y0 + h / 2
            m = self.page.mouse
            if do == "canvas-clicks":
                for fx, fy in ((0.3, 0.35), (0.5, 0.5), (0.7, 0.65)):
                    self.press(x0 + w * fx, y0 + h * fy)
                    self.wait(250)
            elif do == "canvas-drag":
                if self.phone:
                    self.touch([[(cx, cy)]] + [[(cx + k * 18, cy + k * 8)] for k in range(1, 7)])
                else:
                    m.move(cx, cy); m.down(); [m.move(cx + k * 20, cy + k * 9) for k in range(1, 8)]; m.up()
            elif do == "canvas-wheel":
                m.move(cx, cy); m.wheel(0, -400); self.wait(200); m.wheel(0, 700)
            elif do == "canvas-pinch":
                self.touch([[(cx - 30 - k * 14, cy), (cx + 30 + k * 14, cy)] for k in range(0, 7)])
                self.wait(200)
                self.touch([[(cx - 120 + k * 14, cy), (cx + 120 - k * 14, cy)] for k in range(0, 7)])
            elif do == "canvas-twofinger":
                self.touch([[(cx - 30, cy + k * 12), (cx + 30, cy + k * 12)] for k in range(0, 7)])
            return True, ""
        return False, "unknown step " + do

    def touch(self, frames):
        """Touch points moving through frames, then lifted (Chrome's own touch input)."""
        def pts(f):
            return [{"x": x, "y": y, "id": i, "radiusX": 4, "radiusY": 4, "force": 1} for i, (x, y) in enumerate(f)]
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pts(frames[0])})
        for f in frames[1:]:
            self.page.wait_for_timeout(16)
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pts(f)})
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    def steps_for(self, c) -> list[dict]:
        k, sig = c["kind"], c["sig"]
        if c.get("disabled") or c.get("readonly"):
            return []
        if k in ("button", "link", "check"):
            return [{"sig": sig, "do": "click", "what": "press"}]
        if k == "select":
            opts = c.get("options") or []
            if len(opts) < 2:
                return []
            picks = [opts[1], opts[-1]] if len(opts) > 2 else [opts[1]]
            if opts[0] not in picks:
                picks.append(opts[0])            # and back
            return [{"sig": sig, "do": "select", "value": v, "what": f"choose {v!r}"} for v in picks]
        if k == "range":
            return [{"sig": sig, "do": "key", "value": "End", "what": "slide to the end"},
                    {"sig": sig, "do": "key", "value": "Home", "what": "slide to the start"}]
        if k == "number" or (k == "text" and c.get("numeric")):
            return [{"sig": sig, "do": "type", "value": v, "what": f"type {n}", "keys": n == "letters"} for n, v in NUMBERS]
        if k == "text":
            return [{"sig": sig, "do": "type", "value": v, "what": f"type {n}"} for n, v in TEXTS]
        if k == "other":
            it = c.get("inputType", "")
            v = {"color": "#ff8800", "date": "2026-11-20", "time": "07:30", "datetime-local": "2026-11-20T07:30"}.get(it)
            return [{"sig": sig, "do": "other", "value": v, "what": f"set {v}"}] if v else []
        if k == "file":
            return [{"sig": sig, "do": "file", "what": "give a picture"}]
        if k == "canvas":
            out = ["canvas-clicks", "canvas-drag"] + (["canvas-pinch", "canvas-twofinger"] if self.phone else ["canvas-wheel"])
            return [{"sig": sig, "do": d, "what": d.split("-")[1]} for d in out]
        return []

    def wanted(self, c) -> bool:
        """Off the Overview, the menu and the top bar are left to the Overview's crawl and to the nav pass."""
        if self.job["page"] != "panel" or self.job["view"] == "overview":
            return True
        return c["region"] not in ("side", "bottomnav", "top")

    # ── Findings ─────────────────────────────────────────────────────────────
    def find(self, kind, what, detail, steps, shot=True, where=""):
        key = (kind, what, re.sub(r"\d+", "#", str(detail))[:160])
        for f in self.findings:
            if f["key"] == key:
                f["count"] += 1
                return
        n = len(self.findings)
        path = ""
        if shot:
            try:
                path = str(self.shots / f"{self.job['id']}-{n:02d}.png")
                self.page.screenshot(path=path)
            except Exception:
                path = ""
        self.findings.append({"key": key, "kind": kind, "what": what, "detail": detail, "steps": [s.get("label", "") + " → " + s.get("what", "") for s in steps],
                              "where": where, "shot": path, "count": 1, "job": self.job["id"], "view": self.job["view"],
                              "size": self.job["size"], "skin": self.job["skin"]})

    def check(self, before, after, steps, t_action) -> list[str]:
        """Everything wrong after an action; returns short notes for the control's row."""
        notes = []
        new_ev = self.events[t_action:]
        for kind, msg, where in new_ev:
            self.find("error", EVENT_NAMES[kind], msg, steps, where=where)
            notes.append(f"{kind}: {msg[:80]}")
        if after["blank"] and not before["blank"] and after["url"] == before["url"]:
            self.find("stuck", "page went blank", after["url"], steps)
            notes.append("blank")
        if self.phone and after["hscroll"] and not before["hscroll"]:
            self.find("junk", "sideways scrollbar at phone width", json.dumps(after["hscroll"])[:300], steps)
            notes.append("hscroll")
        old = {(j["what"], j["text"]) for j in before["junk"]} | self.load_junk
        for j in after["junk"]:
            if (j["what"], j["text"]) not in old:
                self.find("junk", f"{j['what']} in visible text", j["text"], steps, where=j["at"])
                notes.append(f"junk {j['what']}")
        if after.get("toast") and after["toast"].get("error") and not (before.get("toast") or {}).get("error"):
            self.find("error", "error message shown", after["toast"]["text"][:200], steps)
            notes.append("error toast: " + after["toast"]["text"][:60])
        return notes

    def wait_busy(self, before, steps) -> dict:
        """A spinner or "Loading…" that the action started must be gone within 10 s."""
        lk = self.look()
        old = {b["text"] for b in before["busy"]}
        t0 = time.time()
        # A view's placeholder (its module still on its way) counts as loading too: blank only if it stays.
        while ([b for b in lk["busy"] if b["text"] not in old] or (lk["blank"] and not before["blank"])) and time.time() - t0 < 10:
            self.wait(700)
            lk = self.look()
        left = [b for b in lk["busy"] if b["text"] not in old]
        if left:
            self.find("stuck", "still loading after 10 s", left[0]["text"], steps, where=left[0]["at"])
        return lk

    def close_overlays(self, before, after, steps) -> list[str]:
        """Each overlay the action opened must close: Escape, its own close control, or a click outside."""
        notes = []
        had = {o["sig"] for o in before["overlays"]}
        for ov in sorted([o for o in after["overlays"] if o["sig"] not in had], key=lambda o: -len(o["text"])):
            if ov["sig"] not in {o["sig"] for o in self.look()["overlays"]}:
                notes.append(f"overlay {ov['sig']}: closed with the one before")
                continue
            ways = []
            gone = False
            for how in ("escape", "close", "outside"):
                if how == "escape":
                    self.page.keyboard.press("Escape")
                elif how == "close":
                    cc = self.js("s => __ct.closeControl(s)", ov["sig"])
                    if not cc:
                        ways.append("no close control")
                        continue
                    ok, why = self.perform({"sig": cc["sig"], "do": "click"})
                    if not ok:
                        ways.append(f"close control {cc['label']!r} {why}")
                        continue
                else:
                    pt = self.js("s => __ct.outsidePoint(s)", ov["sig"])
                    if not pt:
                        ways.append("nowhere outside to click")
                        continue
                    self.press(pt["x"], pt["y"])
                self.wait(450)
                now = self.look()
                if ov["sig"] not in {o["sig"] for o in now["overlays"]}:
                    gone = True
                    ways.append(f"{how} closed it")
                    if now["focus"]["where"] == "nowhere" and how in ("escape", "close"):
                        self.find("polish", "focus lost after closing", f"{ov['sig']} closed by {how}; focus went to the page", steps, shot=False)
                    break
                ways.append(f"{how} did not")
            if not gone:
                self.find("stuck", "overlay cannot be closed", f"{ov['sig']} {ov['text'][:80]!r}: " + "; ".join(ways), steps)
            elif ways[0] != "escape closed it":
                self.find("polish", "Escape does not close", f"{ov['sig']} {ov['text'][:60]!r}: " + "; ".join(ways), steps, shot=False)
            notes.append(f"overlay {ov['sig']}: " + "; ".join(ways))
        return notes

    def act_and_check(self, path, before, c, step) -> tuple[dict | None, list[str], str]:
        """One action from a known state; returns the look after, notes, and the outcome."""
        steps = path + [dict(step, label=c["label"])]
        t_ev = len(self.events)
        ws0 = self.js("() => __ct.ws.length")
        url0 = self.page.url
        try:
            ok, why = self.perform(step)
        except Exception as e:
            return None, [], "could not: " + str(e).splitlines()[0][:120]
        if not ok:
            return None, [], why
        self.n_actions += 1
        self.wait(500)
        try:
            # Full screen is the browser's to end (Escape there); headless, the crawler ends it.
            if self.js("() => !!document.fullscreenElement && (document.exitFullscreen(), true)"):
                self.wait(300)
        except Exception:
            pass
        try:
            after = self.wait_busy(before, steps)
        except Exception as e:
            # The page stopped answering: a hang, or it went to another page.
            msg = str(e)
            if self.page.url != url0 or "context was destroyed" in msg or "navigat" in msg:
                try:
                    self.page.wait_for_load_state("domcontentloaded", timeout=8000)
                except Exception:
                    pass
                return None, [], "left the page: " + self.page.url
            self.find("stuck", "page stopped answering", msg[:200], steps, shot=False)
            return None, [], "hang"
        notes = self.check(before, after, steps, t_ev)
        try:
            rows = self.js("n => __ct.ws.slice(n)", ws0)
            for r in rows:
                r["job"], r["control"] = self.job["id"], c["label"]
            self.ws_rows.extend(rows)
        except Exception:
            pass
        return after, notes, "ok"

    # ── The crawl ────────────────────────────────────────────────────────────
    def run(self, budget_s: float) -> dict:
        t_end = time.time() + budget_s
        self.open()
        t0 = time.time()
        root = self.load(first=True)
        load_s = round(time.time() - t0, 1)
        if root is None:
            self.close()
            return self.result(load_s, budget_s, t0)
        # Whatever is wrong on arrival.
        for kind, msg, where in self.events:
            self.find("error", EVENT_NAMES[kind], msg, [], where=where)
        if root["blank"]:
            self.find("stuck", "page is blank on arrival", root["url"], [])
        if self.phone and root["hscroll"]:
            self.find("junk", "sideways scrollbar at phone width", json.dumps(root["hscroll"])[:300], [])
        for j in root["junk"]:
            self.find("junk", f"{j['what']} in visible text", j["text"], [], where=j["at"])
        self.load_junk = {(j["what"], j["text"]) for j in root["junk"]}
        for b in root["busy"]:
            self.find("stuck", "still loading when the page settled", b["text"], [], where=b["at"])
        for o in root["overlays"]:
            if o.get("dialog"):
                self.find("polish", "dialog open on arrival", f"{o['sig']} {o['text'][:80]!r}", [])
        queue = [{"path": [], "depth": 0, "parent": set(), "chain": 0}]
        self.states_seen.add(frozenset())
        opened = []                # (path, step) pairs that opened an overlay: for the pair pass
        state_i = 0
        while queue and time.time() < t_end:
            st = queue.pop(0)
            state_i += 1
            base = root if not st["path"] else self.reach(st["path"])
            if base is None:
                self.controls.append({"state": [s["label"] for s in st["path"]], "label": "(state)", "kind": "-", "region": "-", "what": "replay", "outcome": "could not reach this state again"})
                continue
            if st["path"]:
                root_sig = {c["sig"] for c in base["controls"]}
            ctls = [c for c in base["controls"] if c["sig"] not in st["parent"] and c["sig"] not in self.volatile and self.wanted(c)]
            # A control repeated on every row (a room's Rename, a light's Hide) is the same code each time:
            # the first few are pressed, the rest are counted.
            skipped = [c for c in ctls if c["nth"] > self.opts.get("repeats", 2)]
            ctls = [c for c in ctls if c["nth"] <= self.opts.get("repeats", 2)]
            self.n_repeats_skipped += len(skipped)
            # What lies on top first: a dialog, then floating layers (the 3D house's controls), then the page.
            ctls.sort(key=lambda c: {"modal": 0, "overlay": 1}.get(c["region"], 2))
            if st["depth"] == 0:
                ctls += [c for c in base["controls"] if c["sig"] in self.volatile and self.wanted(c)][:3]   # a few live ones too
            base_sigs = frozenset(c["sig"] for c in base["controls"] if c["sig"] not in self.volatile)
            base_ov = frozenset(o["sig"] for o in base["overlays"])
            dirty = False
            cur = base
            for c in ctls:
                for step in self.steps_for(c) or [None]:
                    if time.time() >= t_end:
                        break
                    row = {"state": [s["label"] for s in st["path"]], "label": c["label"], "kind": c["kind"], "region": c["region"], "sig": c["sig"]}
                    if step is None:
                        row.update(what="-", outcome="disabled" if c.get("disabled") else "nothing to do")
                        self.controls.append(row)
                        continue
                    row["what"] = step["what"]
                    if dirty:
                        cur = self.reach(st["path"]) if st["path"] else self.load()
                        if cur is None:
                            row["outcome"] = "could not get back to the state"
                            self.controls.append(row)
                            break
                        dirty = False
                    after, notes, outcome = self.act_and_check(st["path"], cur, c, step)
                    row["outcome"], row["notes"] = outcome, notes
                    if after is None:
                        dirty = outcome not in ("gone", "off screen") and not outcome.startswith("covered")
                        self.controls.append(row)
                        continue
                    a_sigs = frozenset(x["sig"] for x in after["controls"] if x["sig"] not in self.volatile)
                    a_ov = frozenset(o["sig"] for o in after["overlays"])
                    changed = a_sigs != base_sigs or a_ov != base_ov or after["url"] != base["url"]
                    new = a_sigs - base_sigs
                    new_ov = a_ov - base_ov
                    if after.get("view") != base.get("view"):
                        row["notes"].append(f"switched to the {after.get('view')} view")
                    elif after["url"] == base["url"] and (new or new_ov):
                        chain = NEXT.match(c["label"] or "") is not None
                        depth = st["depth"] + (0 if chain and st["chain"] < 12 else 1)
                        key = frozenset(new) | new_ov
                        if depth <= self.job["depth"] and key not in self.states_seen:
                            self.states_seen.add(key)
                            queue.append({"path": st["path"] + [dict(step, label=c["label"])], "depth": depth, "parent": set(base_sigs),
                                          "chain": st["chain"] + 1 if chain else 0})
                            row["opens"] = len(new)
                    if (new_ov or new) and after.get("view") == base.get("view") and after["url"] == base["url"]:
                        opened.append(st["path"] + [dict(step, label=c["label"])])
                    if new_ov:
                        notes += self.close_overlays(cur, after, st["path"] + [dict(step, label=c["label"])])
                        # Closed and the page is as it was: no reload needed.
                        after = self.look()
                        changed = (frozenset(x["sig"] for x in after["controls"] if x["sig"] not in self.volatile) != base_sigs
                                   or frozenset(o["sig"] for o in after["overlays"]) != base_ov or after["url"] != base["url"])
                    if after["url"] != base["url"]:
                        row["notes"].append("went to " + after["url"])
                    dirty = changed
                    if not dirty:
                        cur = after
                    self.controls.append(row)
        self.pairs(opened, t_end, root)
        out = self.result(load_s, budget_s, t0)
        out["unvisited_states"] = len(queue)
        self.close()
        return out

    def nav_to(self, view) -> bool:
        """Press the menu's entry for a view (phone: through More when it is not pinned)."""
        want = (self.labels.get(view) or view).lower()
        for attempt in range(2):
            lk = self.look()
            for c in lk["controls"]:
                if c.get("nav") and c["label"].lower() == want:
                    ok, _ = self.perform({"sig": c["sig"], "do": "click"})
                    self.wait(700)
                    return ok
            if attempt == 0:
                more = [c for c in lk["controls"] if c.get("nav") and c["label"].lower() in ("more", "more tools")]
                if not more:
                    return False
                self.perform({"sig": more[0]["sig"], "do": "click"})
                self.wait(500)
        return False

    def pairs(self, opened, t_end, root):
        """Pairs: open something, switch view, come back; and two changes in a row."""
        if self.job["page"] != "panel":
            return
        view = self.job["view"]
        other = "maps" if view == "overview" else "overview"
        done = 0
        for path in opened[:8]:
            if time.time() >= t_end or done >= 3:
                break
            lk = self.reach(path)
            if lk is None:
                continue
            steps = path + [{"label": "menu", "what": f"go to {other}"}]
            t_ev = len(self.events)
            if not self.nav_to(other):
                continue                  # a modal dialog is in the way of the menu, as it should be
            done += 1
            a = self.look()
            notes = self.check(lk, a, steps, t_ev)
            left = [o for o in a["overlays"] if o["sig"] in {x["sig"] for x in lk["overlays"]} and o["sig"] not in {x["sig"] for x in root["overlays"]}]
            if left:
                self.find("junk", "overlay stays open on another view", f"{left[0]['sig']} {left[0]['text'][:60]!r}", steps)
            steps2 = steps + [{"label": "menu", "what": f"back to {view}"}]
            t_ev = len(self.events)
            back = self.nav_to(view)
            b = self.look()
            in_menu = view in self.labels
            notes += self.check(a, b, steps2, t_ev)
            if back and b["blank"]:
                self.find("stuck", "view blank after coming back", b["url"], steps2)
            self.n_actions += 2
            self.controls.append({"state": [s["label"] for s in path], "label": f"menu → {other} → {view}", "kind": "pair", "region": "-", "what": "switch view and back",
                                  "outcome": "ok" if back else "could not come back" if in_menu else "ok (away; not in the menu to come back by)", "notes": notes})
        # Two changes in a row, from the arrival state.
        cs = [c for c in root["controls"] if c["kind"] in ("check", "select", "number", "text", "range") and self.wanted(c) and not c.get("disabled")]
        for i in range(0, min(len(cs) - 1, 6), 2):
            if time.time() >= t_end:
                return
            lk = self.load()
            if lk is None:
                return
            s1, s2 = self.steps_for(cs[i])[:1], self.steps_for(cs[i + 1])[:1]
            if not s1 or not s2:
                continue
            steps = [dict(s1[0], label=cs[i]["label"]), dict(s2[0], label=cs[i + 1]["label"])]
            t_ev = len(self.events)
            try:
                ok1, _ = self.perform(steps[0]); self.wait(400)
                ok2, _ = self.perform(steps[1]); self.wait(600)
            except Exception as e:
                ok1 = ok2 = False
            a = self.look()
            notes = self.check(lk, a, steps, t_ev)
            self.n_actions += 2
            self.controls.append({"state": [], "label": f"{cs[i]['label']} then {cs[i + 1]['label']}", "kind": "pair", "region": "content", "what": "two changes", "outcome": "ok" if ok1 and ok2 else "could not do both", "notes": notes})

    def result(self, load_s, budget_s, t0) -> dict:
        return {"job": self.job, "load_s": load_s, "budget_s": round(budget_s), "took_s": round(time.time() - t0, 1),
                "actions": self.n_actions, "reloads": self.n_reloads, "states": len(self.states_seen), "repeats_skipped": self.n_repeats_skipped,
                "controls": self.controls, "findings": self.findings, "blocked": sorted(set(self.blocked))[:20],
                "dialogs": self.dialogs[:40], "ws": self.ws_rows, "volatile": self.volatile}


# ── Workers ───────────────────────────────────────────────────────────────────

def worker(jobs, budgets, base, settings_bodies, out: Path, q, opts):
    from playwright.sync_api import sync_playwright
    shots = out / "shots"
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=LAUNCH_ARGS)
        carry = 0.0
        for job, budget in zip(jobs, budgets):
            t0 = time.time()
            if not browser.is_connected():
                browser = p.chromium.launch(channel="chrome", headless=True, args=LAUNCH_ARGS)
            cr = Crawl(browser, job, opts, base, settings_bodies[job["skin"]], shots)
            try:
                res = cr.run(budget + carry)
            except Exception:
                res = cr.result(0, budget, t0)
                res["crash"] = traceback.format_exc()[-1500:]
                cr.close()
            carry = max(0.0, budget + carry - (time.time() - t0))
            (out / "jobs" / f"{job['id']}.json").write_text(json.dumps(res, indent=1, default=list), encoding="utf-8")
            q.put(f"{job['id']}: {res['actions']} actions, {len(res['findings'])} findings, {res['took_s']} s")
        browser.close()


def settings_variants(dist: Path, skins) -> dict:
    raw = json.loads((dist / "demo_settings.json").read_text(encoding="utf-8"))
    out = {}
    for skin in list(skins) + ["-"]:
        d = json.loads(json.dumps(raw))
        # Forensics and Guests are views only while switched on.
        d["settings"].update(forensics_enabled=True, guest_tags_enabled=True)
        if skin != "-":
            d["settings"]["ui_skin"] = skin
        out[skin] = json.dumps(d)
    return out


class Quiet(http.server.SimpleHTTPRequestHandler):
    # One connection for a page's hundred-odd modules (a new one each ran Windows out of ports: ERR_ADDRESS_IN_USE),
    # and the files kept by the browser between the crawl's reloads: they do not change during a run.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "max-age=86400")
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 512        # several browsers loading 100+ modules at once: the default 5 refuses them
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass                        # a page reloaded mid-answer: nothing to say


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--minutes", type=float, default=36, help="time for the crawl itself (default 36)")
    ap.add_argument("--depth", type=int, default=3, help="how many presses deep to follow what a press opens (default 3)")
    ap.add_argument("--second-skin-depth", type=int, default=1, help="depth for the second skin, whose views share the first's code (default 1)")
    ap.add_argument("--workers", type=int, default=4, help="browsers at once (default 4)")
    ap.add_argument("--repeats", type=int, default=2, help="of a control repeated on every row, how many to press (default 2)")
    ap.add_argument("--skins", default="2025,classic")
    ap.add_argument("--sizes", default="phone,desk")
    ap.add_argument("--pages", default="", help="only these views/pages (comma list), e.g. overview,atlas3d")
    ap.add_argument("--out", default="", help="results folder (default: a new folder in the temp dir)")
    ap.add_argument("--port", type=int, default=9391)
    args = ap.parse_args(argv)
    args.skins = [s for s in args.skins.split(",") if s]
    args.sizes = [s for s in args.sizes.split(",") if s]
    args.pages = [s for s in args.pages.split(",") if s]
    out = Path(args.out) if args.out else Path(tempfile.mkdtemp(prefix="ui_click_through_"))
    (out / "shots").mkdir(parents=True, exist_ok=True)
    (out / "jobs").mkdir(exist_ok=True)
    for f in list((out / "shots").glob("*.png")) + list((out / "jobs").glob("*.json")):
        f.unlink()
    sys.path.insert(0, str(ROOT / "tools" / "demo"))
    from build import build  # noqa: E402

    t_start = time.time()
    tmp = tempfile.TemporaryDirectory()
    dist = build(Path(tmp.name) / "dist")
    srv = Server(("127.0.0.1", args.port), functools.partial(Quiet, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{args.port}/"
    jobs = jobs_for(args)
    total_w = sum(j["weight"] for j in jobs)
    secs = args.minutes * 60 * args.workers
    budgets = [max(20.0, secs * j["weight"] / total_w - 4) for j in jobs]
    bodies = settings_variants(dist, args.skins)
    print(f"{len(jobs)} pages, {args.workers} browsers, about {args.minutes:.0f} min; results in {out}", flush=True)
    q = mp.Queue()
    procs = []
    for w in range(args.workers):
        mine = list(range(w, len(jobs), args.workers))
        pr = mp.Process(target=worker, args=([jobs[i] for i in mine], [budgets[i] for i in mine], base, bodies, out, q, {"repeats": args.repeats}))
        pr.start()
        procs.append(pr)
    done = 0
    while any(p.is_alive() for p in procs) or not q.empty():
        try:
            msg = q.get(timeout=2)
            done += 1
            print(f"[{done}/{len(jobs)} {time.time() - t_start:5.0f}s] {msg}", flush=True)
        except Exception:
            pass
    for p in procs:
        p.join()
    srv.shutdown()
    srv.server_close()
    tmp.cleanup()
    from report import write_report  # noqa: E402
    write_report(out, jobs, time.time() - t_start, args)


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    main()
