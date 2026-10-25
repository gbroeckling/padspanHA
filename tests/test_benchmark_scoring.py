"""The accuracy benchmark (tools/benchmark): grouped held-out scoring of a
recorded walk with PadSpan's own k-NN and spatial code, against a
nearest-scanner baseline. Synthetic walks only; no real house in the repo."""

from __future__ import annotations

import csv
import json
import math
import random
import sys
from pathlib import Path

import pytest

_TOOLS = Path(__file__).resolve().parents[1] / "tools" / "benchmark"
if not (_TOOLS / "benchmark.py").is_file():
    # A generated PadSpan Bright tree carries the integration and the tests, not tools/.
    pytest.skip("no tools/ in this tree (a Bright build)", allow_module_level=True)
sys.path.insert(0, str(_TOOLS))

import benchmark  # noqa: E402
import walklog  # noqa: E402

# Four 4 m rooms in a row, a scanner in the middle of each.
ROOMS = ["Hall", "Kitchen", "Lounge", "Office"]
SCANNERS = {f"scan_{r.lower()}": {"room": r, "x": 4 * i + 2.0, "y": 2.0, "floor": "main", "z": None}
            for i, r in enumerate(ROOMS)}


def _rssi(x: float, y: float, rng: random.Random, noise: float) -> dict[str, float]:
    out = {}
    for s, sc in SCANNERS.items():
        d = max(0.3, math.hypot(x - sc["x"], y - sc["y"]))
        v = -59.0 - 25.0 * math.log10(d) + rng.gauss(0.0, noise)
        if v > -95:
            out[s] = round(v, 1)
    return out


def synthetic(walks: int = 2, per_room: int = 12, noise: float = 2.0, seed: int = 1,
              xy: bool = True) -> dict:
    rng = random.Random(seed)
    polls = []
    t = 1_700_000_000.0
    for w in range(walks):
        for i, room in enumerate(ROOMS):
            for _n in range(per_room):
                x, y = 4 * i + rng.uniform(0.5, 3.5), rng.uniform(0.5, 3.5)
                polls.append({"ts": t, "walk": f"walk{w + 1}", "device": "phone",
                              "room": room, "x": round(x, 2) if xy else None,
                              "y": round(y, 2) if xy else None, "floor": "main",
                              "rssi": _rssi(x, y, rng, noise)})
                t += 2.0
    rooms = {r: {"floor": "main", "polygon": [[4 * i, 0], [4 * i + 4, 0], [4 * i + 4, 4], [4 * i, 4]],
                 "centroid": None} for i, r in enumerate(ROOMS)}
    return {"scanners": json.loads(json.dumps(SCANNERS)), "rooms": rooms, "floors": {}, "polls": polls}


def _roundtrip(log: dict, tmp_path: Path) -> dict:
    p = tmp_path / "walk.json"
    walklog.dump(log, p)
    return walklog.load(p)


def test_all_three_methods_score_a_clean_walk_well(tmp_path):
    res = benchmark.run(_roundtrip(synthetic(), tmp_path))
    assert res["grouping"] == "walk" and res["folds"] == 2
    m = res["methods"]
    assert set(m) == {"knn", "spatial", "nearest"}      # no "live" without a recording
    for name in ("knn", "spatial", "nearest"):
        assert m[name]["room_polls"] == 96
        # The spatial solve's centroid leans inward, so end rooms lose edge polls.
        assert m[name]["rooms_right_pc"] >= (50 if name == "spatial" else 75), (name, m[name])
        assert m[name]["median_error_m"] is not None
    assert m["knn"]["median_error_m"] < 2.0
    assert m["spatial"]["median_error_m"] < 2.5
    assert set(m["knn"]["per_walk"]) == {"walk1", "walk2"}
    assert "Hall" in m["knn"]["per_room"]


def test_one_walk_falls_back_to_holding_out_visits():
    res = benchmark.run(synthetic(walks=1))
    assert res["grouping"] == "visit"
    assert res["folds"] == len(ROOMS)


def test_whole_groups_are_held_out_never_single_readings():
    log = synthetic(walks=3)
    polls = log["polls"]
    for test, held in benchmark.folds(polls, "walk", radius_m=1.5):
        walks = {polls[i]["walk"] for i in test}
        assert len(walks) == 1
        assert set(test) <= held
        assert {j for j, p in enumerate(polls) if p["walk"] in walks} <= held
    for test, held in benchmark.folds(polls, "position", radius_m=1.5):
        for i in test:
            for j, q in enumerate(polls):
                if math.hypot(q["x"] - polls[i]["x"], q["y"] - polls[i]["y"]) <= 1.5:
                    assert j in held


