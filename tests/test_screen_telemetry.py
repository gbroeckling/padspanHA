# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The screens PadSpan runs on, in the opt-in report (2026-10-21, for 4K
walls): resolution, orientation, density, kind and how many monitors, in
buckets (client_screen:*), and how many screens a house runs
(client_screen_seen, counted once per screen per report window)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DOMAIN

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")

_DRIVE = r"""
import(process.argv[1]).then(m => {
  const win = (w, h, dpr, pointer, touch, ext) => ({ devicePixelRatio: dpr, innerWidth: w, innerHeight: h,
    screen: { width: w, height: h, isExtended: ext }, navigator: { maxTouchPoints: touch },
    matchMedia: (q) => ({ matches: q === `(pointer: ${pointer})` }) });
  const store = { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, x) { this.v[k] = x; } };
  const a = m.screenId(store), b = m.screenId(store);
  console.log(JSON.stringify({
    tv4k: m.screenWords(win(3840, 2160, 1, "none", 0, undefined)),
    phone: m.screenWords(win(390, 844, 3, "coarse", 5, undefined)),
    desk1440: m.screenWords(win(2560, 1440, 1, "fine", 0, true)),
    laptop: m.screenWords(win(1440, 900, 2, "fine", 0, false)),
    tablet: m.screenWords(win(820, 1180, 2, "coarse", 5, undefined)),
    id: [a, a === b, /^[0-9a-f]{16}$/.test(a)],
    words: m.CLIENT_SCREEN }));
});
"""


def test_the_screen_words_for_each_kind_of_screen():
    if _NODE is None:
        pytest.skip("node is not installed")
    url = (_WWW / "client_perf.js").resolve().as_uri()
    res = subprocess.run([_NODE, "-e", _DRIVE, url], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    got = json.loads(res.stdout)
    assert got["tv4k"] == ["res_4k", "orient_land", "dpr_1", "kind_large", "screens_unknown"]
    assert got["phone"] == ["res_1080", "orient_port", "dpr_3_up", "kind_phone", "screens_unknown"]
    assert got["desk1440"] == ["res_1440", "orient_land", "dpr_1", "kind_desktop", "screens_2up"]
    assert got["laptop"] == ["res_1440", "orient_land", "dpr_2", "kind_desktop", "screens_1"]
    assert got["tablet"] == ["res_1080", "orient_port", "dpr_2", "kind_tablet", "screens_unknown"]
    assert got["id"][1] and got["id"][2], "one id per browser, kept"
    for k in ("tv4k", "phone", "desk1440", "laptop", "tablet"):
        assert all(w in got["words"] for w in got[k]), k
        assert all(T.event_allowed("client_screen:" + w) for w in got[k]), k



def test_each_screen_counts_once_per_window_and_its_id_never_leaves():
    from custom_components.padspan_ha.const import DATA_SETTINGS
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}})
    a, b = "0123456789abcdef", "fedcba9876543210"
    assert T.note_screen(hass, a) and not T.note_screen(hass, a) and T.note_screen(hass, b)
    assert not T.note_screen(hass, "not-an-id") and not T.note_screen(hass, "ABCDEF0123456789")
    for _ in (a, b):
        T.bump(hass, "client_screen_seen")
    counters = T._take_counters(hass)
    assert counters == {"client_screen_seen": 2}
    assert a not in json.dumps(counters) and b not in json.dumps(counters)
    assert T.note_screen(hass, a), "a new window counts it again"


def test_the_websocket_counts_a_screen_only_when_it_is_new():
    src = (Path(T.__file__).parent / "ws_telemetry.py").read_text(encoding="utf-8")
    assert 'vol.Optional("screen"): vol.All(str, vol.Length(max=32))' in src
    assert 'note_screen(hass, str(msg.get("screen") or "")) and bump(hass, event)' in src
