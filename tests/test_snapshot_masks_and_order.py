"""The object list: what a mask hides, how an exclusion may be written, which
devices the receiver-set merges may join, the order of adverts of one age,
and what the object history keeps of a labelled device.

Each test builds a small house with tests/golden_snapshot.py's stand-ins (its
receivers, its Home Assistant side, PadSpan's own BluetoothLive on a simulated
clock) and runs snapshot_builder._build_live_snapshot over it.
"""

from __future__ import annotations

import random
from datetime import datetime, timezone

import pytest

from custom_components.padspan_ha import bluetooth_live as _bl
from custom_components.padspan_ha import snapshot_builder as SB
from tests import golden_snapshot as gsn
from tests import room_speed_sim as sim

K, L, O = gsn.KITCHEN, gsn.LOUNGE, gsn.OFFICE
NO_RULES = {"excluded_objects": [], "ingest_rules": []}


def _builds(monkeypatch, heard, settings=None, build_at=(0.0,), history=None) -> list[dict]:
    """Run the builder at `build_at` over these adverts and settings."""
    monkeypatch.setattr(gsn, "HEARD", sorted(heard, key=lambda h: (h["t"], h["address"])))
    monkeypatch.setattr(gsn, "SETTINGS", {**NO_RULES, **(settings or {})})
    monkeypatch.setattr(gsn, "BUILD_AT", tuple(build_at))
    monkeypatch.setattr(gsn, "HISTORY_ON_DISK", history or {})
    return gsn.run()


def _objects(build: dict) -> dict[str, dict]:
    return {o["key"]: o for o in build["snapshot"]["objects"]["list"]}


def _masked(build: dict) -> int:
    return build["snapshot"]["objects"]["summary"]["ingest"]["masked_total"]


def _rule(**match) -> dict:
    return {"ingest_rules": [{"action": "mask", "reason": "not wanted", "match": match}]}


# ── A mask hides the device, however it would have been listed ───────────────

SIGN, LAMP = "C4:00:00:00:00:82", "C8:00:00:00:00:D1"
_TWO_PLAIN = [gsn._h(-4.0, SIGN, {L: -48}, name="Shop sign"), gsn._h(-3.0, LAMP, {L: -56}, name="Lamp")]


def test_a_plain_device_masked_by_its_address_is_not_listed(monkeypatch) -> None:
    listed = _objects(_builds(monkeypatch, _TWO_PLAIN)[0])
    assert "ble:" + SIGN in listed and "ble:" + LAMP in listed

    build = _builds(monkeypatch, _TWO_PLAIN, _rule(addrs=[SIGN]))[0]
    assert "ble:" + SIGN not in _objects(build)
    assert "ble:" + LAMP in _objects(build)
    assert _masked(build) == 1


def test_plain_devices_masked_by_their_maker_prefix_are_not_listed(monkeypatch) -> None:
    heard = _TWO_PLAIN + [gsn._h(-2.0, "C4:00:00:00:00:81", {L: -45}, name="[TV] Lounge")]
    build = _builds(monkeypatch, heard, _rule(ouis=["C4:00:00"]))[0]
    assert [k for k in _objects(build) if k.startswith("ble:")] == ["ble:" + LAMP]
    # The house's tag (not heard here) has the prefix too: its entity's row goes with them.
    assert "entity:device_tracker.tile_keys" not in _objects(build)
    assert _masked(build) == 3


def test_a_masked_device_is_not_listed_as_its_entity_either(monkeypatch) -> None:
    """Home Assistant knows the tag as a device with a tracker entity: one
    row for the entity, the tag's adverts folded into it."""
    heard = [gsn._h(-4.0, gsn.TILE, {K: -58}, name="Tile Keys")]
    entity = "entity:device_tracker.tile_keys"
    assert _objects(_builds(monkeypatch, heard)[0])[entity]["address"] == gsn.TILE

    build = _builds(monkeypatch, heard, _rule(addrs=[gsn.TILE]))[0]
    assert entity not in _objects(build) and "ble:" + gsn.TILE not in _objects(build)
    assert _masked(build) == 1                     # one device, counted once


