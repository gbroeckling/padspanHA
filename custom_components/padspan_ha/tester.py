# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Become a tester — the one PadSpan channel that carries contact details.

Garry, 2026-09-28: "add in a become tester option once someone has chosen the
opt-in field. Have them fill in info I might need to make it work if they
want to become a tester. Think on this one so it doesn't break any rules or
cause issues."

The opt-in usage report (telemetry.py) promises counts only — never names,
addresses or contact details. A sign-up is contact details by nature, so it
is kept apart from the report in every way that matters:

- Its own consent and its own button. Nothing here runs by itself: the only
  sends are the person's own presses of "Send sign-up", "Send update" and
  "Stop being a tester" (Settings -> Presence -> Help improve PadSpan). No
  schedule, no queue, no retry — a failure is shown and left there.
- Its own address, TESTER_URL (server/tester.php) — never the report's.
- Its own id: `tester_id`, a random UUID minted here at the first sign-up —
  never the report's install id. That id goes with a sign-up ONLY while the
  person ticks "Link my anonymous usage reports to this sign-up".
- Its own storage: one settings key, SETTINGS_KEY, holding what the person
  typed so they can update it. It stays on their Home Assistant, is never in
  the settings every panel user reads (ws_common._get_settings takes it out),
  and telemetry.build_payload never reads it.

The "About your setup" lines are the report's own numbers — setup_lines()
reads telemetry.build_payload rather than counting anything itself — so they
are counts and versions only; every line is shown, each can be unticked, and
only the ticked ones go.

Withdrawing sends {action: "withdraw", tester_id}; the record here is cleared
only once the server says it has deleted its copy, so the id that can reach
the server's copy is never lost while that copy may still exist.
"""

from __future__ import annotations

import copy
import json
import logging
import re
import time
import uuid
from typing import Any, Iterable

from homeassistant.core import HomeAssistant

from .build_info import BUILD_VERSION
from .const import DATA_SETTINGS, DATA_WLED_LOOKS, DOMAIN

_LOGGER = logging.getLogger(__name__)

TESTER_URL = "https://padspan.traks.ca/api/tester.php"
SCHEMA = 1
SETTINGS_KEY = "tester_signup"
MAX_BYTES = 4096                 # the server's cap (tester.php $MAX)

# What someone can offer to test. A closed list: views/tester_signup.js
# (TESTER_INTERESTS) and server/tester.php ($INTERESTS) hold the same keys,
# and tests/test_tester.py keeps the three equal.
INTERESTS: tuple[str, ...] = (
    "findmy", "wled", "floors", "calibration", "iphone_irk", "bermuda", "esphome_proxies", "other",
)
# "About your setup", in the order shown. server/tester.php ($SETUP_KEYS)
# keeps only these.
SETUP_KEYS: tuple[str, ...] = (
    "ha_version", "padspan_version", "edition", "tier", "scanners", "floors", "rooms",
    "placed_lights", "wled_devices", "wled_outputs", "findmy_on_air", "integrations",
)
# Characters, not bytes; the server counts the same way.
LIMITS: dict[str, int] = {
    "email": 254, "github": 39, "name": 64, "interests_other": 80, "notes": 500, "timezone": 64,
}
_SETUP_INT_MAX = 1_000_000
_SETUP_DICT_MAX = 12

# The same patterns, character for character, are in tester_signup.js and
# tester.php (tests/test_tester.py compares them).
EMAIL_PATTERN = (r"[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                 r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}")
GITHUB_PATTERN = r"[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}"
TIMEZONE_PATTERN = r"[A-Za-z][A-Za-z0-9_+-]*(?:/[A-Za-z0-9_+-]+){0,2}"
_SETUP_STR_PATTERN = r"[A-Za-z0-9 ._+-]{1,32}"
_SETUP_SUBKEY_PATTERN = r"[a-z0-9_]{1,24}"
# What a secret looks like in free text. A sign-up never needs one, and the
# notes box invites pasting: a PadSpan licence key, a 32+ digit hex string
# (an IRK, most API keys), a JWT (a Home Assistant long-lived token), or a
# 40+ character run of letters AND digits with no spaces (most other tokens).
# No flags anywhere, so each pattern means the same in all three languages.
SECRET_PATTERNS: tuple[tuple[str, str], ...] = (
    ("a PadSpan licence key", r"\b[Pp][Ss][Pp][Aa][Nn]-[A-Za-z0-9-]{8,}"),
    ("a long hex string (a key or an IRK)", r"\b[0-9A-Fa-f]{32,}\b"),
    ("a login token", r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
    ("a long key or token", r"(?=[A-Za-z0-9+=_]*[0-9])(?=[A-Za-z0-9+=_]*[A-Za-z])[A-Za-z0-9+=_]{40,}"),
)

_EMAIL_RE = re.compile(EMAIL_PATTERN)
_GITHUB_RE = re.compile(GITHUB_PATTERN)
_TIMEZONE_RE = re.compile(TIMEZONE_PATTERN)
_SETUP_STR_RE = re.compile(_SETUP_STR_PATTERN)
_SETUP_SUBKEY_RE = re.compile(_SETUP_SUBKEY_PATTERN)
# ASCII word boundaries, as JavaScript and PHP (no /u) draw them.
_SECRET_RES = tuple((what, re.compile(rx, re.ASCII)) for what, rx in SECRET_PATTERNS)
_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

NEW_ID_PLACEHOLDER = "(a new random ID, made when you send)"


class TesterError(Exception):
    """A refusal or a failed send, in words the panel shows as they are."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# ── what is stored here ──────────────────────────────────────────────────────

