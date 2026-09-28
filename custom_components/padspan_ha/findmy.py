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

HOW WELL IT WORKS
=================
For the opt-in report (telemetry.py), step() also says how each tag's
hand-over window ended: a link, or — once, when the window closes with none —
the strongest reason no link was made (MISS_REASONS). Only "ambiguous" and
"late" are the matcher turning down what was most likely the tag; the others
are a tag that left range, or another device's change the rules rightly
ignored. A window the bridge did not watch whole — it was not running yet (a
restart), or bridging was off (unwatched()) — is never reported. It says
which moves back were a tag back on its day key (the Find My schedule)
rather than a link undone. on_air() and FindMyBridge.stats() count; neither
ever hands back an address.

Separated or near its owner is read off EVERY report heard within LIVE_S
(separated_report()): each scanner's row is the last advert THAT scanner
caught, so one row can be another moment's payload, hours old — and merging
rows into one record keeps an arbitrary one (review, 2026-09-27: the
house's own separated AirTag read as near its owner).

This module is pure (no Home Assistant imports): snapshot_builder.py feeds it
each poll and persists its state.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

APPLE_COMPANY_ID = 76
FINDMY_TYPE = 0x12
SEPARATED_LEN = 0x19

DEVICE_TYPES = {0: "Apple device", 1: "AirTag", 2: "Find My accessory", 3: "AirPods"}
# The same, as the opt-in report counts them: short fixed keys, never a label.
TYPE_KEYS = {0: "apple", 1: "airtag", 2: "accessory", 3: "airpods"}
BATTERY = {0: "full", 1: "medium", 2: "low", 3: "very low"}
# Why a hand-over window closed with no link, weakest first (a window is
# reported once, by the strongest it came to):
#   no_candidate  no new same-type address at the moment the tag stopped, nor
#                 a little later where it was: it most likely left range;
#   elsewhere     one appeared at that moment (APPEAR_SLACK_S before ..
#                 APPEAR_AFTER_S after its last report) but not where it was,
#                 or where no scanner heard both — another device's own
#                 change, or the tag carried off as it changed: the two look
#                 the same, so neither is counted against the matcher;
#   late          one appeared where it was, after APPEAR_AFTER_S but no
#                 later than a real hand-over can be first heard on this
#                 install (a reseed + the longest gap between polls + an
#                 advert): the timing rule turned it down. At the defaults
#                 (30 s reseed, polls 5-10 s apart) that is inside
#                 APPEAR_AFTER_S, so nothing is late;
#   ambiguous     one fitted, but the pairing was too close to call (MARGIN_DB).
MISS_REASONS = ("no_candidate", "elsewhere", "late", "ambiguous")

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
# How far apart a Find My device's adverts are: its last on the old address
# and its first on the new one.
ADVERT_S = 2.0
# bluetooth_live.py's reseed when the install sets none (ble_reseed_interval_s).
RESEED_S = 30.0
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
# An address a tag used before, heard this recently and this long after the
# tag's last link: the tag is on it again — a Find My key never comes back
# to another device (rounds 10-11).
RETURN_FRESH_S = 10.0
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


def separated_report(manufacturer_data: Any, age_s: Any) -> bool:
    """One scanner's report says a Find My device is away from its owner:
    heard within LIVE_S, with the separated payload. An address is separated
    when ANY of its reports says so (on_air(); snapshot_builder marks the
    merged record `findmy_separated` for step())."""
    if not isinstance(age_s, (int, float)) or age_s > LIVE_S:
        return False
    adv = parse_findmy(manufacturer_data)
    return adv is not None and adv["separated"]


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


def on_air(advertisements: Any) -> dict[str, dict[str, int]]:
    """How many Find My addresses are on the air now, by device type, and how
    many of those are separated from their owner — whether following tags
    would matter in this house at all, bridging on or off. Each address is
    read only to count it once — separated when any of its reports heard
    within LIVE_S says so (separated_report()). Addresses, not devices: for
    up to LIVE_S after a device near its owner changes address (every 15
    minutes) its old one still counts too, and neighbours' and passers-by's
    are on the air."""
    advs: dict[str, dict[str, Any]] = {}
    for a in advertisements or ():
        if not isinstance(a, dict):
            continue
        addr, age = str(a.get("address") or "").upper(), a.get("age_s")
        if not is_findmy_address(addr) or not isinstance(age, (int, float)) or age > LIVE_S:
            continue
        adv = parse_findmy(a.get("manufacturer_data"))
        if adv is None:
            continue
        if addr in advs:
            advs[addr]["separated"] = advs[addr]["separated"] or adv["separated"]
        else:
            advs[addr] = adv
    out = {"on_air": dict.fromkeys(TYPE_KEYS.values(), 0), "separated": dict.fromkeys(TYPE_KEYS.values(), 0)}
    for adv in advs.values():
        k = TYPE_KEYS[adv["device_type"]]
        out["on_air"][k] += 1
        out["separated"][k] += int(adv["separated"])
    return out


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
        # (tag, earlier address) -> (when it was first heard again, the link
        # it was heard after): a return is acted on only when a LATER report
        # confirms it (round 11), and only for that same link (round 13).
        self._returning: dict[tuple[str, str], tuple[float, float]] = {}
        # Tag waiting for its next address -> the strongest MISS_REASONS index
        # its window has come to; None for a window the bridge did not watch
        # whole (_report_lag): never reported. In memory only, as the
        # report's own counters are — never saved, so a restart can neither
        # count a window twice nor trip on an older state file.
        self._waiting: dict[str, int | None] = {}
        # (now_ts, stepped) for this run's recent polls — False for a poll
        # with bridging off (unwatched()): how closely each window was seen.
        self._polls: list[tuple[float, bool]] = []

    def to_state(self) -> dict[str, Any]:
        return {"tags": {k: dict(v) for k, v in self.tags.items()}}

    def stats(self, now_ts: float) -> dict[str, Any]:
        """The tags followed, by device type; how many are on the air now; how
        many are on an address other than the one they were first known by."""
        tracked = dict.fromkeys(TYPE_KEYS.values(), 0)
        live = carried = 0
        for key, t in self.tags.items():
            if t.get("type") in TYPE_KEYS:
                tracked[TYPE_KEYS[t["type"]]] += 1
            live += int(now_ts - float(t.get("last_ts") or 0) <= LIVE_S)
            carried += int(t.get("addr") != key)
        return {"tracked": tracked, "tracked_live": live, "tracked_carried": carried}

    def identity_of(self, addr: str) -> str | None:
        """The tag an address is — its first, current or any earlier address."""
        for key, t in self.tags.items():
            if addr == key or t.get("addr") == addr or addr in (t.get("past") or ()):
                return key
        return None

    def unlink(self, key: str, now_ts: float, address: str | None = None) -> tuple[str, str] | None:
        """A person's "not this tag": undo the tag's last link. Its current
        address goes back to being its own device and is never linked to this
        tag again; the tag waits on its earlier address (not re-linked by
        itself — it's named again, or heard again). `address`: the address
        the person is looking at — only that one is ever refused (round 10:
        the button refused whatever was current). None if the tag never
        moved, or `address` isn't its current one (round 9: a wrong link
        otherwise lasted until FORGET_S)."""
        t = self.tags.get(key)
        if not t or not t.get("past") or (address is not None and t.get("addr") != address):
            return None
        wrong = t["addr"]
        t["refused"] = ([a for a in (t.get("refused") or []) if a != wrong] + [wrong])[-PAST_MAX:]
        t["addr"] = t["past"].pop()
        t["last_ts"] = now_ts - HANDOVER_WINDOW_S - 1      # not waiting for a hand-over, not forgotten
        t.pop("linked_ts", None)
        # The hand-over this undoes was counted once, as the link. Its earlier
        # address lingers in HA's list, so the next poll can put the tag back
        # in that same window: never reported again (a later one is).
        self._waiting[key] = None
        return wrong, t["addr"]

    def _move_back(self, key: str, x: str, seen_ts: float) -> list[str]:
        """The tag is on its earlier address `x` again: every address it was
        linked to after `x` was a dead key of its own or another device —
        dropped from it and kept from it. Returns those addresses."""
        t = self.tags[key]
        past = list(t.get("past") or [])
        if x in past:
            i = len(past) - 1 - past[::-1].index(x)
            later, past = past[i + 1:] + [t["addr"]], past[:i]
        else:                                    # its first address
            later, past = past + [t["addr"]], []
        later = [a for a in dict.fromkeys(later) if a != x]
        t["refused"] = ([a for a in (t.get("refused") or []) if a not in later] + later)[-PAST_MAX:]
        t["past"], t["addr"], t["last_ts"] = past, x, seen_ts
        t.pop("linked_ts", None)
        return later

    def addresses_of(self, key: str) -> list[str]:
        t = self.tags.get(key) or {}
        return list(dict.fromkeys([key, *(t.get("past") or []), t.get("addr")]))

    def _poll(self, now_ts: float, stepped: bool) -> None:
        polls = self._polls
        polls.append((now_ts, stepped))
        # Kept back to the earliest window still open, and one poll before it.
        horizon = now_ts - HANDOVER_WINDOW_S - APPEAR_SLACK_S
        while len(polls) > 1 and polls[1][0] < horizon:
            polls.pop(0)

    def unwatched(self, now_ts: float) -> None:
        """A poll with bridging off: nothing is followed, so a hand-over
        window around it is one the bridge never saw — never reported once
        bridging is back on (review, 2026-09-27: it was filed "late")."""
        self._poll(now_ts, False)

    def _report_lag(self, last: float, reseed_s: float) -> float | None:
        """How long after `last` (a tag's last report) a real hand-over's new
        address can be first heard here: a reseed (a passive proxy's reports
        come only then), the longest gap between polls from APPEAR_SLACK_S
        before `last` to LIVE_S after it (an address is stamped when a poll
        first sees it), and an advert. None when the bridge did not watch
        that stretch: it was not running yet — a restart's first poll takes
        whatever is on the air for there all along, the new address too — or
        bridging was off."""
        start, end = last - APPEAR_SLACK_S, last + LIVE_S
        polls = self._polls
        if not polls or polls[0][0] > start:
            return None
        gap = 0.0
        for (a, stepped_a), (b, stepped_b) in zip(polls, polls[1:]):
            if b > start and a < end:
                if not (stepped_a and stepped_b):
                    return None
                gap = max(gap, b - a)
        return reseed_s + gap + ADVERT_S

    def step(self, now_ts: float, records: dict[str, dict[str, Any]], known: dict[str, str],
             reseed_s: float = RESEED_S) -> dict[str, Any]:
        """One poll. `records`: this snapshot's {addr: rec} (age_s, sources,
        manufacturer_data, and `findmy_separated` when any report heard
        within LIVE_S carries the separated payload). `known`: {addr:
        identity key} for Find My addresses the person has labelled or
        followed — each starts a tracked tag unless it already is one's.
        `reseed_s`: bluetooth_live's reseed interval, for the report's
        "late" (_report_lag). Returns {"map": {addr: identity key} for each
        tag's current address, "linked": [(identity key, old addr, new addr)]
        for links made this poll, "linked_after_s": for each link, seconds
        since the old address's last report, "unlinked": [(identity key,
        dropped addr, earlier addr)] for moves back, "back_on_day_key":
        [identity key] for the moves back that were a tag back on its day
        key, "missed": [(identity key, MISS_REASONS entry)] for hand-over
        windows that closed this poll with no link}."""
        self._poll(now_ts, True)
        linked: list[tuple[str, str, str]] = []
        linked_after: list[float] = []
        fm: dict[str, dict[str, Any]] = {}
        for addr, rec in records.items():
            if not is_findmy_address(addr):
                continue
            adv = parse_findmy(rec.get("manufacturer_data"))
            if adv is None:
                continue
            age = rec.get("age_s")
            age = float(age) if isinstance(age, (int, float)) else 0.0
            # When it was last heard: the record's own absolute stamp when it
            # has one — now minus age is measured at a different moment each
            # build, and that jitter made one unchanged report look like a
            # newer one (round 12).
            seen_ts = now_ts - age
            ls = rec.get("last_seen")
            if isinstance(ls, str) and ls:
                try:
                    seen_ts = datetime.fromisoformat(ls.replace("Z", "+00:00")).timestamp()
                except ValueError:
                    pass
            fm[addr] = {"adv": adv, "age": age, "rssi": rssi_vector(rec), "seen_ts": seen_ts,
                        "separated": bool(rec.get("findmy_separated"))}

        if not self._primed:
            for addr in fm:
                self.first_seen[addr] = float("-inf")
            self._primed = True

        # An address a tag used before, on the air again after its last link:
        # a Find My key never comes back to another device, so the tag is on
        # it now — a separated tag returns to its day key; a wrong link's own
        # tag reappears — and every address linked since is dropped from it.
        # Only on a SECOND, newer report: HA replays cached history into a
        # new callback, and one fresh-looking report is not proof (round 11).
        unlinked: list[tuple[str, str, str]] = []
        day_key: list[str] = []
        # A pending return belongs to the link it was heard after: once the
        # tag is unlinked, moved back, re-linked or forgotten it is void — a
        # stale one let ONE report confirm a return (review round 13).
        self._returning = {ck: v for ck, v in self._returning.items()
                           if (self.tags.get(ck[0]) or {}).get("linked_ts") == v[1]}
        for key, t in list(self.tags.items()):
            linked_ts = t.get("linked_ts")
            if not linked_ts:
                continue
            earlier = [a for a in reversed(t.get("past") or []) if a != t["addr"]]
            if key not in earlier and key != t["addr"]:
                earlier.append(key)
            for x in earlier:
                c, ck = fm.get(x), (key, x)
                # Waiting for the confirming report while the address is still
                # heard (up to LIVE_S — a passive proxy's repeats come only at
                # each 30-60 s reseed); dropped once it has been quiet.
                if c is None or c["age"] > LIVE_S or c["seen_ts"] <= float(linked_ts) + RETURN_FRESH_S:
                    self._returning.pop(ck, None)
                    continue
                pending = self._returning.get(ck)
                if pending is None:
                    if c["age"] <= RETURN_FRESH_S:
                        self._returning[ck] = (c["seen_ts"], linked_ts)
                    continue
                first = pending[0]
                # Confirmed only by a fresh report heard at least a second
                # after the first one.
                if c["age"] > RETURN_FRESH_S or c["seen_ts"] < first + 1.0:
                    continue
                # A separated key again, after a near-owner one: the tag is
                # separated again the same day — the schedule, and the links
                # since were right. Anything else coming back undoes a wrong
                # link: a near-owner key is never used twice, and a separated
                # one changes only to the next day's. Near its owner is what
                # a key was when the tag was linked onto it (its record now
                # has stopped, or is gone). And the key it is on must have
                # stopped before this one came back: two addresses heard at
                # once — even stamped the same moment, as one reseed stamps
                # both — are two devices: a wrong link onto another device's
                # key, that device still on the air (review, 2026-09-27). A
                # real return is an advert (ADVERT_S) after the last on the
                # key it leaves.
                left = fm.get(t["addr"])
                near_owner = set(t.get("near_owner") or ())
                dropped = self._move_back(key, x, c["seen_ts"])
                if (c["separated"] and near_owner.intersection(dropped)
                        and (left is None or left["seen_ts"] < first)):
                    day_key.append(key)
                for gone in dropped:
                    unlinked.append((key, gone, x))
                self._returning = {k: v for k, v in self._returning.items() if k[0] != key}
                break

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
        # For the report (MISS_REASONS): waiting tags a new same-type address
        # appeared for at the hand-over moment, and (tag, address) where the
        # tag was but late; how closely each window was watched.
        in_time: set[str] = set()
        late: set[tuple[str, str]] = set()
        lag = {key: self._report_lag(float(t["last_ts"]), reseed_s) for key, t in waiting.items()}
        for key, t in waiting.items():
            last = float(t["last_ts"])
            for addr, c in fresh.items():
                if c["adv"]["device_type"] != t.get("type") or addr in (t.get("refused") or ()):
                    continue
                appeared = self.first_seen.get(addr, c["seen_ts"])
                if appeared < last - APPEAR_SLACK_S:
                    continue      # there all along: not this hand-over
                d = place_difference(t.get("rssi") or {}, c["rssi"])
                if appeared > last + APPEAR_AFTER_S:
                    # Arrived well after: not this hand-over. Where the tag was,
                    # no later than a real one can be first heard on this
                    # install, it is the timing rule's miss; later or
                    # elsewhere, someone else's.
                    if lag[key] is not None and appeared <= last + lag[key] and d is not None and d <= MAX_DB:
                        late.add((key, addr))
                    continue
                in_time.add(key)
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
            linked_after.append(now_ts - float(self.tags[key]["last_ts"]))
            # The keys it was linked onto while near its owner — read now,
            # while the key is live; at a return it has stopped (above).
            near_owner = list(self.tags[key].get("near_owner") or [])
            if not fresh[addr]["separated"]:
                near_owner = (near_owner + [addr])[-(PAST_MAX + 1):]
            self.tags[key] = {"addr": addr, "type": fresh[addr]["adv"]["device_type"],
                              "rssi": fresh[addr]["rssi"], "last_ts": fresh[addr]["seen_ts"],
                              "past": (self.tags[key].get("past", []) + [old])[-PAST_MAX:],
                              "refused": self.tags[key].get("refused", []), "linked_ts": now_ts}
            if near_owner:
                self.tags[key]["near_owner"] = near_owner
            linked.append((key, old, addr))
            waiting.pop(key)
            fresh.pop(addr)
            self.first_seen.pop(addr, None)

        # Each window keeps the strongest reason it came to; one that closes
        # with no link reports it, once. A tag heard again on its own address,
        # moved back or linked closes its window without a miss. Only a
        # candidate still free counts against it: one linked to another tag
        # just now was that tag's, no rival of this one (review, 2026-09-27).
        near = {key for d, key, a in pairs if d <= MAX_DB and a in fresh}
        late_keys = {key for key, a in late if a in fresh}
        for key in waiting:
            rank = MISS_REASONS.index("ambiguous" if key in near else "late" if key in late_keys
                                      else "elsewhere" if key in in_time else "no_candidate")
            if key not in self._waiting:
                self._waiting[key] = None if lag[key] is None else rank
            elif self._waiting[key] is not None:
                self._waiting[key] = max(self._waiting[key], rank)
        missed: list[tuple[str, str]] = []
        for key in [k for k in self._waiting if k not in waiting]:
            rank = self._waiting.pop(key)
            t = self.tags.get(key)
            if rank is not None and t is not None and now_ts - float(t.get("last_ts") or 0) > HANDOVER_WINDOW_S:
                missed.append((key, MISS_REASONS[rank]))

        for key in [k for k, t in self.tags.items() if now_ts - float(t.get("last_ts") or 0) > FORGET_S]:
            self.tags.pop(key)
        return {"map": {t["addr"]: k for k, t in self.tags.items()}, "linked": linked,
                "linked_after_s": linked_after, "unlinked": unlinked, "back_on_day_key": day_key,
                "missed": missed}
