# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The WLED control card's IP line is a link, not just a label.

Garry, 2026-09-09: "please make sure the card for WLED has a clickable IP
address, so a browser open to go deeper" — the card (views/lights_map.js's
openControlCard, opened from lights_panel.js's _openWledDetail with
`ip: this._regStore?.reg?.ipMap?.[eid]`, the device registry's own
configuration_url hostname) showed "IP: 192.168.x.x" as plain text; a device
worth surfacing an IP for is worth one click away from its own web UI.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const {{ install }} = await import(pathToFileURL({json.dumps(str(_ROOT / 'tests' / 'js' / 'dom_shim.mjs'))}).href);\n"
        "install(globalThis);\n"
        f"const LM = await import(pathToFileURL({json.dumps(str(_VIEWS / 'lights_map.js'))}).href);\n"
        "const out={};\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


_HASS_JS = """
const hass = {
  states: {
    "light.wled_strip": {
      state: "on",
      attributes: {
        friendly_name: "Porch WLED",
        supported_color_modes: ["rgb"],
        effect_list: ["Solid", "Rainbow"],
        effect: "Solid",
        rgb_color: [255, 200, 0],
      },
    },
  },
  callService: async () => {},
};
"""


def test_the_ip_line_is_a_real_anchor_to_the_devices_own_web_ui():
    out = _run(_HASS_JS + """
LM.openControlCard(hass, "light.wled_strip", { ip: "192.168.1.77" });
const a = document.body.querySelector('a[href]');
out.found = !!a;
out.href = a ? a.getAttribute("href") : null;
out.text = a ? a.textContent : null;
out.target = a ? a.getAttribute("target") : null;
out.rel = a ? a.getAttribute("rel") : null;
""")
    assert out["found"], "the WLED card grew no anchor tag for its IP"
    assert out["href"] == "http://192.168.1.77", out["href"]
    assert out["text"] == "192.168.1.77", out["text"]
    assert out["target"] == "_blank", "must open in a new tab, not navigate away from the panel"
    assert out["rel"] and "noopener" in out["rel"], out["rel"]


def test_no_ip_means_no_link_and_no_crash():
    out = _run(_HASS_JS + """
LM.openControlCard(hass, "light.wled_strip", {});
const a = document.body.querySelector('a[href]');
out.found = !!a;
""")
    assert out["found"] is False, "no ip means nothing to link to — no anchor should render"