def test_a_masked_device_is_not_brought_back_from_the_history(monkeypatch) -> None:
    """A labelled tag in the object history is listed for good, heard or not.
    Masked, it is not listed; its row is kept, so it is back with the rule gone."""
    spare = "C4:00:00:00:00:99"
    row = dict(gsn.HISTORY_ON_DISK["ble:" + spare])
    labels = {spare: "Spare tag"}
    monkeypatch.setattr(gsn, "LABELS", labels)
    assert "ble:" + spare in _objects(_builds(monkeypatch, _TWO_PLAIN, history={row["key"]: row})[0])

    # Not heard: only its row in the history could list it.
    build = _builds(monkeypatch, _TWO_PLAIN, _rule(addrs=[spare]), history={row["key"]: row})[0]
    assert "ble:" + spare not in _objects(build)
    assert _masked(build) == 1
    kept = build["kept_for_the_next_build"]["object_history"]
    assert "ble:" + spare in kept

    # Heard as well: still one device, counted once.
    heard = _TWO_PLAIN + [gsn._h(-2.0, spare, {O: -70}, name="Spare tag")]
    build = _builds(monkeypatch, heard, _rule(addrs=[spare]), history={row["key"]: row})[0]
    assert "ble:" + spare not in _objects(build)
    assert _masked(build) == 1

    # The rule gone, with what the masked build kept: listed again, label and all.
    back = _objects(_builds(monkeypatch, _TWO_PLAIN, history=kept)[0])["ble:" + spare]
    assert back["user_label"] == "Spare tag"


# ── An exclusion in each form the object list shows a device in ──────────────

_PHONE = "irk:" + gsn._IRK.hex()
_PACK = "ibeacon:" + gsn.UUID_FACTORY + ":10011:19641"
_FORMS = {
    # how it is written: (the entry, the objects it hides, one it must leave)
    "a plain device's address": (gsn.TV, ["ble:" + gsn.TV], "ble:" + gsn.DOG),
    "the address in small letters": (gsn.TV.lower(), ["ble:" + gsn.TV], "ble:" + gsn.DOG),
    "a plain device's key": ("ble:" + gsn.TV, ["ble:" + gsn.TV], "ble:" + gsn.DOG),
    "an entity's key": ("entity:device_tracker.tile_keys",
                        ["entity:device_tracker.tile_keys", "ble:" + gsn.TILE], "entity:sensor.phone_area"),
    "an iBeacon's key": ("ibeacon:" + gsn.UUID_BIKE + ":1:2", ["ibeacon:" + gsn.UUID_BIKE + ":1:2"],
                         "ibeacon:" + gsn.UUID_ROTATES + ":7:9"),
    # (the other beacon, now the only one with the id, is listed under the id alone)
    "one beacon of a pack that shares an id": (_PACK + ":" + gsn.TWIN_A, [_PACK + ":" + gsn.TWIN_A], _PACK),
    "a phone's key": (_PHONE, [_PHONE], "ble:" + gsn.DOG),
    "a Find My tag's key": ("ble:" + gsn.KEYS_A, ["ble:" + gsn.KEYS_A], "ble:" + gsn.DOG),
    "a Find My tag's address": (gsn.KEYS_A, ["ble:" + gsn.KEYS_A], "ble:" + gsn.DOG),
}


@pytest.fixture(scope="module")
def nothing_excluded() -> list[dict]:
    with pytest.MonkeyPatch.context() as mp:
        return _builds(mp, gsn.HEARD, {**gsn.SETTINGS, **NO_RULES}, gsn.BUILD_AT, gsn.HISTORY_ON_DISK)


@pytest.mark.parametrize("form", list(_FORMS))
def test_an_exclusion_hides_its_object(monkeypatch, nothing_excluded, form) -> None:
    entry, hidden, left = _FORMS[form]
    builds = _builds(monkeypatch, gsn.HEARD, {**gsn.SETTINGS, **NO_RULES, "excluded_objects": [entry]},
                     gsn.BUILD_AT, gsn.HISTORY_ON_DISK)
    assert any(hidden[0] in _objects(b) for b in nothing_excluded), "the house lists it when nothing is excluded"
    for before, build in zip(nothing_excluded, builds):
        listed = _objects(build)
        assert not [k for k in hidden if k in listed], f"still listed {gsn.label(build)}"
        assert left in listed
        if hidden[0] in _objects(before):
            assert _masked(build) >= 1
    if "pack" in form:
        assert _objects(builds[0])[_PACK]["all_addresses"] == [gsn.TWIN_B]
    if "Find My" in form:
        # The tag is listed under its first address while it uses another:
        # the address it uses now is hidden with it.
        assert not [o for o in _objects(builds[-1]).values()
                    if gsn.KEYS_B in (o.get("address"), o.get("current_address"))]


# ── The merges that go by the receivers that hear a device ───────────────────
# Three of the guessing merges (the same kind of Apple message, the same
# services with no name, nothing said at all) take two random addresses for
# one device when the same receivers hear both. That alone does not tell one
# device that changed its address from two devices in one room: every device
# in a room is heard by that room's receivers. Two devices that are both
# sending, each on its own address, are two.

