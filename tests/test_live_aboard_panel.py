# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard on the wall panel, and the people in it (views/live_aboard_panel.js).

tests/js/live_aboard_panel.mjs runs the real 3D view under the DOM shim on a
house shaped like Garry's (five rooms in the basement, eleven on the main
floor, five upstairs over part of it): with no home set the sidebar opens on
the floor with the most rooms of its own (the main floor, never All); Views ▾
→ Set as home keeps the camera and floor per browser; untouched for the
setting's time it flies home, closing menus and cards, never while Edit,
Furnish, a card the Atlas opened or full screen by hand holds it; Carries
places a person whatever the names say, and a thing picked for two stays with
the first, the other told; someone known only by their room stands in its
middle, nudged apart and dimmed, "room only" on their card, in Live Aboard
and on the flat map alike; a pinned tag stands at its pin; Show people and
Show tags & scanners in Views ▾ save (an admin's) or show on or off; Follow
glides on the capped clock and a touch lets go; the People chip goes to each
person in turn, changing floor; at rest, no frames and no timer.

Held here: the two new settings (the return's time, one of four; who carries
what: people by id, plain keys, capped) with their validation, backup and
restore; who carries what never in the usage report; the hooks the hosts hand
over; the panel module asking nothing of Home Assistant.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN, SETTINGS_STORE_KEY
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_house3d_store import _capture_backups, _house, _restore, store  # noqa: F401  (store: the fixture)
from tests.test_telemetry import _hass

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")
# Made-up people and keys (never anyone real): the shapes the live snapshot uses.
_PICKS = {"person.alex_example": ["irk:0a1b2c3d4e", "entity:device_tracker.alex_phone"],
          "person.sam": ["ibeacon:00000000-0000-4000-8000-000000000001:101:202"]}


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


# ═══ the harness ══════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_panel.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["homefloor:", "home:", "idle:", "hold:", "carries:", "roomonly:", "pinned:",
                                    "switches:", "chip:", "follow:", "rest:"])
def test_the_panel_harness_covers_each_part(harness, prefix) -> None:
    got = {k: v for k, v in harness["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(harness['cases'])}"
    bad = [f for f in harness["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)


def test_every_panel_case_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:4], indent=2, ensure_ascii=False)


# ═══ the settings: going back home, who carries what ══════════════════════════

def test_the_two_settings_have_their_defaults_and_are_in_the_schema() -> None:
    assert DEFAULT_SETTINGS["atlas_3d_home_idle_s"] == 60
    assert DEFAULT_SETTINGS["atlas_3d_carries"] == {}
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"atlas_3d_home_idle_s", "atlas_3d_carries"} <= keys


@pytest.mark.parametrize(("raw", "want"), [(0, 0), (30, 30), (60, 60), (300, 300), ("300", 300), (30.0, 30),
                                           (45, 60), (-1, 60), (3600, 60), ("soon", 60), (None, 60), (float("nan"), 60),
                                           (30.5, 60)])
def test_the_return_is_one_of_four_or_a_minute(raw, want) -> None:
    assert WS._atlas_3d_idle(raw) == want
    assert WS.ATLAS_3D_IDLE_CHOICES == (0, 30, 60, 300)


def test_carries_keeps_people_by_id_and_plain_keys_once_each() -> None:
    raw = {"person.alex": ["irk:abc", "irk:abc", "entity:device_tracker.alex_phone", "", 7, None, "has space", "tab\there",
                            "x" * 161, "y" * 160],
           "person.sam": [],                            # nothing left: left out
           "light.kitchen": ["ble:AA"],                 # not a person
           "person.Bad": ["ble:AA"], "person._x": ["ble:AA"], "person.": ["ble:AA"],
           "person.dan": "ble:AA"}                      # not a list
    assert WS._atlas_3d_carries(raw) == {"person.alex": ["irk:abc", "entity:device_tracker.alex_phone", "y" * 160]}
    assert WS._atlas_3d_carries([("person.a", ["k"])]) == {}
    assert WS._atlas_3d_carries(None) == {}
    many = {f"person.p{i}": [f"k{j}" for j in range(20)] for i in range(80)}
    capped = WS._atlas_3d_carries(many)
    assert len(capped) == WS.CARRIES_MAX_PEOPLE == 50
    assert all(len(v) == WS.CARRIES_MAX_EACH == 8 for v in capped.values())
    assert capped["person.p0"] == [f"k{j}" for j in range(8)], "in the order picked"


def test_carries_saves_through_settings_set_and_a_bad_payload_wipes_nothing() -> None:
    h, conn = _hass(), MagicMock()
    conn.user = MagicMock(is_admin=True)             # an administrator's (the review: as Show people's)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_carries": {**_PICKS, "light.x": ["k"]},
                                      "atlas_3d_home_idle_s": 300}))
    assert not conn.send_error.called
    data = h.data[DOMAIN][DATA_SETTINGS].data
    assert data["atlas_3d_carries"] == _PICKS and data["atlas_3d_home_idle_s"] == 300
    assert conn.send_result.call_args[0][1]["settings"]["atlas_3d_carries"] == _PICKS
    for bad in ("not a dict", ["person.x"], None):
        _run(WS.ws_settings_set(h, conn, {"id": 2, "atlas_3d_carries": bad}))
        assert data["atlas_3d_carries"] == _PICKS, f"{bad!r} wiped what was saved"
    _run(WS.ws_settings_set(h, conn, {"id": 3, "atlas_3d_carries": {}}))
    assert data["atlas_3d_carries"] == {}, "an empty pick is kept: today's matching for everyone"