def _settings(hass: HomeAssistant):
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        raise TesterError("not_ready", "PadSpan's settings are not loaded yet — try again in a moment.")
    return st


def record(hass: HomeAssistant) -> dict[str, Any]:
    """The sign-up as this Home Assistant holds it ({} = none)."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    rec = (st.data if st else {}).get(SETTINGS_KEY)
    return rec if isinstance(rec, dict) else {}


def signed_up(rec: dict[str, Any]) -> bool:
    return bool(isinstance(rec, dict) and rec.get("signed_up_at"))


def carried_over(live: dict[str, Any] | None) -> dict[str, Any]:
    """The sign-up to keep through a factory reset or a settings restore.

    Its tester_id is the only way to reach the server's copy, so losing it
    locally would leave a sign-up nobody can withdraw; restoring an older
    one would bring back a sign-up that was withdrawn. The live record wins
    either way — like the licence, it is not house configuration.
    """
    rec = (live or {}).get(SETTINGS_KEY)
    return {SETTINGS_KEY: copy.deepcopy(rec) if isinstance(rec, dict) else {}}


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


# ── "About your setup" ───────────────────────────────────────────────────────

def _setup_value(v: Any) -> Any:
    """A setup value the server accepts, or None: a count, a short version or
    word, or a small {word: count} table. Nothing else can be a line."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v if 0 <= v <= _SETUP_INT_MAX else None
    if isinstance(v, str):
        return v if _SETUP_STR_RE.fullmatch(v) else None
    if isinstance(v, dict):
        if len(v) > _SETUP_DICT_MAX:
            return None
        out: dict[str, int] = {}
        for k, n in v.items():
            if not (isinstance(k, str) and _SETUP_SUBKEY_RE.fullmatch(k)):
                return None
            if isinstance(n, bool) or not isinstance(n, int) or not 0 <= n <= _SETUP_INT_MAX:
                return None
            out[k] = n
        return out
    return None


def _counted(d: dict[str, int], labels: dict[str, str]) -> str:
    parts = [f"{n} {labels.get(k, k)}" for k, n in d.items() if n]
    return ", ".join(parts) if parts else "none"


def _wled_devices(hass: HomeAssistant) -> int:
    try:
        return len(hass.config_entries.async_entries("wled"))
    except Exception:
        return 0


def _wled_outputs(hass: HomeAssistant) -> dict[str, int]:
    """LED outputs by WLED bus type over the lights PadSpan remembers a look
    for (wled_exact.py) — already in memory, no device is asked. Keyed by the
    bus type number ("type_45"), never a name or an address."""
    store = hass.data.get(DOMAIN, {}).get(DATA_WLED_LOOKS)
    data = getattr(store, "data", None)
    devices = data.get("devices") if isinstance(data, dict) else None
    out: dict[str, int] = {}
    for rec in (devices.values() if isinstance(devices, dict) else ()):
        look = rec.get("look") if isinstance(rec, dict) else None
        geometry = (((look or {}).get("setup") or {}).get("geometry") or {}) if isinstance(look, dict) else {}
        for bus in geometry.get("buses") or []:
            t = bus.get("type") if isinstance(bus, dict) else None
            if isinstance(t, int) and not isinstance(t, bool) and 0 <= t <= 255:
                out[f"type_{t}"] = out.get(f"type_{t}", 0) + 1
    # The server takes a table of at most 12; keep the most common.
    return dict(sorted(out.items(), key=lambda kv: -kv[1])[:_SETUP_DICT_MAX])