_KINDS = {
    "the same kind of Apple message": dict(manuf={76: bytes.fromhex("0906031c0a000001")}),
    "the same services and no name": dict(uuids=(gsn._HEART_RATE,)),
    "nothing said at all": {},
}
_ONE, _OTHER = "E6:00:00:00:00:B1", "E6:00:00:00:00:B3"


def two_devices_in_one_room(kind: str) -> list[dict]:
    """Two devices of one kind, each sending every ten seconds for five
    minutes on its own address, both heard by the kitchen and the lounge."""
    heard = []
    for i in range(30):
        heard.append(gsn._h(10.0 * i + 1.0, _ONE, {K: -60, L: -72}, **_KINDS[kind]))
        heard.append(gsn._h(10.0 * i + 4.0, _OTHER, {K: -66, L: -70}, **_KINDS[kind]))
    return heard


def one_device_that_changed_address(kind: str) -> list[dict]:
    """One device: on its first address for 100 seconds, then on its next."""
    return [gsn._h(10.0 * i + 1.0, _ONE if i < 10 else _OTHER, {K: -60, L: -72}, **_KINDS[kind])
            for i in range(30)]


@pytest.mark.parametrize("kind", list(_KINDS))
def test_two_devices_heard_by_the_same_receivers_stay_two(monkeypatch, kind) -> None:
    for build in _builds(monkeypatch, two_devices_in_one_room(kind), build_at=(15.0, 95.0, 295.0)):
        listed = _objects(build)
        assert "ble:" + _ONE in listed and "ble:" + _OTHER in listed, gsn.label(build)


# ── Adverts of the same age ──────────────────────────────────────────────────

_SAME_INSTANT = [f"C8:00:00:00:{n:02X}:01" for n in (9, 3, 12, 1, 7, 11, 2, 8, 5, 10, 4, 6)]


def test_adverts_of_one_age_are_listed_by_address(monkeypatch) -> None:
    """Twelve devices heard at the same instant: the adverts, and the objects
    made from them, come in address order, whatever order they were heard in."""
    heard = [gsn._h(-4.0, a, {L: -60}, name=f"Lamp {n}") for n, a in enumerate(_SAME_INSTANT)]
    orders = []
    for seed in (1, 2):
        random.Random(seed).shuffle(heard)
        monkeypatch.setattr(gsn, "HEARD", list(heard))
        monkeypatch.setattr(gsn, "SETTINGS", dict(NO_RULES))
        monkeypatch.setattr(gsn, "BUILD_AT", (0.0,))
        monkeypatch.setattr(gsn, "HISTORY_ON_DISK", {})
        snap = gsn.run()[0]["snapshot"]
        adverts = [a["address"] for a in snap["ble"]["advertisements"]]
        objects = [o["address"] for o in snap["objects"]["list"] if o["kind"] == "ble"]
        assert adverts == sorted(_SAME_INSTANT)
        assert objects == sorted(_SAME_INSTANT)
        orders.append((adverts, objects))
    assert orders[0] == orders[1]


def test_the_cap_keeps_the_same_addresses_whatever_order_they_were_heard_in() -> None:
    """More addresses than the cap, all of one age: which are kept goes by
    address, not by which happened to be heard first."""
    newest_first = sorted(_SAME_INSTANT, reverse=True)
    for arrival in (newest_first, list(reversed(newest_first))):
        snap = _live_snapshot([(a, L) for a in arrival], max_ads=5)
        assert [a["address"] for a in snap["advertisements"]] == sorted(_SAME_INSTANT)[:5]


def _live_snapshot(heard: list[tuple[str, str]], **kw) -> dict:
    """BluetoothLive's own snapshot after these (address, receiver) adverts,
    all heard at the same instant."""
    clock = sim.Clock()
    scanners = {s: gsn.ESPHomeScanner(s, s) for s in (K, L, O)}
    hass, _stores = gsn._house()
    box: list = [None]
    with gsn._pinned(clock, sim.FakeManager(list(scanners.values())), list(scanners.values()), box, [None]):
        live = box[0] = _bl.BluetoothLive(hass)
        clock.t = -4.0
        for addr, source in heard:
            fields = dict(rssi=-60, tx_power=None, service_uuids=[], service_data={}, manufacturer_data={})
            scanners[source].discovered_devices_and_advertisement_data[addr] = (
                gsn.NS(address=addr, name="", details={}), gsn.NS(local_name="", **fields))
            scanners[source].discovered_device_timestamps[addr] = clock.monotonic()
            live._on_adv(gsn.NS(address=addr, time=clock.monotonic(), source=source, name="",
                                connectable=False, device=None, **fields))
        clock.t = 0.0
        return live.get_snapshot(**kw)