@pytest.mark.parametrize("raw", ["inf", "-inf", "1e400", float("inf"), float("-inf"), "nan"])
def test_a_return_time_that_is_no_number_never_breaks_the_save(raw) -> None:
    """Review: "inf" or "1e400" raised OverflowError in int(), and the whole
    save failed, every other setting in it lost."""
    assert WS._atlas_3d_idle(raw) == 60
    h, conn = _hass(), MagicMock()
    conn.user = MagicMock(is_admin=True)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_home_idle_s": raw, "quiet_mode": False}))
    assert not conn.send_error.called
    data = h.data[DOMAIN][DATA_SETTINGS].data
    assert data["atlas_3d_home_idle_s"] == 60 and data["quiet_mode"] is False


@pytest.mark.parametrize(("key", "value"), [("atlas_3d_carries", {"person.alex": ["irk:0a1b2c3d4e"]}),
                                            ("atlas_3d_people", True), ("atlas_3d_tags", True)])
def test_only_an_administrator_changes_who_shows_and_what_they_carry(key, value) -> None:
    """Review: as in Live Aboard's Views ▾ (and its Settings rows), an
    administrator's: anyone else is refused and nothing of the save is kept."""
    h, conn = _hass(), MagicMock()
    conn.user = MagicMock(is_admin=False)
    data = h.data[DOMAIN][DATA_SETTINGS].data
    before = dict(data)
    _run(WS.ws_settings_set(h, conn, {"id": 1, key: value, "quiet_mode": False}))
    assert conn.send_error.called and conn.send_error.call_args[0][1] == "unauthorized"
    assert data == before, "nothing of a refused save is kept"
    admin = MagicMock()
    admin.user = MagicMock(is_admin=True)
    _run(WS.ws_settings_set(h, admin, {"id": 2, key: value}))
    assert not admin.send_error.called and data[key] == value


def _person_event(entity_id, action="remove", **more):
    from types import SimpleNamespace
    return SimpleNamespace(data={"action": action, "entity_id": entity_id, **more})


def _person_fire(h, event) -> list:
    """Home Assistant's registry listener, as it calls it; each task it starts, run."""
    from custom_components.padspan_ha import house3d_people as HP
    started = []
    h.async_create_task = started.append
    HP._on_entity_registry_updated(h, event)
    return [_run(c) for c in started]


def test_what_a_person_carried_follows_a_rename_and_goes_with_a_delete(tmp_path) -> None:
    """Review: a renamed person's picks were left under the old id (they
    silently stopped placing them) and a deleted one's stayed for good."""
    h = _house(tmp_path)                             # no Live Aboard file: only the settings change
    data = h.data[DOMAIN][DATA_SETTINGS].data
    data["atlas_3d_carries"] = {"person.alex": ["irk:0a1b2c3d4e"], "person.sam": ["ble:keys"]}
    writes = []
    real = h.data[DOMAIN][DATA_SETTINGS].async_set

    async def _set(**kw):
        writes.append(sorted(kw))
        await real(**kw)
    h.data[DOMAIN][DATA_SETTINGS].async_set = _set
    _person_fire(h, _person_event("person.alexandra", "update", old_entity_id="person.alex"))
    assert data["atlas_3d_carries"] == {"person.alexandra": ["irk:0a1b2c3d4e"], "person.sam": ["ble:keys"]}
    assert writes == [["atlas_3d_carries"]], "one settings write, of that key alone"
    _person_fire(h, _person_event("person.sam"))
    assert data["atlas_3d_carries"] == {"person.alexandra": ["irk:0a1b2c3d4e"]}
    # Renamed onto someone who has picks of their own: theirs are kept.
    data["atlas_3d_carries"] = {"person.a": ["k1"], "person.b": ["k2"]}
    _person_fire(h, _person_event("person.b", "update", old_entity_id="person.a"))
    assert data["atlas_3d_carries"] == {"person.b": ["k2"]}
    # A person with no picks, another kind of entity, a plain update: nothing written.
    writes.clear()
    for ev in (_person_event("person.zed"), _person_event("light.alexandra"), _person_event("person.b", "update")):
        _person_fire(h, ev)
    assert writes == [] and data["atlas_3d_carries"] == {"person.b": ["k2"]}


