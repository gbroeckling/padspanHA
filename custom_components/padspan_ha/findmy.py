# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Apple Find My tags (AirTags and "works with Find My" tags) across address changes.

WHAT A FIND MY TAG SENDS
========================
Apple manufacturer data (company 0x004C), message type 0x12:

  byte 0   0x12            Find My
  byte 1   length          0x19 (25) while SEPARATED from its owner;
                           a short payload (0x02) while NEARBY / connected
  byte 2   status          bits 6-7 battery (0 full .. 3 very low)
                           bits 4-5 device type: 0 Apple device (iPhone,
                           Mac, iPad), 1 AirTag, 2 third-party Find My
                           accessory, 3 AirPods / headphones
  bytes 3-24               public key bytes 6..27 (separated only)
  byte 25                  top two bits of public key byte 0
  byte 26                  hint

The Bluetooth address IS the first six bytes of the current public key, with
the top two bits set (a static random address, first byte 0xC0-0xFF). Near
its owner the key — so the address — changes every 15 minutes; separated, it
changes once a day at about 04:00 local time. Nothing in the advertisement
survives a change except the status byte's device type (and, usually, its
battery level): the key is the identity, and it rotates on purpose.

Sources: seemoo-lab AirGuard (AppleFindMy.kt, DeviceManager.kt, AirTag.kt);
Heinrich et al., "AirGuard — Protecting Android Users from Stalking Attacks by
Apple Find My Devices" (WiSec 2022), Table 1 and §2.2; Adam Catley, "Apple
AirTag Reverse Engineering".

