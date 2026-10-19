"""Read-only check of PadSpan on a running Home Assistant (issue #97).

    PADSPAN_HA_URL=http://<ha>:8123 PADSPAN_HA_TOKEN_FILE=<file> python tools/ha_live_check.py [expected_version]

The token file holds a long-lived access token (HA profile → Security). It is
read from outside the repo and never printed. Optional:
  PADSPAN_HARNESS_CDP=http://127.0.0.1:<port>  run in a browser that is already
      running (another machine's, through an SSH tunnel), not a local one
  PADSPAN_LIVE_OUT=<dir>                       where the screenshots go

Signed in with the token, it opens each PadSpan view by URL
(/padspan-ha?view=<id>) and the Atlas panel (/padspan-lights). It clicks
nothing and changes nothing. Per view: did it open, did it draw, any page or
console errors. On the Atlas, Live Aboard's state if it is on (the quality
it picked, or why it fell back). Then floor-plan privacy (0.38.143+):
  old public copy  /local/padspan_ha/maps/<file>     -> 404
  new image link   /api/padspan_ha/maps/image/<id>   -> 401/403 without login
  the signed link the panel is handed                -> 200
Exit 1 if anything is wrong. Map names print here, never in a repo file.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent / "live_aboard_harness"))
from browser import channel  # noqa: E402

HA = os.environ.get("PADSPAN_HA_URL", "").rstrip("/")
TOKEN_FILE = os.environ.get("PADSPAN_HA_TOKEN_FILE", "")
if not HA or not TOKEN_FILE:
    sys.exit(__doc__)
TOKEN = Path(os.path.expanduser(TOKEN_FILE)).read_text(encoding="utf-8").strip()
EXPECT = sys.argv[1] if len(sys.argv) > 1 else None
CDP = os.environ.get("PADSPAN_HARNESS_CDP", "").strip()
OUT = Path(os.environ.get("PADSPAN_LIVE_OUT") or Path(__file__).resolve().parent / "live_out" / time.strftime("%Y%m%d-%H%M%S"))

VIEWS = ["overview", "purelive", "follow", "devices", "bluetooth", "presence", "monitor", "maps",
         "settings", "manage", "training", "calibration", "traceback", "forensics", "occupancy", "health"]
# ?view= links that bounced to Overview before the version that fixed them
# (issue #93): reported as "known" on an older install, as bad on a newer one.
KNOWN_BEFORE = {"0.38.145": {"bluetooth", "presence", "monitor", "forensics"}}

TEN_YEARS = 315360000
TOKENS = json.dumps({"access_token": TOKEN, "token_type": "Bearer", "expires_in": TEN_YEARS,
                     "hassUrl": HA, "clientId": HA + "/", "refresh_token": "",
                     "expires": int(time.time() * 1000) + TEN_YEARS * 1000})
INIT = f"if (location.origin === {json.dumps(HA)}) localStorage.setItem('hassTokens', {json.dumps(TOKENS)});"

PROBE = """(tag) => {
  const deep = (root, sel) => { const hit = root.querySelector(sel); if (hit) return hit;
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const f = deep(el.shadowRoot, sel); if (f) return f; } return null; };
  const panel = deep(document, tag);
  if (!panel) return {panel: false};
  const root = panel.shadowRoot || panel;
  const text = [...root.children].filter(e => e.tagName !== 'STYLE').map(e => e.innerText || '').join(' ').replace(/\\s+/g, ' ').trim();
  return {panel: true, view: panel.state ? panel.state.view : null, chars: text.length, text: text.slice(0, 90)};
}"""
# Live Aboard's state, through the very module the page loaded (same URL, so the same instance).
ABOARD = """async () => {
  const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/views/live_aboard.js'));
  if (!url) return {on: false};
  const s = (await import(url)).liveAboardSlot('atlas')._state();
  return {on: true, failed: s.failed || null, profile: s.profile || null, measured: s.measured, frames: s.frames};
}"""
MAPS = """async () => {
  const r = await document.querySelector('home-assistant').hass.callWS({type: 'padspan_ha/maps_list'});
  const maps = Array.isArray(r) ? r : (r.maps || []);
  return {maps: maps.map(m => ({id: m.id, name: m.name, file: m.image ? m.image.filename : null})),
          signed: (r && r.image_urls) || {}};
}"""


def status(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError as e:
        return f"error: {e}"


def ver(v):
    try:
        return tuple(int(x) for x in str(v).split("."))
    except ValueError:
        return (0,)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    views = {"ok": 0, "known": 0, "bad": 0}
    problems = 0
    with sync_playwright() as p:
        if CDP:
            browser = p.chromium.connect_over_cdp(CDP)
        else:
            # No steady-frame flags here (unlike the harness): on mostly-still
            # HA pages they stop Chrome producing the frame a screenshot waits for.
            ch = channel()
            browser = p.chromium.launch(channel=None if ch == "chromium" else ch, headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script(INIT)
        pg = ctx.new_page()
        errs: list[str] = []
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:180]))
        pg.on("console", lambda m: errs.append("console.error: " + m.text[:180]) if m.type == "error" else None)

        pg.goto(HA + "/padspan-ha", wait_until="domcontentloaded")
        pg.wait_for_timeout(6000)
        running = pg.evaluate("() => document.querySelector('home-assistant').hass.callWS({type: 'padspan_ha/version'})")
        version = (running or {}).get("version", "?")
        print(f"PadSpan on Home Assistant: {version} (build {(running or {}).get('build_id', '?')})")
        if EXPECT and version != EXPECT:
            print(f"VERSION MISMATCH: expected {EXPECT}")
            problems += 1
        known = set().union(*(v for fixed, v in KNOWN_BEFORE.items() if ver(version) < ver(fixed)))

        pages = [(v, f"/padspan-ha?view={v}", "padspan-ha-app") for v in VIEWS]
        pages.append(("atlas", "/padspan-lights", "padspan-lights-app"))
        aboard = None
        for name, path, tag in pages:
            errs.clear()
            pg.goto(HA + path, wait_until="domcontentloaded")
            pg.wait_for_timeout(7000)
            r = pg.evaluate(PROBE, tag)
            pg.screenshot(path=str(OUT / f"{name}.png"))
            redirected = bool(r.get("panel")) and tag == "padspan-ha-app" and r.get("view") != name
            bad = []
            if not r.get("panel"):
                bad.append("panel element missing")
            elif redirected and name not in known:
                bad.append(f"opened {r.get('view')!r} instead")
            if r.get("panel") and not r.get("chars"):
                bad.append("drew no text")
            bad += errs
            mark = "BAD" if bad else ("known" if redirected else "ok")
            note = f"  [opened {r.get('view')!r}: known before 0.38.145, #93]" if mark == "known" else ""
            views[mark.lower()] += 1
            print(f"{name:12} {mark:5} {r.get('chars', 0):6} chars{note}")
            for b in bad:
                print(" " * 19 + b)
            if name == "atlas":
                aboard = pg.evaluate(ABOARD)
        maps = pg.evaluate(MAPS)
        ctx.close()
        browser.close()
    problems += views["bad"]

    if aboard and aboard.get("on"):
        print(f"Live Aboard on the Atlas: profile {aboard.get('profile')}, measured {aboard.get('measured')}, "
              f"fell back: {aboard.get('failed') or 'no'}")
    else:
        print("Live Aboard on the Atlas: not showing (the Atlas opened on its flat map)")

    private = 0
    print(f"floor plans: {len(maps['maps'])} maps, {len(maps['signed'])} signed links")
    for m in maps["maps"]:
        old = status(f"{HA}/local/padspan_ha/maps/{m['file']}") if m["file"] else "no image"
        bare = status(f"{HA}/api/padspan_ha/maps/image/{m['id']}")
        link = maps["signed"].get(m["id"])
        signed = status(HA + link) if link else "no link"
        ok = old in (404, "no image") and bare in (401, 403) and signed in (200, "no link")
        private += ok
        problems += not ok
        print(f"  {'ok ' if ok else 'BAD'} {(m['name'] or m['id'])[:28]:28} old -> {old} | no login -> {bare} | signed -> {signed}")

    print(f"screenshots: {OUT}")
    print(f"SUMMARY: views {views['ok']} ok, {views['known']} known, {views['bad']} bad | "
          f"floor plans {private}/{len(maps['maps'])} private")
    print("RESULT:", "all good" if not problems else f"{problems} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
