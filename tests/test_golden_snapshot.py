"""The live snapshot builder gives exactly the stored output.

tests/golden_snapshot.py builds one fixed house (stand-ins for Home
Assistant's areas, devices, entities and states; PadSpan's own stores; a
fixed list of adverts handed to BluetoothLive on a simulated clock) and runs
snapshot_builder._build_live_snapshot at six moments over twenty minutes.
Each build's whole snapshot, and what the builder kept for the next build,
must be what is stored in tests/golden/snapshot/builds.json.

This is what lets snapshot_builder.py be restructured: the same output
before and after. A behaviour change on purpose changes the file:

    python -m tests.regen_goldens snapshot

and its diff shows which values of which build changed.
"""

from __future__ import annotations

import pytest

from tests import golden_snapshot as gsn
from tests import golden_tools as gt

pytestmark = gt.FULL_EDITION_ONLY


@pytest.fixture(scope="module")
def builds() -> list[dict]:
    return gsn.run()


def test_the_builder_gives_the_stored_output(builds) -> None:
    gt.check_whole("snapshot", "builds", builds, gsn.label)


def test_a_second_run_gives_the_same_output(builds) -> None:
    """Nothing is left behind by a run that the next one picks up."""
    assert gt.lines(gsn.run()) == gt.lines(builds)


def test_the_house_takes_the_builder_through_what_it_is_there_for(builds) -> None:
    """Each line is one thing the builder does, seen in the stored builds."""
    snaps = [b["snapshot"] for b in builds]
    objs = [{o["key"]: o for o in s["objects"]["list"]} for s in snaps]
    first, last = objs[0], objs[-1]

    # Every kind of object.
    assert {o["kind"] for o in first.values()} == {"entity", "ble", "private_ble", "ibeacon"}
    # Receivers matched to Home Assistant's devices and areas; one it no
    # longer lists, marked lost in the settings; network details from entities.
    radios = {r["source"]: r for r in snaps[0]["ble"]["radios"]}
    assert radios[gsn.KITCHEN]["area_name"] == "Kitchen" and radios[gsn.KITCHEN]["ip"] == "192.0.2.10"
    assert radios[gsn.LOUNGE]["display_name"] == "Lounge Proxy"
    assert radios[gsn.GONE]["lost"] is True and "area_name" not in radios[gsn.GONE]
    # Tracked entities: one of Bermuda's device (its Area sensor), one by a
    # word in its name, one that is a Home Assistant device with an address.
    assert [t["entity_id"] for t in snaps[0]["tags"]] == [
        "device_tracker.tile_keys", "sensor.beacon1_room", "sensor.phone_area"]
    # An iBeacon with a label; one whose address changed; two on a maker's default id, kept apart.
    bike = first["ibeacon:" + gsn.UUID_BIKE + ":1:2"]
    assert bike["user_label"] == "Bike" and bike["identified"]
    rot = "ibeacon:" + gsn.UUID_ROTATES + ":7:9"
    assert first[rot]["all_addresses"] == [gsn.ROT_A] and gsn.ROT_B in last[rot]["all_addresses"]
    twins = [k for k in first if k.startswith("ibeacon:" + gsn.UUID_FACTORY)]
    assert len(twins) == 2
    # A private address resolved, before and after it changed.
    phone = "irk:" + gsn._IRK.hex()
    assert first[phone]["address"] == gsn.PHONE_A and last[phone]["address"] == gsn.PHONE_B
    # A Find My tag keeps its name across a change of address.
    keys = last["ble:" + gsn.KEYS_A]
    assert keys["findmy"] and keys["current_address"] == gsn.KEYS_B and keys["user_label"] == "Keys"
    assert "ble:" + gsn.KEYS_B in objs[1] and "ble:" + gsn.KEYS_B not in last
    # A guessing merge: one name on two random addresses is one object.
    assert objs[1]["ble:" + gsn.CAR_B]["_dedup_reason"] == "same_name:EX90" and "ble:" + gsn.CAR_A not in objs[1]
    # The three merges that go by the receivers that hear a device want the
    # signal and age equal to the last digit too: three bare random addresses
    # heard a moment apart stay three, and each pair heard at the same
    # instants with the same signal is one object.
    assert all("ble:" + a in first for a in gsn.BARE)
    for pair, reason in ((gsn.ECHO, "bare_random_mac"), (gsn.BANDS, "same_svc_uuids_scanners"),
                         (gsn.PODS, "apple_continuity:")):
        assert first["ble:" + pair[0]]["_dedup_reason"].startswith(reason) and "ble:" + pair[1] not in first
    # Adverts of one age come in address order, and the objects made from them.
    lamps = [k for k in first if k in {"ble:" + a for a in gsn.LAMPS}]
    assert lamps == sorted("ble:" + a for a in gsn.LAMPS) and lamps != ["ble:" + a for a in gsn.LAMPS]
    # What the settings hide (an address in the simple list, an address rule,
    # a beacon id), counted: not listed in any build.
    assert snaps[0]["objects"]["summary"]["ingest"]["masked_total"] == 3
    assert not any(k in o for o in objs for k in ("ble:" + gsn.TV, "ble:" + gsn.SIGN))
    assert not any(k.startswith("ibeacon:" + gsn.UUID_HIDDEN) for o in objs for k in o)
    # The object history: a labelled tag from the file, never heard here; a
    # tag heard once, still listed twenty minutes on.
    assert first["ble:C4:00:00:00:00:99"]["user_label"] == "Spare tag"
    assert last["ble:" + gsn.OLD_TAG]["age_s"] > 1200
    assert builds[-1]["kept_for_the_next_build"]["saved_files"]["history"]["saves"] >= 2
    # Names from the tables, ids from the registry, rooms from the strongest receiver.
    assert first["ble:" + gsn.WATCH]["company_name"] == "Samsung Electronics"
    assert first["ble:" + gsn.DOG]["padspan_id"] == "ps_00000000d06c"
    assert first["ble:" + gsn.DOG]["room"] == "Kitchen"
    assert snaps[0]["scanner_health"][gsn.KITCHEN]["polls"] == 30