def test_a_visit_split_does_not_flatter_a_walk_that_carries_no_room_signal():
    """Rooms that look alike to the radios, but each visit has its own quirk.
    A random row split would match a poll to its own visit's copies and score
    near 100%; held-out visits must score near chance."""
    rng = random.Random(7)
    polls = []
    for v in range(40):
        quirk = {s: rng.uniform(-90, -60) for s in SCANNERS}
        room = rng.choice(ROOMS)
        for _n in range(10):
            polls.append({"ts": None, "walk": "w", "device": "d", "room": room,
                          "x": None, "y": None, "floor": "",
                          "rssi": {s: q + rng.gauss(0, 0.5) for s, q in quirk.items()}})
    log = {"scanners": json.loads(json.dumps(SCANNERS)), "rooms": {}, "floors": {}, "polls": polls}
    res = benchmark.run(log, methods=("knn",))
    assert res["methods"]["knn"]["rooms_right_pc"] < 50
    assert res["methods"]["knn"]["median_error_m"] is None   # no positions in the log


def test_train_walks_tests_only_the_other_walks():
    res = benchmark.run(synthetic(walks=3), train_walks={"walk1"})
    assert res["grouping"] == "train-walks" and res["folds"] == 1
    assert set(res["methods"]["knn"]["per_walk"]) == {"walk2", "walk3"}


def test_settling_polls_are_left_out_of_training_and_testing():
    log = synthetic(walks=2, per_room=12)
    res = benchmark.run(log, settle_s=5.0)        # polls every 2 s: 3 per visit
    assert res["settling_dropped"] == 2 * len(ROOMS) * 3
    assert res["methods"]["knn"]["room_polls"] == 96 - res["settling_dropped"]


def test_without_scanner_positions_only_knn_and_the_baseline_run():
    log = synthetic(xy=False)
    for sc in log["scanners"].values():
        sc["x"] = sc["y"] = None
    res = benchmark.run(log)
    assert set(res["methods"]) == {"knn", "nearest"}
    assert "spatial" in res["skipped"]
    assert res["methods"]["knn"]["median_error_m"] is None


def test_a_csv_walk_log_reads_the_same_as_json(tmp_path):
    log = synthetic(walks=1, per_room=3)
    with (tmp_path / "scanners.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "room", "x", "y", "floor", "z"])
        for s, sc in SCANNERS.items():
            w.writerow([s, sc["room"], sc["x"], sc["y"], sc["floor"], ""])
    with (tmp_path / "walk.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(list(walklog._FIXED) + [f"rssi:{s}" for s in SCANNERS])
        for p in log["polls"]:
            w.writerow([p["ts"], p["walk"], p["device"], p["room"], p["x"], p["y"], p["floor"]]
                       + [p["rssi"].get(s, "") for s in SCANNERS])
    got = walklog.load(tmp_path / "walk.csv", tmp_path / "scanners.csv")
    want = _roundtrip(log, tmp_path)
    assert got["polls"] == want["polls"]
    assert got["scanners"] == want["scanners"]


def test_a_walk_log_must_say_what_it_is(tmp_path):
    (tmp_path / "x.json").write_text(json.dumps({"polls": []}))
    with pytest.raises(ValueError):
        walklog.load(tmp_path / "x.json")


def test_the_cli_prints_a_table_and_writes_json(tmp_path, capsys):
    walklog.dump(synthetic(), tmp_path / "walk.json")
    assert benchmark.main([str(tmp_path / "walk.json"), "--json", str(tmp_path / "r.json")]) == 0
    out = capsys.readouterr().out
    assert "PadSpan k-NN" in out and "Nearest scanner" in out
    assert json.loads((tmp_path / "r.json").read_text())["methods"]["knn"]["room_polls"] == 96


def test_it_scores_padspans_own_code_not_a_copy():
    src = (_TOOLS / "benchmark.py").read_text(encoding="utf-8")
    assert "CalibrationStore.knn_locate(" in src
    assert "heldout.SpatialSite(" in src and "site.locate(" in src
    assert "heldout._strongest_area(" in src
    assert "MISSING_SCANNER_PENALTY" not in src     # no distance of its own
    # Not shipped to users: nothing under the integration imports it.
    integ = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    for f in integ.rglob("*.py"):
        assert "tools.benchmark" not in f.read_text(encoding="utf-8", errors="ignore")
