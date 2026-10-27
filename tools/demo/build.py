"""Build the public demo: the real panel over a fake Home Assistant, as static files.

    python tools/demo/build.py [out_dir]      # default tools/demo/dist

Copies the panel's www files (custom_components/padspan_ha/www/padspan-ha)
into <out>/padspan_ha_static/padspan-ha, so the demo always runs the code in
this checkout, and adds the demo page (index.html), the fake Home Assistant
(fake_hass.js) and its houses (estate.js, and fixture.js for ?house=classic). The one change to the
copied files: the panel's absolute "/padspan_ha_static/" URLs become relative,
so the folder works from any path (padspan.traks.ca/demo/, a file server).
The demo's own modules are loaded with a stamp of their contents (?v=...):
Cloudflare and browsers keep .js for 4 hours, and a new page must never run
an old fake_hass.js, estate.js or fixture.js.

demo_settings.json is the integration's own DEFAULT_SETTINGS
(settings_store.py) and its version, read from the source without importing
Home Assistant. Serve <out> with any static file server, e.g.
python -m http.server 8790 -d tools/demo/dist --bind 127.0.0.1
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
INTEGRATION = ROOT / "custom_components" / "padspan_ha"
WWW = INTEGRATION / "www" / "padspan-ha"
DEMO_FILES = ("index.html", "fake_hass.js", "fixture.js", "estate.js", "preview.jpg")  # preview.jpg: the link-preview picture
REWRITE = (".js", ".mjs", ".css", ".html")


def default_settings() -> dict:
    """settings_store.DEFAULT_SETTINGS, read as a literal."""
    tree = ast.parse((INTEGRATION / "settings_store.py").read_text(encoding="utf-8"))
    for node in tree.body:
        target = getattr(node, "target", None) or (node.targets[0] if isinstance(node, ast.Assign) else None)
        if getattr(target, "id", None) == "DEFAULT_SETTINGS":
            return ast.literal_eval(node.value)
    raise SystemExit("DEFAULT_SETTINGS not found in settings_store.py")


def version_info() -> dict:
    """The version and build stamp the Atlas page was released with."""
    src = (WWW / "lights_panel.js").read_text(encoding="utf-8")
    version = re.search(r'const APP_VERSION = "([^"]+)"', src).group(1)
    build_id = re.search(r'const BUILD_ID = "([^"]+)"', src).group(1)
    return {"version": version, "build_version": version, "build_id": build_id}


def build(out: Path) -> Path:
    if out.exists():
        shutil.rmtree(out)
    dest = out / "padspan_ha_static" / "padspan-ha"
    shutil.copytree(WWW, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for f in dest.rglob("*"):
        if f.suffix in REWRITE and f.is_file():
            raw = f.read_bytes()
            if b"/padspan_ha_static/" in raw:
                f.write_bytes(raw.replace(b"/padspan_ha_static/", b"./padspan_ha_static/"))
    for name in DEMO_FILES:
        shutil.copy2(HERE / name, out / name)
    stamp = hashlib.sha1(b"".join((HERE / n).read_bytes() for n in ("fake_hass.js", "fixture.js", "estate.js"))).hexdigest()[:10]
    for name, old in (("index.html", 'import("./fake_hass.js")'), ("fake_hass.js", 'from "./fixture.js"'),
                      ("fake_hass.js", 'from "./estate.js"')):
        f = out / name
        text = f.read_text(encoding="utf-8")
        if text.count(old) != 1:
            raise SystemExit(f"{name}: expected one {old}")
        f.write_text(text.replace(old, old.replace('.js"', f'.js?v={stamp}"')), encoding="utf-8")
    payload = {"settings": default_settings(), "version": version_info()}
    (out / "demo_settings.json").write_text(json.dumps(payload, indent=1, sort_keys=True), encoding="utf-8")
    return out


if __name__ == "__main__":
    target = build(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "dist")
    print(f"demo built in {target}")
