# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""An in-process WLED for the exact-look tests: no device is ever contacted.

It follows the firmware where the exact look depends on it (WLED 0.14.4 /
0.15.4 / 16.0.1 json.cpp, cfg.cpp, FX_fcn.cpp):
- deserializeState's order: bri, on (toggle), unfreeze on turn-on,
  transition, tt, tb, nl, udpn, mainseg, then seg[]; "ps" queues a preset and
  returns early;
- a segment "on" never turns the master on; a 3-value colour sets W to 0;
  colours on an on/off segment and the palette on a non-RGB one are ignored;
- an id past the segment count is appended (and renumbered); stop 0 deletes;
  deleting at least half of more than 3 segments purges and renumbers;
- udpn.recv is ignored from 0.15 on (it only exists on 0.14); a config save
  writes the live receive/sync groups to flash and resets the live "send"
  switch to the saved one (0.15+); on 0.14.4 a saved "dir" changes the live
  switch only when it differs from the one it booted with (cfg.cpp:399-401)
  and the save writes the LIVE switch back as "dir" (cfg.cpp:868), with no
  "en" or "pal" (0.14 has neither); keys WLED resets when a write leaves
  them out do;
- the v:true reply as WLED serializes it: only active segments, W dropped
  without a white channel, opacity 0 reported as 255, briLast as "bri";
- faults: 503 busy, a lost reply (applied, then a timeout), offline, a
  reboot to the boot defaults (aseg rebuilds one orange segment per output).