def lines_from_report(hass: HomeAssistant, report: dict[str, Any]) -> list[dict[str, Any]]:
    """The setup lines, from a usage report as telemetry.build_payload built
    it: [{key, label, value, text}] in SETUP_KEYS order. `value` is what goes;
    `text` is how the panel says it."""
    from .findmy import DEVICE_TYPES, TYPE_KEYS  # noqa: PLC0415
    from .wled_look import _bus_type  # noqa: PLC0415

    env = report.get("env") if isinstance(report.get("env"), dict) else {}
    out: list[dict[str, Any]] = []

    def add(key: str, label: str, value: Any, text: str) -> None:
        v = _setup_value(value)
        if v is not None:
            out.append({"key": key, "label": label, "value": v, "text": text})

    add("ha_version", "Home Assistant", report.get("ha_version"), str(report.get("ha_version")))
    add("padspan_version", "PadSpan", report.get("version"), str(report.get("version")))
    add("edition", "Edition", report.get("edition"),
        {"full": "PadSpan HA", "bright": "PadSpan Bright"}.get(str(report.get("edition")), str(report.get("edition"))))
    add("tier", "Tier", report.get("tier"),
        {"free": "free", "bright": "Bright Pro", "pro": "Pro"}.get(str(report.get("tier")), str(report.get("tier"))))
    kinds = env.get("scanner_kinds") if isinstance(env.get("scanner_kinds"), dict) else {}
    add("scanners", "Scanners", kinds,
        f"{sum(v for v in kinds.values() if isinstance(v, int))} — "
        + _counted(kinds, {"ip_known": "with diagnostics (ESPHome)", "espresense": "ESPresense",
                           "other": "other"}))
    for key, label in (("floors", "Floors"), ("rooms", "Rooms"), ("placed_lights", "Placed lights")):
        add(key, label, env.get(key), str(env.get(key)))
    n_wled = _wled_devices(hass)
    add("wled_devices", "WLED devices", n_wled, str(n_wled))
    outputs = _wled_outputs(hass)
    if outputs:
        add("wled_outputs", "WLED LED outputs (lights PadSpan remembers a look for)", outputs,
            ", ".join(f"{n} × {_bus_type(int(k[5:]))}" for k, n in outputs.items()))
    on_air = ((env.get("findmy") or {}).get("on_air") or {}) if isinstance(env.get("findmy"), dict) else {}
    add("findmy_on_air", "Find My on the air now", on_air,
        _counted(on_air, {TYPE_KEYS[i]: DEVICE_TYPES[i] for i in TYPE_KEYS}))
    integ = env.get("integrations") if isinstance(env.get("integrations"), dict) else {}
    wanted = {"bermuda": "Bermuda", "private_ble_device": "Private BLE Device", "esphome": "ESPHome"}
    picked = {k: integ.get(k, 0) for k in wanted}
    add("integrations", "Related integrations", picked,
        " · ".join(f"{wanted[k]} {n}" for k, n in picked.items()))
    return out


async def setup_lines(hass: HomeAssistant) -> list[dict[str, Any]]:
    """The report's own numbers for "About your setup" — built the way the
    report's Preview builds them, so they are the same numbers and the same
    trust tier. A house the report cannot describe gives no lines, not an
    error: the sign-up still works without them."""
    from . import telemetry  # noqa: PLC0415
    await telemetry.ensure_snapshot(hass)
    try:
        report = telemetry.build_payload(hass, consume=False)
        return lines_from_report(hass, report)
    except Exception as err:  # never let the summary stop a sign-up
        _LOGGER.debug("Tester setup summary unavailable: %s", err)
        return []


# ── checking what the person typed ───────────────────────────────────────────

def secret_in(text: str) -> str:
    """What secret `text` looks like it contains ("" if none)."""
    for what, rx in _SECRET_RES:
        if rx.search(text or ""):
            return what
    return ""


def _one_line(v: Any) -> str:
    return _CONTROL_RE.sub("", str(v or "").replace("\r", " ").replace("\n", " ").replace("\t", " ")).strip()


