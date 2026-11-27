# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The manual's reference tables are the code's.

docs/manual/14-home-assistant-reference.md (entities, attributes, services,
events, Assist, MQTT), docs/manual/20-settings-reference.md (every setting,
its default and range), docs/manual/12-the-screens.md (the menu map, from
panel.js MENU), docs/manual/D-for-developers.md (every websocket command) and
docs/manual/B-every-screen-and-tab.md (every screen and its tabs)
carry blocks made by scripts/build_manual_reference.py. They
fail here when they no longer match what the code makes, and the script
itself refuses an entity, attribute, event field, setting or screen the code
has and the script gives no words for, or words for one the code no longer
has. When this fails, run

    python scripts/build_manual_reference.py

and commit what it wrote (or, when it stops with an error, add the line it asks
for in the script first).

Also here: every relative link in the manual points at a file that exists, and
an anchor in it at a heading that file has.
"""
from __future__ import annotations

import copy
import importlib.util
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_manual_reference.py"
MANUAL = ROOT / "docs" / "manual"

pytestmark = pytest.mark.skipif(not SCRIPT.is_file() or not MANUAL.is_dir(),
                                reason="the Bright derivation carries no docs/ or scripts/")


def _load():
    spec = importlib.util.spec_from_file_location("build_manual_reference", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


B = _load() if SCRIPT.is_file() else None


def test_the_committed_tables_are_what_the_code_makes() -> None:
    bad = B.stale()
    assert not bad, ("These generated blocks no longer match the code. Run "
                     "`python scripts/build_manual_reference.py` and commit the result:\n" + "\n".join(bad))


def test_every_entity_class_has_words() -> None:
    assert {(e["module"], e["cls"]) for e in B.ENTITIES} == B.entity_classes_in_code()


def test_the_services_described_are_the_ones_registered() -> None:
    import yaml
    listed = set(yaml.safe_load((ROOT / "custom_components" / "padspan_ha" / "services.yaml").read_text(encoding="utf-8")))
    assert listed == B.registered_services() == {"set_room_tag_map", "dump_devices", "wled_on", "wled_off", "reload_screens", "announce"}


def test_every_event_is_described() -> None:
    assert set(B.EVENTS) == set(B.events_in_code())


@pytest.mark.parametrize("what", ["attribute", "event field", "entity"])
def test_it_refuses_code_it_has_no_words_for(monkeypatch, what) -> None:
    """A new attribute, event field or entity in the code, with nothing said about it here, stops the build."""
    if what == "attribute":
        entities = copy.deepcopy(B.ENTITIES)
        del entities[1]["attributes"]["last_room"]
        monkeypatch.setattr(B, "ENTITIES", entities)
    elif what == "event field":
        events = copy.deepcopy(B.EVENTS)
        del events["padspan_room_change"]["data"]["to_room"]
        monkeypatch.setattr(B, "EVENTS", events)
    else:
        monkeypatch.setattr(B, "ENTITIES", [e for e in B.ENTITIES if e["cls"] != "PadSpanGuestHome"])
    with pytest.raises(B.ReferenceError_):
        B.blocks()


def test_it_refuses_words_for_what_the_code_no_longer_has(monkeypatch) -> None:
    entities = copy.deepcopy(B.ENTITIES)
    entities[0]["attributes"]["battery"] = "A battery the tracker never reports."
    monkeypatch.setattr(B, "ENTITIES", entities)
    with pytest.raises(B.ReferenceError_):
        B.blocks()


def test_every_setting_has_words_and_a_place() -> None:
    """Each key in DEFAULT_SETTINGS and the settings_set schema is in the settings table, once."""
    keys = B.setting_keys()
    assert set(keys) == set(B.SETTINGS_ENTRIES)
    assert {"away_timeout_m", "room_change_delay_s", "kalman_q", "lights_panel_enabled"} <= set(keys)
    text = (MANUAL / "20-settings-reference.md").read_text(encoding="utf-8")
    for key in keys:
        assert text.count(f"`{key}`") >= 1, key


def test_defaults_and_ranges_come_from_the_code() -> None:
    """The figures the docs audit found wrong in the help (Q 0.125, up to 1.0) are read, not typed."""
    ranges = B.setting_ranges()
    assert B.default_settings()["kalman_q"] == 3.0 and ranges["kalman_q"] == "0.01 to 10"
    assert ranges["away_timeout_m"] == "1 to 1440" and B.setting_default("away_timeout_m") == (True, 5)
    assert ranges["object_history_days"] == "`1`, `2`, `7`, `14`"


@pytest.mark.parametrize("what", ["missing", "gone", "label"])
def test_it_refuses_a_setting_it_cannot_place(monkeypatch, what) -> None:
    """A setting with no entry, an entry for a setting gone, or words the screen does not show, stop it."""
    entries = dict(B.SETTINGS_ENTRIES)
    if what == "missing":
        del entries["away_timeout_m"]
    elif what == "gone":
        entries["presence_mode"] = ("Settings → Tracking → Rooms and timing", "Presence", "", "A setting that is gone.")
    else:
        where, card, _control, text = entries["away_timeout_m"]
        entries["away_timeout_m"] = (where, card, "Away time-out (minutes)", text)
    monkeypatch.setattr(B, "SETTINGS_ENTRIES", entries)
    with pytest.raises(B.ReferenceError_):
        B.blocks()


def test_the_menu_map_is_the_panels_menu() -> None:
    """Chapter 12's menu map is read from panel.js: every screen, once, in its place in each mode."""
    code = B.menu_in_code()
    ids = [i for i, _ in code["menu"]]
    assert set(ids) == set(B.SCREENS) and len(ids) == len(set(ids))
    assert set(code["gated"]) == set(B.SHOWN_WHEN) == {"forensics", "guests", "setup", "wifi", "energy"}
    assert {"follow", "overview", "calibration"} <= set(code["basic"]) and "purelive" not in code["basic"]
    assert {"purelive", "traceback", "health"} <= set(code["advanced"]) and "devices" not in code["advanced"]
    assert {"forensics", "guests"} <= set(code["every_mode"])
    assert [g for g, _ in code["groups"]] == ["Live", "Build", "Diagnose", "Internals"]
    text = (MANUAL / "12-the-screens.md").read_text(encoding="utf-8")
    block = B.committed_block(text, "menu")
    for _i, name in code["menu"]:
        assert f"| **{name}** |" in block, name