HOW ONE TAG IS FOLLOWED ACROSS A CHANGE
=======================================
A change is a hand-over: the old address stops and, within seconds, a new
one starts — from the same place. So a new address carries on a known tag
only when ALL of these hold:

  * both are Find My advertisements of the same device type — an iPhone, an
    AirPods case and a tag never match, whatever else they share;
  * the old address has stopped: not heard for LIVE_S. That is long, on
    purpose — a passive proxy's repeats of a live tag reach PadSpan only at
    each reseed (30 s by default, up to 60 s), so a shorter silence is a
    live tag reported late (review round 8). A link lands about a minute
    after a real change;
  * the new address first appeared around the old one's last report — not
    long before (a neighbour's tag in range all along) and not long after
    (a visitor's tag arriving at the door);
  * the scanners hear it where they last heard the old one: the mean
    difference over the scanners that heard both is within MAX_DB, and a
    scanner that heard one strongly but not the other counts heavily;
  * the pairing is unambiguous — the best match for both sides, by at least
    MARGIN_DB over every alternative, near or not. Two tags lying together
    that change at 04:00 together can't be told apart; then nothing is
    linked rather than a guess.

An address a tag has used stays in Home Assistant's list for a while after
the change, growing older: it is still that tag's (never a new identity, and
never re-pointed), until the tag is forgotten.

This module is pure (no Home Assistant imports): snapshot_builder.py feeds it
each poll and persists its state.
"""
from __future__ import annotations

from typing import Any

APPLE_COMPANY_ID = 76
FINDMY_TYPE = 0x12
SEPARATED_LEN = 0x19

DEVICE_TYPES = {0: "Apple device", 1: "AirTag", 2: "Find My accessory", 3: "AirPods"}
BATTERY = {0: "full", 1: "medium", 2: "low", 3: "very low"}

# An address heard within this is live; not heard for longer, it has stopped.
# A Find My tag advertises every 2 s, but a passive proxy's repeats reach
# PadSpan only at each reseed (bluetooth_live.py: 30 s default, 60 s max).
LIVE_S = 75.0
# How long after the old address stops the new one may still be linked.
HANDOVER_WINDOW_S = 300.0
# The new address may have first appeared this long before the old one's last
# report (the two are reported at different moments) ...
APPEAR_SLACK_S = 15.0
# ... or this long after it (the old one's last report lags its last advert
# by up to a reseed; a later arrival is someone else's tag).
APPEAR_AFTER_S = 45.0
# Mean RSSI difference over shared scanners that still reads "same place".
MAX_DB = 10.0
# How much better the chosen pairing must be than any alternative.
MARGIN_DB = 6.0
# A scanner that heard one address this strongly but not the other at all
# counts as this much difference — more than MAX_DB, so a scanner only one
# side hears can never make two places look alike (round 8).
UNSHARED_STRONG_DBM = -80
UNSHARED_PENALTY_DB = 20.0
# The addresses a tag used before its current one, kept so a lingering one
# is recognised as that tag's.
PAST_MAX = 16
# A tracked tag not heard for this long is dropped from the bridge state.
FORGET_S = 3 * 86400.0


def _payload_bytes(value: Any) -> bytes | None:
    """manufacturer_data's value in any of the shapes PadSpan sees: bytes,
    a list of ints, "0x12 0x19 ..." (bluetooth_live.py) or plain hex."""
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    if isinstance(value, (list, tuple)):
        try:
            return bytes(int(v) & 0xFF for v in value)
        except (TypeError, ValueError):
            return None
    if isinstance(value, str):
        s = value.strip()
        try:
            if "0x" in s.lower() or " " in s:
                return bytes(int(p, 16) for p in s.replace(",", " ").split() if p)
            return bytes.fromhex(s)
        except ValueError:
            return None
    return None


def apple_payload(manufacturer_data: Any) -> bytes | None:
    """The Apple (0x004C) manufacturer payload, whatever the key's type."""
    if not isinstance(manufacturer_data, dict):
        return None
    for key in ("76", 76, "0x004C", "0x004c"):
        if key in manufacturer_data:
            return _payload_bytes(manufacturer_data[key])
    return None


def parse_findmy(manufacturer_data: Any) -> dict[str, Any] | None:
    """A Find My advertisement's readable parts, or None if it isn't one."""
    raw = apple_payload(manufacturer_data)
    if not raw or len(raw) < 3 or raw[0] != FINDMY_TYPE:
        return None
    status = raw[2]
    return {
        "separated": raw[1] == SEPARATED_LEN,
        "status": status,
        "device_type": (status >> 4) & 0x03,
        "battery": (status >> 6) & 0x03,
    }


def is_findmy_address(address: str) -> bool:
    """A static random address — first byte 0xC0-0xFF — as every Find My key makes."""
    try:
        return (int(str(address).split(":")[0], 16) & 0xC0) == 0xC0
    except (ValueError, IndexError):
        return False


def rssi_vector(rec: dict[str, Any], max_age_s: float = LIVE_S) -> dict[str, float]:
    """{scanner: rssi} for the scanners that heard this address recently."""
    out: dict[str, float] = {}
    for src, info in (rec.get("sources") or {}).items():
        if not isinstance(info, dict):
            continue
        rssi, age = info.get("rssi"), info.get("age_s")
        if isinstance(rssi, (int, float)) and (not isinstance(age, (int, float)) or age <= max_age_s):
            out[str(src)] = float(rssi)
    return out


def place_difference(a: dict[str, float], b: dict[str, float]) -> float | None:
    """How differently the scanners hear two addresses, in dB — None when no
    scanner heard both (then there is nothing to compare)."""
    shared = [s for s in a if s in b]
    if not shared:
        return None
    diffs = [abs(a[s] - b[s]) for s in shared]
    for s, v in list(a.items()) + list(b.items()):
        if s not in shared and v >= UNSHARED_STRONG_DBM:
            diffs.append(UNSHARED_PENALTY_DB)
    return sum(diffs) / len(diffs)


class FindMyBridge:
    """Which current address each known Find My tag is using.

    tags:       {identity key: {"addr", "type", "rssi", "last_ts"}} — one per
                tag PadSpan knows (labelled, or followed), keyed by the object
                key it had when first known (so its key never changes).
    first_seen: {addr: ts} for Find My addresses not (yet) linked to a tag.
    """

    def __init__(self, state: dict[str, Any] | None = None) -> None:
        state = state or {}
        self.tags: dict[str, dict[str, Any]] = {}
        for k, v in (state.get("tags") or {}).items():
            if isinstance(v, dict) and v.get("addr"):
                t = dict(v)
                t["past"] = [str(a) for a in (t.get("past") or [])][-PAST_MAX:]
                self.tags[str(k)] = t
        self.first_seen: dict[str, float] = {}
        # Until the first poll, every address in range counts as there all
        # along — after a restart nothing looks newly arrived (round 8).
        self._primed = False

    def to_state(self) -> dict[str, Any]:
        return {"tags": {k: dict(v) for k, v in self.tags.items()}}

    def identity_of(self, addr: str) -> str | None:
        """The tag an address is — its first, current or any earlier address."""
        for key, t in self.tags.items():
            if addr == key or t.get("addr") == addr or addr in (t.get("past") or ()):
                return key
        return None

    def unlink(self, key: str, now_ts: float) -> tuple[str, str] | None:
        """A person's "not this tag": undo the tag's last link. Its current
        address goes back to being its own device and is never linked to this
        tag again; the tag waits on its earlier address (not re-linked by
        itself — it's named again, or heard again). None if it never moved
        (round 9: a wrong link otherwise lasted until FORGET_S)."""
        t = self.tags.get(key)
        if not t or not t.get("past"):
            return None
        wrong = t["addr"]
        t["refused"] = ([a for a in (t.get("refused") or []) if a != wrong] + [wrong])[-PAST_MAX:]
        t["addr"] = t["past"].pop()
        t["last_ts"] = now_ts - HANDOVER_WINDOW_S - 1      # not waiting for a hand-over, not forgotten
        return wrong, t["addr"]

    def addresses_of(self, key: str) -> list[str]:
        t = self.tags.get(key) or {}
        return list(dict.fromkeys([key, *(t.get("past") or []), t.get("addr")]))

    def step(self, now_ts: float, records: dict[str, dict[str, Any]], known: dict[str, str]) -> dict[str, Any]:
        """One poll. `records`: this snapshot's {addr: rec} (age_s, sources,
        manufacturer_data). `known`: {addr: identity key} for Find My addresses
        the person has labelled or followed — each starts a tracked tag unless
        it already is one's. Returns {"map": {addr: identity key} for each
        tag's current address, "linked": [(identity key, old addr, new addr)]
        for links made this poll}."""
        linked: list[tuple[str, str, str]] = []
        fm: dict[str, dict[str, Any]] = {}
        for addr, rec in records.items():
            if not is_findmy_address(addr):
                continue
            adv = parse_findmy(rec.get("manufacturer_data"))
            if adv is None:
                continue
            age = rec.get("age_s")
            age = float(age) if isinstance(age, (int, float)) else 0.0
            fm[addr] = {"adv": adv, "age": age, "rssi": rssi_vector(rec), "seen_ts": now_ts - age}

        if not self._primed:
            for addr in fm:
                self.first_seen[addr] = float("-inf")
            self._primed = True

        # A known address starts a tag — never one that is already a tag's
        # (a lingering old address would pull the identity back: round 8).
        for addr, key in known.items():
            c = fm.get(addr)
            if c is None or c["age"] > LIVE_S or self.identity_of(addr) is not None:
                continue
            if key in self.tags:
                # The same identity on a newer address the person named: only
                # if heard more recently than the tag's own address.
                if c["seen_ts"] <= float(self.tags[key].get("last_ts") or 0):
                    continue
                self.tags[key]["past"] = (self.tags[key].get("past", []) + [self.tags[key]["addr"]])[-PAST_MAX:]
            self.tags[key] = {"addr": addr, "type": c["adv"]["device_type"], "rssi": c["rssi"],
                              "last_ts": c["seen_ts"], "past": self.tags.get(key, {}).get("past", [])}
        # Each tag's last report and picture, from its current address.
        for t in self.tags.values():
            cur = fm.get(t["addr"])
            if cur is None:
                continue
            t["last_ts"] = max(float(t.get("last_ts") or 0), cur["seen_ts"])
            if cur["age"] <= LIVE_S:
                t["type"] = cur["adv"]["device_type"]
                if cur["rssi"]:
                    t["rssi"] = cur["rssi"]

        owned = {a for k in self.tags for a in self.addresses_of(k)}
        for addr, cur in fm.items():
            if addr not in owned and addr not in known:
                self.first_seen.setdefault(addr, cur["seen_ts"])
        for addr in [a for a in self.first_seen if a not in fm or a in owned]:
            self.first_seen.pop(addr, None)

        # Tags whose address has stopped, recently: waiting for their next one.
        waiting = {key: t for key, t in self.tags.items()
                   if LIVE_S < now_ts - float(t.get("last_ts") or 0) <= HANDOVER_WINDOW_S}
        # Live addresses no tag owns: could be one of them.
        fresh = {a: c for a, c in fm.items() if a not in owned and a not in known and c["age"] <= LIVE_S}
        pairs: list[tuple[float, str, str]] = []
        for key, t in waiting.items():
            last = float(t["last_ts"])
            for addr, c in fresh.items():
                if c["adv"]["device_type"] != t.get("type") or addr in (t.get("refused") or ()):
                    continue
                appeared = self.first_seen.get(addr, c["seen_ts"])
                if not (last - APPEAR_SLACK_S <= appeared <= last + APPEAR_AFTER_S):
                    continue      # there all along, or arrived well after: not this hand-over
                d = place_difference(t.get("rssi") or {}, c["rssi"])
                if d is not None:
                    pairs.append((d, key, addr))
        # Unambiguous pairings only: within MAX_DB, and better than every
        # alternative for either side — near or not — by MARGIN_DB.
        for d, key, addr in sorted(pairs):
            if d > MAX_DB or key not in waiting or addr not in fresh:
                continue
            rivals = [p[0] for p in pairs if (p[1] == key) != (p[2] == addr)]
            if rivals and min(rivals) - d < MARGIN_DB:
                continue
            old = self.tags[key]["addr"]
            self.tags[key] = {"addr": addr, "type": fresh[addr]["adv"]["device_type"],
                              "rssi": fresh[addr]["rssi"], "last_ts": fresh[addr]["seen_ts"],
                              "past": (self.tags[key].get("past", []) + [old])[-PAST_MAX:],
                              "refused": self.tags[key].get("refused", [])}
            linked.append((key, old, addr))
            waiting.pop(key)
            fresh.pop(addr)
            self.first_seen.pop(addr, None)

        for key in [k for k, t in self.tags.items() if now_ts - float(t.get("last_ts") or 0) > FORGET_S]:
            self.tags.pop(key)
        return {"map": {t["addr"]: k for k, t in self.tags.items()}, "linked": linked}
