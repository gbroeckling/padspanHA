# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""How hard the machine is working, for the opt-in usage report.

Garry, 2026-09-29: "Add load numbers and CPU info to opt-in for this type of
decision in future" — "need to watch the pi installs for max outs". Whether a
feature (an animated overlay, a 4-8 s live snapshot on a 2,700-object house)
bogs Home Assistant down depends on the machine: on the developer's 6-vCPU VM
it does not, and on a Raspberry Pi it might. This measures it, per install,
so the report can say it per hardware class.

What it measures (telemetry.py decides what of it leaves, and how rounded):

    host load       os.getloadavg() 1-minute, per CPU
    HA CPU          this process's CPU time over wall time (every thread —
                    it is Home Assistant's process), % of one core
    memory          this process's RSS; host MemAvailable and swap used
    loop lag        how late this module's own timer fires, in ms
    PadSpan's cost  each live snapshot build and presence poll, in ms
    max-outs        samples over a limit (OVER_*)
    PadSpan's size  objects in the live snapshot, entries in the object
                    history and what one costs (KB, estimated hourly), the
                    Bluetooth cache's addresses and MB, how many new
                    addresses arrive per hour, the share not heard for
                    15 minutes, and ESPresense's cache (padspan_sizes)

and the hardware class (hw_class): CPU count, RAM bucket, architecture,
installation type and board family — each from a fixed list, never a model
string, hostname or serial.

Garry, 2026-10-05, after a 2 GB Pi on a busy street ran out of memory within
hours: the low-memory version "should force a more safe object max count",
and the report has to carry what picking that number takes — how many
objects each install holds, what one costs, what the machine had left, and
whether Home Assistant died of it. A run that ends without a clean stop takes
the in-memory window with it, so RunLog keeps starts, unclean ends and the
worst minutes ON DISK (only while the report is on).

Cost, by design — it must never be the thing it is measuring:

  * ONE timer per Home Assistant: a loop.call_at every 60 s. A second
    async_start is a no-op; async_stop (integration unload) cancels it; a
    reload starts a new one and keeps the window. The callback measures its
    own lateness (the event-loop lag), and only while the report is ON hands
    ONE executor job the reads that touch files (/proc/meminfo,
    /proc/self/status, getloadavg — glibc reads /proc/loadavg — and
    os.cpu_count, which reads /sys). The hardware class is read once, also in
    the executor, and cached (installation type: Home Assistant's own
    system_info, asked once). Nothing of PadSpan's on the event loop reads a
    file or asks the OS anything; a read still in flight when the next tick
    comes is not doubled up. Snapshot and poll timings are one perf_counter pair around
    code that already runs, and a bin increment.
  * O(1) memory: each metric is a _Hist — counts in log-spaced bins 2% wide
    (a sparse dict: a few hundred ints at most, however long the window)
    plus exact min/max. A day of one-a-minute samples or ten thousand
    snapshot builds cost the same. Percentiles read off the bins are good to
    about ±1%, finer than the two significant figures they are reported at.
  * Every entry point is wrapped: nothing here raises into its caller, and
    a machine without /proc or getloadavg (Windows, macOS, a locked-down
    container) simply reports fewer metrics.
  * PadSpan's size is read ON the event loop, because only the loop changes
    those dicts: lengths (O(1)), a share from AGE_SAMPLE sampled addresses,
    and once an hour the deep size of SIZE_SAMPLE entries — never a walk of
    every object. RunLog writes a few hundred bytes when a worst value moves
    past the one on disk by _PEAK_STEP (delayed and coalesced), once at each
    start and once at each clean stop.
