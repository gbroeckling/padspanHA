"""The usage report's 2026-11-19 additions.

- The one optional question (where did you hear about PadSpan) falls due once
  per install: when the report is turned on by any route, and when a free
  licence starts (trial, tester sign-up, free year). A house that was already
  reporting is never asked by itself.
- env.store: which store keeps this copy up to date (report_context.py).
- env.used_in: how many automations and scripts use PadSpan. Counts only.
- Deleting PadSpan with the report on sends one last report saying so.
"""

from __future__ import annotations

import asyncio
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import report_context as RC
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_telemetry import _hass

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_ROOT = _CC.parents[1]


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ── the question falls due once ──────────────────────────────────────────────

def test_the_question_is_due_once_and_only_for_a_house_that_has_not_said():
    assert T.heard_ask_due({}) == {"telemetry_heard_ask": "due"}
    assert T.heard_ask_due({"telemetry_heard_ask": "", "telemetry_heard": ""}) == {"telemetry_heard_ask": "due"}
    assert T.heard_ask_due({"telemetry_heard_ask": "due"}) == {}, "already due"
    assert T.heard_ask_due({"telemetry_heard_ask": "done"}) == {}, "answered or skipped: never again"
    assert T.heard_ask_due({"telemetry_heard": "reddit"}) == {}, "said in Settings: nothing to ask"
    assert T.heard_ask_due(None) == {"telemetry_heard_ask": "due"}


def _save(h, **msg):
    conn = MagicMock()
    conn.user = MagicMock(is_admin=True)
    _run(WS.ws_settings_set(h, conn, {"id": 1, **msg}))
    return h.data[DOMAIN][DATA_SETTINGS].data


def _quiet(monkeypatch):
    async def _mint(hass):
        return ""
    monkeypatch.setattr(T, "ensure_install_id", _mint)
    monkeypatch.setattr(T, "reset_windows", lambda hass: None)


def test_turning_the_report_on_makes_the_question_due_and_an_answer_or_skip_ends_it(monkeypatch):
    _quiet(monkeypatch)
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    data = _save(h, telemetry_enabled=True, telemetry_asked=True)
    assert data["telemetry_heard_ask"] == "due"
    data = _save(h, telemetry_heard="YouTube ")
    assert data["telemetry_heard"] == "youtube" and data["telemetry_heard_ask"] == "done"
    # off and on again: answered, so never due again
    _save(h, telemetry_enabled=False)
    assert _save(h, telemetry_enabled=True)["telemetry_heard_ask"] == "done"

    skip = _hass()
    skip.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    _save(skip, telemetry_enabled=True)
    data = _save(skip, telemetry_heard_ask="done")
    assert data["telemetry_heard_ask"] == "done" and not data.get("telemetry_heard")
    # the panel can only ever end the question, not start it again
    assert _save(skip, telemetry_heard_ask="due")["telemetry_heard_ask"] == "done"
    assert _save(skip, telemetry_heard="not a word")["telemetry_heard"] == ""


def test_a_house_already_reporting_is_not_asked_by_itself(monkeypatch):
    _quiet(monkeypatch)
    h = _hass()                                   # telemetry_enabled is already True
    data = _save(h, telemetry_enabled=True)
    assert not data.get("telemetry_heard_ask"), "no off-to-on change, so nothing falls due"


def test_only_an_administrator_ends_or_answers_it(monkeypatch):
    _quiet(monkeypatch)
    h = _hass()
    for msg in ({"telemetry_heard": "reddit"}, {"telemetry_heard_ask": "done"}):
        conn = MagicMock()
        conn.user = MagicMock(is_admin=False)
        _run(WS.ws_settings_set(h, conn, {"id": 1, **msg}))
        assert conn.send_error.call_args[0][1] == "unauthorized", msg
    assert not h.data[DOMAIN][DATA_SETTINGS].data.get("telemetry_heard")


def test_a_free_licence_starting_makes_it_due_too():
    """Trial, tester sign-up and free year: a house already reporting never
    sees the opt-in card, so these are where it gets asked."""
    trial = (_CC / "ws_forensics.py").read_text(encoding="utf-8")
    body = trial[trial.index("async def ws_trial_start("):trial.index('@websocket_api.websocket_command({"type": "padspan_ha/forensics_stats"})')]
    assert "**heard_ask_due(st.data)," in body
    tester = (_CC / "ws_tester.py").read_text(encoding="utf-8")
    body = tester[tester.index("async def ws_tester_signup("):tester.index('"padspan_ha/tester_withdraw"')]
    assert "due = heard_ask_due(st.data) if st else {}" in body and "await st.async_set(**due)" in body
    invite = (_CC / "pro_invite.py").read_text(encoding="utf-8")
    body = invite[invite.index("async def ws_pro_invite_claim("):invite.index('"padspan_ha/pro_invite_decline"')]
    assert "**heard_ask_due(st.data)," in body


