"""The 3D look's ⋯ "Lights as buttons": the wiring that has no runnable harness of its own.
(What a tap does with it on is run in tests/js/live_aboard_controls.mjs, the "buttons:" case.)"""
import re
from pathlib import Path

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_WWW = _CC / "www" / "padspan-ha"
_VIEWS = _WWW / "views"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_the_line_is_off_until_a_screen_ticks_it_and_is_the_3d_looks_alone() -> None:
    show = _read(_VIEWS / "live_aboard_show.js")
    line = re.search(r'\{ key: "light_buttons"[^\n]*\}', show).group(0)
    assert "dflt: false" in line and "flat: true" not in line and 'group: "lights"' in line
    la = _read(_VIEWS / "live_aboard.js")
    # Only on the Atlas tab and its walls, only while a tap switches lights, never while editing.
    assert "const buttonsOn = () => mapOnly && !!showOn && showOn.light_buttons === true && !showSuspended() && lightTapsOn();" in la
    assert 'for (const g of groups) g.rows = g.rows.filter(r => r.key !== "light_buttons" || mapOnly);' in la


def test_off_a_press_is_picked_as_before() -> None:
    la = _read(_VIEWS / "live_aboard.js")
    pick = la[la.index("  function pickAt(clientX, clientY, noLights = false){"):la.index("  /** Where a target is, in px from the view's own corner")]
    # Every new branch in the picking waits on the line.
    assert pick.count("btnOn") == 4 and "const btnOn = buttonsOn();" in pick
    assert "if (btnOn) {" in pick and "if (btnOn || !L.F.group.visible" in pick and "if (btnOn) { const t = roomTarget(clientX, clientY);" in pick
    assert "const at = buttonsOn() ? roomAtScreen(x, y) : null" in la


def test_the_sheet_for_several_lights_is_the_atlas_own() -> None:
    lm = _read(_VIEWS / "lights_map.js")
    fn = lm[lm.index("export function openLightsSheet(api, lights, eids){"):]
    fn = fn[:fn.index("\n}\n")]
    assert "openAggregateSheet(api, {" in fn and "api.setMany(ids, false)" in fn and "api.setMany(ids, true)" in fn
    assert "api.openLights=(eids)=>openLightsSheet(api, lights, eids);" in _read(_WWW / "lights_panel.js")


def test_the_report_knows_the_line_and_its_taps() -> None:
    from custom_components.padspan_ha import telemetry

    assert "light_buttons" in telemetry.HOUSE3D_SHOW_ITEMS
    for w in ("light", "several", "room"):
        assert f"house3d_show:button_tap:{w}" in telemetry.HOUSE3D_SHOW_EVENTS
        assert f'"house3d_show:button_tap:{w}"' in _read(_VIEWS / "live_aboard_show.js")
    assert 'light_buttons: "lights as buttons"' in _read(_VIEWS / "installbase.js")
