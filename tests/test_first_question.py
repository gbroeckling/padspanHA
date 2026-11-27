# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The first-run question, "What do you want PadSpan for?" (the owner, 2026-11-26).

  1. Asked on a new install's first run only: a settings store made fresh has
     purpose_ask "due"; every install from before keeps "" and is never asked,
     and a restore never brings "due" back.
  2. Saved as settings purpose (onboarding.PURPOSE_KEYS, the first ticked
     first), an administrator's; the answer or Skip makes it "done", and only
     from "due".
  3. The opt-in report carries env.purpose, only when one is ticked.
  4. The panel: tests/js/first_question.mjs runs views/first_question.js (who
     is asked, Start, Skip, each answer's first step, the next steps,
     Settings); panel.js asks it at the top of Getting started, and Settings
     → Appearance has the same choice.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import onboarding as onb
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.build_info import EDITION
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_onboarding_proxy_health import _load
from tests.test_telemetry import _hass as _report_hass

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


# ═══ 1. who is asked ══════════════════════════════════════════════════════════

def test_the_defaults_ask_nobody():
    assert DEFAULT_SETTINGS["purpose"] == [] and DEFAULT_SETTINGS["purpose_ask"] == ""
    assert onb.PURPOSE_KEYS == ("whole_house", "presence", "plan", "lights")


def test_a_new_install_is_asked(tmp_path):
    storage = tmp_path / ".storage"
    storage.mkdir()
    data, saved = _load(None, storage)
    if EDITION == "bright":            # no presence or plan to offer: never asked (test_bright_is_never_asked)
        assert data["purpose_ask"] == ""
        return
    assert data["purpose_ask"] == "due" and saved["purpose_ask"] == "due"


def test_an_existing_install_is_never_asked(tmp_path):
    storage = tmp_path / ".storage"
    storage.mkdir()
    for loaded in ({"data_mode": "live"}, {}, {"purpose": ["plan"]}):
        data, _ = _load(dict(loaded), storage)
        assert data["purpose_ask"] == "", loaded
    data, _ = _load({"purpose_ask": "done", "purpose": ["lights"]}, storage)
    assert data["purpose_ask"] == "done" and data["purpose"] == ["lights"]


def test_bright_is_never_asked(tmp_path, monkeypatch):
    from custom_components.padspan_ha import settings_store as ss
    monkeypatch.setattr(ss, "EDITION", "bright")
    storage = tmp_path / ".storage"
    storage.mkdir()
    assert _load(None, storage)[0]["purpose_ask"] == ""


def test_a_restore_keeps_this_installs_asking():
    from custom_components.padspan_ha.settings_store import purpose_ask_kept
    # this install's own, never the backup's
    assert purpose_ask_kept({}, {"purpose_ask": "due"}) == ""
    assert purpose_ask_kept({"purpose_ask": ""}, {"purpose_ask": "due", "purpose": []}) == ""
    assert purpose_ask_kept({"purpose_ask": "done"}, {"purpose_ask": "due"}) == "done"
    # a new install still asking: done once the restored settings hold an answer (as live_first_kept does)
    assert purpose_ask_kept({"purpose_ask": "due"}, {"purpose": ["plan"]}) == "done"
    assert purpose_ask_kept({"purpose_ask": "due"}, {"purpose": ["garage"]}) == "due"
    assert purpose_ask_kept({"purpose_ask": "due"}, {}) == "due"
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_backup.py").read_text(encoding="utf-8")
    assert 'data["purpose_ask"] = purpose_ask_kept(store_obj.data or {}, data)' in src


# ═══ 2. stored, an administrator's ════════════════════════════════════════════

def test_the_keys_are_cleaned():
    assert onb.purpose_keys(["lights", "plan", "lights", "garage", 3, None]) == ["lights", "plan"]
    for bad in (None, "plan", 3, {"plan": True}):
        assert onb.purpose_keys(bad) == []


def _settings_set(start: dict, msg: dict, admin: bool = True):
    """padspan_ha/settings_set with `msg` against a store holding `start`: (what it saved, the error sent or None)."""
    st = SimpleNamespace(data={**DEFAULT_SETTINGS, **start})
    saved: dict = {}

    async def _set(**kw):
        saved.update(kw)
        st.data.update(kw)
    st.async_set = _set
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    hass.async_create_task = lambda c: c.close()
    conn = MagicMock()
    conn.user = SimpleNamespace(is_admin=admin)
    errors = []
    conn.send_error = lambda mid, code, text="", **kw: errors.append((code, text))
    handler = getattr(WS.ws_settings_set, "__wrapped__", WS.ws_settings_set)
    asyncio.run(handler(hass, conn, {"id": 1, "type": "padspan_ha/settings_set", **msg}))
    return saved, (errors[0] if errors else None), st.data


def test_an_answer_is_saved_and_ends_the_asking():
    saved, err, data = _settings_set({"purpose_ask": "due"}, {"purpose": ["presence", "junk", "presence", "lights"]})
    assert err is None and data["purpose"] == ["presence", "lights"] and data["purpose_ask"] == "done"


def test_skip_ends_the_asking_and_saves_nothing_else():
    saved, err, data = _settings_set({"purpose_ask": "due"}, {"purpose_ask": "done"})
    assert err is None and data["purpose_ask"] == "done" and data["purpose"] == []