Plug it in by monkeypatching ws_wled._request_once with fleet.request_once,
so ws_wled._request's real busy backoff runs over it.
"""

from __future__ import annotations

import asyncio
import copy
import json
from typing import Any

from custom_components.padspan_ha import ws_wled as W

DEFAULT_COLOR = [255, 160, 0, 0]
SEG_KEYS_BOOL = ("sel", "rev", "mi", "rY", "mY", "tp", "o1", "o2", "o3")


def _ver_tuple(ver: str) -> tuple:
    out = []
    for part in str(ver).split("-")[0].split("."):
        try:
            out.append(int(part))
        except ValueError:
            out.append(0)
    return tuple(out)


class FakeWled:
    def __init__(self, *, host: str, info: dict, state: dict, cfg: dict, presets: dict | None = None,
                 reserved_fx: tuple = (), modes: int | None = None) -> None:
        self.host = host
        self.info = copy.deepcopy(info)
        self.cfg = copy.deepcopy(cfg)
        self.presets = copy.deepcopy(presets or {"0": {}})
        self.v14 = _ver_tuple(self.info.get("ver", "0.15.0")) < (0, 15)
        self.v16 = _ver_tuple(self.info.get("ver", "0.15.0")) >= (16,)
        self.modes = modes or int(self.info.get("fxcount") or 187)
        self.reserved_fx = set(reserved_fx)
        self.log: list[tuple[str, str, Any]] = []
        self.busy = 0            # next N requests answer 503
        self.lose = 0            # next N POSTs are applied, then the reply is lost
        self.offline = False
        self.gate: asyncio.Event | None = None
        self.rebooted = 0
        self.presets_applied: list = []
        self._load_state(state)
        # 0.14.4's notifyDirectDefault: the saved "dir" it last read.
        self.dir_default = bool(((((self.cfg.get("if") or {}).get("sync") or {}).get("send")) or {}).get("dir", False))

    # ── building ───────────────────────────────────────────────────────────

    @classmethod
    def from_capture(cls, cap: dict, **kw: Any) -> "FakeWled":
        return cls(host=cap.get("host", "fake"), info=cap["info"], state=cap["state"], cfg=cap["cfg"],
                   presets=cap.get("presets"), **kw)

    def _load_state(self, st: dict) -> None:
        self.bri = int(st.get("bri", 128)) if st.get("on") else 0
        self.bri_last = int(st.get("bri", 128)) or 128
        self.transition = int(st.get("transition", 7))
        self.tt_once: int | None = None
        self.tb = None
        nl = st.get("nl") or {}
        self.nl = {"on": bool(nl.get("on")), "dur": nl.get("dur", 60), "mode": nl.get("mode", 1), "tbri": nl.get("tbri", 0)}
        u = st.get("udpn") or {}
        self.send_rt = bool(u.get("send", False))
        self.recv_flag = bool(u.get("recv", True))       # 0.14 only
        self.sgrp = int(u.get("sgrp", 1))
        self.rgrp = int(u.get("rgrp", 1))
        self.lor = int(st.get("lor", 0))
        self.mainseg = int(st.get("mainseg", 0))
        self.ps = st.get("ps", -1)
        self.pl = st.get("pl", -1)
        self.extra_top = {k: st[k] for k in ("AudioReactive", "bs", "ledmap") if k in st}
        self.segs: list[dict | None] = []
        for s in st.get("seg") or []:
            sid = int(s.get("id", len(self.segs)))
            while len(self.segs) < sid:
                self.segs.append(None)
            seg = {k: copy.deepcopy(v) for k, v in s.items() if k not in ("id", "len", "lc", "bri", "col")}
            seg["opacity"] = int(s.get("bri", 255))
            seg["col"] = [list(c) + [0] * (4 - len(c)) for c in s.get("col") or [[0, 0, 0]] * 3]
            self.segs.append(seg)

    # ── the device's own rules ─────────────────────────────────────────────

    @property
    def matrix(self) -> dict | None:
        return (self.info.get("leds") or {}).get("matrix")

    @property
    def total(self) -> int:
        return int((self.info.get("leds") or {}).get("count") or ((self.cfg.get("hw") or {}).get("led") or {}).get("total") or 0)

    @property
    def white(self) -> bool:
        return bool((self.info.get("leds") or {}).get("rgbw"))

    def _buses(self) -> list[dict]:
        return list((((self.cfg.get("hw") or {}).get("led") or {}).get("ins")) or [])

    def seg_lc(self, seg: dict) -> int:
        """Light capabilities of the outputs a segment covers (bus_manager)."""
        led = (self.cfg.get("hw") or {}).get("led") or {}
        glob = led.get("rgbwm", 255)
        lc = 0
        start, stop = int(seg.get("start", 0)), int(seg.get("stop", 0))
        if self.matrix and "startY" in seg:
            start, stop = 0, int(self.matrix["w"]) * int(self.matrix["h"])
        for b in self._buses():
            bs, bl = int(b.get("start", 0)), int(b.get("len", 0))
            if bs >= stop or bs + bl <= start:
                continue
            t, mode = int(b.get("type", 22)), b.get("rgbwm", 0) if glob == 255 else glob
            manual_w = mode in (0, 3)
            if t == 40:
                continue
            if t in (41,):
                lc |= 2
                continue
            if t == 42:
                lc |= 4 | (2 if manual_w else 0)
                continue
            lc |= 1
            if t in (29, 30, 31, 44, 45, 28, 32, 34) and manual_w:
                lc |= 2
            if t in (45, 28, 32, 34):
                lc |= 4
        return lc

    def _append(self) -> int:
        self.segs.append({"start": 0, "stop": self.total, "grp": 1, "spc": 0, "of": 0, "on": True, "frz": False,
                          "opacity": 255, "cct": 127, "set": 0, "col": [list(DEFAULT_COLOR), [0, 0, 0, 0], [0, 0, 0, 0]],
                          "fx": 0, "sx": 128, "ix": 128, "pal": 0, "c1": 128, "c2": 128, "c3": 16, "sel": True,
                          "rev": False, "mi": False, "o1": False, "o2": False, "o3": False, "si": 0, "m12": 0,
                          **({"startY": 0, "stopY": int(self.matrix["h"]), "rY": False, "mY": False, "tp": False}
                             if self.matrix else {}), **({"bm": 0} if self.v16 else {})})
        return len(self.segs) - 1

    def _deserialize_segment(self, elem: dict, it: int) -> bool:
        sid = int(elem.get("id", it))
        if sid >= int((self.info.get("leds") or {}).get("maxseg") or 32):
            return False
        stop = elem.get("stop", -1)
        if sid >= len(self.segs):
            if stop <= 0:
                return False
            sid = self._append()
        seg = self.segs[sid]
        if seg is None:
            if stop <= 0:
                return False
            self.segs[sid] = None
            sid2 = self._append()
            self.segs[sid] = self.segs.pop(sid2)
            seg = self.segs[sid]
        start = int(elem.get("start", seg["start"]))
        if stop < 0:
            ln = int(elem.get("len", 0) or 0)
            stop = start + ln if ln > 0 else seg["stop"]
        if "n" in elem:
            seg["n"] = elem["n"]
        elif (start, stop) != (seg["start"], seg["stop"]):
            seg.pop("n", None)
        grp = int(elem.get("grp", seg.get("grp", 1)))
        spc = int(elem.get("spc", seg.get("spc", 0)))
        of = seg.get("of", 0)
        length = stop - start if stop > start else 1
        if "of" in elem:
            of = abs(int(elem["of"])) % length if abs(int(elem["of"])) > length - 1 else abs(int(elem["of"]))
        # setGeometry
        seg["grp"], seg["spc"] = (grp, spc) if grp else (1, 0)
        seg["of"] = of
        if "startY" in seg:
            seg["startY"] = int(elem.get("startY", seg["startY"]))
            seg["stopY"] = int(elem.get("stopY", seg["stopY"]))
        if stop <= start:
            self.segs[sid] = None                 # inactive; stays in the list until a purge
            if sid == self.mainseg:
                self.mainseg = 0
            return True
        seg["start"] = start
        limit = int(self.matrix["w"]) if self.matrix and "startY" in seg else self.total
        seg["stop"] = min(stop, limit) if limit else stop
        if "bri" in elem:
            b = int(elem["bri"])
            if b > 0:
                seg["opacity"] = b
            seg["on"] = b > 0
        if "on" in elem:
            seg["on"] = bool(elem["on"])
        if "frz" in elem:
            seg["frz"] = bool(elem["frz"])
        if "cct" in elem:
            seg["cct"] = int(elem["cct"])
        lc = self.seg_lc(seg)
        if isinstance(elem.get("col"), list):
            if lc & 3:
                for i, c in enumerate(elem["col"][:3]):
                    if isinstance(c, list) and c:
                        rgbw = [0, 0, 0, 0]
                        for k, v in enumerate(c[:4]):
                            rgbw[k] = int(v)
                        seg["col"][i] = rgbw
            else:
                seg["col"][0], seg["col"][1] = [255, 255, 255, 255], [0, 0, 0, 0]
        for k in ("set", "si", "m12"):
            if k in elem:
                seg[k] = int(elem[k])
        for k in SEG_KEYS_BOOL:
            if k in elem and (k in seg or k in ("sel", "rev", "mi", "o1", "o2", "o3")):
                seg[k] = bool(elem[k])
        if "fx" in elem:
            fx = int(elem["fx"])
            if self.pl >= 0:
                self.pl = -1                      # json.cpp:290 — sending fx unloads a playlist
            while fx < self.modes and fx in self.reserved_fx:
                fx += 1
            if fx >= self.modes:
                fx = 0
            seg["fx"] = fx
        for k in ("sx", "ix", "c1", "c2"):
            if k in elem:
                seg[k] = int(elem[k])
        if "pal" in elem and lc & 1:
            seg["pal"] = int(elem["pal"])
        if "c3" in elem:
            seg["c3"] = max(0, min(31, int(elem["c3"])))
        if "bm" in elem and self.v16:
            seg["bm"] = int(elem["bm"])
        return True

    def _toggle(self) -> None:
        if self.bri == 0:
            self.bri = self.bri_last
        else:
            self.bri_last, self.bri = self.bri, 0

    def deserialize_state(self, root: dict) -> None:
        on_before = self.bri > 0
        if "bri" in root:
            self.bri = max(0, min(255, int(root["bri"])))
        on_val = root.get("on", self.bri > 0)
        if isinstance(on_val, str):
            if on_val.startswith("t") and (on_before or not self.bri):
                self._toggle()
        elif (not bool(on_val)) != (not self.bri):
            self._toggle()
        if self.bri and not on_before:
            for s in self.segs:
                if s:
                    s["frz"] = False
        if "transition" in root:
            self.transition = int(root["transition"])
        if "tt" in root:
            self.tt_once = int(root["tt"])
        if "tb" in root:
            self.tb = int(root["tb"])
        nl = root.get("nl")
        if isinstance(nl, dict):
            for k in ("on", "dur", "mode", "tbri"):
                if k in nl:
                    self.nl[k] = nl[k]
        u = root.get("udpn")
        if isinstance(u, dict):
            if "send" in u:
                self.send_rt = bool(u["send"])
            if "sgrp" in u:
                self.sgrp = int(u["sgrp"])
            if "rgrp" in u:
                self.rgrp = int(u["rgrp"])
            if self.v14 and "recv" in u:
                self.recv_flag = bool(u["recv"])
        if "rb" in root:
            self.reboot()
            return
        if "mainseg" in root:
            m = int(root["mainseg"])
            if m < len(self.segs) and self.segs[m] is not None:
                self.mainseg = m
        if "lor" in root:
            self.lor = int(root["lor"])
        segv = root.get("seg")
        if isinstance(segv, list):
            deleted = 0
            for it, elem in enumerate(segv):
                if isinstance(elem, dict) and self._deserialize_segment(elem, it) and elem.get("stop") == 0:
                    deleted += 1
            n = len(self.segs)
            if n > 3 and deleted >= n // 2:
                self.segs = [s for s in self.segs if s is not None]
        elif isinstance(segv, dict):
            if "id" in segv:
                self._deserialize_segment(segv, int(segv["id"]))
            else:
                for i, s in enumerate(self.segs):
                    if s and s.get("sel"):
                        self._deserialize_segment({**segv, "id": i}, i)
        if "ps" in root:
            self.presets_applied.append(root["ps"])          # queued; applied later by the loop
            return
        if self.bri > 0:
            self.bri_last = self.bri

    def serialize_state(self) -> dict:
        out: dict[str, Any] = {"on": self.bri > 0, "bri": self.bri if self.bri else self.bri_last,
                               "transition": self.transition}
        if self.v16:
            out["bs"] = self.extra_top.get("bs", 0)
        out.update({"ps": self.ps, "pl": self.pl})
        out.update({k: v for k, v in self.extra_top.items() if k != "bs"})
        out["nl"] = {**self.nl, "rem": -1}
        out["udpn"] = {"send": self.send_rt, "recv": self.recv_flag if self.v14 else self.rgrp != 0,
                       "sgrp": self.sgrp, "rgrp": self.rgrp}
        out["lor"] = self.lor
        out["mainseg"] = self.mainseg
        segs = []
        for sid, s in enumerate(self.segs):
            if s is None or s["stop"] == 0:
                continue
            seg: dict[str, Any] = {"id": sid, "start": s["start"], "stop": s["stop"]}
            if "startY" in s:
                seg["startY"], seg["stopY"] = s["startY"], s["stopY"]
            seg["len"] = s["stop"] - s["start"]
            for k in ("grp", "spc", "of", "on", "frz"):
                seg[k] = s[k]
            seg["bri"] = s["opacity"] or 255
            seg["cct"] = s["cct"]
            seg["set"] = s.get("set", 0)
            if self.v16:
                seg["lc"] = self.seg_lc(s)
            if "n" in s:
                seg["n"] = s["n"]
            seg["col"] = [list(c[:4]) if self.white else list(c[:3]) for c in s["col"]]
            for k in ("fx", "sx", "ix", "pal", "c1", "c2", "c3", "sel", "rev", "mi"):
                seg[k] = s[k]
            for k in ("rY", "mY", "tp"):
                if k in s:
                    seg[k] = s[k]
            for k in ("o1", "o2", "o3", "si", "m12"):
                seg[k] = s[k]
            if self.v16:
                seg["bm"] = s.get("bm", 0)
            segs.append(seg)
        out["seg"] = segs
        return out

    def serialize_info(self) -> dict:
        info = copy.deepcopy(self.info)
        leds = info.setdefault("leds", {})
        leds["seglc"] = [self.seg_lc(s) for s in self.segs if s is not None and s["stop"] > 0]
        info["live"] = False
        return info

    def deserialize_config(self, body: dict) -> None:
        body = {k: v for k, v in body.items() if k not in ("rb", "pin", "sv")}
        led = ((body.get("hw") or {}).get("led")) or {}
        merged = W.deep_merge(self.cfg, body)
        # Keys WLED resets when a write leaves them out (cfg.cpp).
        mled = merged.setdefault("hw", {}).setdefault("led", {})
        if "fps" not in led:
            mled["fps"] = 42
        if "rgbwm" not in led:
            mled["rgbwm"] = 255
        if "gc" not in (body.get("light") or {}):
            merged.setdefault("light", {})["gc"] = {"bri": 1, "col": 1, "val": 2.8}
        sync = ((body.get("if") or {}).get("sync")) or {}
        recv, send = sync.get("recv") or {}, sync.get("send") or {}
        if "grp" in recv:
            self.rgrp = int(recv["grp"])
        if "grp" in send:
            self.sgrp = int(send["grp"])
        saved_send = merged.setdefault("if", {}).setdefault("sync", {}).setdefault("send", {})
        if not self.v14:
            self.send_rt = bool(saved_send.get("en", False))       # sendNotificationsRT = sendNotifications
        elif "dir" in send:
            # cfg.cpp:399-401 (0.14.4): prev = notifyDirectDefault; read dir;
            # only a CHANGED saved value reaches the live notifyDirect.
            if bool(send["dir"]) != self.dir_default:
                self.send_rt = bool(send["dir"])
            self.dir_default = bool(send["dir"])
        # serializeConfig: the live groups are what gets saved.
        msync = merged["if"]["sync"]
        msync.setdefault("recv", {})["grp"] = self.rgrp
        msync["send"]["grp"] = self.sgrp
        if self.v14:
            msync["send"]["dir"] = self.send_rt                    # cfg.cpp:868 — the LIVE switch
            msync["send"].pop("en", None)                          # 0.14 has no such settings
            msync["recv"].pop("pal", None)
        self.cfg = merged
        if "rb" in body:
            self.reboot()

    def reboot(self) -> None:
        """Back to the boot defaults (wled.cpp): saved sync, def.on/bri, aseg
        rebuilds one segment per output in the default orange."""
        self.rebooted += 1
        sync = ((self.cfg.get("if") or {}).get("sync")) or {}
        self.send_rt = bool((sync.get("send") or {}).get("dir" if self.v14 else "en", False))
        self.dir_default = bool((sync.get("send") or {}).get("dir", False))
        self.sgrp = int((sync.get("send") or {}).get("grp", 1))
        self.rgrp = int((sync.get("recv") or {}).get("grp", 1))
        self.recv_flag = True
        d = self.cfg.get("def") or {}
        self.bri_last = int(d.get("bri", 128))
        self.bri = self.bri_last if d.get("on", True) else 0
        self.transition = int((((self.cfg.get("light") or {}).get("tr")) or {}).get("dur", 7))
        self.nl["on"] = False
        self.mainseg = 0
        self.pl = -1
        self.segs = []
        for b in self._buses() or [{"start": 0, "len": self.total}]:
            sid = self._append()
            self.segs[sid]["start"] = int(b.get("start", 0))
            self.segs[sid]["stop"] = int(b.get("start", 0)) + int(b.get("len", 0))
        self.info["uptime"] = 0

    # ── HTTP ───────────────────────────────────────────────────────────────

    async def handle(self, method: str, path: str, body: Any) -> Any:
        self.log.append((method, path, copy.deepcopy(body)))
        if self.gate is not None:
            await self.gate.wait()
        if self.offline:
            raise W.WledError("unreachable", f"Can't reach {self.host}: offline")
        if self.busy:
            self.busy -= 1
            raise W.WledError("busy", "The device is busy — try again in a moment")
        if method == "GET":
            if path == "json/state":
                return self.serialize_state()
            if path == "json/info":
                return self.serialize_info()
            if path in ("json/si", "json"):
                return {"state": self.serialize_state(), "info": self.serialize_info()}
            if path == "json/cfg":
                return copy.deepcopy(self.cfg)
            if path == "presets.json":
                return copy.deepcopy(self.presets)
            raise W.WledError("http_error", f"The device answered HTTP 404 ({path})")
        if path == "json/state":
            self.deserialize_state(copy.deepcopy(body))
            reply = self.serialize_state() if body.get("v") else {"success": True}
        elif path == "json/cfg":
            self.deserialize_config(copy.deepcopy(body))
            reply = {"success": True}
        else:
            raise W.WledError("http_error", f"The device answered HTTP 404 ({path})")
        if self.lose:
            self.lose -= 1
            raise W.WledError("timeout", f"No answer from {self.host} within 12 s")
        return json.loads(json.dumps(reply))

    def posts(self, path: str = "json/state") -> list[dict]:
        return [b for m, p, b in self.log if m == "POST" and p == path]


class FakeFleet:
    """host -> FakeWled; request_once replaces ws_wled._request_once."""

    def __init__(self, *devices: FakeWled) -> None:
        self.devices = {d.host: d for d in devices}
        self.order: list[tuple[str, str, str]] = []

    async def request_once(self, hass: Any, host: str, method: str, path: str, body: Any, timeout: float) -> Any:
        self.order.append((host, method, path))
        dev = self.devices.get(host)
        if dev is None:
            raise W.WledError("unreachable", f"Can't reach {host}")
        return await dev.handle(method, path, body)


def simple_device(host: str = "192.168.2.118", *, mac: str = "28562f551738", ver: str = "0.15.3",
                  arch: str = "esp32", segs: int = 2, white: bool = True, on: bool = True) -> FakeWled:
    """A small Quin-like device: a 5-channel PWM output + a digital strip per
    extra segment, each its own segment."""
    buses = [{"start": 0, "len": 1, "type": 45 if white else 22, "order": 1, "rev": False, "skip": 0,
              "rgbwm": 0, "freq": 19531, "maxpwr": 0, "ledma": 0, "pin": [2, 4, 12, 32, 33]}]
    start = 1
    for _ in range(segs - 1):
        buses.append({"start": start, "len": 30, "type": 22, "order": 0, "rev": False, "skip": 0,
                      "rgbwm": 0, "freq": 0, "maxpwr": 1250, "ledma": 55, "pin": [5]})
        start += 30
    total = start
    seg_list = [{"id": i, "start": b["start"], "stop": b["start"] + b["len"], "len": b["len"], "grp": 1, "spc": 0,
                 "of": 0, "on": True, "frz": False, "bri": 255, "cct": 127, "set": 0,
                 "col": [[255, 160, 0, 0] if white else [255, 160, 0], [0, 0, 0, 0] if white else [0, 0, 0],
                         [0, 0, 0, 0] if white else [0, 0, 0]],
                 "fx": 0, "sx": 128, "ix": 128, "pal": 0, "c1": 128, "c2": 128, "c3": 16, "sel": True, "rev": False,
                 "mi": False, "o1": False, "o2": False, "o3": False, "si": 0, "m12": 0}
                for i, b in enumerate(buses)]
    info = {"ver": ver, "arch": arch, "mac": mac, "fxcount": 187, "uptime": 1000, "live": False,
            "leds": {"count": total, "rgbw": white, "seglc": [], "maxseg": 16 if "8266" in arch else 32}}
    cfg = {"hw": {"led": {"total": total, "maxpwr": 1250, "ledma": 0, "cct": False, "cr": False, "ic": False, "cb": 0,
                          "fps": 42, "rgbwm": 255, "ins": buses}, "if": {"i2c-pin": [-1, -1]}},
           "light": {"scale-bri": 100, "gc": {"bri": 1, "col": 1, "val": 2.8}, "tr": {"dur": 7}},
           "def": {"ps": 0, "on": True, "bri": 128},
           "if": {"sync": {"recv": {"bri": True, "col": True, "fx": True, "pal": True, "grp": 1, "seg": False, "sb": False},
                           "send": {"en": False, "dir": False, "btn": False, "va": False, "hue": True, "grp": 1, "ret": 0}}}}
    state = {"on": on, "bri": 128, "transition": 7, "ps": -1, "pl": -1,
             "nl": {"on": False, "dur": 60, "mode": 1, "tbri": 0},
             "udpn": {"send": False, "recv": True, "sgrp": 1, "rgrp": 1}, "lor": 0, "mainseg": 0, "seg": seg_list}
    return FakeWled(host=host, info=info, state=state, cfg=cfg)
