# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Is a Bluetooth proxy suddenly hearing far less than it usually does?

The 2026.7 ESPHome Wi-Fi/Bluetooth coexistence bug left proxies hearing about
9% of the advertisements around them: still "online", still listed, just
deaf, and rooms went wrong with nothing on screen saying why.

From the advertisements PadSpan already receives (bluetooth_live._on_adv,
live ones only, never the reseed or HA's replayed history), each scanner's
minute is summed as: advertisements per address it heard. Per address, so a
room that empties (phones leave with their owners) does not look like a
deaf radio; a deaf radio hears every address it still hears less often.

  baseline   a slow average of the scanner's own healthy minutes (about an
             hour), learned for WARMUP_MIN minutes before anything is judged;
  low        a minute under DROP_RATIO of that baseline;
  drop       LOW_MINUTES low minutes in a row while at least one other
             warmed-up scanner is normal that minute (a house-wide quiet
             spell, or HA itself pausing, is not one scanner's fault);
  recovery   CLEAR_MINUTES minutes in a row back over CLEAR_RATIO.

A minute where a scanner heard fewer than MIN_ADDRS addresses says nothing
and is skipped. The minute closes on the first advertisement after it ends
(or a snapshot, whichever comes first), so with no panel open the counts
still cover one minute, not days of rotating addresses. Memory only: a restart learns again. Nothing is shown unless
a drop is on (the snapshot's radio gets adv_rate_low), and the opt-in report
gets a bucket of how many drops started (telemetry.PROXY_DROP_EVENTS).
"""
from __future__ import annotations

from dataclasses import dataclass, field

WINDOW_S = 60.0
MAX_WINDOW_S = 300.0     # a longer gap between ticks (no snapshot built) is not judged
MIN_ADDRS = 3
WARMUP_MIN = 30
EMA_ALPHA = 1.0 / 60.0
DROP_RATIO = 0.30
LOW_MINUTES = 10
CLEAR_RATIO = 0.60
CLEAR_MINUTES = 3
# Addresses kept per scanner per minute, at most; past it only the addresses
# already kept are counted, so the per-address rate stays honest.
MAX_ADDRS = 1024
# Drops started between snapshots, kept for the next tick (count only).
MAX_PENDING = 64


@dataclass
class _Scanner:
    baseline: float = 0.0
    minutes: int = 0          # healthy minutes learned
    low_run: int = 0
    ok_run: int = 0
    dropped: bool = False


@dataclass
class AdvertRateHealth:
    _count: dict[str, int] = field(default_factory=dict)
    _addrs: dict[str, set[str]] = field(default_factory=dict)
    _start: float | None = None
    _sc: dict[str, _Scanner] = field(default_factory=dict)
    _pending: list[str] = field(default_factory=list)

    def note(self, source: str, address: str, now: float | None = None) -> None:
        """One live advertisement. A dict increment and a set add; given the
        time, the minute is closed here once it has passed."""
        if now is not None and self._start is not None and now - self._start >= WINDOW_S:
            started = self._roll(now)
            if started and len(self._pending) < MAX_PENDING:
                self._pending.extend(started[:MAX_PENDING - len(self._pending)])
        s = self._addrs.get(source)
        if s is None:
            s = self._addrs[source] = set()
        if address not in s:
            if len(s) >= MAX_ADDRS:
                return
            s.add(address)
        self._count[source] = self._count.get(source, 0) + 1

    def low_sources(self) -> set[str]:
        return {src for src, sc in self._sc.items() if sc.dropped}

    def tick(self, now: float) -> list[str]:
        """Close the window once a minute has passed; the scanners whose drop
        STARTED with it, or since the last tick."""
        pending, self._pending = self._pending, []
        return pending + self._roll(now)

    def _roll(self, now: float) -> list[str]:
        if self._start is None:
            self._start = now
            return []
        elapsed = now - self._start
        if elapsed < WINDOW_S:
            return []
        counts, addrs = self._count, self._addrs
        self._count, self._addrs, self._start = {}, {}, now
        if elapsed > MAX_WINDOW_S:
            return []
        minutes = elapsed / 60.0
        rates = {src: counts[src] / len(a) / minutes
                 for src, a in addrs.items() if len(a) >= MIN_ADDRS and counts.get(src)}
        # Which scanners are normal THIS minute, judged before any updates.
        normal = {src for src, r in rates.items()
                  if (sc := self._sc.get(src)) and sc.minutes >= WARMUP_MIN and not sc.dropped
                  and r >= CLEAR_RATIO * sc.baseline}
        started: list[str] = []
        for src, r in rates.items():
            sc = self._sc.setdefault(src, _Scanner())
            if sc.minutes < WARMUP_MIN:
                sc.baseline = r if sc.minutes == 0 else sc.baseline + (r - sc.baseline) / (sc.minutes + 1)
                sc.minutes += 1
                continue
            if sc.dropped:
                sc.ok_run = sc.ok_run + 1 if r >= CLEAR_RATIO * sc.baseline else 0
                if sc.ok_run >= CLEAR_MINUTES:
                    sc.dropped, sc.low_run, sc.ok_run = False, 0, 0
                continue
            if r < DROP_RATIO * sc.baseline:
                sc.low_run += 1
                if sc.low_run >= LOW_MINUTES and normal - {src}:
                    sc.dropped, sc.ok_run = True, 0
                    started.append(src)
                continue
            sc.low_run = 0
            sc.baseline += EMA_ALPHA * (r - sc.baseline)
            sc.minutes += 1
        return started