# ── env.store ────────────────────────────────────────────────────────────────

def _repos(installed):
    """A store's repository list holding PadSpan with this installed flag (None: not listed)."""
    seen = []

    def get_by_full_name(name):
        seen.append(name)
        return None if installed is None else SimpleNamespace(data=SimpleNamespace(installed=installed))
    return SimpleNamespace(get_by_full_name=get_by_full_name, seen=seen)


def _store_hass(marketplace=..., hacs=...):
    entries = [] if marketplace is ... else [SimpleNamespace(runtime_data=SimpleNamespace(repositories=_repos(marketplace)))]
    data = {} if hacs is ... else {"hacs": SimpleNamespace(repositories=_repos(hacs))}
    asked = []

    def async_entries(domain):
        asked.append(domain)
        return entries if domain == "marketplace" else []
    return SimpleNamespace(config_entries=SimpleNamespace(async_entries=async_entries), data=data, asked=asked)


def test_the_store_is_whoever_lists_padspan_as_installed():
    assert RC.install_store(_store_hass(marketplace=True)) == "marketplace"
    assert RC.install_store(_store_hass(hacs=True)) == "hacs"
    assert RC.install_store(_store_hass(marketplace=True, hacs=True)) == "marketplace", "taken over: who keeps it up to date now"
    assert RC.install_store(_store_hass(marketplace=False, hacs=True)) == "hacs"
    # a store that is there but does not list it as installed: copied in by hand
    assert RC.install_store(_store_hass(marketplace=False)) == "manual"
    assert RC.install_store(_store_hass(hacs=None)) == "manual"
    assert RC.install_store(_store_hass()) == "manual"
    h = _store_hass(marketplace=True)
    RC.install_store(h)
    assert h.asked == ["marketplace"]
    # an entry that has not finished loading has no manager yet
    h = _store_hass()
    h.config_entries.async_entries = lambda d: [SimpleNamespace()]
    assert RC.install_store(h) == "manual"


def test_a_store_that_cannot_be_read_is_unknown_never_a_guess():
    broken = SimpleNamespace(config_entries=SimpleNamespace(async_entries=lambda d: []),
                             data={"hacs": SimpleNamespace()})          # no .repositories
    assert RC.install_store(broken) == "unknown"
    # "installed" has to be True itself: a mock or a string is not a yes
    odd = _store_hass(hacs="yes")
    assert RC.install_store(odd) == "manual"
    assert RC.REPOSITORY == "gbroeckling/padspanHA"
    assert set(RC.STORE_WORDS) == {"marketplace", "hacs", "manual", "unknown"}


# ── env.used_in ──────────────────────────────────────────────────────────────

def test_users_are_counted_once_however_many_entities_they_use():
    by_entity = {"sensor.keys_area": ["automation.hall_light", "automation.leaving"],
                 "sensor.phone_area": ["automation.hall_light"], "sensor.spare": []}
    by_device = {"dev1": ["automation.device_trigger", "automation.leaving"]}
    n = RC.count_users(by_entity, by_device, lambda e: by_entity[e], lambda d: by_device[d])
    assert n == 3
    assert RC.count_users([], [], lambda e: ["x"], lambda d: ["y"]) == 0


def _used_in_house(monkeypatch, entities, devices, automations, scripts):
    reg = SimpleNamespace(entities={i: SimpleNamespace(entity_id=e, platform=p) for i, (e, p) in enumerate(entities)})
    dev_reg = SimpleNamespace(devices={d: SimpleNamespace(id=d, identifiers={(dom, d)}) for d, dom in devices})
    import homeassistant.helpers.device_registry as dr
    import homeassistant.helpers.entity_registry as er
    monkeypatch.setattr(er, "async_get", lambda hass: reg, raising=False)
    monkeypatch.setattr(dr, "async_get", lambda hass: dev_reg, raising=False)
    for name, users in (("automation", automations), ("script", scripts)):
        mod = types.ModuleType(f"homeassistant.components.{name}")
        setattr(mod, f"{name}s_with_entity", lambda hass, e, _u=users: _u.get(e, []))
        setattr(mod, f"{name}s_with_device", lambda hass, d, _u=users: _u.get(d, []))
        monkeypatch.setitem(sys.modules, f"homeassistant.components.{name}", mod)
        import homeassistant.components as comps
        monkeypatch.setattr(comps, name, mod, raising=False)
    return SimpleNamespace()


