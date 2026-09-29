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

and the hardware class (hw_class): CPU count, RAM bucket, architecture,
installation type and board family — each from a fixed list, never a model
string, hostname or serial.

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
"""

from __future__ import annotations

import logging
import math
import os
import platform
import re
import time
from functools import partial
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .telemetry import enabled

_LOGGER = logging.getLogger(__name__)

INTERVAL_S = 60.0
_DATA_SAMPLER = "_perf_sampler"     # the running timer (one per hass)
_DATA_WINDOW = "_perf_window"       # stats since the last report — survives a reload
_DATA_HW = "_perf_hw"               # the hardware class, detected once

# The max-out limits: a sample over one is counted (PerfWindow.over).
OVER_LOAD_PER_CPU = 1.0      # 1-minute load above one runnable task per CPU
OVER_HA_CPU_PCT = 90.0       # Home Assistant's process above 90% of one core
UNDER_MEM_AVAIL_PCT = 10.0   # host memory available below 10%
OVER_LAG_MS = 1000.0         # the event loop a second or more late

METRICS: tuple[str, ...] = ("load", "cpu", "rss", "mem", "swap", "lag", "snap", "cycle")
OVER: tuple[str, ...] = ("load", "cpu", "mem", "lag")
_HW_TRIES = 10               # ticks allowed to wait for the Supervisor's info

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
    """The window so far — and start a new one (a send)."""
    w = window(hass)
    hass.data[DOMAIN][_DATA_WINDOW] = PerfWindow()
    return w


def give_back_window(hass: HomeAssistant, w: PerfWindow | None) -> None:
    if isinstance(w, PerfWindow):
        window(hass).merge(w)


def reset_window(hass: HomeAssistant) -> None:
    """Opt-in: nothing measured before the person said yes goes."""
    hass.data.setdefault(DOMAIN, {})[_DATA_WINDOW] = PerfWindow()


def record_duration(hass: HomeAssistant, metric: str, ms: float) -> None:
    """One snapshot build ("snap") or presence poll ("cycle") took `ms`.

    Called on the event loop from the code being timed: a dict lookup when
    the report is off, one bin increment when it is on. Never raises.
    """
    try:
        if enabled(hass):
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
        # (on the event loop) just to be told no.
        if "hassio" in hass.config.components:
            from homeassistant.components import hassio as _hassio  # noqa: PLC0415
            if _hassio.is_hassio(hass) is True:
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

    @property
    def running(self) -> bool:
        return self._handle is not None and not self._stopped

    def start(self) -> None:
        loop = self.hass.loop
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
            if not enabled(self.hass):
                self._last_cpu = None   # a CPU delta must never span time off
                return
            self._maybe_detect_hw()
            if self._busy:
                return
            self._busy = True
            fut = self.hass.async_add_executor_job(read_host)
            fut.add_done_callback(partial(self._on_read, lag_ms))
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

    def _on_read(self, lag_ms: float, fut: Any) -> None:
        """The executor's reading is back (on the event loop). Never raises."""
        self._busy = False
        try:
            if self._stopped or fut.cancelled() or fut.exception() is not None:
                return
            self.record(lag_ms, fut.result())
        except Exception as err:
            _LOGGER.debug("Load sample dropped: %s", err)

    def record(self, lag_ms: float, s: dict[str, Any]) -> None:
        """Fold one reading into the window (the math, testable alone)."""
        if not enabled(self.hass):
            self._last_cpu = None
            return
        w = window(self.hass)
        w.samples += 1
        w.add("lag", lag_ms)
        if lag_ms > OVER_LAG_MS:
            w.over["lag"] += 1
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
                    if pct > OVER_HA_CPU_PCT:
                        w.over["cpu"] += 1
        mem = s.get("mem_avail_pct")
        if isinstance(mem, (int, float)):
            w.add("mem", mem)
            if mem < UNDER_MEM_AVAIL_PCT:
                w.over["mem"] += 1
        for key, metric in (("swap_mb", "swap"), ("rss_mb", "rss")):
            v = s.get(key)
            if isinstance(v, (int, float)):
                w.add(metric, v)


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


def async_stop(hass: HomeAssistant) -> None:
    """Cancel the timer. The window stays, so a reload keeps the day's numbers."""
    try:
        s = hass.data.get(DOMAIN, {}).pop(_DATA_SAMPLER, None)
        if isinstance(s, PerfSampler):
            s.stop()
    except Exception:
        pass
