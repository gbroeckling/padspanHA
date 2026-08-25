# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""`fabric_map_transform_set` takes a `transform` dict and stores it.

Two holes, both on the field that decides how big the house is.

**The scales were never sanitised.** The pose fields are — origin, rotation
and σ all come through `float(... or 0)` with a finite check — and the two
scales, which are the only fields whose VALUE can make a later conversion
raise, went straight to disk. `scale_x_m: null` is a `TypeError` in BOTH
`map_frac_to_metres` and `metres_to_map_frac`, i.e. every scanner, beacon,
barrier and calibration point on that map; `scale_x_m: 0` is worse, because it
does not raise — it is a singular matrix that answers the origin for every
point across the map and refuses every point back.

Reachable from the panel it ships with: Save Scale computes
`Math.round((imgW / ppm) * 10000) / 10000`, and `JSON.stringify(Infinity)` is
`null`, so a zero px/m posts a null scale rather than an error.

**The same write DROPPED `reference_measurements`.** The record is replaced by
the payload, so a caller that does not carry the provenance un-measures the
map — the identical "absent means delete" defect already fixed for σ, on the
field that decides whether a map can anchor the whole house to metres. Losing
it is not cosmetic: `measure_world_gauge` skips an unmeasured map, and with no
anchor anywhere the stack has no metre scale at all.