def test_used_in_counts_automations_and_scripts_that_use_padspans_own_things(monkeypatch):
    h = _used_in_house(
        monkeypatch,
        entities=[("sensor.keys_area", DOMAIN), ("sensor.phone_area", DOMAIN), ("light.kitchen", "hue")],
        devices=[("dev_keys", DOMAIN), ("dev_bulb", "hue")],
        automations={"sensor.keys_area": ["automation.a"], "sensor.phone_area": ["automation.a", "automation.b"],
                     "dev_keys": ["automation.c"], "light.kitchen": ["automation.other"], "dev_bulb": ["automation.other2"]},
        scripts={"sensor.phone_area": ["script.goodnight"]})
    assert RC.used_in(h) == {"automations": 3, "scripts": 1}


def test_used_in_is_left_out_of_a_house_where_padspan_has_nothing_yet(monkeypatch):
    h = _used_in_house(monkeypatch, entities=[("light.kitchen", "hue")], devices=[("dev_bulb", "hue")],
                       automations={"light.kitchen": ["automation.x"]}, scripts={})
    assert RC.used_in(h) is None


def test_the_report_carries_the_store_and_the_counts_and_nothing_else_fits(monkeypatch):
    monkeypatch.setattr(RC, "install_store", lambda hass: "marketplace")
    monkeypatch.setattr(RC, "used_in", lambda hass: {"automations": 4, "scripts": 0})
    payload = T.build_payload(_hass())
    T.assert_shareable(payload)
    assert payload["env"]["store"] == "marketplace"
    assert payload["env"]["used_in"] == {"automations": 4, "scripts": 0}
    for bad in ({"store": "the Marketplace"}, {"used_in": {"automations": "hall light"}},
                {"used_in": {"automations": -1}}, {"used_in": {"dashboards": 2}}, {"used_in": ["automation.x"]},
                {"used_in": {"automations": True}}):
        p = json.loads(json.dumps(payload))
        p["env"].update(bad)
        with pytest.raises(ValueError):
            T.assert_shareable(p)


def test_a_house_that_cannot_be_read_still_sends_its_report(monkeypatch):
    def boom(hass):
        raise RuntimeError("no automation integration here")
    monkeypatch.setattr(RC, "install_store", lambda hass: "manual")
    monkeypatch.setattr(RC, "used_in", boom)
    payload = T.build_payload(_hass())
    T.assert_shareable(payload)
    assert payload["env"]["store"] == "manual" and "used_in" not in payload["env"]


# ── the removal report ───────────────────────────────────────────────────────

def _http(monkeypatch, status=200):
    sent = []

    class _Resp:
        def __init__(self): self.status = status
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False

    class _Session:
        def post(self, url, data=None, **k):
            sent.append((url, json.loads(data), k))
            return _Resp()
    fake = types.ModuleType("homeassistant.helpers.aiohttp_client")
    fake.async_get_clientsession = lambda hass: _Session()
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake)
    return sent


def test_deleting_padspan_with_the_report_on_says_so_once_and_says_nothing_else(monkeypatch):
    sent = _http(monkeypatch)
    h = _hass()
    assert _run(T.async_send_removed(h)) is True
    (url, body, kw), = sent
    assert url == T.TELEMETRY_URL and kw["timeout"] == 5
    assert body == {"schema": 1, "install_id": h.data[DOMAIN][DATA_SETTINGS].data["telemetry_install_id"],
                    "day": T._today(), "version": T.BUILD_VERSION, "usage": {"integration_removed": 1}}
    T.assert_shareable(body)
    # every key is one the receiver takes (server/telemetry.php refuses a report with any other)
    php = _ROOT / "server" / "telemetry.php"
    if php.exists():
        allowed = php.read_text(encoding="utf-8")
        allowed = allowed[allowed.index("$allowed = array("):allowed.index(");", allowed.index("$allowed = array("))]
        assert all(f"'{k}'" in allowed for k in body)