def test_settings_never_starts_the_asking():
    # An install that was never asked answers in Settings: saved, and still never asked.
    saved, err, data = _settings_set({"purpose_ask": ""}, {"purpose": ["plan"]})
    assert err is None and data["purpose"] == ["plan"] and data["purpose_ask"] == ""
    saved, err, data = _settings_set({"purpose_ask": ""}, {"purpose_ask": "done"})
    assert data["purpose_ask"] == ""
    # Only ever forward: "due" is never sent from the panel.
    saved, err, data = _settings_set({"purpose_ask": "done"}, {"purpose_ask": "due"})
    assert data["purpose_ask"] == "done"


def test_a_skip_is_counted_and_an_answer_is_not(monkeypatch):
    bumped = []
    monkeypatch.setattr(T, "bump", lambda hass, event, n=1: bumped.append(event) or True)
    _settings_set({"purpose_ask": "due"}, {"purpose_ask": "done"})
    assert bumped == ["purpose_skipped"]
    assert "purpose_skipped" in T.EVENTS and T.event_allowed("purpose_skipped")
    bumped.clear()
    _settings_set({"purpose_ask": "due"}, {"purpose": ["lights"]})      # answered
    _settings_set({"purpose_ask": "done"}, {"purpose_ask": "done"})     # asked before
    _settings_set({"purpose_ask": ""}, {"purpose": []})                 # never asked: Settings
    assert bumped == []
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    assert 'purpose_skipped: "Skipped the first-run question"' in ib


def test_only_an_administrator_answers():
    saved, err, data = _settings_set({"purpose_ask": "due"}, {"purpose": ["plan"]}, admin=False)
    assert err == ("unauthorized", "Only an administrator can change what PadSpan is for")
    assert data["purpose"] == [] and data["purpose_ask"] == "due"


def test_the_schema_and_the_manual_have_both_keys():
    ws = (_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("purpose"): _LIST,' in ws and 'vol.Optional("purpose_ask"): str,' in ws
    ref = (_ROOT / "scripts" / "build_manual_reference.py").read_text(encoding="utf-8")
    assert '"purpose": ("Settings → Appearance", "What do you want PadSpan for?"' in ref
    assert '"purpose_ask": (None, "kept"' in ref


# ═══ 3. the report ════════════════════════════════════════════════════════════

def test_the_report_carries_the_answer_only_when_there_is_one():
    h = _report_hass()
    payload = T.build_payload(h)
    assert "purpose" not in payload["env"], "not answered is not sent"
    for bad in ([], ["garage"], "plan", None, 3):
        h.data[DOMAIN][DATA_SETTINGS].data["purpose"] = bad
        assert "purpose" not in T.build_payload(h)["env"], bad
    h.data[DOMAIN][DATA_SETTINGS].data["purpose"] = ["lights", "whole_house"]
    payload = T.build_payload(h)
    T.assert_shareable(payload)
    assert payload["env"]["purpose"] == ["lights", "whole_house"]
    for bad in (["my house"], [], "lights", ["lights", "lights"]):
        payload["env"]["purpose"] = bad
        with pytest.raises(ValueError):
            T.assert_shareable(payload)


def test_the_summary_counts_the_answers():
    import importlib.util
    script = _ROOT / "server" / "telemetry_summary.py"
    if not script.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    spec = importlib.util.spec_from_file_location("telemetry_summary", script)
    S = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(S)
    assert S._PURPOSE_KEYS == onb.PURPOSE_KEYS
    latest = {"a": {"env": {"purpose": ["lights", "plan"], "emergency_count": 3}},
              "b": {"env": {"purpose": ["plan"]}}, "c": {"env": {}}}
    out = S.purpose_section(latest)
    assert out[0].startswith("What they want PadSpan for (2 of 3 installs answered")
    rows = {ln.split()[0]: [int(x) for x in ln.split()[1:]] for ln in out[2:6]}
    assert rows == {"whole_house": [0, 0], "presence": [0, 0], "plan": [2, 1], "lights": [1, 1]}
    assert out[-1].strip() == "leak, smoke, gas or CO alarms on the map: 1 of 3 installs (median 3)"


# ═══ 4. the panel ═════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def run() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    r = subprocess.run([node, str(_ROOT / "tests" / "js" / "first_question.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in r.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{r.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("due:", 5), ("ask:", 4), ("start:", 5), ("skip:", 2), ("step:", 8),
                                          ("next:", 6), ("settings:", 4)])
def test_the_question_in_the_panel(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_the_keys_are_the_backends():
    src = (_WWW / "views" / "first_question.js").read_text(encoding="utf-8")
    got = re.search(r"export const PURPOSES = Object\.freeze\(\[([^\]]*)\]\);", src).group(1)
    assert tuple(re.findall(r'"([a-z_]+)"', got)) == onb.PURPOSE_KEYS


def test_getting_started_asks_it_first_and_settings_has_it():
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert "import(`./views/first_question.js?b=${BUILD_ID}`)" in panel
    card = panel[panel.index("// ── Onboarding wizard"):panel.index("// Last line: the 90-day trial")]
    # while due, the question in place of the steps; once answered, its next steps
    assert "_fqDue = !!FQ && FQ.due(this._ctx());" in card
    assert "_fqDue ? FQ.askCard(this._ctx()) : FQ.nextCard(this._ctx())" in card
    assert "if (!_fqDue) bar.appendChild(dots);" in card
    assert "if (!_fqDue) bar.appendChild(list);" in panel
    settings = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    appearance = settings[settings.index("function _settingsAppearance("):]
    assert "FQ.settingsCard(ctx)" in appearance[:600]