Both are now the writer's job, so no caller has to remember.
"""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.const import DATA_MODEL, DOMAIN
from custom_components.padspan_ha.model_store import ModelStore
from custom_components.padspan_ha.ws_fabric import ws_fabric_map_transform_set
from tests.conftest import seed_world_gauge


_MEASURED = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
             "scale_y_m": 15.0, "rotation_rad": 0.0, "floor_id": "main",
             "origin_anchored": True,
             "reference_measurements": [{"p1": [0.1, 0.5], "p2": [0.6, 0.5],
                                         "distance_m": 10.0, "px_per_meter": 80.0}]}

_MAP = {"id": "m1", "floor_id": "main", "name": "Ground",
        "image": {"width": 1600, "height": 1200},
        "stack": {"is_master": True, "scale": 1.0, "scale_x_adj": 1.0,
                  "ref_ar": 0.75, "rotation": 0, "x_offset": 0, "y_offset": 0}}

# What Save Scale posts, minus the scale it could not compute. Five fields and
# the measurements, exactly as `views/maps.js` builds them.
_SAVE = {"origin_x_m": 0.0, "origin_y_m": 0.0, "rotation_rad": 0.0,
         "floor_id": "main",
         "reference_measurements": [{"p1": [0.1, 0.5], "p2": [0.6, 0.5],
                                     "distance_m": 10.0, "px_per_meter": 80.0}]}


def _store(transform: dict | None = _MEASURED) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock()
    s.store = AsyncMock()
    s.store.async_save = AsyncMock()
    s.data = {"map_transforms": {"m1": dict(transform)} if transform else {}}
    seed_world_gauge(s, [_MAP])
    s.fabric = None
    return s


async def _post(mdl: ModelStore, transform: dict) -> MagicMock:
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl}}
    conn = MagicMock()
    await ws_fabric_map_transform_set(
        hass, conn, {"id": 1, "map_id": "m1", "transform": transform})
    return conn


# ── the scales ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [None, 0, 0.0, -20.0, "twenty", float("nan"),
                                 float("inf")],
                         ids=["null", "int zero", "float zero", "negative",
                              "string", "nan", "inf"])
@pytest.mark.asyncio
async def test_an_unusable_scale_does_not_reach_the_record(bad) -> None:
    """A payload that does not state a usable scale has not restated it."""
    mdl = _store()
    await _post(mdl, {**_SAVE, "scale_x_m": bad, "scale_y_m": 15.0})

    t = mdl.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == 20.0, f"{bad!r} reached the record as {t['scale_x_m']!r}"
    # …and the conversions still answer, in both directions.
    assert mdl.map_frac_to_metres(1.0, 1.0, "m1") == (20.0, 15.0)
    assert mdl.metres_to_map_frac(20.0, 15.0, "m1") == pytest.approx((1.0, 1.0))


@pytest.mark.parametrize("bad,raises", [(None, True), (0.0, False)],
                         ids=["null", "zero"])
def test_the_control_what_the_reader_does_with_one(bad, raises) -> None:
    """Why it has to be caught at the writer: the reader cannot.

    `float(None)` raises, so a null scale takes out every conversion on that
    map — and a zero does not raise at all, which is worse: it answers the
    origin for every point across a 20 m map and refuses every one of them
    back, so positions collapse onto one spot instead of erroring.
    """
    mdl = _store({**_MEASURED, "scale_x_m": bad})
    if raises:
        with pytest.raises(TypeError):
            mdl.map_frac_to_metres(1.0, 0.5, "m1")
        with pytest.raises(TypeError):
            mdl.metres_to_map_frac(10.0, 7.5, "m1")
    else:
        assert mdl.map_frac_to_metres(1.0, 0.5, "m1") == (0.0, 7.5), (
            "a zero scale used to answer the origin for every x on the map"
        )
        assert mdl.metres_to_map_frac(10.0, 7.5, "m1") is None


@pytest.mark.asyncio
async def test_a_usable_scale_is_still_the_payloads_to_state() -> None:
    """Not a blanket refusal — a re-measure is exactly what this endpoint is
    for, and it must land."""
    mdl = _store()
    await _post(mdl, {**_SAVE, "scale_x_m": 25.5, "scale_y_m": 17.25})
    t = mdl.data["map_transforms"]["m1"]
    assert (t["scale_x_m"], t["scale_y_m"]) == (25.5, 17.25)


@pytest.mark.asyncio
async def test_with_nothing_stored_the_key_is_dropped_not_faked() -> None:
    """A map that never had a scale and is handed a null does not get one.

    Absent is a state every reader already handles — `measure_world_gauge`
    skips it, `map_geometry_faults` skips it — and it is the honest one.
    Storing a null instead would break both of them on the next read.
    """
    mdl = _store(None)
    await _post(mdl, {"origin_x_m": 0.0, "origin_y_m": 0.0, "rotation_rad": 0.0,
                      "scale_x_m": None, "scale_y_m": None, "floor_id": "main"})
    t = mdl.data["map_transforms"]["m1"]
    assert "scale_x_m" not in t and "scale_y_m" not in t
    assert fabric_truth.measure_world_gauge([_MAP], mdl) is None
    # It is reported as UNPLACED, which is what it is: a picture nobody has
    # measured. Before R3 such a map still drew, through its stack, so the
    # honest answer was silence; it cannot be drawn at all now.
    _f = fabric_truth.map_geometry_faults([_MAP], mdl)
    assert [x["terms"] for x in _f] == [["unplaced"]]
    assert mdl.map_frac_to_metres(1.0, 1.0, "m1") == (1.0, 1.0)


@pytest.mark.asyncio
async def test_a_null_already_on_disk_is_not_carried_back() -> None:
    """The upgrade case, which is the whole reason this endpoint matters.

    A record written before the sanitise existed already holds the null. The
    writer's other rule is that a key the payload does not state is carried
    from the old record — so dropping the key alone would put the stored null
    straight back, and the map would still take out every conversion on it.
    """
    mdl = _store({**_MEASURED, "scale_x_m": None, "scale_y_m": None})
    await _post(mdl, {"origin_x_m": 0.0, "origin_y_m": 0.0, "rotation_rad": 0.0,
                      "scale_x_m": None, "scale_y_m": None, "floor_id": "main"})
    t = mdl.data["map_transforms"]["m1"]
    assert "scale_x_m" not in t and "scale_y_m" not in t
    assert mdl.map_frac_to_metres(1.0, 1.0, "m1") == (1.0, 1.0)
    # …and the measurement is still there, so a re-measure lands on a record
    # that still knows it was measured.
    assert t.get("reference_measurements")


# ── the measurements ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_payload_that_says_nothing_does_not_un_measure_the_map() -> None:
    """The σ rule, on the field that decides whether a map is measured."""
    mdl = _store()
    await _post(mdl, {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                      "scale_y_m": 15.0, "rotation_rad": 0.0, "floor_id": "main"})

    t = mdl.data["map_transforms"]["m1"]
    assert t.get("reference_measurements") == _MEASURED["reference_measurements"]
    anchor = fabric_truth.measure_world_gauge([_MAP], mdl)
    assert anchor is not None and anchor["source_map_id"] == "m1", (
        "the house lost its metre anchor to a write that never mentioned it"
    )


@pytest.mark.asyncio
async def test_the_control_the_house_has_no_metre_scale_without_it() -> None:
    """What the drop costs, stated in the thing that stops working.

    No measured map anywhere means no metre anchor, and with no anchor the
    stack cannot be converted to metres at all — `rooms_from_stack` has no
    scale, Repair Positioning reports `anchor_missing`, and Rebuild Stack
    refuses with `no_metre_anchor`. One websocket call.
    """
    mdl = _store({k: v for k, v in _MEASURED.items()
                  if k != "reference_measurements"})
    assert fabric_truth.measure_world_gauge([_MAP], mdl) is None


@pytest.mark.asyncio
async def test_a_re_measure_still_replaces_them() -> None:
    """Stating the field is how it changes — that half is unchanged."""
    mdl = _store()
    fresh = [{"p1": [0.0, 0.0], "p2": [1.0, 0.0], "distance_m": 22.0,
              "px_per_meter": 72.7}]
    await _post(mdl, {**_SAVE, "scale_x_m": 22.0, "scale_y_m": 16.5,
                      "reference_measurements": fresh})
    assert mdl.data["map_transforms"]["m1"]["reference_measurements"] == fresh


@pytest.mark.asyncio
async def test_the_reply_still_reports_what_was_stored() -> None:
    """The panel prints these back at the user, so they must be the record's
    and not the payload's."""
    mdl = _store()
    conn = await _post(mdl, {**_SAVE, "scale_x_m": None, "scale_y_m": None})
    res = conn.send_result.call_args[0][1]
    assert (res["scale_x_m"], res["scale_y_m"]) == (20.0, 15.0)
    assert res["refs"] == 1