def test_carries_is_in_a_backup_and_comes_back_with_a_restore(store, tmp_path, monkeypatch) -> None:  # noqa: F811
    from custom_components.padspan_ha import ws_backup
    box = _capture_backups(monkeypatch)
    h = _house(tmp_path)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_carries"] = dict(_PICKS)
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 1}))
    kept = box["backups"][-1]["stores"][SETTINGS_STORE_KEY]
    assert kept["atlas_3d_carries"] == _PICKS
    # Picked again since; the backup restored: as it was then.
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_carries"] = {"person.sam": ["ble:other"]}
    _restore(h, monkeypatch, {SETTINGS_STORE_KEY: kept}, [SETTINGS_STORE_KEY])
    assert h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_carries"] == _PICKS
    assert store.saved[SETTINGS_STORE_KEY]["atlas_3d_carries"] == _PICKS, "written to the file too"


def test_who_carries_what_never_goes_in_the_usage_report() -> None:
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data.update({"atlas_3d_enabled": True, "atlas_3d_people": True,
                                               "atlas_3d_carries": dict(_PICKS), "atlas_3d_home_idle_s": 30})
    p = T.build_payload(h)
    T.assert_shareable(p)
    flat = json.dumps(p)
    for word in ("atlas_3d_carries", "carries", "alex_example", "person.sam", "0a1b2c3d4e", "alex_phone", "101:202",
                 "atlas_3d_home_idle_s"):
        assert word not in flat, word
    src = _code(_ROOT / "custom_components" / "padspan_ha" / "telemetry.py")
    assert "atlas_3d_carries" not in src and "atlas_3d_home_idle_s" not in src, "the report names neither"


# ═══ the hooks the hosts hand over ════════════════════════════════════════════

def test_the_hosts_hand_over_the_settings_and_the_switches_save() -> None:
    lp = _js(_WWW / "lights_panel.js")
    assert "atlas_3d_carries: s.atlas_3d_carries, atlas_3d_home_idle_s: s.atlas_3d_home_idle_s" in lp
    block = lp[lp.index("house3d: this.state._house3d ?"):]
    block = block[:block.index("} : null,")]
    assert "admin: !!this._hass?.user?.is_admin," in block
    maps = _js(_VIEWS / "maps.js")
    mblock = maps[maps.index("house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?"):]
    mblock = mblock[:mblock.index("} : null,")]
    assert "admin: !!ctx.hass?.user?.is_admin," in mblock and "saveSetting: async (key, v) => {" in mblock
    lm = _js(_VIEWS / "lights_map.js")
    assert ('settings3d: h3.settings, admin: h3.admin === true, saveSetting: typeof h3.saveSetting === "function" '
            '? h3.saveSetting : null,') in lm
    # The flat map's people take the same picks (one place, both views).
    assert "carries: abSet.atlas_3d_carries || null," in lm
    ab = _code(_VIEWS / "atlas_aboard.js")
    assert "carries: d.carries || null" in ab and "export const personCard = TRACKED.personCard;" in ab


def test_the_panel_asks_nothing_of_home_assistant_and_loads_like_the_others() -> None:
    src = _code(_VIEWS / "live_aboard_panel.js")
    for word in ("callWS", "wsCall", "fetch(", "hass", "setInterval", "localStorage", "three"):
        assert word not in src, word
    assert src.count("setTimeout(") == 1, "one timer: going back home"
    la = _js(_VIEWS / "live_aboard.js")
    want = "import(`./live_aboard_panel.js${new URL(import.meta.url).search}`)"
    at = la.index(want)
    assert ".catch(" in la[at:at + 200], "optional: a failure leaves the view as it was"
    assert "callWS" not in la and "wsCall" not in la and "settings_set" not in la
    # People & devices: its only new call is the one setting, alone.
    pp = _code(_VIEWS / "live_aboard_people.js")
    assert pp.count("padspan_ha/settings_set") == 1
    assert 'callWS({ type: "padspan_ha/settings_set", atlas_3d_carries: next })' in pp


def test_the_settings_box_offers_off_and_three_times() -> None:
    sec = _js(_VIEWS / "settings.js")
    assert 'const _ATLAS_3D_IDLE = [[0, "Off"], [30, "After 30 s"], [60, "After 1 min"], [300, "After 5 min"]];' in sec
    box = sec[sec.index("function _atlas3dSection("):]
    box = box[:box.index("\nfunction ")]
    assert 'more.appendChild(row("Back to home view", [idleSel]));' in box
    assert 'save("atlas_3d_home_idle_s", want,' in box
    for words in ("flies back to its home view", "Views ▾ → Set as home", "Edit or Furnish", "a card is open", "full screen"):
        assert words in box, words


def test_new_words_say_live_aboard_never_3d() -> None:
    """Garry's naming: nothing new on screen calls the view "3D"."""
    texts = []
    for p in (_VIEWS / "live_aboard_panel.js", _VIEWS / "live_aboard_people.js", _VIEWS / "live_aboard_tracked.js"):
        texts += re.findall(r'"([^"\n]*)"|`([^`\n]*)`', _code(p))
    words = [a or b for a, b in texts]
    assert not [w for w in words if re.search(r"\b3D\b", w)], [w for w in words if re.search(r"\b3D\b", w)][:5]