"""

from __future__ import annotations

import json
import logging
import math
import os
import platform
import random
import re
import sys
import time
import types
from collections import deque
from datetime import timedelta
from functools import partial
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_ESPRESENSE_MQTT, DATA_OBJECT_HISTORY, DOMAIN
from .telemetry import enabled

_LOGGER = logging.getLogger(__name__)

INTERVAL_S = 60.0
_DATA_SAMPLER = "_perf_sampler"     # the running timer (one per hass)
_DATA_WINDOW = "_perf_window"       # stats since the last report — survives a reload
_DATA_HW = "_perf_hw"               # the hardware class, detected once
_DATA_SETTLE = "_perf_settle"       # start-up grace (see _settling) — survives a reload

# The max-out limits: a sample over one is counted (PerfWindow.over).
OVER_LOAD_PER_CPU = 1.0      # 1-minute load above one runnable task per CPU
OVER_HA_CPU_PCT = 90.0       # Home Assistant's process above 90% of one core
UNDER_MEM_AVAIL_PCT = 10.0   # host memory available below 10%
OVER_LAG_MS = 1000.0         # the event loop a second or more late
# Started with Home Assistant: nothing is sampled until this long after it is
# running. A start-up (every integration loading, the recorder catching up)
# pegs a Pi for minutes; sampled, every restart would read as a max-out.
STARTUP_GRACE_S = 300.0

METRICS: tuple[str, ...] = ("load", "cpu", "rss", "mem", "swap", "lag", "snap", "cycle",
                            # PadSpan's size (padspan_sizes)
                            "objects", "history", "obj_kb", "history_mb",
                            "ble_addrs", "ble_mb", "ble_new", "ble_old", "esp_addrs",
                            # the live snapshot as held between builds, as JSON, and how often it goes
                            "snap_mb", "snap_json_mb", "snap_req",
                            # Home Assistant while each kind of view is on a screen (VIEW_CLASSES)
                            *(f"{m}@{c}" for c in ("atlas", "sim", "other", "none") for m in ("cpu", "lag", "rss")))
OVER: tuple[str, ...] = ("load", "cpu", "mem", "lag")
_HW_TRIES = 10               # ticks allowed to wait for the Supervisor's info

SIZE_EVERY = 60              # ticks between per-entry size estimates: an hour
SIZE_SAMPLE = 32             # entries deep-sized per estimate
AGE_SAMPLE = 2000            # addresses sampled for the share not heard lately
OLD_S = 900.0                # "not heard lately": 15 minutes
_SIZE_NODE_CAP = 50_000      # objects one estimate may visit, at most
# Which kind of view is on a screen, from the panels' own once-a-minute
# heartbeat (the client_fps:<class>:... usage event, www/padspan-ha/
# client_perf.js): the Atlas, the 3D house (Live Aboard, "sim"), anything
# else. A minute with none is "none". The same minute can count for two.
VIEW_CLASSES: tuple[str, ...] = ("atlas", "sim", "other")
VIEW_HOLD_S = 90.0           # a view counts as on screen this long after its heartbeat
_DATA_VIEWS = "_perf_views"          # class -> loop time of its last heartbeat
_DATA_SNAP_REQS = "_perf_snap_reqs"  # live_snapshot requests served (only ever grows)

_LOG_R = math.log(1.02)      # bin width: 2%


class _Hist:
    """A bounded histogram: log-spaced bins 2% wide, exact min/max/count.

    Values <= 0 (an idle CPU, no swap) count in `zeros`; negatives are
    clamped to 0, non-finite values dropped.
    """

    __slots__ = ("n", "zeros", "bins", "lo", "hi")

    def __init__(self) -> None:
        self.n = 0
        self.zeros = 0
        self.bins: dict[int, int] = {}
        self.lo = math.inf
        self.hi = -math.inf

    def add(self, v: float) -> None:
        try:
            v = float(v)
        except (TypeError, ValueError):
            return
        if not math.isfinite(v):
            return
        v = max(0.0, v)
        self.n += 1
        self.lo = min(self.lo, v)
        self.hi = max(self.hi, v)
        if v <= 0.0:
            self.zeros += 1
            return
        k = math.floor(math.log(v) / _LOG_R)
        self.bins[k] = self.bins.get(k, 0) + 1

    def quantile(self, q: float) -> float | None:
        """Nearest-rank quantile (q in 0..1), from the bins, kept in [min, max]."""
        if not self.n:
            return None
        rank = max(1, math.ceil(q * self.n))
        if rank <= self.zeros:
            return 0.0
        if rank >= self.n:
            return self.hi
        seen = self.zeros
        for k in sorted(self.bins):
            seen += self.bins[k]
            if seen >= rank:
                return min(max(math.exp((k + 0.5) * _LOG_R), self.lo), self.hi)
        return self.hi

    def merge(self, other: "_Hist") -> None:
        self.n += other.n
        self.zeros += other.zeros
        for k, c in other.bins.items():
            self.bins[k] = self.bins.get(k, 0) + c
        self.lo = min(self.lo, other.lo)
        self.hi = max(self.hi, other.hi)


class PerfWindow:
    """Everything measured since the last report."""

    def __init__(self, started: float | None = None) -> None:
        self.started = time.monotonic() if started is None else started
        self.samples = 0
        self.hists: dict[str, _Hist] = {m: _Hist() for m in METRICS}
        self.over: dict[str, int] = {k: 0 for k in OVER}
        # The RunLog's counts a send took with it (take_window) — handed back
        # with the window when the send fails.
        self.runs: dict[str, Any] | None = None

    def add(self, metric: str, v: float) -> None:
        h = self.hists.get(metric)
        if h is not None:
            h.add(v)

    def hours(self, now: float | None = None) -> float:
        now = time.monotonic() if now is None else now
        return max(0.0, now - self.started) / 3600.0

    def merge(self, other: "PerfWindow") -> None:
        """A send that failed: its window goes back under this one."""
        self.started = min(self.started, other.started)
        self.samples += other.samples
        for m, h in other.hists.items():
            self.hists.setdefault(m, _Hist()).merge(h)
        for k, c in other.over.items():
            self.over[k] = self.over.get(k, 0) + c


# ── the window ──────────────────────────────────────────────────────────────

def window(hass: HomeAssistant) -> PerfWindow:
    dom = hass.data.setdefault(DOMAIN, {})
    w = dom.get(_DATA_WINDOW)
    if not isinstance(w, PerfWindow):
        w = dom[_DATA_WINDOW] = PerfWindow()
    return w


def take_window(hass: HomeAssistant) -> PerfWindow:
    """The window so far — and start a new one (a send). The RunLog's
    counts go with it."""
    w = window(hass)
    hass.data[DOMAIN][_DATA_WINDOW] = PerfWindow()
    log = run_log(hass)
    if log is not None:
        w.runs = log.take()
    return w


def give_back_window(hass: HomeAssistant, w: PerfWindow | None) -> None:
    if isinstance(w, PerfWindow):
        window(hass).merge(w)
        log = run_log(hass)
        if log is not None and w.runs:
            log.give_back(w.runs)


def reset_window(hass: HomeAssistant) -> None:
    """Opt-in: nothing measured before the person said yes goes."""
    dom = hass.data.setdefault(DOMAIN, {})
    dom[_DATA_WINDOW] = PerfWindow()
    s = dom.get(_DATA_SAMPLER)
    if isinstance(s, PerfSampler):
        s._last_cpu = None      # nor a CPU delta that began before it
        s._last_new = None      # nor an address rate
        s._last_reqs = None


def _settling(hass: HomeAssistant) -> bool:
    """Home Assistant is still starting, or has run for under STARTUP_GRACE_S.

    Set by the sampler that started with Home Assistant (math.inf until it is
    running, then the grace's end) and kept in hass.data, so a reload in the
    first minutes does not start sampling mid start-up.
    """
    dom = hass.data.get(DOMAIN, {})
    until = dom.get(_DATA_SETTLE)
    if until is None:
        return False
    if until == math.inf:
        if not getattr(hass, "is_running", True):
            return True
        until = dom[_DATA_SETTLE] = hass.loop.time() + STARTUP_GRACE_S
    if hass.loop.time() < until:
        return True
    dom.pop(_DATA_SETTLE, None)
    return False


def record_duration(hass: HomeAssistant, metric: str, ms: float) -> None:
    """One snapshot build ("snap") or presence poll ("cycle") took `ms`.

    Called on the event loop from the code being timed: a dict lookup when
    the report is off, one bin increment when it is on. Not during the
    start-up grace. Never raises.
    """
    try:
        if enabled(hass) and not _settling(hass):
            window(hass).add(metric, ms)
    except Exception:
        pass


# ── reading the machine ─────────────────────────────────────────────────────

def cpu_count() -> int | None:
    try:
        n = os.cpu_count()
    except Exception:
        return None
    return n if isinstance(n, int) and n > 0 else None


def _read_kb(path: str, keys: tuple[str, ...]) -> dict[str, int]:
    """`Key:   123 kB` lines from a /proc file; {} where there is no such file."""
    out: dict[str, int] = {}
    try:
        with open(path, encoding="ascii", errors="ignore") as f:
            for line in f:
                name, _, rest = line.partition(":")
                if name in keys:
                    try:
                        out[name] = int(rest.split()[0])
                    except (IndexError, ValueError):
                        pass
                    if len(out) == len(keys):
                        break
    except OSError:
        pass
    return out


def read_host() -> dict[str, Any]:
    """One sample of the machine. EXECUTOR ONLY: it reads /proc files.

    `mono` and `cpu_s` are read back to back so the CPU-time delta and the
    wall-time delta cover the same interval. Missing sources leave keys out.
    """
    out: dict[str, Any] = {"mono": time.monotonic(), "cpu_s": time.process_time(), "cpus": cpu_count()}
    try:
        out["load1"] = float(os.getloadavg()[0])
    except (AttributeError, OSError, IndexError):
        pass                                        # Windows; some sandboxes
    mem = _read_kb("/proc/meminfo", ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree"))
    if mem.get("MemTotal") and "MemAvailable" in mem:
        out["mem_avail_pct"] = 100.0 * mem["MemAvailable"] / mem["MemTotal"]
    if "SwapTotal" in mem and "SwapFree" in mem:
        out["swap_mb"] = max(0, mem["SwapTotal"] - mem["SwapFree"]) / 1024.0
    rss = _read_kb("/proc/self/status", ("VmRSS",))
    if "VmRSS" in rss:
        out["rss_mb"] = rss["VmRSS"] / 1024.0
    return out


# ── what PadSpan itself holds ───────────────────────────────────────────────

_LEAVES = (str, bytes, bytearray, int, float, complex, bool, type(None))
_OPAQUE = (type, types.ModuleType, types.FunctionType, types.BuiltinFunctionType, types.MethodType)


def deep_bytes(obj: Any, cap: int = _SIZE_NODE_CAP, seen: set[int] | None = None) -> int:
    """Bytes held by a Python object graph: sys.getsizeof of every distinct
    object reachable through containers and plain objects' attributes,
    counting a shared one once. An estimate — the allocator's own overhead
    is not in it — and it stops after `cap` objects. Pass `seen` to count
    only what is not already in it (a copy's own cost over its original)."""
    seen = set() if seen is None else seen
    stack: list[Any] = [obj]
    total = 0
    start = len(seen)
    while stack and len(seen) - start < cap:
        o = stack.pop()
        if id(o) in seen or isinstance(o, _OPAQUE):
            continue
        seen.add(id(o))
        try:
            total += sys.getsizeof(o)
        except Exception:
            continue
        if isinstance(o, _LEAVES):
            continue
        if isinstance(o, dict):
            stack.extend(o.keys())
            stack.extend(o.values())
        elif isinstance(o, (list, tuple, set, frozenset, deque)):
            stack.extend(o)
        else:
            d = getattr(o, "__dict__", None)
            if isinstance(d, dict):
                stack.append(d)
            for name in getattr(type(o), "__slots__", ()) or ():
                if isinstance(name, str) and hasattr(o, name):
                    stack.append(getattr(o, name))
    return total


def _entry_kb(d: dict, extra: dict | None = None) -> float | None:
    """What one entry of `d` costs, in KB: SIZE_SAMPLE of its entries, their
    keys and their share of its table (plus `extra`'s value for the same
    key — the Bluetooth cache keeps its RSSI samples in a second dict)."""
    n = len(d)
    if not n:
        return None
    keys = list(d) if n <= SIZE_SAMPLE else random.sample(list(d), SIZE_SAMPLE)
    parts: list[Any] = [*keys, *(d[k] for k in keys)]
    if extra:
        parts.extend(extra[k] for k in keys if k in extra)
    held = deep_bytes(parts) - sys.getsizeof(parts)
    table = sys.getsizeof(d) / n + (sys.getsizeof(extra) / max(1, len(extra)) if extra else 0.0)
    return (held / len(keys) + table) / 1024.0


def _snapshot_kb(items: list, original_of: Any) -> tuple[float, float] | None:
    """KB one entry of a snapshot list holds over the cache entry it was
    copied from (`original_of(item)`: that entry, or None), and KB it takes
    as JSON — the snapshot's objects and adverts are shallow copies sharing
    most of their values with the object history and the Bluetooth cache."""
    if not items:
        return None
    sample = items if len(items) <= SIZE_SAMPLE else random.sample(items, SIZE_SAMPLE)
    seen: set[int] = set()
    held = 0
    js = 0
    for it in sample:
        orig = original_of(it)
        if orig is not None:
            deep_bytes(orig, seen=seen)                 # counted where it lives
        held += deep_bytes(it, seen=seen)
        try:
            js += len(json.dumps(it, default=str, separators=(",", ":")))
        except Exception:
            pass
    return held / len(sample) / 1024.0, js / len(sample) / 1024.0


def padspan_sizes(hass: HomeAssistant, kb: dict[str, float], *, estimate: bool) -> dict[str, float]:
    """What PadSpan holds right now — ON THE EVENT LOOP: these dicts only
    change there. Counts are O(1); the share of Bluetooth addresses not heard
    for OLD_S comes from AGE_SAMPLE of them. With `estimate`, each store's
    per-entry size is measured again into `kb` (SIZE_SAMPLE entries); its MB
    is that size times the count, every call. Keys are left out where there is
    nothing to measure (no snapshot built yet, no Bluetooth, no ESPresense)."""
    dom = hass.data.get(DOMAIN, {})
    out: dict[str, float] = {}
    entry = dom.get("snapshot_cache")
    snap = entry[1] if isinstance(entry, tuple) and len(entry) == 2 and isinstance(entry[1], dict) else {}
    objs = snap.get("objects")
    summary = objs.get("summary") if isinstance(objs, dict) else None
    if isinstance(summary, dict) and isinstance(summary.get("total"), int):
        out["objects"] = summary["total"]
    hist = dom.get(DATA_OBJECT_HISTORY)
    if isinstance(hist, dict):
        out["history"] = len(hist)
        if estimate or "history" not in kb:
            k = _entry_kb(hist)
            if k is not None:
                kb["history"] = k
        if "history" in kb and hist:
            out["obj_kb"] = kb["history"]
            out["history_mb"] = kb["history"] * len(hist) / 1024.0
    from .bluetooth_live import DATA_KEY as _BL_KEY, _now as _bl_now  # noqa: PLC0415
    bl = dom.get(_BL_KEY)
    seen = getattr(bl, "_seen_by_source", None)
    if isinstance(seen, dict):
        n = out["ble_addrs"] = len(seen)
        if n:
            addrs = list(seen) if n <= AGE_SAMPLE else random.sample(list(seen), AGE_SAMPLE)
            cutoff = _bl_now() - timedelta(seconds=OLD_S)
            old = sum(1 for a in addrs if all(getattr(v, "seen", cutoff) < cutoff for v in (seen.get(a) or {}).values()))
            out["ble_old"] = 100.0 * old / len(addrs)
        samples = getattr(bl, "_rssi_samples", None)
        if estimate or "ble" not in kb:
            k = _entry_kb(seen, samples if isinstance(samples, dict) else None)
            if k is not None:
                kb["ble"] = k
        if "ble" in kb and n:
            out["ble_mb"] = kb["ble"] * n / 1024.0
    esp = getattr(dom.get(DATA_ESPRESENSE_MQTT), "_seen", None)
    if isinstance(esp, dict):
        out["esp_addrs"] = len(esp)
    # The cached live snapshot: held between builds (and doubled while one is
    # built), and sent as JSON to every open panel every 5 s.
    obj_list = objs.get("list") if isinstance(objs, dict) and isinstance(objs.get("list"), list) else None
    ble = snap.get("ble") if isinstance(snap.get("ble"), dict) else {}
    ads = ble.get("advertisements") if isinstance(ble.get("advertisements"), list) else None
    if estimate or "snap_obj" not in kb:
        h = hist if isinstance(hist, dict) else {}
        k = _snapshot_kb(obj_list or [], lambda o: h.get(o.get("key")) if isinstance(o, dict) else None)
        if k is not None:
            kb["snap_obj"], kb["snap_obj_js"] = k
    if estimate or "snap_ad" not in kb:
        sbs = seen if isinstance(seen, dict) else {}

        def _orig(a: Any) -> Any:
            if not isinstance(a, dict):
                return None
            adv = (sbs.get(a.get("address")) or {}).get(a.get("source"))
            return getattr(adv, "record", None)

        k = _snapshot_kb(ads or [], _orig)
        if k is not None:
            kb["snap_ad"], kb["snap_ad_js"] = k
    n_obj, n_ad = len(obj_list or ()), len(ads or ())
    if n_obj or n_ad:
        out["snap_mb"] = (kb.get("snap_obj", 0.0) * n_obj + kb.get("snap_ad", 0.0) * n_ad) / 1024.0
        out["snap_json_mb"] = (kb.get("snap_obj_js", 0.0) * n_obj + kb.get("snap_ad_js", 0.0) * n_ad) / 1024.0
    return out


# ── the hardware class ──────────────────────────────────────────────────────

def arch_class(machine: Any) -> str:
    m = str(machine or "").strip().lower()
    if not m:
        return "unknown"
    if m in ("x86_64", "amd64", "x64"):
        return "x86_64"
    if m in ("i386", "i486", "i586", "i686", "x86"):
        return "x86"
    if m in ("aarch64", "arm64", "aarch64_be"):
        return "aarch64"
    if m.startswith("armv7") or m in ("armv8l", "armhf"):       # 32-bit userland
        return "armv7"
    if m.startswith("armv6"):
        return "armv6"
    return "other"


def ram_bucket(total_bytes: Any) -> str:
    """Total RAM as the size it is sold as. MemTotal runs a little under the
    installed amount (a 4 GB Pi reads ~3.8 GiB), so each bucket is "up to"."""
    try:
        gib = float(total_bytes) / 1024 ** 3
    except (TypeError, ValueError):
        return "unknown"
    if not math.isfinite(gib) or gib <= 0:
        return "unknown"
    for edge in (1, 2, 4, 8, 16):
        if gib <= edge:
            return f"{edge}g"
    return "16g+"


def _ram_total_bytes() -> int | None:
    """Physical RAM via sysconf — a syscall, no file read; None off POSIX."""
    try:
        return int(os.sysconf("SC_PAGE_SIZE")) * int(os.sysconf("SC_PHYS_PAGES"))
    except (AttributeError, ValueError, OSError, TypeError):
        return None


def install_class(installation_type: Any) -> str:
    """homeassistant.helpers.system_info's installation_type, as a fixed word."""
    t = str(installation_type or "").strip().lower()
    if t == "home assistant os":
        return "os"
    if t == "home assistant supervised":
        return "supervised"
    if t in ("home assistant container", "unsupported third party container"):
        return "container"
    if t == "home assistant core":
        return "core"
    return "unknown" if t in ("", "unknown") else "other"


def board_class(board: Any) -> str:
    """The Supervisor's board (os info: rpi4-64, ova, generic-x86-64, green,
    yellow…) or machine (raspberrypi4-64, qemux86-64…), as a fixed word."""
    if not isinstance(board, str) or not board.strip():
        return "unknown"
    b = board.strip().lower()
    for prefix, cls in (("rpi5", "rpi5"), ("raspberrypi5", "rpi5"), ("rpi4", "rpi4"), ("raspberrypi4", "rpi4"),
                        ("rpi3", "rpi3"), ("raspberrypi3", "rpi3"), ("rpi2", "rpi2"), ("raspberrypi2", "rpi2")):
        if b.startswith(prefix):
            return cls
    if b.startswith("rpi") or b.startswith("raspberrypi"):
        return "rpi_other"
    if b in ("green", "yellow"):
        return b
    if b.startswith("odroid"):
        return "odroid"
    if b.startswith("tinker"):
        return "tinker"
    if b.startswith("khadas"):
        return "khadas"
    if b == "ova" or b.startswith("qemu"):
        return "vm"
    if b in ("generic-x86-64", "intel-nuc"):
        return "generic_x86_64"
    if b == "generic-aarch64":
        return "generic_aarch64"
    return "other"


def board_from_model(model: Any) -> str:
    """A Raspberry Pi running Container/Core (no Supervisor to ask): its
    device-tree model string, mapped to a class here — the string never
    leaves this function."""
    m = str(model or "").strip().lower()
    if not m:
        return "unknown"
    if "raspberry pi" not in m:
        return "other"
    if re.search(r"raspberry pi (5|500)\b|compute module 5", m):
        return "rpi5"
    if re.search(r"raspberry pi (4|400)\b|compute module 4", m):
        return "rpi4"
    if re.search(r"raspberry pi 3\b|compute module 3|zero 2", m):
        return "rpi3"
    if re.search(r"raspberry pi 2\b", m):
        return "rpi2"
    return "rpi_other"


def _read_dt_model() -> str:
    """EXECUTOR ONLY."""
    try:
        with open("/proc/device-tree/model", "rb") as f:
            return f.read(128).decode("ascii", "ignore").strip("\x00 \n")
    except OSError:
        return ""


def _read_static(want_model: bool) -> dict[str, Any]:
    """What cannot change while HA runs. EXECUTOR ONLY: os.cpu_count reads
    /sys, the device-tree model is a file, and system_info is imported here
    so the import after it, on the event loop, reads nothing from disk."""
    try:
        import homeassistant.helpers.system_info  # noqa: F401, PLC0415
    except Exception:
        pass
    try:
        machine = platform.machine()
    except Exception:
        machine = ""
    return {"cpus": cpu_count(), "ram_bytes": _ram_total_bytes(), "machine": machine,
            "model": _read_dt_model() if want_model else ""}


def hw_class(hass: HomeAssistant) -> dict[str, Any]:
    """The hardware class, as async_ensure_hw found it — a dict read, safe on
    the event loop. Before the first detection: zero CPUs, all "unknown"."""
    det = hass.data.get(DOMAIN, {}).get(_DATA_HW)
    det = det if isinstance(det, dict) else {}
    n = det.get("cpus")
    return {
        "cpus": n if isinstance(n, int) and n > 0 else 0,
        "ram": det.get("ram") or "unknown",
        "arch": det.get("arch") or "unknown",
        "install": det.get("install") or "unknown",
        "board": det.get("board") or "unknown",
    }


async def async_ensure_hw(hass: HomeAssistant) -> bool:
    """Detect the hardware class once. True once it is known for good.

    CPU count, RAM and architecture: one executor read. Installation type:
    system_info, Home Assistant's own answer. Board: on Home Assistant OS /
    Supervised, the Supervisor's own (hassio os info) — asked only once the
    Supervisor's info has loaded, which also keeps system_info from logging
    that it has none (until then: "unknown", not ready, asked again); on
    Container / Core, the device tree, where it names a Raspberry Pi. All
    guarded; any failure is "unknown".
    """
    dom = hass.data.setdefault(DOMAIN, {})
    cur = dom.get(_DATA_HW)
    if isinstance(cur, dict) and cur.get("ready"):
        return True
    hassio = None
    try:
        # Only where the Supervisor integration is loaded — so its module is
        # already imported, and a Container / Core install never imports it
        # (on the event loop) just to be told no. Loaded IS the answer: the
        # Supervisor integration only sets up under a Supervisor (its old
        # is_hassio() is gone from this module since HA 2026.1).
        if "hassio" in hass.config.components:
            from homeassistant.components import hassio as _hassio  # noqa: PLC0415
            if callable(getattr(_hassio, "get_info", None)):
                hassio = _hassio
    except Exception:
        hassio = None
    try:
        static = await hass.async_add_executor_job(_read_static, hassio is None)
    except Exception:
        static = {}
    static = static if isinstance(static, dict) else {}
    found: dict[str, Any] = {
        "cpus": static.get("cpus") if isinstance(static.get("cpus"), int) else None,
        "ram": ram_bucket(static.get("ram_bytes")),
        "arch": arch_class(static.get("machine")),
        "install": "unknown", "board": "unknown", "ready": True,
    }
    if hassio is not None:
        info = os_info = None
        try:
            info = hassio.get_info(hass)
            os_info = hassio.get_os_info(hass)
        except Exception:
            pass
        if not isinstance(info, dict):
            found["ready"] = False
            dom[_DATA_HW] = found
            return False
        raw = os_info.get("board") if isinstance(os_info, dict) else None
        found["board"] = board_class(raw if isinstance(raw, str) and raw else info.get("machine"))
    else:
        found["board"] = board_from_model(static.get("model"))
    try:
        from homeassistant.helpers.system_info import async_get_system_info  # noqa: PLC0415
        si = await async_get_system_info(hass)
        if isinstance(si, dict):
            found["install"] = install_class(si.get("installation_type"))
    except Exception:
        pass
    dom[_DATA_HW] = found
    return True


def cached_cpus(hass: HomeAssistant) -> int | None:
    det = hass.data.get(DOMAIN, {}).get(_DATA_HW)
    n = det.get("cpus") if isinstance(det, dict) else None
    return n if isinstance(n, int) and n > 0 else None


# ── which view is on screen, and how often the snapshot goes ────────────────

def note_view(hass: HomeAssistant, cls: Any) -> None:
    """A panel said this kind of view is on its screen (VIEW_CLASSES). A dict
    write; never raises."""
    try:
        if cls in VIEW_CLASSES:
            hass.data.setdefault(DOMAIN, {}).setdefault(_DATA_VIEWS, {})[cls] = hass.loop.time()
    except Exception:
        pass


def note_snapshot_request(hass: HomeAssistant) -> None:
    """A panel fetched the live snapshot (ws_live_snapshot). Never raises."""
    try:
        dom = hass.data.setdefault(DOMAIN, {})
        dom[_DATA_SNAP_REQS] = int(dom.get(_DATA_SNAP_REQS, 0)) + 1
    except Exception:
        pass


def views_on_screen(hass: HomeAssistant, now: float) -> tuple[str, ...]:
    """The view classes with a heartbeat in the last VIEW_HOLD_S, or ("none",)."""
    seen = hass.data.get(DOMAIN, {}).get(_DATA_VIEWS) or {}
    on = tuple(c for c in VIEW_CLASSES
               if isinstance(seen.get(c), (int, float)) and 0 <= now - seen[c] <= VIEW_HOLD_S)
    return on or ("none",)


# ── the runs, on disk ───────────────────────────────────────────────────────

RUNS_STORE_KEY = "padspan_ha.perf_runs"
_DATA_RUNS = "_perf_runs"               # this process's RunLog
_DATA_RUNS_STOP = "_perf_runs_stop"     # the Home Assistant stop listener
# The worst of each since the last report, across every run, and which way
# is worse. Named as health.runs reports them.
RUN_PEAKS: dict[str, str] = {"rss_mb": "max", "mem_avail_pc": "min", "swap_mb": "max",
                             "objects_n": "max", "history_n": "max", "ble_addrs_n": "max"}
_PEAK_STEP = 0.05            # a worst value is written again once 5% past the one on disk
_PEAK_STEP_PC = 1.0          # ... memory available, once a whole point lower
_RUNS_SAVE_DELAY_S = 60.0


def _runs_store(hass: HomeAssistant) -> Any:
    from homeassistant.helpers.storage import Store  # noqa: PLC0415
    return Store(hass, 1, RUNS_STORE_KEY)


def _empty_runs() -> dict[str, Any]:
    return {"running": False, "starts": 0, "unclean": 0}


def _clean_runs(raw: Any) -> dict[str, Any]:
    """A stored log, as far as it is one: counts and finite peaks only."""
    out = _empty_runs()
    if not isinstance(raw, dict):
        return out
    out["running"] = raw.get("running") is True
    for k in ("starts", "unclean"):
        v = raw.get(k)
        if isinstance(v, int) and not isinstance(v, bool) and v >= 0:
            out[k] = v
    for k in RUN_PEAKS:
        v = raw.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0:
            out[k] = float(v)
    return out


class RunLog:
    """Home Assistant starts, the ones that followed an unclean end, and the
    worst minutes since the last report — kept on disk.

    The window lives in memory. A run that ends without a clean stop — Home
    Assistant killed because the machine ran out of memory, or the power
    pulled — takes it along, and the report sent after the restart covers
    minutes. Those runs are the ones a low-memory build exists for. A start
    writes `running: true`; Home Assistant's stop writes it false; a start
    that finds it still true counts an unclean end. Only while the report is
    on: opting in starts an empty log, opting out deletes it.
    """

    def __init__(self, hass: HomeAssistant, store: Any = None) -> None:
        self.hass = hass
        self.store = store if store is not None else _runs_store(hass)
        self.data: dict[str, Any] = _empty_runs()
        self._on_disk: dict[str, float] = {}    # each peak as last written

    def _snapshot(self) -> dict[str, Any]:
        return dict(self.data)

    def _save_later(self) -> None:
        try:
            self.store.async_delay_save(self._snapshot, _RUNS_SAVE_DELAY_S)
        except Exception as err:
            _LOGGER.debug("Run log not saved: %s", err)

    async def async_begin(self, with_ha: bool) -> None:
        """This process's run begins: count the start (`with_ha`: Home
        Assistant is starting, not PadSpan reloading) and an unclean end of
        the run before, which never wrote running: false."""
        try:
            raw = await self.store.async_load()
        except Exception:
            raw = None
        d = _clean_runs(raw)
        if d["running"]:
            d["unclean"] += 1
        if with_ha:
            d["starts"] += 1
        d["running"] = True
        self.data = d
        self._on_disk = {k: d[k] for k in RUN_PEAKS if k in d}
        await self.store.async_save(self._snapshot())

    async def async_reset(self) -> None:
        """Opting in: nothing from before it."""
        self.data = {**_empty_runs(), "running": True}
        self._on_disk = {}
        await self.store.async_save(self._snapshot())

    async def async_stopping(self) -> None:
        """Home Assistant is stopping cleanly."""
        self.data["running"] = False
        await self.store.async_save(self._snapshot())

    def observe(self, key: str, v: Any) -> None:
        """One sample of a RUN_PEAKS value. Written when the worst so far
        moves past the one on disk by a step, so a slow climb costs a few
        writes, not one a minute."""
        way = RUN_PEAKS.get(key)
        if way is None or isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
            return
        cur = self.data.get(key)
        if cur is not None and (v <= cur if way == "max" else v >= cur):
            return
        self.data[key] = float(v)
        disk = self._on_disk.get(key)
        if disk is None or (disk - v >= _PEAK_STEP_PC if way == "min" else v >= disk * (1.0 + _PEAK_STEP)):
            self._on_disk[key] = float(v)
            self._save_later()

    def peek(self) -> dict[str, Any]:
        """What the next report carries: the counts and the peaks."""
        return {k: v for k, v in self.data.items() if k != "running"}

    def take(self) -> dict[str, Any]:
        """A send takes the counts and peaks; the run goes on."""
        taken = self.peek()
        self.data = {**_empty_runs(), "running": self.data.get("running", True)}
        self._on_disk = {}
        self._save_later()
        return taken

    def give_back(self, taken: dict[str, Any]) -> None:
        """A send that failed: its counts and peaks go with the next one."""
        for k in ("starts", "unclean"):
            self.data[k] = int(self.data.get(k, 0)) + int(taken.get(k, 0) or 0)
        for k in RUN_PEAKS:
            if k in taken:
                self.observe(k, taken[k])
        self._save_later()


def run_log(hass: HomeAssistant) -> RunLog | None:
    log = hass.data.get(DOMAIN, {}).get(_DATA_RUNS)
    return log if isinstance(log, RunLog) else None


def _start_runs(hass: HomeAssistant) -> None:
    """Once per process — a reload keeps the log — and only while the report
    is on. Also listens for Home Assistant's stop, once."""
    dom = hass.data.setdefault(DOMAIN, {})
    if not dom.get(_DATA_RUNS_STOP):
        try:
            from homeassistant.const import EVENT_HOMEASSISTANT_STOP  # noqa: PLC0415
        except ImportError:
            EVENT_HOMEASSISTANT_STOP = "homeassistant_stop"  # noqa: N806

        async def _on_stop(_event: Any) -> None:
            log = run_log(hass)
            if log is not None and enabled(hass):
                try:
                    await log.async_stopping()
                except Exception as err:
                    _LOGGER.debug("Run log not closed: %s", err)

        dom[_DATA_RUNS_STOP] = hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _on_stop)
    if _DATA_RUNS in dom or not enabled(hass):
        return
    log = dom[_DATA_RUNS] = RunLog(hass)
    hass.async_create_background_task(log.async_begin(not getattr(hass, "is_running", True)),
                                      "padspan_ha perf runs")


async def async_runs_opted_in(hass: HomeAssistant) -> None:
    """The report was switched on: an empty log, from now."""
    try:
        dom = hass.data.setdefault(DOMAIN, {})
        log = run_log(hass) or RunLog(hass)
        dom[_DATA_RUNS] = log
        await log.async_reset()
    except Exception as err:
        _LOGGER.debug("Run log not started: %s", err)


async def async_runs_opted_out(hass: HomeAssistant) -> None:
    """The report was switched off: the log goes, from memory and disk."""
    try:
        log = hass.data.get(DOMAIN, {}).pop(_DATA_RUNS, None)
        if not isinstance(log, RunLog):
            log = RunLog(hass)
        await log.store.async_remove()
    except Exception as err:
        _LOGGER.debug("Run log not removed: %s", err)


# ── the sampler ─────────────────────────────────────────────────────────────

class PerfSampler:
    """The one timer. See the module docstring for what it costs."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._handle: Any = None
        self._due = 0.0
        self._busy = False              # a host read is in the executor
        self._stopped = False
        self._last_cpu: tuple[float, float] | None = None
        self._hw_tries = 0
        self._hw_busy = False
        self._ticks = 0                          # sampled ticks, for the hourly size estimate
        self._kb: dict[str, float] = {}          # per-entry KB, by store (padspan_sizes)
        self._last_new: tuple[float, int, int] | None = None   # (loop time, count, which cache)
        self._last_reqs: tuple[float, int] | None = None        # (loop time, live_snapshot requests)

    @property
    def running(self) -> bool:
        return self._handle is not None and not self._stopped

    def start(self) -> None:
        loop = self.hass.loop
        if not getattr(self.hass, "is_running", True):
            self.hass.data.setdefault(DOMAIN, {})[_DATA_SETTLE] = math.inf
        self._due = loop.time() + INTERVAL_S
        self._handle = loop.call_at(self._due, self._on_timer)

    def stop(self) -> None:
        self._stopped = True
        h, self._handle = self._handle, None
        if h is not None:
            try:
                h.cancel()
            except Exception:
                pass

    def _on_timer(self) -> None:
        """Fires on the event loop. Measures its own lateness, schedules the
        next tick, and hands the file reads to the executor. Never raises."""
        self._handle = None
        if self._stopped:
            return
        lag_ms = 0.0
        try:
            loop = self.hass.loop
            now = loop.time()
            lag_ms = max(0.0, (now - self._due) * 1000.0)
            self._due += INTERVAL_S
            if self._due <= now:        # more than a whole period late: no catch-up burst
                self._due = now + INTERVAL_S
            self._handle = loop.call_at(self._due, self._on_timer)
        except Exception as err:
            _LOGGER.debug("Load sampler could not reschedule: %s", err)
        try:
            settling = _settling(self.hass)     # its clock runs with the report off too
            if not enabled(self.hass):
                self._last_cpu = None   # a CPU delta must never span time off
                self._last_new = None   # nor an address rate
                self._last_reqs = None
                return
            if settling:
                self._last_cpu = None   # nor span the start-up
                self._last_new = None
                self._last_reqs = None
                return
            self._maybe_detect_hw()
            try:
                self._sample_padspan()
            except Exception as err:
                _LOGGER.debug("PadSpan size sample skipped: %s", err)
            if self._busy:
                return
            self._busy = True
            views = views_on_screen(self.hass, self.hass.loop.time())
            fut = self.hass.async_add_executor_job(read_host)
            fut.add_done_callback(partial(self._on_read, lag_ms, views))
        except Exception as err:
            self._busy = False
            _LOGGER.debug("Load sample skipped: %s", err)

    def _maybe_detect_hw(self) -> None:
        if self._hw_busy or self._hw_tries >= _HW_TRIES:
            return
        cur = self.hass.data.get(DOMAIN, {}).get(_DATA_HW)
        if isinstance(cur, dict) and cur.get("ready"):
            self._hw_tries = _HW_TRIES
            return
        self._hw_tries += 1
        self._hw_busy = True

        async def _detect() -> None:
            try:
                await async_ensure_hw(self.hass)
            except Exception:
                pass
            finally:
                self._hw_busy = False

        try:
            self.hass.async_create_background_task(_detect(), "padspan_ha perf hw")
        except Exception:
            self._hw_busy = False

    def _on_read(self, lag_ms: float, views: tuple[str, ...], fut: Any) -> None:
        """The executor's reading is back (on the event loop). Never raises."""
        self._busy = False
        try:
            if self._stopped or fut.cancelled() or fut.exception() is not None:
                return
            self.record(lag_ms, fut.result(), views)
        except Exception as err:
            _LOGGER.debug("Load sample dropped: %s", err)

    def record(self, lag_ms: float, s: dict[str, Any], views: tuple[str, ...] = ()) -> None:
        """Fold one reading into the window (the math, testable alone).
        `views`: the view classes on a screen this minute; the reading counts
        for each of them too (lag, HA CPU, RSS)."""
        if not enabled(self.hass):
            self._last_cpu = None
            return
        w = window(self.hass)
        w.samples += 1
        w.add("lag", lag_ms)
        if lag_ms > OVER_LAG_MS:
            w.over["lag"] += 1
        views = tuple(v for v in views if v in VIEW_CLASSES or v == "none")
        for v in views:
            w.add(f"lag@{v}", lag_ms)
        cpus = s.get("cpus")
        load1 = s.get("load1")
        if isinstance(load1, (int, float)) and isinstance(cpus, int) and cpus > 0:
            per_cpu = float(load1) / cpus
            w.add("load", per_cpu * 100.0)
            if per_cpu > OVER_LOAD_PER_CPU:
                w.over["load"] += 1
        mono, cpu_s = s.get("mono"), s.get("cpu_s")
        if isinstance(mono, (int, float)) and isinstance(cpu_s, (int, float)):
            prev, self._last_cpu = self._last_cpu, (float(mono), float(cpu_s))
            if prev is not None:
                dt, dcpu = float(mono) - prev[0], float(cpu_s) - prev[1]
                if dt > 0 and dcpu >= 0:
                    pct = 100.0 * dcpu / dt
                    w.add("cpu", pct)
                    for v in views:
                        w.add(f"cpu@{v}", pct)
                    if pct > OVER_HA_CPU_PCT:
                        w.over["cpu"] += 1
        mem = s.get("mem_avail_pct")
        log = run_log(self.hass)
        if isinstance(mem, (int, float)):
            w.add("mem", mem)
            if mem < UNDER_MEM_AVAIL_PCT:
                w.over["mem"] += 1
            if log is not None:
                log.observe("mem_avail_pc", mem)
        for key, metric in (("swap_mb", "swap"), ("rss_mb", "rss")):
            v = s.get(key)
            if isinstance(v, (int, float)):
                w.add(metric, v)
                if log is not None:
                    log.observe(key, v)
                if metric == "rss":
                    for c in views:
                        w.add(f"rss@{c}", v)

    def _sample_padspan(self) -> None:
        """PadSpan's own size this tick (see padspan_sizes for the cost): the
        per-entry sizes are measured on the first sampled tick and hourly."""
        self._ticks += 1
        sizes = padspan_sizes(self.hass, self._kb, estimate=self._ticks % SIZE_EVERY == 1)
        sizes.update(self._new_rate())
        sizes.update(self._request_rate())
        self.record_padspan(sizes)

    def _request_rate(self) -> dict[str, float]:
        """live_snapshot requests since the last tick, per hour: each one is
        the whole snapshot as JSON (snap_json_mb) to some panel."""
        n = self.hass.data.get(DOMAIN, {}).get(_DATA_SNAP_REQS, 0)
        if isinstance(n, bool) or not isinstance(n, int):
            return {}
        now = self.hass.loop.time()
        prev, self._last_reqs = self._last_reqs, (now, n)
        if prev is None or n < prev[1] or now <= prev[0]:
            return {}
        return {"snap_req": (n - prev[1]) * 3600.0 / (now - prev[0])}

    def _new_rate(self) -> dict[str, float]:
        """Bluetooth addresses new to the cache since the last tick, per hour.
        Nothing across a gap (off, the start-up) or a cache made again."""
        from .bluetooth_live import DATA_KEY as _BL_KEY  # noqa: PLC0415
        bl = self.hass.data.get(DOMAIN, {}).get(_BL_KEY)
        n = getattr(bl, "new_addresses", None)
        if isinstance(n, bool) or not isinstance(n, int):
            self._last_new = None
            return {}
        now = self.hass.loop.time()
        prev, self._last_new = self._last_new, (now, n, id(bl))
        if prev is None or prev[2] != id(bl) or n < prev[1] or now <= prev[0]:
            return {}
        return {"ble_new": (n - prev[1]) * 3600.0 / (now - prev[0])}

    def record_padspan(self, sizes: dict[str, float]) -> None:
        """Fold one look at PadSpan's size into the window (and the run log's
        worst values). Names are METRICS'."""
        if not enabled(self.hass):
            return
        w = window(self.hass)
        for k, v in sizes.items():
            w.add(k, v)
        log = run_log(self.hass)
        if log is not None:
            for k in ("objects", "history", "ble_addrs"):
                if k in sizes:
                    log.observe(k + "_n", sizes[k])


def async_start(hass: HomeAssistant) -> None:
    """Start the one timer (a no-op when it is already running)."""
    try:
        dom = hass.data.setdefault(DOMAIN, {})
        cur = dom.get(_DATA_SAMPLER)
        if isinstance(cur, PerfSampler) and cur.running:
            return
        s = PerfSampler(hass)
        s.start()
        dom[_DATA_SAMPLER] = s
    except Exception as err:
        _LOGGER.debug("Load sampler not started: %s", err)
    try:
        _start_runs(hass)
    except Exception as err:
        _LOGGER.debug("Run log not started: %s", err)


def async_stop(hass: HomeAssistant) -> None:
    """Cancel the timer. The window stays, so a reload keeps the day's numbers."""
    try:
        s = hass.data.get(DOMAIN, {}).pop(_DATA_SAMPLER, None)
        if isinstance(s, PerfSampler):
            s.stop()
    except Exception:
        pass
