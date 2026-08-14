"""One away rule, one implementation — and it must actually be applied.

A Tesla that had left an hour earlier stayed listed in the Garage next to
devices seen 20 seconds ago, and its device_tracker read "unknown" rather than
"not_home".  Both came from the same cause: "is this object still here?" was
hand-rolled in nine places (sensor.py, device_tracker.py and seven spots across
the frontend), each re-deriving `(away_timeout_m ?? 5) * 60`.  The server-side
room-occupancy rebuild never implemented it at all.

This is the same failure shape as the map-image cache buster (issue #62): one
rule, many copies, some of them wrong.  The structural guard at the bottom is
what stops a tenth copy appearing.
"""

from __future__ import annotations

import re
from pathlib import Path

from custom_components.padspan_ha.presence_rules import (
    DEFAULT_AWAY_TIMEOUT_M,
    away_timeout_s,
    is_away,
)

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


class _Store:
    def __init__(self, data):
        self.data = data


class _Hass:
    def __init__(self, settings=None):
        from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
        self.data = {DOMAIN: {DATA_SETTINGS: _Store(settings)} if settings is not None else {}}


# ── The rule itself ──────────────────────────────────────────────────────────

def test_default_timeout_is_five_minutes():
    assert away_timeout_s(_Hass()) == 300.0
    assert DEFAULT_AWAY_TIMEOUT_M == 5.0


def test_configured_timeout_is_honoured_and_clamped():
    assert away_timeout_s(_Hass({"away_timeout_m": 30})) == 1800.0
    assert away_timeout_s(_Hass({"away_timeout_m": 0})) == 60.0        # min 1 min
    assert away_timeout_s(_Hass({"away_timeout_m": 99999})) == 86400.0  # max 1 day
    assert away_timeout_s(_Hass({"away_timeout_m": "bad"})) == 300.0


def test_the_tesla_case():
    """The live object, exactly as the snapshot carried it."""
    tesla = {"kind": "ibeacon", "room": "Garage", "age_s": 3754.17}
    assert is_away(tesla, 300.0)


def test_a_device_seen_seconds_ago_is_present():
    assert not is_away({"kind": "ble", "room": "Garage", "age_s": 20.0}, 300.0)


def test_the_boundary_is_strictly_greater():
    assert not is_away({"kind": "ble", "age_s": 300.0}, 300.0)
    assert is_away({"kind": "ble", "age_s": 300.1}, 300.0)


def test_ha_entities_are_never_away():
    """An HA entity has no radio and no age — blanking those empties the UI."""
    assert not is_away({"kind": "entity", "room": "Kitchen", "age_s": 999999}, 300.0)


def test_a_missing_or_unusable_age_is_not_treated_as_away():
    """Absence of evidence is not evidence of absence."""
    for age in (None, "old", float("nan"), float("inf"), True):
        assert not is_away({"kind": "ble", "age_s": age}, 300.0), age
    assert not is_away({"kind": "ble"}, 300.0)
    assert not is_away(None, 300.0)


# ── The rule must be APPLIED where presence is decided ───────────────────────

def test_room_occupancy_filters_out_departed_objects():
    """Occupancy is present tense.

    An object keeps its last known room forever, which is deliberate — that is
    how "last seen in the Garage" survives a dropout.  But a room lists who is
    IN it, so the rebuild must drop anything past the timeout.
    """
    src = (_ROOT / "websocket.py").read_text(encoding="utf-8")
    start = src.index("_rtm_fresh: dict[str, list[str]] = {}")
    block = src[start:start + 600]
    assert "is_away" in block, (
        "the room_tag_map rebuild does not apply the away rule — a departed "
        "device stays listed as an occupant"
    )


def test_the_tracker_names_the_away_state_instead_of_returning_none():
    """None is not not_home.

    HA falls through a None location_name to latitude/longitude; this tracker
    has neither, so None rendered as "unknown" and no automation could act on
    a device being away.
    """
    src = (_ROOT / "device_tracker.py").read_text(encoding="utf-8")
    body = src[src.index("def location_name"):]
    body = body[:body.index("\n    @property")]
    assert "STATE_NOT_HOME" in body, "the away state must be named explicitly"
    code = "\n".join(
        l for l in body.splitlines()
        if not l.strip().startswith("#") and '"""' not in l
    )
    assert "return None" not in code, (
        "location_name still returns None on the away path — that renders as "
        f"'unknown', not 'not_home':\n{code}"
    )


# ── Structural guard: no tenth copy ──────────────────────────────────────────

_HAND_ROLLED = re.compile(r"away_timeout_m[^\n]{0,80}?\*\s*60")


def test_no_file_hand_rolls_the_away_threshold():
    """Every consumer must go through the shared rule.

    Nine copies is how this broke: each one re-derived the threshold, and the
    one place that mattered most never derived it at all.  presence_rules.py
    owns the arithmetic; settings.js may still read the value to render the
    setting's own input.
    """
    allowed = {
        _ROOT / "presence_rules.py",                    # owns it
        _ROOT / "www" / "padspan-ha" / "views" / "settings.js",  # edits the setting
    }
    offenders: list[str] = []
    for path in list(_ROOT.rglob("*.py")) + list(_ROOT.rglob("*.js")):
        if path in allowed or "/lib/" in path.as_posix():
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if _HAND_ROLLED.search(line):
                offenders.append(f"{path.relative_to(_ROOT)}:{i}")
    assert not offenders, (
        "away threshold re-derived instead of using the shared rule "
        f"(presence_rules.away_timeout_s / is_away): {offenders}"
    )