def clean_form(form: dict[str, Any], known_setup: Iterable[str]) -> tuple[dict[str, Any], list[str]]:
    """What the person typed, checked. Returns (clean, problems); a non-empty
    `problems` means nothing may be sent. The same checks, in the same words,
    run in the panel first (tester_signup.js testerProblems)."""
    problems: list[str] = []
    email = _one_line(form.get("email"))
    if not email:
        problems.append("Enter an email address.")
    elif len(email) > LIMITS["email"] or not _EMAIL_RE.fullmatch(email):
        problems.append("That email address doesn't look right.")
    github = _one_line(form.get("github"))
    if github.startswith("@"):
        github = github[1:]
    if github and not _GITHUB_RE.fullmatch(github):
        problems.append("That GitHub username doesn't look right.")
    name = _one_line(form.get("name"))
    if len(name) > LIMITS["name"]:
        problems.append(f"Name is too long ({LIMITS['name']} characters at most).")
    raw_interests = form.get("interests") or []
    interests: list[str] = []
    for i in raw_interests if isinstance(raw_interests, list) else []:
        if i not in INTERESTS:
            problems.append(f"Unknown choice under what you'd like to test: {str(i)[:40]}")
    for i in INTERESTS:
        if isinstance(raw_interests, list) and i in raw_interests:
            interests.append(i)
    other = _one_line(form.get("interests_other")) if "other" in interests else ""
    if len(other) > LIMITS["interests_other"]:
        problems.append(f"'Other' is too long ({LIMITS['interests_other']} characters at most).")
    notes = _CONTROL_RE.sub("", str(form.get("notes") or "").replace("\r\n", "\n").replace("\r", "\n")).strip()
    if len(notes) > LIMITS["notes"]:
        problems.append(f"Notes are too long ({LIMITS['notes']} characters at most).")
    timezone = _one_line(form.get("timezone"))
    if timezone and (len(timezone) > LIMITS["timezone"] or not _TIMEZONE_RE.fullmatch(timezone)):
        problems.append("That time zone doesn't look right (for example America/Vancouver).")
    for where, text in (("your name", name), ("the GitHub username", github),
                        ("'Other'", other), ("your notes", notes)):
        what = secret_in(text)
        if what:
            problems.append(f"That looks like {what} in {where} — please take it out. A sign-up never needs one.")
    if form.get("consent") is not True:
        problems.append("Tick the box to agree to be contacted.")
    known = [k for k in SETUP_KEYS if k in set(known_setup)]
    wanted = form.get("setup_keys") or []
    setup_keys = [k for k in known if isinstance(wanted, list) and k in wanted]
    clean = {
        "email": email, "github": github, "name": name, "interests": interests,
        "interests_other": other, "notes": notes, "timezone": timezone,
        "setup_keys": setup_keys, "setup_off": [k for k in known if k not in setup_keys],
        "consent": form.get("consent") is True, "link_reports": bool(form.get("link_reports")),
    }
    return clean, problems


# ── what is sent ─────────────────────────────────────────────────────────────

def build_body(hass: HomeAssistant, clean: dict[str, Any], *, action: str, tester_id: str,
               lines: list[dict[str, Any]]) -> dict[str, Any]:
    """The sign-up exactly as it is POSTed. Only the ticked setup lines; the
    install id only while "Link my anonymous usage reports" is ticked."""
    contact = {"email": clean["email"]}
    if clean.get("github"):
        contact["github"] = clean["github"]
    if clean.get("name"):
        contact["name"] = clean["name"]
    ticked = set(clean.get("setup_keys") or [])
    body: dict[str, Any] = {
        "schema": SCHEMA, "action": action, "tester_id": tester_id, "contact": contact,
        "interests": list(clean.get("interests") or []),
        "setup": {ln["key"]: ln["value"] for ln in lines if ln.get("key") in ticked},
        "consent": True, "version": BUILD_VERSION, "day": _today(),
    }
    if clean.get("interests_other") and "other" in body["interests"]:
        body["interests_other"] = clean["interests_other"]
    if clean.get("notes"):
        body["notes"] = clean["notes"]
    if clean.get("timezone"):
        body["timezone"] = clean["timezone"]
    if clean.get("link_reports"):
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        install_id = str(((st.data if st else {}) or {}).get("telemetry_install_id") or "")
        if _UUID_RE.fullmatch(install_id):
            body["link_install_id"] = install_id
    return body


def _encode(body: dict[str, Any]) -> bytes:
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


async def _post(hass: HomeAssistant, body: dict[str, Any]) -> None:
    """One POST to TESTER_URL, and only there. Raises TesterError unless the
    server answered {"ok": true}. Never retried, never queued."""
    data = _encode(body)
    if len(data) > MAX_BYTES:
        raise TesterError("too_long", "That is too long to send (over 4 KB) — please shorten your notes.")
    status, reply = 0, None
    try:
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
        session = async_get_clientsession(hass)
        async with session.post(TESTER_URL, data=data,
                                headers={"Content-Type": "application/json"}, timeout=15) as resp:
            status = int(resp.status)
            try:
                reply = await resp.json(content_type=None)
            except Exception:
                reply = None
    except Exception as err:
        _LOGGER.debug("Tester sign-up send failed: %s", err)
        raise TesterError("network", "Could not reach padspan.traks.ca. Nothing is retried by itself — "
                                     "try again later.") from None
    if 200 <= status < 300 and isinstance(reply, dict) and reply.get("ok") is True:
        return
    said = reply.get("error") if isinstance(reply, dict) else None
    said = _one_line(said)[:200] if isinstance(said, str) else ""
    raise TesterError("refused", f"padspan.traks.ca did not accept it ({said or f'HTTP {status}'}).")


