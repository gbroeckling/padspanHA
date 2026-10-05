# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard's Strip tool: where an LED strip or a string of lights really
goes, in the 3D file (house3d_edit's lights[<entity id>].run).

Garry, 2026-10-05: "Need to build a tool for better height and area placement
for string lights ... a step farther for Sims." A run is a light's polyline
(2 to 64 points, x and y on its floor, h above it), which way it shines, a
loop or not, on a piece of furniture or not, and a string's swag and bulb
spacing. Held here:
- checked strictly on the way in: the points, their bounds, each stretch at
  least 5 cm, at most 100 m in all, the face, the piece's id, sag, spacing,
  loop and the stretches that are only wire (gaps);
- owned with the light's height and kind: the editor's entry is its whole, so
  leaving the run out removes it, and a newer key beside it is kept;
- an older PadSpan (0.38.99) owns only the height and the kind: its saves
  keep the run (the owned-keys merge), so nothing of a run is lost there;
- a piece removed (in the same save, or by "Remove all furniture") takes no
  strip with it: the run stays where it was, as plain points;
- a run on a piece that is not there is refused.
"""

from __future__ import annotations

import copy
import json
import math

import pytest

from custom_components.padspan_ha import house3d_store as H
from tests.test_house3d_edit import _edit, _file, _on, _seed, disk  # noqa: F401
from tests.test_house3d_pieces import _clear, _sofa
from tests.test_house3d_store import _capture_backups  # noqa: F401

_RUN = {"pts": [[1.0, 0.02, 1.4], [3.5, 0.02, 1.4], [3.5, 2.0, 1.4]], "face": "down", "loop": False}
_LOOP = {"pts": [[0.02, 0.02, 2.5], [5.98, 0.02, 2.5], [5.98, 4.98, 2.5], [0.02, 4.98, 2.5]], "face": "up", "loop": True,
         "gaps": [2]}
_STRING = {"pts": [[0.0, 0.0, 2.4], [4.0, 0.0, 2.4], [4.0, 3.0, 2.2]], "face": "room", "loop": False,
           "sag_m": 0.3, "spacing_m": 0.4}


def _set(entry: dict, base: dict | None = None) -> dict:
    return H.apply_edit(base or H.empty(), {"lights": {"light.a": entry}})


# ═══ checked on the way in ════════════════════════════════════════════════════

@pytest.mark.parametrize("run", [_RUN, _LOOP, _STRING, {**_RUN, "piece": "fur_1a2b3c4d"}])
def test_a_good_run_is_kept_as_sent(run):
    base = {**H.empty(), "pieces": {"fur_1a2b3c4d": _sofa()}}
    out = _set({"kind": "string" if "sag_m" in run else "undercab", "run": copy.deepcopy(run)}, base)
    assert out["lights"]["light.a"]["run"] == run


def test_a_run_alone_and_beside_a_height_and_a_kind():
    out = H.apply_edit(H.empty(), {"lights": {"light.a": {"run": _RUN}, "light.b": {"z_m": 1.0, "kind": "tv", "run": _LOOP}}})
    assert out["lights"] == {"light.a": {"run": _RUN}, "light.b": {"z_m": 1.0, "kind": "tv", "run": _LOOP}}


def test_points_are_kept_to_the_millimetre_and_gaps_in_order():
    run = {**_LOOP, "pts": [[0.0001, 0.0, 2.50049], [6.0, 0.0, 2.5], [6.0, 5.0, 2.5], [0.0, 5.0, 2.5]], "gaps": [3, 0]}
    out = _set({"run": run})["lights"]["light.a"]["run"]
    assert out["pts"][0] == [0.0, 0.0, 2.5] and out["gaps"] == [0, 3]


@pytest.mark.parametrize("run,says", [
    ("not a run", "a run is"),
    ({"pts": [[0, 0, 1], [1, 0, 1]], "face": "up"}, "a run is"),                       # no loop
    ({**_RUN, "colour": "red"}, "a run is"),                                           # a key it does not have
    ({**_RUN, "pts": [[0, 0, 1]]}, "2 to 64 points"),
    ({**_RUN, "pts": [[i * 0.1, 0, 1] for i in range(65)]}, "2 to 64 points"),
    ({**_RUN, "pts": "0,0,1"}, "2 to 64 points"),
    ({**_RUN, "pts": [[0, 0], [1, 0]]}, "[x, y, height]"),
    ({**_RUN, "pts": [[0, 0, 1], [1, 0, 1, 2]]}, "[x, y, height]"),
    ({**_RUN, "pts": [[0, 0, 1], [1, "0", 1]]}, "run point 2 y"),
    ({**_RUN, "pts": [[0, 0, 1], [1, 0, True]]}, "run point 2 height"),
    ({**_RUN, "pts": [[0, 0, 1], [1, 0, float("nan")]]}, "run point 2 height"),
    ({**_RUN, "pts": [[0, 0, -0.01], [1, 0, 1]]}, "run point 1 height"),
    ({**_RUN, "pts": [[0, 0, 10.5], [1, 0, 1]]}, "run point 1 height"),
    ({**_RUN, "pts": [[20000, 0, 1], [1, 0, 1]]}, "run point 1 x"),
    ({**_RUN, "pts": [[0, 0, 1], [0.03, 0, 1], [2, 0, 1]]}, "at least 5 cm"),
    ({**_RUN, "pts": [[0, 0, 1], [2, 0, 1], [2, 0, 1.01]]}, "at least 5 cm"),
    ({**_LOOP, "pts": [[0, 0, 1], [2, 0, 1], [0.0, 0.04, 1]]}, "at least 5 cm"),           # the closing stretch too
    ({**_RUN, "pts": [[0, 0, 1], [60, 0, 1], [60, 50, 1]]}, "at most 100 m"),
    ({**_LOOP, "pts": [[0, 0, 1], [40, 0, 1], [40, 30, 1]], "gaps": []}, "at most 100 m"),   # 40 + 30 + 50 round
    ({**_RUN, "face": "sideways"}, "face must be one of up, down, room, wall"),
    ({**_RUN, "face": None}, "face must be one of"),
    ({**_RUN, "loop": 1}, "loop must be true or false"),
    ({**_RUN, "loop": True, "pts": [[0, 0, 1], [1, 0, 1]]}, "at least 3 points"),
    ({**_RUN, "piece": "sofa"}, "piece's id"),
    ({**_RUN, "piece": None}, "piece's id"),
    ({**_STRING, "sag_m": 1.6}, "sag_m"),
    ({**_STRING, "sag_m": -0.1}, "sag_m"),
    ({**_STRING, "spacing_m": 0.1}, "spacing_m"),
    ({**_STRING, "spacing_m": 2.5}, "spacing_m"),
    ({**_STRING, "spacing_m": "40"}, "spacing_m"),
    ({**_LOOP, "gaps": [4]}, "gaps"),                       # a loop of 4 points has stretches 0 to 3
    ({**_LOOP, "gaps": [1, 1]}, "gaps"),
    ({**_LOOP, "gaps": [0, 1, 2, 3]}, "gaps"),               # all of it wire: no light at all
    ({**_LOOP, "gaps": [True]}, "gaps"),
    ({**_LOOP, "gaps": "2"}, "gaps"),
    ({**_RUN, "gaps": [2]}, "gaps"),                        # an open run of 3 points has stretches 0 and 1
])
def test_a_bad_run_is_refused_plainly(run, says):
    with pytest.raises(H.EditError) as err:
        _set({"kind": "strip", "run": run})
    assert says in str(err.value), str(err.value)


def test_a_bad_run_writes_nothing(disk, tmp_path):  # noqa: F811
    _seed(tmp_path, {**H.empty(), "lights": {"light.a": {"run": _RUN}}})
    before = _file(tmp_path).read_bytes()
    h, conn = _on(tmp_path)
    out = _edit(h, conn, lights={"light.a": {"run": {**_RUN, "face": "sideways"}}, "light.b": {"z_m": 1.0}})
    assert "error" in out and "face must be one of" in out["message"], out
    assert _file(tmp_path).read_bytes() == before


def test_at_most_100_m_exactly_and_5_cm_exactly_are_kept():
    out = _set({"run": {**_RUN, "pts": [[0, 0, 1], [0.05, 0, 1], [100.0, 0, 1]]}})["lights"]["light.a"]["run"]
    assert math.isclose(sum(math.dist(a, b) for a, b in zip(out["pts"], out["pts"][1:])), 100.0)


# ═══ owned with the height and the kind ═══════════════════════════════════════

def test_the_editors_entry_is_its_whole_leaving_the_run_out_removes_it():
    base = _set({"z_m": 1.4, "kind": "undercab", "run": _RUN})
    out = H.apply_edit(base, {"lights": {"light.a": {"kind": "undercab"}}})
    assert out["lights"]["light.a"] == {"kind": "undercab"}


def test_removing_the_light_entry_removes_its_run_and_keeps_a_newer_key():
    base = {**H.empty(), "lights": {"light.a": {"run": _RUN, "future": [1]}}}
    out = H.apply_edit(base, {"lights": {"light.a": None}})
    assert out["lights"]["light.a"] == {"future": [1]}


# ═══ an older PadSpan (0.38.99) ═══════════════════════════════════════════════
# 0.38.99's editor reads only z_m and kind of a light (live_aboard_draft.js
# ownedOf) and its server owns only those two (_LIGHT_OWNED): every key it does
# not own is kept by the owned-keys merge. So what it sends — a height, a kind,
# both, or null for "back to PadSpan's guess" — never touches a run. The
# entries below are exactly what 0.38.99's Heights tool sends.

def _light_entry_0_38_99(k: str, v: dict) -> dict:
    """0.38.99's own check of a light's entry, word for word."""
    if not v or set(v) - frozenset(("z_m", "kind")):
        raise H.EditError(f"{k}: a light has a height {{z_m}} and/or a kind {{kind}}")
    out = {}
    if "z_m" in v:
        out["z_m"] = H._num(v["z_m"], 0.0, H.HEIGHT_MAX_M, f"{k} z_m")
    if "kind" in v:
        if not isinstance(v["kind"], str) or not H._KIND.fullmatch(v["kind"]):
            raise H.EditError(f"{k}: kind must be a short word (a-z, 0-9 and _)")
        out["kind"] = v["kind"]
    return out


@pytest.fixture
def server_0_38_99(monkeypatch):
    """This server with 0.38.99's rules for a light: it owns z_m and kind only."""
    monkeypatch.setattr(H, "_LIGHT_OWNED", frozenset(("z_m", "kind")))
    monkeypatch.setattr(H, "_light_entry", _light_entry_0_38_99)


@pytest.mark.parametrize("old_editor_sends,left", [
    ({"z_m": 1.9}, {"z_m": 1.9}),
    ({"z_m": 1.9, "kind": "valance"}, {"z_m": 1.9, "kind": "valance"}),
    ({"kind": "undercab"}, {"kind": "undercab"}),
    (None, {}),                                     # Reset, with no kind set: "back to PadSpan's guess"
])
def test_an_older_padspans_heights_save_keeps_the_run(server_0_38_99, old_editor_sends, left):
    base = {**H.empty(), "lights": {"light.a": {"z_m": 1.4, "kind": "undercab", "run": _RUN}}}
    out = H.apply_edit(base, {"lights": {"light.a": old_editor_sends}})
    assert out["lights"]["light.a"] == {**left, "run": _RUN}


def test_an_older_padspan_never_sends_a_run_and_would_refuse_one(server_0_38_99):
    with pytest.raises(H.EditError, match="a height"):
        H.apply_edit(H.empty(), {"lights": {"light.a": {"kind": "strip", "run": _RUN}}})


def test_the_run_is_inside_the_light_entry_so_older_readers_and_backups_keep_it_whole():
    data = H.normalise({**H.empty(), "lights": {"light.a": {"run": _LOOP, "kind": "cove"}}})
    assert data["lights"]["light.a"]["run"] == _LOOP and H.writable(data)
    assert data["schema"] == H.SCHEMA == 1, "no new schema: an older PadSpan still edits the file"


# ═══ on a piece of furniture ══════════════════════════════════════════════════

def test_piece_point_is_the_pieces_own_frame():
    p = _sofa(x_m=2.0, y_m=1.0, z_m=0.5, rotation=90.0)
    # across (cos, sin) = (0, 1) and to the front (-sin, cos) = (-1, 0) at 90°.
    assert H.piece_point(p, [1.0, 0.0, 0.2]) == [2.0, 2.0, 0.7]
    assert H.piece_point(p, [0.0, 0.5, 0.0]) == [1.5, 1.0, 0.5]
    assert H.piece_point(_sofa(x_m=0, y_m=0, z_m=0, rotation=0.0), [0.3, -0.2, 1.0]) == [0.3, -0.2, 1.0]


def test_a_piece_removed_in_the_same_save_leaves_its_run_where_it_was():
    sofa = _sofa(x_m=2.0, y_m=1.0, z_m=0.0, rotation=90.0)
    base = H.apply_edit({**H.empty(), "pieces": {sofa["id"]: sofa}},
                        {"lights": {"light.a": {"kind": "undercab", "run": {**_RUN, "piece": sofa["id"]}}}})
    out = H.apply_edit(base, {"pieces": {sofa["id"]: None}})
    run = out["lights"]["light.a"]["run"]
    assert "piece" not in run and run["face"] == "down" and run["loop"] is False
    assert run["pts"] == [H.piece_point(sofa, p) for p in _RUN["pts"]]
    assert out["lights"]["light.a"]["kind"] == "undercab"


def test_a_run_on_a_piece_that_is_not_there_is_refused():
    with pytest.raises(H.EditError, match="on a piece that is not there"):
        _set({"run": {**_RUN, "piece": "fur_00000009"}})


def test_a_run_whose_piece_went_earlier_does_not_stop_other_saves():
    """An older PadSpan's Furnish removed the piece: the run stays in the file
    (Live Aboard asks for it to be laid out again) and other saves go on."""
    base = {**H.empty(), "lights": {"light.a": {"run": {**_RUN, "piece": "fur_00000009"}}}}
    out = H.apply_edit(base, {"lights": {"light.b": {"z_m": 1.0}}})
    assert out["lights"]["light.a"]["run"]["piece"] == "fur_00000009"


def test_remove_all_furniture_leaves_the_runs_on_pieces_where_they_were(disk, tmp_path, monkeypatch):  # noqa: F811
    from custom_components.padspan_ha import ws_backup

    async def _bk(hass, note, keys):
        return "bk_1"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    sofa = _sofa(x_m=3.0, y_m=2.0, z_m=0.4, rotation=180.0)
    data = {**H.empty(), "pieces": {sofa["id"]: sofa},
            "lights": {"light.a": {"kind": "tv", "run": {**_RUN, "piece": sofa["id"]}}, "light.b": {"run": _LOOP}}}
    _seed(tmp_path, data)
    h, _ = _on(tmp_path, admin=True)
    assert _clear(h, only="pieces") == {"cleared": True, "backup_id": "bk_1"}
    disk_now = json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]
    assert disk_now["pieces"] == {}
    assert disk_now["lights"]["light.a"]["run"]["pts"] == [H.piece_point(sofa, p) for p in _RUN["pts"]]
    assert "piece" not in disk_now["lights"]["light.a"]["run"] and disk_now["lights"]["light.b"] == {"run": _LOOP}


def test_saved_through_house3d_edit_and_read_back(disk, tmp_path):  # noqa: F811
    h, conn = _on(tmp_path)
    out = _edit(h, conn, lights={"light.deck_string": {"kind": "string", "run": _STRING}})
    assert "error" not in out, out
    on_disk = json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]
    assert on_disk["lights"]["light.deck_string"] == {"kind": "string", "run": _STRING}