# ── The map frame is sized by the building, not by what stands outside it ────

def test_object_markers_cannot_stretch_the_overview_frame():
    """A truck in the driveway must not set the zoom for the whole map.

    Every projected point used to grow the frame's bounding box, so one object
    30 m from the house zoomed the map out to contain it and the house shrank
    into the middle. The frame is frozen once the structure is drawn; outside
    objects are tethered to the edge and ringed instead.
    """
    src = (_ROOT / "www" / "padspan-ha" / "views" / "overview.js").read_text(encoding="utf-8")

    # The bbox writer must respect the freeze.
    grow = src[src.index("const iso = (wx,wy,wz)=>{"):]
    grow = grow[:grow.index("return p;")]
    assert "_isoBBFrozen" in grow, (
        "iso() grows the frame bounding box unconditionally — object markers "
        "will stretch the map again"
    )

    # The freeze must happen before objects are drawn.
    freeze = src.index("_isoBBFrozen = true;")
    first_obj_loop = src.index("for(const o of followedObjects){")
    assert freeze < first_obj_loop, (
        "the frame is frozen after object rendering starts, which is too late"
    )

    # Both object-rendering paths must tether — the followed-beacon loop and
    # the general marker loop. One alone leaves half the objects stretching
    # the map.
    calls = [m.start() for m in re.finditer(r"_tetherOutside\(", src)]
    calls = [c for c in calls if c > src.index("const _tetherOutside =")]
    assert len(calls) >= 2, (
        f"only {len(calls)} tether call site(s); both rendering paths need one"
    )


def test_no_surface_asserts_a_departed_object_is_still_in_a_room():
    """"In this room" and "Location" are present tense.

    The Tesla read not_home on both its entities and was gone from room
    occupancy, yet still showed as being in the Garage — because three
    separate display surfaces printed its last known room as though it were
    current: the Overview objects table, the room detail modal's occupant
    list, and the object detail modal's Location heading.
    """
    panel = (_ROOT / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")

    # Room detail: occupants must be filtered.
    occ = panel[panel.index("_showRoomDetail(roomName){"):]
    occ = occ[:occ.index("const radios")]
    assert "isAway" in occ, (
        "the room detail modal lists occupants without an away filter — a "
        "departed device still appears to be standing in the room"
    )

    # Object detail: the heading must say it is the LAST location.
    loc = panel[panel.index("const objRoom = obj.room"):]
    loc = loc[:loc.index('"Location"') + 40]
    assert "Last location" in loc, (
        "the object detail modal labels a departed object's room as its "
        "current Location"
    )

    # Overview table: the room column must qualify an away object.
    ov = (_ROOT / "www" / "padspan-ha" / "views" / "overview.js").read_text(encoding="utf-8")
    cell = ov[ov.index('el("td",{}, addr || "—"),'):]
    cell = cell[:600]
    assert "isAway" in cell, (
        "the Overview objects table prints the room bare, so a departed "
        "device still reads as being there"
    )


# ---------------------------------------------------------------------------
# 7. `room` is present tense, decided ONCE, at the source
# ---------------------------------------------------------------------------

def test_the_snapshot_clears_the_room_of_a_departed_object():
    """Five surfaces showed the same departed car as being in the Garage.

    Each was fixed only when someone spotted it, because every one of them read
    `room` and had to remember to check the age independently. The snapshot now
    answers it: a departed object has no current room, where it was last seen
    moves to `last_room`, and `away` says so. Anything reading `room` is then
    correct by construction — including code not written yet.
    """
    src = (_ROOT / "websocket.py").read_text(encoding="utf-8")
    blk = src[src.index("# ── `room` is PRESENT TENSE"):]
    blk = blk[:blk.index("# Rebuild room_tag_map")]
    assert "is_away(_obj" in blk, "the snapshot does not test for away"
    assert '_obj["last_room"]' in blk, "where it was last seen is discarded"
    assert '_obj["room"] = ""' in blk, (
        "a departed object still carries its old room as its CURRENT room, so "
        "every display surface will assert it is still there"
    )
    assert '_obj["away"] = True' in blk, "nothing marks the object as away"


def test_the_room_is_cleared_before_occupancy_is_rebuilt():
    """Order matters: occupancy is derived from the same field."""
    src = (_ROOT / "websocket.py").read_text(encoding="utf-8")
    clear = src.index('_obj["room"] = ""')
    rebuild = src.index("_rtm_fresh: dict[str, list[str]] = {}")
    assert clear < rebuild, (
        "occupancy is rebuilt before departed rooms are cleared, so a "
        "departed object is still counted as an occupant"
    )


def test_last_seen_displays_read_last_room_not_room():
    """Surfaces that legitimately show where it WAS must use last_room.

    They previously read `room`, which is now empty for a departed object —
    without this they would show a dash instead of "last: Garage".
    """
    www = _ROOT / "www" / "padspan-ha"
    for rel in ("views/objects.js", "views/overview.js", "panel.js"):
        src = (www / rel).read_text(encoding="utf-8")
        assert "last_room" in src, (
            "{} shows a departed object's location without reading "
            "last_room".format(rel)
        )