@pytest.mark.parametrize("what", ["screen", "gone", "gate"])
def test_it_refuses_a_screen_it_has_no_words_for(monkeypatch, what) -> None:
    """A screen added to MENU with no words, words for a screen gone, or a gate nobody described, stop the build."""
    screens, shown = dict(B.SCREENS), dict(B.SHOWN_WHEN)
    if what == "screen":
        del screens["occupancy"]
    elif what == "gone":
        screens["zones"] = "A screen the menu no longer has."
    else:
        del shown["guests"]
    monkeypatch.setattr(B, "SCREENS", screens)
    monkeypatch.setattr(B, "SHOWN_WHEN", shown)
    with pytest.raises(B.ReferenceError_):
        B.blocks()


def test_the_tables_name_what_people_automate_with() -> None:
    """The reference parts the docs audit found documented nowhere (2026-11-21)."""
    text = (MANUAL / "14-home-assistant-reference.md").read_text(encoding="utf-8")
    for needed in ("`last_room`", "`room_reason`", "`padspan_ha.set_room_tag_map`", "`padspan_ha.wled_on`",
                   "`padspan_ha.wled_off`", "`padspan_device_departed`", "`PadSpanWhereIs`"):
        assert needed in text, needed


def test_every_screen_and_its_tabs_are_read_from_the_panel() -> None:
    """Appendix B: each menu screen once, and the tabs of the screens that have them, as the panel labels them."""
    tabs = B.screen_tabs_in_code()
    assert "Atlas builder" in tabs["maps"] and "Tracking" in tabs["settings"] and "Model" in tabs["calibration"]
    assert "Factory Reset" in tabs["manage"] and "IRK Manager" in tabs["bluetooth"]
    block = B.committed_block((MANUAL / "B-every-screen-and-tab.md").read_text(encoding="utf-8"), "screens")
    for _i, name in B.menu_in_code()["menu"]:
        assert block.count(f"| **{name}** |") == 1, name
    for labels in tabs.values():
        for label in labels:
            assert f"**{label}**" in block, label


def test_the_websocket_table_is_every_registered_command() -> None:
    """Appendix D lists each websocket command the code declares and registers, once, with who may send it."""
    cmds = B.ws_commands_in_code()
    assert len(cmds) > 200 and len({c["type"] for c in cmds}) == len(cmds)
    block = B.committed_block((MANUAL / "D-for-developers.md").read_text(encoding="utf-8"), "websocket")
    for c in cmds:
        assert f"| `{c['type']}` |" in block, c["type"]
    by_type = {c["type"]: c for c in cmds}
    assert by_type["padspan_ha/irk_validate"]["admin"] == "always"
    assert by_type["padspan_ha/irk_validate"]["fields"] == ["`irk_hex`"]
    assert any(c["admin"] == "with Enhanced security" for c in cmds)


def test_the_websocket_table_reads_as_words_for_people() -> None:
    """A handler whose first sentence is a note to a developer gets a line written for the table
    (WS_WHAT); one for a command that is gone stops the build; no row is dated or names the owner."""
    cmds = {c["type"]: c for c in B.ws_commands_in_code()}
    for ctype, words in B.WS_WHAT.items():
        assert cmds[ctype]["what"] == words
    assert not [t for t, c in cmds.items() if re.search(r"\b20\d\d-\d\d|\bowner\b|\bPhase \d", c["what"])]
    saved = dict(B.WS_WHAT)
    try:
        B.WS_WHAT["padspan_ha/no_such_command"] = "Gone."
        with pytest.raises(B.ReferenceError_):
            B.ws_commands_in_code()
    finally:
        B.WS_WHAT.clear()
        B.WS_WHAT.update(saved)


# ── links ───────────────────────────────────────────────────────────────────

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")


def _slug(heading: str) -> str:
    """GitHub's anchor for a heading: lower case, marks dropped, spaces as hyphens."""
    s = re.sub(r"[`*_]", "", heading.strip().lower())
    s = re.sub(r"[^\w\- ]", "", s)
    return s.replace(" ", "-")


def _anchors(path: Path) -> set[str]:
    return {_slug(m.group(1)) for m in re.finditer(r"^#{1,6} (.+)$", path.read_text(encoding="utf-8"), re.M)}


def test_every_relative_link_in_the_manual_resolves() -> None:
    bad = []
    for page in sorted(MANUAL.glob("*.md")):
        for m in LINK.finditer(page.read_text(encoding="utf-8")):
            target = m.group(1)
            if re.match(r"[a-z]+:", target):
                continue
            file_part, _, anchor = target.partition("#")
            dest = (page.parent / file_part).resolve() if file_part else page
            if not dest.exists():
                bad.append(f"{page.name}: {target} (no such file)")
            elif anchor and dest.suffix == ".md" and anchor not in _anchors(dest):
                bad.append(f"{page.name}: {target} (no such heading)")
    assert not bad, "\n".join(bad)
