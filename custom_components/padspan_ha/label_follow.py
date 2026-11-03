# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""A name that follows a device whose address rotates, on screen only.

Someone names a device. Its address changes. The merges won't move the name
(merge_guard.py) because a wrong guess there mixes another device's signal into
calibration. So the name stayed on the first address and aged. This follows it
on evidence, and keeps what it concludes away from everything stored.

WHAT A LINK NEEDS (all of it)
=============================
  * the new address appears as the old one stops: the two windows don't overlap
    and the gap is under GAP_S;
  * the same broadcast name, or the same distinctive payload;
  * the same maker and kind;
  * the receivers hear it where they heard the old one: at least MIN_RECEIVERS
    heard both, within MAX_DB (findmy.place_difference);
  * exactly one address fits;
  * the address is one a radio calls random, or is rotating-shaped. One a radio
    calls public never takes part.

Measured on Garry's house, 2026-11-02: five days of saved snapshots replayed, with
every rotating address treated as someone's device and the name and payload
hidden, so devices of one maker and kind had only the moment and the place to tell
them apart. Identity came from what the rule never reads (an iBeacon id, a payload
that stayed the same, an AirPlay target's IP). One receiver: 2 right, 13 wrong. Two
or more, within MAX_DB: 227 right, 1 doubtful (one spot, two IPs, likely one Mac).
MAX_DB under 5 lost right ones and over 5 added only coincidences; GAP_S over 90
turned right ones ambiguous and under 90 lost them. Very few devices there both
rotate and send a name (a TV: 2 of 2 right), so this is one house's evidence.

WHAT MISSES BY ONE
==================
Good evidence that misses one test is asked about, never linked: one quiet line
on the new address's row, "This looks like <label>: same device?"
  gap    same name or payload, but heard long after the old one stopped;
  place  same name or payload at the right moment, but the receivers disagree
         or too few heard both;
  weak   no name or payload to compare, but the moment and the place fit, and
         it is the only one of its maker and kind.
Yes makes that one link the person's. No is remembered.

WHAT A LINK TOUCHES
===================
The screen. overlay() runs on ws_live_snapshot's own copies, last, and nothing
else reads this module: calibration's auto points, adaptive learning, Follow's
alerts, the device registry and padspan_id see the snapshot _live_snapshot
built, which this never changes. Even a person's Yes stays on screen: those
accept only an identity that is proven (a public address, an iBeacon id, an
IRK). `address` and `all_addresses` stay as they were on the row too, because
Calibration's own capture matches adverts by them.

This module is pure (no Home Assistant imports): snapshot_builder.py feeds it
each poll and persists its state.
"""
from __future__ import annotations

from datetime import datetime
import re
from typing import Any

from .findmy import LIVE_S, _payload_bytes, place_difference, rssi_vector

# The new address may have first been heard this long before the old one's last
# report: the two are reported at different moments.
SLACK_S = 15.0
# ... and at most this long after it. "A small limit": a real change takes a
# moment, plus a passive proxy's reseed (30 s, up to 60 s), plus a poll.
GAP_S = 90.0
# How long after the old address stops a link may still land: a new address can
# take a while to show its name.
WINDOW_S = 300.0
# How the receivers must agree.
MAX_DB = 5.0
MIN_RECEIVERS = 2
# A payload counts as evidence only if it could tell two devices apart: long
# enough, and not one byte over and over.
MIN_PAYLOAD_BYTES = 6
MIN_PAYLOAD_DISTINCT = 4
# A name this short is a fragment, not a name (one house has a device named "4"),
# and these say nothing (the same-name merge skips them too).
MIN_NAME = 3
_NOT_A_NAME_RE = re.compile(r"^([0-9A-Fa-f]{2}[:\-]){2,}|^[0-9A-Fa-f]{4,}$|^BLE$|^Unknown$")
# How long after the old address stopped a same-named new one is still asked about.
ASK_MAX_GAP_S = 7 * 86400.0
# Changes of address before the pointer to the real fix (an IRK).
HINT_AFTER = 3
# Addresses kept per link and refused per device.
PATH_MAX = 16
REFUSED_MAX = 64
# How long an undone link is watched for the radio to confirm it was wrong.
UNDONE_WATCH_S = 7 * 86400.0

_APPLE_KEYS = ("76", "0x004c", "0x004C")
_MAC_LEN = 17


def is_plain_mac(value: Any) -> bool:
    """AA:BB:CC:DD:EE:FF, the only shape of address this follows."""
    return isinstance(value, str) and len(value) == _MAC_LEN and value.count(":") == 5


def may_rotate(address: str, address_type: Any) -> bool:
    """A radio called it random, or nobody said and it is rotating-shaped. One a
    radio calls public never rotates, whatever its top bits look like."""
    if address_type == "public":
        return False
    if address_type == "random":
        return True
    try:
        return (int(address.split(":")[0], 16) & 0xC0) == 0x40
    except (ValueError, IndexError):
        return False


def real_name(rec: dict[str, Any]) -> str:
    """The name the device itself sent, or "" (an advert's name is often just
    its address). Case-sensitive on purpose: another spelling is another name."""
    name = str(rec.get("broadcast_name") or rec.get("name") or "").replace("\x00", "").strip()
    if len(name) < MIN_NAME or _NOT_A_NAME_RE.match(name):
        return ""
    return name


def distinctive_payloads(rec: dict[str, Any]) -> dict[str, bytes]:
    """{company or service: bytes} worth comparing. Not Apple's: its continuity
    bytes change by the minute, and an iBeacon is a proven identity already."""
    out: dict[str, bytes] = {}
    for prefix, block in (("m", rec.get("manufacturer_data")), ("s", rec.get("service_data"))):
        for key, value in (block or {}).items():
            if prefix == "m" and str(key) in _APPLE_KEYS:
                continue
            raw = _payload_bytes(value)
            if raw and len(raw) >= MIN_PAYLOAD_BYTES and len(set(raw)) >= MIN_PAYLOAD_DISTINCT:
                out[f"{prefix}:{key}"] = raw
    return out


def maker_kind(rec: dict[str, Any]) -> tuple[frozenset, int | None, frozenset]:
    """(company numbers, Apple's message type, services): what it says it is."""
    md = rec.get("manufacturer_data") or {}
    apple = None
    for key in _APPLE_KEYS:
        if key in md:
            raw = _payload_bytes(md[key])
            apple = raw[0] if raw else None
            break
    services = {str(u).lower() for u in (rec.get("service_uuids") or [])}
    services |= {str(u).lower() for u in (rec.get("service_data") or {})}
    return frozenset(str(k) for k in md), apple, frozenset(services)


def same_maker_kind(a: tuple, b: tuple) -> bool:
    """Same company numbers and Apple message type. Services must share one when
    both have any (each advert lists only some), and neither may have them alone."""
    if a[0] != b[0] or a[1] != b[1]:
        return False
    return (not a[2] and not b[2]) or bool(a[2] & b[2])


def says_something(mk: tuple) -> bool:
    """False for an advert with no maker and no service: nothing to compare."""
    return bool(mk[0] or mk[2])


def same_identity_data(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """The same broadcast name, or the same distinctive payload."""
    an = real_name(a)
    if an and an == real_name(b):
        return True
    pa = distinctive_payloads(a)
    if not pa:
        return False
    pb = distinctive_payloads(b)
    return any(pb.get(k) == v for k, v in pa.items())


def _seen_ts(rec: dict[str, Any], now_ts: float) -> float:
    """When it was last heard: the record's own stamp when it has one."""
    stamp = rec.get("last_seen")
    if isinstance(stamp, str) and stamp:
        try:
            return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
    age = rec.get("age_s")
    return now_ts - (float(age) if isinstance(age, (int, float)) else 0.0)


def _heard_at(rec: dict[str, Any]) -> dict[str, float]:
    """Each receiver's reading, from an hour-old record or a live one."""
    return rssi_vector(rec, max_age_s=float("inf"))


class LabelLinks:
    """Which address each named or followed device is using, as far as the screen
    goes.

    links:    {first address: {"path": [{"a", "by", "ts"}]}}. "by" is "evidence" or
              "you"; the last entry is the address it uses now.
    asks:     {first address: {"a", "why", "ts"}}: the question open for it.
    refused:  {first address: [addresses]}: answered No, or undone.
    moves:    {first address: n}: new addresses it has been linked to or asked about.
    hint_off: first addresses whose pointer to an IRK was dismissed.
    undone:   {first address: {"a", "ts"}}: for the report's wrong-after-undo.
    """

    def __init__(self, state: dict[str, Any] | None = None) -> None:
        state = state if isinstance(state, dict) else {}

        def book(name: str) -> dict[str, Any]:
            value = state.get(name)
            return {str(k): v for k, v in value.items()} if isinstance(value, dict) else {}

        self.links: dict[str, dict[str, Any]] = {}
        for root, entry in book("links").items():
            path = [dict(p) for p in (entry.get("path") or []) if isinstance(p, dict) and p.get("a")] \
                if isinstance(entry, dict) else []
            if path:
                self.links[root] = {"path": path}
        self.moves: dict[str, int] = {k: v for k, v in book("moves").items() if isinstance(v, int)}
        self.asks: dict[str, dict[str, Any]] = {
            k: dict(v) for k, v in book("asks").items() if isinstance(v, dict) and v.get("a")}
        self.refused: dict[str, list[str]] = {
            k: [str(a) for a in v][-REFUSED_MAX:] for k, v in book("refused").items() if isinstance(v, list)}
        off = state.get("hint_off")
        self.hint_off: set[str] = {str(a) for a in off} if isinstance(off, list) else set()
        self.undone: dict[str, dict[str, Any]] = {
            k: dict(v) for k, v in book("undone").items() if isinstance(v, dict) and v.get("a")}
        # In memory only. first_heard: {address: when first heard}; -inf for one
        # on the air when this started (after a restart nothing looks new).
        self.first_heard: dict[str, float] = {}
        self._primed = False
        # {address: {"ts", "rssi", "rec"}} as each watched address last sounded.
        self._last: dict[str, dict[str, Any]] = {}
        # {(first address, address): the report that may mean it is back}.
        self._returning: dict[tuple[str, str], float] = {}
        # Asked-about pairs this run, so the report counts each once.
        self._asked: set[tuple[str, str]] = set()
        self._events: list[str] = []
        # This poll's watched devices, and the addresses links already use.
        self._watched: dict[str, Any] = {}
        self._taken: set[str] = set()
        self.dirty = False

    def to_state(self) -> dict[str, Any]:
        return {"links": {k: {"path": [dict(p) for p in v["path"]]} for k, v in self.links.items()},
                "asks": {k: dict(v) for k, v in self.asks.items()},
                "refused": {k: list(v) for k, v in self.refused.items() if v},
                "moves": dict(self.moves),
                "hint_off": sorted(self.hint_off),
                "undone": {k: dict(v) for k, v in self.undone.items()}}

    def current(self, root: str) -> str:
        link = self.links.get(root)
        return link["path"][-1]["a"] if link else root

    def shows_anything(self) -> bool:
        """Is there anything for overlay() to put on the screen?"""
        return bool(self.links or self.asks or any(n >= HINT_AFTER for n in self.moves.values()))

    # ── A person's answers ─────────────────────────────────────────────────

    def answer(self, root: str, address: str, yes: bool, now_ts: float) -> bool:
        """Yes or No to the open question. False when that isn't the question open."""
        ask = self.asks.get(root)
        if not ask or ask.get("a") != address:
            return False
        del self.asks[root]
        if yes:
            self._link(root, address, "you", now_ts, count_move=False)
        else:
            self._refuse(root, [address])
        self.dirty = True
        return True

    def undo(self, root: str, now_ts: float) -> bool:
        """Remove the whole link: the name goes back to the first address, and the
        addresses it passed through are never linked to it again."""
        link = self.links.pop(root, None)
        if not link:
            return False
        addrs = [p["a"] for p in link["path"]]
        self._refuse(root, addrs)
        self.undone[root] = {"a": addrs[-1], "ts": now_ts}
        self._last.pop(addrs[-1], None)
        self._returning = {k: v for k, v in self._returning.items() if k[0] != root}
        self.dirty = True
        return True

    def dismiss_hint(self, root: str) -> None:
        self.hint_off.add(root)
        self.dirty = True

    def _refuse(self, root: str, addrs: list[str]) -> None:
        had = [a for a in self.refused.get(root, []) if a not in addrs]
        self.refused[root] = (had + addrs)[-REFUSED_MAX:]

    def _link(self, root: str, address: str, by: str, now_ts: float, count_move: bool = True) -> None:
        link = self.links.setdefault(root, {"path": []})
        if link["path"]:
            self._last.pop(link["path"][-1]["a"], None)
        link["path"] = (link["path"] + [{"a": address, "by": by, "ts": now_ts}])[-PATH_MAX:]
        if count_move:
            self.moves[root] = self.moves.get(root, 0) + 1

    # ── One poll ───────────────────────────────────────────────────────────

    def step(self, now_ts: float, records: dict[str, dict[str, Any]], watched: dict[str, dict[str, Any] | None],
             proven: set[str] | None = None, claimed: set[str] | None = None,
             history: dict[str, dict[str, Any]] | None = None) -> list[str]:
        """One poll. `records`: {address: this snapshot's record}. `watched`: {first
        address: its history entry or None} for each plain address someone named
        or followed that may rotate. `proven`: addresses with an identity of their
        own (IRK, iBeacon). `claimed`: addresses someone named or followed.
        `history`: the object history, for an address not on the air since a
        restart. Returns the report's events, once each."""
        self._events = []
        proven = proven or set()
        claimed = claimed if claimed is not None else set(watched)
        self._forget_unwatched(watched)
        if not watched:
            self._primed = False
            self.first_heard.clear()
            self._last.clear()
            return []
        self._note_first_heard(now_ts, records)
        self._watched = watched
        self._taken = {link["path"][-1]["a"] for link in self.links.values()}

        names: dict[str, list[str]] = {}
        for addr, rec in records.items():
            name = real_name(rec)
            if name:
                names.setdefault(name, []).append(addr)

        for root, hist in watched.items():
            self._check_returned(root, now_ts, records)
            cur = self.current(root)
            if cur != root and cur in claimed:
                self.links.pop(root, None)      # the address has a name of its own now
                self.dirty = True
                cur = root
            rec = records.get(cur)
            if rec is not None:
                seen = _seen_ts(rec, now_ts)
                prev = self._last.get(cur)
                if prev is None or seen > prev["ts"]:
                    # The name it sent outlives the advert that carried it.
                    kept = real_name(prev["rec"]) if prev else ""
                    self._last[cur] = {"ts": seen, "rssi": rssi_vector(rec),
                                       "rec": {**rec, "broadcast_name": kept} if kept and not real_name(rec) else rec}
            last = self._last.get(cur) or self._sounded(root, cur, hist, history)
            if last is None:
                continue
            self._follow_one(root, cur, last, now_ts, records, proven, claimed, names)
        self._check_undone(now_ts, records)
        return self._events

    def _count(self, event: str) -> None:
        self._events.append(event)

    def _sounded(self, root: str, cur: str, hist: dict[str, Any] | None,
                 history: dict[str, dict[str, Any]] | None) -> dict[str, Any] | None:
        """How the address it uses sounded, for one not on the air since a restart
        or since a person's Yes: its history entry, or (merged away) the first
        address's and the moment of the link."""
        entry = (history or {}).get(f"ble:{cur}") if cur != root else hist
        if isinstance(entry, dict) and isinstance(entry.get("_last_seen_ts"), (int, float)):
            age = entry.get("_cache_age_s")
            return {"ts": float(entry["_last_seen_ts"]) - (float(age) if isinstance(age, (int, float)) else 0.0),
                    "rssi": {}, "rec": entry}
        link = self.links.get(root)
        if link and isinstance(hist, dict):
            return {"ts": float(link["path"][-1].get("ts") or 0.0), "rssi": {}, "rec": hist}
        return None

    def _forget_unwatched(self, watched: dict[str, Any]) -> None:
        """Its name or its Follow was taken away, or it now has an identity of its
        own: the links, questions and answers about it go too."""
        for book in (self.links, self.asks, self.moves, self.refused, self.undone):
            for root in [r for r in book if r not in watched]:
                del book[root]
                self.dirty = True

    def _note_first_heard(self, now_ts: float, records: dict[str, dict[str, Any]]) -> None:
        first = self.first_heard
        if not self._primed:
            for addr in records:
                first[addr] = float("-inf")
            self._primed = True
            return
        for addr, rec in records.items():
            if addr not in first:
                first[addr] = _seen_ts(rec, now_ts)
        for addr in [a for a in first if a not in records]:
            del first[addr]

    def _check_returned(self, root: str, now_ts: float, records: dict[str, dict[str, Any]]) -> None:
        """An address it left is on the air again, so the hand-over wasn't one: back
        to the first address. Only on a second, newer report: Home Assistant
        replays cached history into a new callback (findmy.py, round 11)."""
        link = self.links.get(root)
        if not link:
            return
        made = float(link["path"][-1].get("ts") or 0.0)
        earlier = [root] + [p["a"] for p in link["path"][:-1]]
        for addr in earlier:
            rec = records.get(addr)
            if rec is None:
                continue
            seen = _seen_ts(rec, now_ts)
            if seen <= made:
                continue
            first = self._returning.get((root, addr))
            if first is None:
                self._returning[(root, addr)] = seen
            elif seen > first:
                self.links.pop(root, None)
                self._refuse(root, [p["a"] for p in link["path"]])
                self._returning = {k: v for k, v in self._returning.items() if k[0] != root}
                self.dirty = True
                self._count("label_link_old_back")
                return

    def _check_undone(self, now_ts: float, records: dict[str, dict[str, Any]]) -> None:
        """The radio says an undone link was wrong: both addresses on the air at once."""
        for root, entry in list(self.undone.items()):
            if now_ts - float(entry.get("ts") or 0.0) > UNDONE_WATCH_S:
                del self.undone[root]
                self.dirty = True
                continue
            a, b = records.get(root), records.get(entry["a"])
            if a is None or b is None:
                continue
            after = float(entry.get("ts") or 0.0)
            sa, sb = _seen_ts(a, now_ts), _seen_ts(b, now_ts)
            if sa > after and sb > after and abs(sa - sb) <= LIVE_S:
                del self.undone[root]
                self.dirty = True
                self._count("label_link_wrong_after_undo")

    def _candidate_ok(self, addr: str, rec: dict[str, Any], root: str, cur: str, proven: set[str],
                      claimed: set[str]) -> bool:
        if addr in (root, cur) or addr in proven or addr in claimed or addr in self._taken \
                or addr in self.refused.get(root, ()):
            return False
        return may_rotate(addr, rec.get("address_type"))

    def _drop_question_overtaken(self, root: str, silent: float, now_ts: float, records: dict[str, dict[str, Any]],
                                 proven: set[str], claimed: set[str]) -> None:
        """The question's address has an identity of its own now, or both addresses
        are on the air at once, which is two devices: nothing left to ask."""
        ask = self.asks.get(root)
        if not ask:
            return
        addr, cand = ask["a"], records.get(ask["a"])
        both_live = cand is not None and silent < LIVE_S and now_ts - _seen_ts(cand, now_ts) < LIVE_S \
            and _seen_ts(cand, now_ts) > float(ask.get("ts") or 0.0)
        if both_live:
            self._refuse(root, [addr])
        if both_live or addr in proven or addr in claimed:
            del self.asks[root]
            self.dirty = True

    def _another_could_be_it(self, root: str, addr: str, rec: dict[str, Any], mk: tuple, now_ts: float) -> bool:
        """Exactly one, from both sides: another named device that stopped at the same
        moment, with the same name or data, could as well be the one that moved."""
        for other in self._watched:
            if other == root:
                continue
            last = self._last.get(self.current(other))
            if last is None or not max(LIVE_S, GAP_S) <= now_ts - last["ts"] <= WINDOW_S:
                continue
            if last["ts"] - SLACK_S <= self.first_heard.get(addr, float("-inf")) <= last["ts"] + GAP_S \
                    and same_identity_data(last["rec"], rec) and same_maker_kind(maker_kind(last["rec"]), mk):
                return True
        return False

    def _follow_one(self, root: str, cur: str, last: dict[str, Any], now_ts: float, records: dict[str, dict[str, Any]],
                    proven: set[str], claimed: set[str], names: dict[str, list[str]]) -> None:
        last_ts = last["ts"]
        silent = now_ts - last_ts
        old = last["rec"]
        self._drop_question_overtaken(root, silent, now_ts, records, proven, claimed)
        old_mk = maker_kind(old)
        if silent < max(LIVE_S, GAP_S):
            return
        if silent <= WINDOW_S and last["rssi"] and self._hand_over(root, cur, last, old_mk, now_ts, records,
                                                                   proven, claimed):
            return
        if silent <= ASK_MAX_GAP_S:
            self._ask_late(root, cur, last, old, old_mk, now_ts, records, proven, claimed, names)
        ask = self.asks.get(root)
        if ask is not None and now_ts - float(ask.get("ts") or 0.0) > ASK_MAX_GAP_S:
            del self.asks[root]
            self.dirty = True

    def _hand_over(self, root: str, cur: str, last: dict[str, Any], old_mk: tuple, now_ts: float,
                   records: dict[str, dict[str, Any]], proven: set[str], claimed: set[str]) -> bool:
        """The old address has stopped and the window is open. True when it linked."""
        last_ts, old = last["ts"], last["rec"]
        first = self.first_heard
        lo, hi = last_ts - SLACK_S, last_ts + GAP_S
        timed = [a for a, r in records.items()
                 if lo <= first.get(a, float("-inf")) <= hi
                 and self._candidate_ok(a, r, root, cur, proven, claimed)]
        if not timed:
            return False
        evidence = [a for a in timed if same_identity_data(old, records[a])
                    and same_maker_kind(old_mk, maker_kind(records[a]))]
        if len(evidence) > 1:
            return False              # two fit: nobody can say which, so no one is told
        if len(evidence) == 1:
            addr = evidence[0]
            diff, shared = _place(last["rssi"], rssi_vector(records[addr]))
            if shared >= MIN_RECEIVERS and diff is not None and diff <= MAX_DB:
                if self._another_could_be_it(root, addr, records[addr], old_mk, now_ts):
                    return False
                self._link(root, addr, "evidence", now_ts)
                self._taken.add(addr)
                self.asks.pop(root, None)
                self.dirty = True
                self._count("label_link_linked")
                return True
            if now_ts - last_ts >= WINDOW_S - 30.0:
                self._ask(root, addr, "place", now_ts)
            return False
        if not says_something(old_mk):
            return False
        same = [a for a in timed if same_maker_kind(old_mk, maker_kind(records[a]))]
        if len(same) != 1:
            return False
        diff, shared = _place(last["rssi"], rssi_vector(records[same[0]]))
        if shared >= MIN_RECEIVERS and diff is not None and diff <= MAX_DB:
            self._ask(root, same[0], "weak", now_ts)
        return False

    def _ask_late(self, root: str, cur: str, last: dict[str, Any], old: dict[str, Any], old_mk: tuple, now_ts: float,
                  records: dict[str, dict[str, Any]], proven: set[str], claimed: set[str],
                  names: dict[str, list[str]]) -> None:
        """Long after it stopped, one address on the air now with its name or payload."""
        name = real_name(old)
        pool = names.get(name, ()) if name else ()
        if not pool and not distinctive_payloads(old):
            return
        if not pool:
            pool = list(records)
        live = [a for a in pool
                if now_ts - _seen_ts(records[a], now_ts) <= LIVE_S
                and self.first_heard.get(a, float("-inf")) > last["ts"] + GAP_S
                and self._candidate_ok(a, records[a], root, cur, proven, claimed)
                and same_identity_data(old, records[a])
                and same_maker_kind(old_mk, maker_kind(records[a]))]
        if len(live) == 1:
            self._ask(root, live[0], "gap", now_ts)

    def _ask(self, root: str, addr: str, why: str, now_ts: float) -> None:
        ask = self.asks.get(root)
        if ask and ask.get("a") == addr:
            return
        self.asks[root] = {"a": addr, "why": why, "ts": now_ts}
        self.dirty = True
        if (root, addr) not in self._asked:
            self._asked.add((root, addr))
            self.moves[root] = self.moves.get(root, 0) + 1
            self._count("label_link_asked")


def _place(a: dict[str, float], b: dict[str, float]) -> tuple[float | None, int]:
    """(how differently the receivers hear them, how many heard both)."""
    return place_difference(a, b), sum(1 for s in a if s in b)


# Everything on a row that says where it is and how it sounds, and nothing that
# says who it is: Calibration's capture matches adverts by address and all_addresses.
_LIVE_FIELDS = ("rssi", "age_s", "last_seen", "sources", "room", "last_room", "away", "room_held", "room_unsure",
                "x_m", "y_m", "floor_id", "outside", "knn_confidence", "room_confidence", "rssi_margin_confidence",
                "_smoothed", "_stale")


def overlay(objects: list[dict[str, Any]], links: LabelLinks) -> list[dict[str, Any]]:
    """The list the screen shows; the rows it was given are left as they were. A
    linked row shows its current address's signal and room and keeps its own key,
    address and name, and the current address's row goes."""
    if not links.shows_anything():
        return objects
    by_key: dict[str, dict[str, Any]] = {}
    by_addr: dict[str, dict[str, Any]] = {}
    for obj in objects:
        by_key[str(obj.get("key") or "")] = obj
        if obj.get("kind") == "ble":
            addr = obj.get("address")
            if addr:
                by_addr[str(addr).upper()] = obj
            for other in obj.get("all_addresses") or ():
                by_addr.setdefault(str(other).upper(), obj)
    changed: dict[int, dict[str, Any]] = {}

    def own(row: dict[str, Any]) -> dict[str, Any]:
        return changed.setdefault(id(row), dict(row))

    hide: set[int] = set()
    for root, link in links.links.items():
        row = by_key.get(f"ble:{root}")
        if row is None:
            continue
        cur = link["path"][-1]
        shown = own(row)
        shown["label_link"] = {"address": cur["a"], "by": cur.get("by") or "evidence", "since": cur.get("ts")}
        live = by_addr.get(cur["a"])
        if live is None or live is row:
            continue
        for field in _LIVE_FIELDS:
            if field in live:
                shown[field] = live[field]
            else:
                shown.pop(field, None)
        hide.add(id(live))
    for root, count in links.moves.items():
        row = by_key.get(f"ble:{root}")
        if row is not None and count >= HINT_AFTER and root not in links.hint_off and row.get("user_label"):
            own(row)["irk_hint"] = True
    for root, ask in links.asks.items():
        cand, row = by_addr.get(ask["a"]), by_key.get(f"ble:{root}")
        if cand is None or row is None or id(cand) in hide:
            continue
        own(cand)["label_ask"] = {"key": f"ble:{root}", "address": ask["a"], "why": ask.get("why"),
                                  "label": row.get("user_label") or row.get("best_name") or root}
        own(row)["label_asking"] = {"address": ask["a"], "why": ask.get("why")}
    return [changed.get(id(o), o) for o in objects if id(o) not in hide]
