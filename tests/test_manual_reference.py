# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The manual's reference tables are the code's.

docs/manual/14-home-assistant-reference.md (entities, attributes, services,
events, Assist, MQTT) and docs/manual/20-settings-reference.md (every setting,
its default and range) carry blocks made by scripts/build_manual_reference.py.
They fail here when they no longer match what the code makes, and the script
itself refuses an entity, attribute, event field or setting the code has and
the script gives no words for, or words for one the code no longer has. When
this fails, run

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
    assert listed == B.registered_services() == {"set_room_tag_map", "dump_devices", "wled_on", "wled_off"}


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


def test_the_tables_name_what_people_automate_with() -> None:
    """The reference parts the docs audit found documented nowhere (2026-11-21)."""
    text = (MANUAL / "14-home-assistant-reference.md").read_text(encoding="utf-8")
    for needed in ("`last_room`", "`room_reason`", "`padspan_ha.set_room_tag_map`", "`padspan_ha.wled_on`",
                   "`padspan_ha.wled_off`", "`padspan_device_departed`", "`PadSpanWhereIs`"):
        assert needed in text, needed


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