# ── An ALLOW rule on a row's own key ─────────────────────────────────────────
# First matching rule wins, and an ALLOW stops there: for an entity's row as
# for an advert. The tag's adverts are masked by its maker's prefix either way.

_ALLOW_THE_ENTITY = {"action": "allow", "match": {"keys": ["entity:device_tracker.tile_keys"]}}
_MASK_THE_MAKER = {"action": "mask", "match": {"ouis": ["C4:00:00"]}}
_SIGN_LAMP_AND_TAG = _TWO_PLAIN + [gsn._h(-2.0, gsn.TILE, {K: -58}, name="Tile Keys")]


def test_an_allow_on_an_entitys_key_holds_though_its_address_is_masked(monkeypatch) -> None:
    build = _builds(monkeypatch, _SIGN_LAMP_AND_TAG, {"ingest_rules": [_ALLOW_THE_ENTITY, _MASK_THE_MAKER]})[0]
    listed = _objects(build)
    assert "entity:device_tracker.tile_keys" in listed
    assert "ble:" + SIGN not in listed and "ble:" + gsn.TILE not in listed
    assert _masked(build) == 2                     # the sign, and the tag's adverts


def test_a_mask_that_comes_before_the_allow_wins(monkeypatch) -> None:
    build = _builds(monkeypatch, _SIGN_LAMP_AND_TAG, {"ingest_rules": [_MASK_THE_MAKER, _ALLOW_THE_ENTITY]})[0]
    listed = _objects(build)
    assert "entity:device_tracker.tile_keys" not in listed
    assert "ble:" + SIGN not in listed and "ble:" + gsn.TILE not in listed
    assert _masked(build) == 2                     # the tag is one device, counted once


# ── A labelled device's row in the object history ────────────────────────────
# A row with a label is kept for good: silent, masked or both. The history
# looks for the label where the list does (the object store under the
# device's address as well as its key; the device registry).

_E = sim.Clock.EPOCH0
_MONTH = 30 * 86400.0
_SPARE, _STRANGER = "C4:00:00:00:00:99", "C8:00:00:00:00:98"


def _row(addr: str, name: str, silent_s: float, labelled: bool = True) -> dict:
    """A plain device's row as the history stores it, last heard `silent_s` ago."""
    row = {"key": "ble:" + addr, "kind": "ble", "address": addr, "name": name, "room": "Office", "rssi": -70,
           "age_s": 5.0, "sources": [{"source": O, "rssi": -70, "age_s": 5.0}], "manufacturer_data": {},
           "service_data": {}, "service_uuids": [], "_first_seen": _E - 2 * _MONTH, "_last_seen_ts": _E - silent_s}
    if labelled:
        row.update(user_label=name, identified=True)
    return row


