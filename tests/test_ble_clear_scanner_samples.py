"""A Radio Reset (BluetoothLive.clear_scanner) takes the receiver's signal samples with its adverts.

The samples (BluetoothLive._rssi_samples: up to 32 per address and receiver)
were left behind. An address heard only by the reset receiver then left the
cache at once, and the age prune walks the cache, so its samples were never
removed: kept for as long as Home Assistant ran, one set per such address on
every reset.
"""

from __future__ import annotations

from tests.test_maker_address_rules import PROXY, RANDOM_STATIC, _advert, _bluez, _esphome, _stack

OTHER = "C8:11:22:33:44:66"


def test_an_address_only_the_reset_receiver_heard_goes_with_its_samples(monkeypatch) -> None:
    _BL, bl = _stack(monkeypatch)
    bl._on_adv(_advert(RANDOM_STATIC, _esphome(RANDOM_STATIC, 1), source=PROXY))
    assert RANDOM_STATIC in bl._rssi_samples
    bl.clear_scanner(PROXY)
    assert RANDOM_STATIC not in bl._seen_by_source
    assert RANDOM_STATIC not in bl._rssi_samples


def test_an_address_another_receiver_hears_keeps_that_receivers_samples(monkeypatch) -> None:
    _BL, bl = _stack(monkeypatch)
    bl._on_adv(_advert(OTHER, _esphome(OTHER, 1), source=PROXY))
    bl._on_adv(_advert(OTHER, _bluez(OTHER)))                       # hci0 hears it too
    assert set(bl._rssi_samples[OTHER]) == {PROXY, "hci0"}
    bl.clear_scanner(PROXY)
    assert set(bl._seen_by_source[OTHER]) == {"hci0"}
    assert set(bl._rssi_samples[OTHER]) == {"hci0"}
