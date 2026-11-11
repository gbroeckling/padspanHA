"""Settings → "Show lengths in feet and inches" (units_feet; owner, 2026-11-12: "Mapping and the helper first").

Off by default, saved like every switch, reported only when on (the existing
on-only feature words). With it on a number typed with no unit is feet, read
on the server (plan_geom.length_read) by the helper's preview and save and by
the upload's hand measurement, end to end on the real stores; one typed with a
unit is read as typed either way; the scale saved is right in metres both
ways. The panel side (the one formatter and every screen it reaches) is
tests/js/units_feet.mjs, run here.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import plan_geom as G
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_maps as WM
from custom_components.padspan_ha import ws_plan_ai as WP
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_plan_build import _call
from tests.test_plan_build_scale import _setup

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _PKG / "www" / "padspan-ha"
_NODE = shutil.which("node")
_FT = 0.3048


def test_a_bare_number_is_feet_only_with_the_switch():
    assert G.length_read("12") == (12.0, "metres") and G.length_read("12", feet=True) == (round(12 * _FT, 6), "feet")
    assert G.length_read("13.75", feet=True) == (round(13.75 * _FT, 6), "feet")
    assert G.length_read("12,5", feet=True)[0] == round(12.5 * _FT, 6)              # a decimal comma too
    assert G.length_read("450") == (0.45, "millimetres")                              # off: as before
    # A unit typed is read as typed, either way.
    for text, metres in (("4.2 m", 4.2), ("420 cm", 4.2), ("13' 9\"", 4.191), ("9 in", 0.2286)):
        assert G.length_read(text)[0] == G.length_read(text, feet=True)[0] == pytest.approx(metres, abs=1e-6)
        assert G.length_read(text, feet=True)[1] is None
    assert G.parse_length("10 + 2", feet=True) == pytest.approx(12 * _FT)
    assert G.parse_length("lots", feet=True) is None


def test_off_by_default_saved_and_reported_only_when_on():
    assert DEFAULT_SETTINGS["units_feet"] is False
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert "units_feet" in keys
    assert '"quiet_mode", "units_feet", "light_theme",' in (_PKG / "ws_settings.py").read_text(encoding="utf-8")
    assert T._FEATURE_ON_ONLY["units_feet"] == "units_feet"  # noqa: SLF001
    assert 'units_feet: "Lengths in feet and inches"' in (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")


def _house(monkeypatch, tmp_path, disk, feet):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    h.data[DOMAIN][DATA_SETTINGS].data["units_feet"] = feet
    return h, conn, mdl, ms


# Half the 1000 px picture's width: 5 m, typed as 16.4042 (feet) with the switch on, as 5 with it off.
_ENDS = {"p1": [0.1, 0.5], "p2": [0.6, 0.5]}


@pytest.mark.parametrize(("feet", "text"), [(True, "16.4042"), (False, "5"), (True, "5 m"), (False, "16' 4 27/32\"")])
def test_the_upload_nudge_reads_and_saves_in_metres(monkeypatch, tmp_path, disk, feet, text):  # noqa: F811
    h, conn, mdl, ms = _house(monkeypatch, tmp_path, disk, feet)
    pv = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{**_ENDS, "text": text}])
    assert pv["metres"][0] == pytest.approx(5.0, abs=1e-3) and pv["across_m"] == pytest.approx(10.0, abs=1e-3)
    assert pv["assumed"] == [("feet" if feet else "metres") if text in ("16.4042", "5") else None]
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{**_ENDS, "text": text}], save=True)
    t = mdl.map_transform("n1")
    assert out["ok"] is True and t["scale_x_m"] == pytest.approx(10.0, abs=1e-3) and t["reference_measurements"][0]["distance_m"] == pytest.approx(5.0, abs=1e-3)


@pytest.mark.parametrize(("feet", "text"), [(True, "16.4042"), (False, "5")])
def test_the_helpers_preview_and_save_read_the_same_way(monkeypatch, tmp_path, disk, feet, text):  # noqa: F811
    h, conn, mdl, ms = _house(monkeypatch, tmp_path, disk, feet)
    pv = _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", measures=[{**_ENDS, "text": text}], via="wizard")
    assert pv["assumed"] == ["feet" if feet else "metres"] and pv["across_m"] == pytest.approx(10.0, abs=1e-3)
    out = _call(WP.ws_plan_build_scale_save, h, conn, map_id="n1", sig="nn", measures=[{**_ENDS, "text": text}], source="guided", via="wizard")
    assert out["ok"] is True and out["across_m"] == pytest.approx(10.0, abs=1e-3)
    assert mdl.map_transform("n1")["scale_x_m"] == pytest.approx(10.0, abs=1e-3)


def test_a_length_that_isnt_one_is_said_in_the_persons_units(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms = _house(monkeypatch, tmp_path, disk, True)
    pv = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{"text": "lots"}])
    assert pv["invalid"] == "Type a length such as 13' 9\", 13.5 or 4.2 m."
    h.data[DOMAIN][DATA_SETTINGS].data["units_feet"] = False
    pv = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{"text": "lots"}])
    assert pv["invalid"] == "Type a length such as 4.2 m, 420 cm or 13' 9\"."


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_panel_harness():
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "units_feet.mjs"), str(_WWW)], capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    out = json.loads(lines[-1])
    assert len(out["cases"]) >= 30 and not out["failures"], json.dumps(out["failures"], indent=1, ensure_ascii=False)