def _when(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _history(build: dict) -> dict:
    return build["kept_for_the_next_build"]["object_history"]


def test_a_labelled_device_silent_longer_than_the_history_time_keeps_its_row(monkeypatch) -> None:
    monkeypatch.setattr(gsn, "LABELS", {_SPARE: "Spare tag"})
    rows = [_row(_SPARE, "Spare tag", _MONTH), _row(_STRANGER, "Nobody's", _MONTH, labelled=False)]
    for build in _builds(monkeypatch, _TWO_PLAIN, build_at=(0.0, 100.0), history={r["key"]: r for r in rows}):
        kept = _history(build)["ble:" + _SPARE]
        assert kept["user_label"] == "Spare tag" and kept["identified"] is True
        assert kept["_first_seen"] == rows[0]["_first_seen"]
        listed = _objects(build)["ble:" + _SPARE]
        assert listed["user_label"] == "Spare tag" and listed["first_seen"] == _when(rows[0]["_first_seen"])
        # One with no label goes after the history time, as before.
        assert "ble:" + _STRANGER not in _history(build) and "ble:" + _STRANGER not in _objects(build)


def test_a_device_labelled_only_in_the_device_registry_keeps_its_row(monkeypatch) -> None:
    """The list reads the registry's label after the row is stored, so the
    row carries no flag for it. The house's registry names the dog's collar."""
    monkeypatch.setattr(gsn, "LABELS", {})
    row = _row(gsn.DOG, "PetTag", _MONTH, labelled=False)
    for build in _builds(monkeypatch, _TWO_PLAIN, build_at=(0.0, 100.0), history={row["key"]: row}):
        assert _history(build)["ble:" + gsn.DOG]["_first_seen"] == row["_first_seen"]
        listed = _objects(build)["ble:" + gsn.DOG]
        assert listed["user_label"] == "Dog collar" and listed["first_seen"] == _when(row["_first_seen"])


def test_a_row_whose_label_is_gone_loses_its_flags_and_goes(monkeypatch) -> None:
    """What the check is there for: the label deleted, the row still flagged."""
    monkeypatch.setattr(gsn, "LABELS", {})
    row = _row(_SPARE, "Spare tag", _MONTH)
    build = _builds(monkeypatch, _TWO_PLAIN, history={row["key"]: row})[0]
    assert "ble:" + _SPARE not in _history(build) and "ble:" + _SPARE not in _objects(build)


@pytest.mark.parametrize("hidden_by", ["a rule on its maker's prefix", "an exclusion"])
def test_a_labelled_device_masked_for_longer_than_the_history_time_is_back_as_it_was(monkeypatch, hidden_by) -> None:
    monkeypatch.setattr(gsn, "LABELS", {gsn.DOG: "Dog collar"})
    heard = [gsn._h(-4.0, gsn.DOG, {K: -62}, name="PetTag")]
    row = dict(_history(_builds(monkeypatch, heard)[0])["ble:" + gsn.DOG])
    assert row["user_label"] == "Dog collar"
    # 25 hours on (the history time is a day), hidden all that while.
    row["_first_seen"] -= 90000.0
    row["_last_seen_ts"] -= 90000.0
    rule = _rule(ouis=["C4:00:00"]) if "prefix" in hidden_by else {"excluded_objects": [gsn.DOG]}
    builds = _builds(monkeypatch, heard, rule, build_at=(0.0, 100.0), history={row["key"]: row})
    for build in builds:
        assert "ble:" + gsn.DOG not in _objects(build)
        kept = _history(build)["ble:" + gsn.DOG]
        assert kept["user_label"] == "Dog collar" and kept["_first_seen"] == row["_first_seen"]
    # The rule removed: the same device, first seen when it was.
    back = _objects(_builds(monkeypatch, heard, history=_history(builds[-1]))[0])["ble:" + gsn.DOG]
    assert back["user_label"] == "Dog collar" and back["first_seen"] == _when(row["_first_seen"])


def test_an_excluded_find_my_tag_keeps_its_row_when_it_moves_to_its_next_address(monkeypatch) -> None:
    """The tag is labelled and followed, and has a row from before it was
    excluded. When the bridge links its next address, its first address is
    claimed by that link: the row is held back, not deleted."""
    row = _row(gsn.KEYS_A, "Keys", 3600.0)
    excluded = {**gsn.SETTINGS, **NO_RULES, "excluded_objects": [gsn.KEYS_A]}
    builds = _builds(monkeypatch, gsn.HEARD, excluded, gsn.BUILD_AT, {row["key"]: row})
    for build in builds:
        assert "ble:" + gsn.KEYS_A not in _objects(build), gsn.label(build)
        kept = _history(build).get("ble:" + gsn.KEYS_A)
        assert kept and kept["user_label"] == "Keys" and kept["_first_seen"] == row["_first_seen"], gsn.label(build)
    back = _builds(monkeypatch, gsn.HEARD, {**gsn.SETTINGS, **NO_RULES}, gsn.BUILD_AT, _history(builds[-1]))
    keys = _objects(back[-1])["ble:" + gsn.KEYS_A]
    assert keys["user_label"] == "Keys" and keys["first_seen"] == _when(row["_first_seen"])


def test_the_count_cap_spares_a_row_labelled_only_in_the_device_registry(monkeypatch) -> None:
    monkeypatch.setattr(gsn, "LABELS", {})
    monkeypatch.setattr(SB._low_memory, "history_max", lambda _hass: 5)
    rows = [_row(gsn.DOG, "PetTag", 3000.0, labelled=False)]         # heard longest ago
    rows += [_row(f"C8:00:00:00:01:{n:02X}", "Nobody's", 1000.0 + n, labelled=False) for n in range(20)]
    kept = _history(_builds(monkeypatch, _TWO_PLAIN, history={r["key"]: r for r in rows})[0])
    assert "ble:" + gsn.DOG in kept
    assert len([k for k in kept if k.startswith("ble:C8:00:00:00:01:")]) < 20


def test_the_count_cap_asks_its_keeper_before_an_entry_goes() -> None:
    cache = {f"ble:{n}": {"_last_seen_ts": n} for n in range(150)}
    gone = SB.cap_object_history(cache, 100, set(), keep=lambda entry: entry["_last_seen_ts"] == 0)
    assert "ble:0" in cache and gone == 59 and len(cache) == 91
