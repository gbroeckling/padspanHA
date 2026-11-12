"""A tap on a device the class chips dim says why nothing happened (a wall left on Motion, 2026-11-12: no light answered
a tap and nothing said so). tools/live_aboard_harness/pw_dimmed.py drives the real view; here the wiring is held."""
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"


def test_a_tap_on_a_dimmed_device_says_so() -> None:
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8")
    note = la[la.index("function dimmedNote(x, y){"):la.index("/** A room tint's strength")]
    # Only on the Atlas tab and its walls, only while a class is picked, and the pick sees dimmed devices for that call alone.
    assert "if (!classF || !mapOnly) return;" in note
    assert "seeDim = true;" in note and "finally { seeDim = false; }" in note
    assert 'h.kind !== "device" || !MARKS.dimmed(lbe[h.eid], classF)' in note
    assert 'classCb ? () => classCb("all") : null, "Show all"' in note
    assert "const dimOf = (eid) => !seeDim && !!(classF && MARKS && MARKS.dimmed(lbe[eid], classF));" in la
    # Said on a single tap on nothing; a double tap still flies to the room.
    assert "flyToRoomAt(e.clientX, e.clientY)) tapAt = null;\n        else dimmedNote(e.clientX, e.clientY);" in la


def test_the_atlas_hands_over_the_chips_setter_and_word() -> None:
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert 'onClassFilter: typeof host.onClassFilter === "function" ? host.onClassFilter : null,' in lm
    assert "classLabel: (LIGHT_CLASSES.find(([c]) => c === host.classFilter) || [])[1] || null," in lm
    tools = _ROOT / "tools" / "live_aboard_harness"
    assert (tools / "pw_dimmed.py").is_file()
    assert '("dimmed", ["pw_dimmed.py"])' in (tools / "run_all.py").read_text(encoding="utf-8")