def test_a_house_with_the_report_off_sends_nothing_when_deleted(monkeypatch):
    sent = _http(monkeypatch)
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    assert _run(T.async_send_removed(h)) is False
    h.data[DOMAIN][DATA_SETTINGS].data.update(telemetry_enabled=True, telemetry_install_id="")
    assert _run(T.async_send_removed(h)) is False, "never opted in far enough to have an id"
    assert sent == []


def test_the_removal_report_reads_the_saved_settings_when_padspan_is_already_unloaded(monkeypatch):
    sent = _http(monkeypatch)
    saved = {"telemetry_enabled": True, "telemetry_install_id": "8f0d0f7e-2c8f-4c8a-9d1c-0f2c3d4e5f60"}

    class _Store:
        def __init__(self, hass, version, key): assert key == "padspan_ha.settings"
        async def async_load(self): return saved
    import homeassistant.helpers.storage as storage
    monkeypatch.setattr(storage, "Store", _Store)
    h = SimpleNamespace(data={})
    assert _run(T.async_send_removed(h)) is True
    assert sent[0][1]["install_id"] == saved["telemetry_install_id"]


def test_a_failed_removal_report_never_stops_the_removal(monkeypatch):
    fake = types.ModuleType("homeassistant.helpers.aiohttp_client")

    def boom(hass):
        raise OSError("network is down")
    fake.async_get_clientsession = boom
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake)
    assert _run(T.async_send_removed(_hass())) is False
    assert _http(monkeypatch, status=500) == [] and _run(T.async_send_removed(_hass())) is False
    init = (_CC / "__init__.py").read_text(encoding="utf-8")
    body = init[init.index("async def async_remove_entry("):init.index("async def async_unload_entry(")]
    assert "await async_send_removed(hass)" in body


# ── the developer's summary ──────────────────────────────────────────────────

def test_the_summary_reads_the_store_the_counts_and_removals():
    import importlib.util
    script = _ROOT / "server" / "telemetry_summary.py"
    if not script.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    spec = importlib.util.spec_from_file_location("telemetry_summary", script)
    S = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(S)
    assert S._STORE_WORDS == RC.STORE_WORDS
    latest = {
        "aaaaaaaa-1": {"env": {"store": "marketplace", "used_in": {"automations": 4, "scripts": 0}}},
        "bbbbbbbb-2": {"env": {"store": "hacs", "used_in": {"automations": 0, "scripts": 0}}},
        "cccccccc-3": {"env": {"store": "marketplace", "used_in": {"automations": 12, "scripts": 1}}},
        "dddddddd-4": {"env": {}},                                       # an older PadSpan: says neither
        "eeeeeeee-5": {"day": "2026-11-20", "version": "0.38.263", "usage": {"integration_removed": 1}},
    }
    out = S.context_section(latest, {"eeeeeeee-5"})
    assert out[0] == "Kept up to date by (3 of 4 installs say)"
    assert out[1].strip() == "marketplace 2, hacs 1"
    assert out[2] == "Used in automations or scripts (3 installs say)"
    assert out[3].strip() == "in at least one automation or script: 2 of 3"
    assert out[4].split() == ["automations", "0:", "1,", "1-2:", "0,", "3-9:", "1,", "10+:", "1"]
    assert out[5].split() == ["scripts", "0:", "2,", "1-2:", "1,", "3-9:", "0,", "10+:", "0"]
    assert out[6].endswith("not back since): 1") and out[7].split() == ["eeeeeeee", "2026-11-20", "v0.38.263"]
    empty = S.context_section({"x": {"env": {}}}, set())
    assert "no install says yet" in empty[1] and "no install says yet" in empty[3]
    assert S.was_removed({"usage": {"integration_removed": 1}}) and not S.was_removed({"usage": {"tab:maps": 2}})
    main = script.read_text(encoding="utf-8")
    assert "if was_removed(r):\n            removed.add(iid)\n            if iid in latest:\n                continue" in main
    assert "removed.discard(iid)" in main


def test_the_readme_and_settings_say_what_was_added():
    readme = _ROOT / "README.md"
    if readme.exists():
        text = readme.read_text(encoding="utf-8")
        for want in ("`store`: which store keeps this copy of PadSpan up to date", "`used_in`: how many automations and how many scripts",
                     "**If you delete PadSpan** from Home Assistant while the report is on", "`integration_removed`"):
            assert want in text, want
    settings = (_CC / "www" / "padspan-ha" / "views" / "settings.js").read_text(encoding="utf-8")
    assert "which store keeps PadSpan up to date" in settings and "how many automations and scripts use it" in settings
    assert "one last report says it was removed" in settings
