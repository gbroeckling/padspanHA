"""0.38.182: the panel says what the code does (workbook Backlog, 'panel vs code')."""
from pathlib import Path

from custom_components.padspan_ha.presence_rules import is_outdoor_floor, room_change_delay_s

ROOT = Path(__file__).resolve().parents[1]
CC = ROOT / "custom_components" / "padspan_ha"
VIEWS = CC / "www" / "padspan-ha" / "views"


def test_room_change_delay_zero_is_zero():
    assert room_change_delay_s({}) == 20.0
    assert room_change_delay_s({"room_change_delay_s": None}) == 20.0
    assert room_change_delay_s({"room_change_delay_s": 0}) == 0.0
    assert room_change_delay_s({"room_change_delay_s": 0.0}) == 0.0
    assert room_change_delay_s({"room_change_delay_s": 45}) == 45.0
    assert room_change_delay_s({"room_change_delay_s": 999}) == 300.0
    assert room_change_delay_s({"room_change_delay_s": "x"}) == 20.0
    for f in ("presence_coordinator.py", "ws_capture.py"):
        assert 'get("room_change_delay_s") or 20' not in (CC / f).read_text(encoding="utf-8"), f


def test_outdoor_rules_read_registry_floors():
    src = (CC / "presence_coordinator.py").read_text(encoding="utf-8")
    assert "== OUTSIDE_FLOOR_ID" not in src
    assert "OUTSIDE_FLOOR_ID in {" not in src
    assert is_outdoor_floor("outside") and is_outdoor_floor("__outside__") and not is_outdoor_floor("ground")


def test_dead_constants_gone():
    src = (CC / "presence_coordinator.py").read_text(encoding="utf-8")
    assert "_VG_RAPID_COOLDOWN_S" not in src
    assert "_RELIABILITY_FLOOR" not in src
    assert "At 10 s/poll" not in src


def test_panel_defaults_and_c3():
    st = (VIEWS / "settings.js").read_text(encoding="utf-8")
    assert "Default: 10s" not in st and "Default: 5s" in st
    assert "instant room switching" not in st
    assert "presence_poll_interval_s) : 10)" not in st
    bt = (VIEWS / "bluetooth.js").read_text(encoding="utf-8")
    assert '"Not recommended"' not in bt


def test_vote_requirement_never_exceeds_the_window():
    src = (CC / "presence_coordinator.py").read_text(encoding="utf-8")
    assert "else vote_threshold + 1\n" not in src
    assert "min(len(votes), vote_threshold + 1)" in src