# ── the three things a person can do ─────────────────────────────────────────

async def status(hass: HomeAssistant) -> dict[str, Any]:
    """What this Home Assistant holds, and the setup lines to offer. Sends nothing."""
    rec = record(hass)
    tz = str(getattr(hass.config, "time_zone", "") or "")
    return {
        "signed_up": signed_up(rec),
        "record": copy.deepcopy(rec) or None,
        "setup": await setup_lines(hass),
        "default_timezone": tz if len(tz) <= LIMITS["timezone"] and _TIMEZONE_RE.fullmatch(tz) else "",
    }


def _gate(hass: HomeAssistant, rec: dict[str, Any]) -> str:
    """A NEW sign-up is offered only while the usage report is on (Garry:
    "once someone has chosen the opt-in"). An update and a withdrawal are
    always allowed."""
    from .telemetry import enabled  # noqa: PLC0415
    if not signed_up(rec) and not enabled(hass):
        return "Turn on the usage report above first — becoming a tester starts there."
    return ""


async def preview(hass: HomeAssistant, form: dict[str, Any]) -> dict[str, Any]:
    """The exact JSON a send made now would carry. Sends nothing."""
    rec = record(hass)
    lines = await setup_lines(hass)
    clean, problems = clean_form(form, [ln["key"] for ln in lines])
    gate = _gate(hass, rec)
    if gate:
        problems.insert(0, gate)
    if problems:
        return {"payload": None, "problems": problems, "url": TESTER_URL, "bytes": 0}
    tid = str(rec.get("tester_id") or "")
    body = build_body(hass, clean, action="update" if signed_up(rec) else "signup",
                      tester_id=tid if _UUID_RE.fullmatch(tid) else NEW_ID_PLACEHOLDER, lines=lines)
    return {"payload": body, "problems": [], "url": TESTER_URL, "bytes": len(_encode(body))}


async def sign_up(hass: HomeAssistant, form: dict[str, Any]) -> str:
    """Send a sign-up (or an update) and keep what was sent. Returns the action."""
    st = _settings(hass)
    rec = record(hass)
    gate = _gate(hass, rec)
    if gate:
        raise TesterError("report_off", gate)
    lines = await setup_lines(hass)
    clean, problems = clean_form(form, [ln["key"] for ln in lines])
    if problems:
        raise TesterError("invalid", " ".join(problems))
    tester_id = str(rec.get("tester_id") or "")
    if not _UUID_RE.fullmatch(tester_id):
        tester_id = str(uuid.uuid4())
        # Kept BEFORE the send: if the server stores it and its answer is
        # lost on the way back, the next press reuses this id and "Stop
        # being a tester" can still reach it — never a copy nobody can
        # withdraw. It is only a random id; what was typed is kept below,
        # once the server has it.
        await st.async_set(**{SETTINGS_KEY: {**rec, "tester_id": tester_id}})
    action = "update" if signed_up(rec) else "signup"
    body = build_body(hass, clean, action=action, tester_id=tester_id, lines=lines)
    await _post(hass, body)
    now = _now_iso()
    await st.async_set(**{SETTINGS_KEY: {
        "tester_id": tester_id,
        "email": clean["email"], "github": clean["github"], "name": clean["name"],
        "interests": clean["interests"], "interests_other": body.get("interests_other", ""),
        "notes": clean["notes"], "timezone": clean["timezone"],
        "setup_off": clean["setup_off"], "linked": "link_install_id" in body,
        "signed_up_at": rec.get("signed_up_at") or now, "updated_at": now,
    }})
    return action


async def withdraw(hass: HomeAssistant) -> None:
    """Ask the server to delete the sign-up; clear it here only once it has."""
    st = _settings(hass)
    rec = record(hass)
    tester_id = str(rec.get("tester_id") or "")
    if _UUID_RE.fullmatch(tester_id):
        await _post(hass, {"schema": SCHEMA, "action": "withdraw", "tester_id": tester_id})
    await st.async_set(**{SETTINGS_KEY: {}})
