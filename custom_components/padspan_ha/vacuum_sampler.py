# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Every advertisement of the tag on the robot while it stands at a run's stop.

bluetooth_live fills its sample buffer (vacuum_import.tag_samples) from
bluetooth.async_register_callback, which fires only when a device's
advertisement data CHANGES (developers.home-assistant.io, core/bluetooth/api;
habluetooth's manager drops identical packets). A fixed-payload beacon, the kind
stuck on the robot, then gives a few samples per receiver in 20 s, not the ~100
it sends (research, 2026-11-24). So during a stop, and only then:

  every   Home Assistant 2026.10 and newer: bluetooth.async_register_advertisement_callback
          (hass, callback, address) fires once per packet each scanner hears,
          unchanged or not (home-assistant/core PR #182916, api.py).
  poll    older: once a second, each scanner's own latest record of the tag
          (habluetooth scanners' discovered_devices_and_advertisement_data and
          discovered_device_timestamps), a sample counted only when its time is
          new, so one packet is never counted twice.

The buffer's own samples stay the fallback: per receiver, whichever path heard
more is used (StopSampler.merged).
"""

from __future__ import annotations

import logging
from typing import Any

from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)

MAX_SAMPLES = 200            # per receiver per stop (a 100 ms beacon over 35 s is ~350; plenty)


class StopSampler:
    """The tag's RSSI per receiver while the robot stands at one stop."""

    def __init__(self, hass, tag: str) -> None:
        self.hass = hass
        self.tag = str(tag or "").strip().upper()
        self.samples: dict[str, list[float]] = {}
        self.mode = "buffer"                 # every | poll | buffer (only the buffer's own samples)
        self._unsub = None
        self._last: dict[str, Any] = {}      # scanner source -> the record time last counted

    def _add(self, src: str, rssi: Any) -> None:
        if not src or src == "_unknown" or not isinstance(rssi, (int, float)):
            return
        s = self.samples.setdefault(str(src), [])
        if len(s) < MAX_SAMPLES:
            s.append(float(rssi))

    def _on_adv(self, service_info: Any) -> None:
        try:
            self._add(getattr(service_info, "source", ""), getattr(service_info, "rssi", None))
        except Exception:  # noqa: BLE001 — a bad packet is no sample; never raise into HA's dispatch
            _quiet_error("vacuum_sampler:on_adv")

    def start(self) -> None:
        """Every packet where Home Assistant can give them; else polling (poll())."""
        try:
            from homeassistant.components import bluetooth  # noqa: PLC0415
            reg = getattr(bluetooth, "async_register_advertisement_callback", None)
            if reg is not None:
                self._unsub = reg(self.hass, self._on_adv, self.tag)
                self.mode = "every"
                return
        except Exception:  # noqa: BLE001 — no Bluetooth: the buffer's samples alone
            _quiet_error("vacuum_sampler:register")
        self.mode = "poll"

    def poll(self) -> None:
        """Once a second without the every-packet callback: each scanner's own
        latest record of the tag, counted when its time is new."""
        if self.mode != "poll":
            return
        try:
            from habluetooth import get_manager  # noqa: PLC0415
            manager = get_manager()
            scanners = list(manager.async_current_scanners()) if manager else []
        except Exception:  # noqa: BLE001 — no habluetooth: the buffer's samples alone
            _quiet_error("vacuum_sampler:manager")
            self.mode = "buffer"
            return
        for sc in scanners:
            try:
                src = str(getattr(sc, "source", "") or "")
                found = (getattr(sc, "discovered_devices_and_advertisement_data", None) or {})
                hit = next(((dev, adv) for a, (dev, adv) in found.items() if str(a).upper() == self.tag), None)
                if not src or hit is None:
                    continue
                stamps = getattr(sc, "discovered_device_timestamps", None) or {}
                when = next((v for a, v in stamps.items() if str(a).upper() == self.tag), None)
                if when is None or self._last.get(src) == when:
                    continue
                self._last[src] = when
                self._add(src, getattr(hit[1], "rssi", None))
            except Exception:  # noqa: BLE001 — one scanner that can't be read
                _quiet_error("vacuum_sampler:scanner")

    def stop(self) -> None:
        if self._unsub:
            try:
                self._unsub()
            except Exception:  # noqa: BLE001
                _quiet_error("vacuum_sampler:unregister")
            self._unsub = None

    def merged(self, buffered: list[dict]) -> list[dict]:
        """Per receiver, this stop's samples or the buffer's, whichever has more."""
        out: dict[str, list[float]] = {s: list(v) for s, v in self.samples.items()}
        for r in buffered or []:
            src, vals = str(r.get("source") or ""), list(r.get("rssi_samples") or [])
            if src and len(vals) > len(out.get(src, [])):
                out[src] = vals
        return [{"source": s, "rssi_samples": v} for s, v in sorted(out.items()) if v]


def samples_bucket(n: int) -> str:
    """A receiver's samples at one stop, in the opt-in report's closed words."""
    return "rx_samples_0_2" if n < 3 else "rx_samples_3_9" if n < 10 else "rx_samples_10_29" if n < 30 else "rx_samples_30_plus"