# ── who may call it, and the third field it deleted ──────────────────────────
#
# This handler writes where a map SITS. Every scanner, beacon, barrier and
# calibration point on it converts through the record, `measure_world_gauge`
# reads it to pin the whole house to metres, and `floor_id` decides which
# storey the rooms are drawn on. Its three siblings — align_to_stack,
# stack_rebuild and reanchor — have always required an admin; this one did
# not, so any authenticated HA user could move any map in the building.
#
# And `floor_id` was the third field on the "absent means delete" list, after
# σ and `reference_measurements`: `transform.setdefault("floor_id",
# DEFAULT_FLOOR_ID)` meant a payload that did not mention a floor moved the
# record to 'main'.

def test_the_command_is_admin_only_like_its_three_siblings() -> None:
    """Checked on the shipped decorator stack, because `require_admin` is a
    decorator and a unit call goes straight past it."""
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "custom_components" /
           "padspan_ha" / "ws_fabric.py").read_text(encoding="utf-8")
    # Two of the four siblings are deleted with the second copy of the
    # placement they repaired; these are the writers that remain.
    for name in ("ws_fabric_map_transform_set", "ws_fabric_map_reanchor"):
        i = src.index(f"async def {name}")
        assert "require_admin" in src[max(0, i - 500):i], (
            f"{name} rewrites a map's placement without an admin check"
        )


@pytest.mark.asyncio
async def test_a_payload_that_does_not_mention_a_floor_does_not_move_the_map() -> None:
    """Save Scale on a map on the upper storey used to send it to 'main'."""
    mdl = _store({**_MEASURED, "floor_id": "upper"})
    await _post(mdl, {k: v for k, v in _SAVE.items() if k != "floor_id"}
                | {"scale_x_m": 22.0, "scale_y_m": 16.5})
    assert mdl.data["map_transforms"]["m1"]["floor_id"] == "upper"


@pytest.mark.asyncio
async def test_stating_a_floor_still_moves_it() -> None:
    """Carried is not frozen — the other half of the same rule."""
    mdl = _store({**_MEASURED, "floor_id": "upper"})
    await _post(mdl, {**_SAVE, "floor_id": "attic",
                      "scale_x_m": 22.0, "scale_y_m": 16.5})
    assert mdl.data["map_transforms"]["m1"]["floor_id"] == "attic"


@pytest.mark.asyncio
async def test_a_first_measurement_still_gets_a_floor() -> None:
    """With nothing stored there is nothing to carry, and a record with no
    floor at all matches no storey — `presence_coordinator` compares it by
    equality."""
    mdl = _store(None)
    await _post(mdl, {"origin_x_m": 0.0, "origin_y_m": 0.0, "rotation_rad": 0.0,
                      "scale_x_m": 20.0, "scale_y_m": 15.0})
    assert mdl.data["map_transforms"]["m1"]["floor_id"] == "main"
