# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""How much AI PadSpan uses: the AI credit tracker (experimental, 2026-11).

Garry, 2026-11-09: track this integration's Claude use against the monthly
credit of the plan Home Assistant's key runs on. Design: PadspanResearch
plan-build-design-2026-11.md, section 9 (the tracker), 10 (the opt-in report)
and 14 (stall watch: every read that failed or was refused has a named reason).

Every AI read PadSpan sends goes through ws_house3d_photo.ask(), the only
ai_task.generate_data call in the integration (photos, the stair finder, Add
data via plans, and the plan line-up to come). ask() calls note_read() once per
read, whatever happened; a caller that couldn't use an answer calls unusable(),
and one that refused before any read (no AI Task that can do it, no fallback)
calls refused(). Counted per calendar month (Home Assistant's local time) per
AI Task: reads, stops by reason, by feature, and an estimated spend.

Home Assistant's answer carries no token counts, so the spend is an estimate
from the picture's size and the prompt's length (estimate_usd below), labelled
as one wherever it shows. The exact figure is the Anthropic Console's
(https://platform.claude.com/usage, filtered by the key Home Assistant uses).

Stored in padspan_ha.ai_usage, on this Home Assistant only: not in backups,
emptied by a Factory Reset, never in the opt-in report, which gets counts and
coarse bands only (the report's usage key, telemetry.AI_USAGE_EVENTS).
"""

from __future__ import annotations

import json
import logging
import re
import struct
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_SETTINGS, DOMAIN

_LOGGER = logging.getLogger(__name__)

STORE_KEY = "padspan_ha.ai_usage"
DATA_AI_USAGE = "ai_usage"            # hass.data[DOMAIN]: the Usage below
SAVE_DELAY_S = 30
MONTHS_KEPT = 13

# ═══ The constants block (section 14: one place, reused by the later stages) ═══
#
# Why an AI read stopped: each failed or refused read is counted under exactly
# one of these, here and in the opt-in report (ai_reads_fail:<reason>). The
# plain words are what Settings → AI shows ("3 reads stopped: out of credit").
STOP_REASONS: tuple[str, ...] = (
    "unreachable",   # the AI's server couldn't be reached (ws_house3d_photo.unreachable)
    "no_credit",     # the AI's account is out of credit (CREDIT_WORDS in the error)
    "timeout",       # no answer within the read's time
    "refusal",       # the AI declined (REFUSAL_WORDS in its answer or error)
    "bad_answer",    # it answered, but nothing in the answer could be used
    "no_ai",         # refused before reading: no AI Task chosen that can do it
    "no_fallback",   # stopped instead of using another AI (the plan line-up never falls back)
    "no_media",      # Home Assistant's media folder couldn't take the picture
    "error",         # any other failure of the AI Task
)
STOP_WORDS: dict[str, str] = {
    "unreachable": "the AI couldn't be reached",
    "no_credit": "out of credit",
    "timeout": "no answer in time",
    "refusal": "the AI declined",
    "bad_answer": "an answer PadSpan couldn't use",
    "no_ai": "no AI Task that can do it",
    "no_fallback": "stopped, no other AI is used",
    "no_media": "the media folder couldn't take the picture",
    "error": "another error",
}
# The Anthropic error a key with no credit gives (Garry's, 2026-11-09: "Your
# credit balance is too low to access the Anthropic API").
CREDIT_WORDS = re.compile(r"credit balance|out of credit|insufficient credit|purchase credits", re.I)
# Home Assistant's Anthropic integration (2026.6+; read in 2026.7.4's entity.py,
# ai_task.py and strings.json): the API's stop_reason "refusal" is raised as
# HomeAssistantError(translation_key="api_refusal"), "Potential policy violation
# detected."; every API error as translation_key "api_error", "Anthropic API
# error: {message}." (a credit error carries the API's own words, CREDIT_WORDS);
# an answer that isn't the JSON asked for as "json_parse_error". Its old "Sorry,
# I had a problem talking to Anthropic" wording is gone, and an error is never
# a refusal by its words.
REFUSAL_KEYS = frozenset({"api_refusal"})
REFUSAL_ERROR_WORDS = re.compile(r"policy violation", re.I)
BAD_ANSWER_KEYS = frozenset({"json_parse_error", "response_not_found"})
# The refusal words the research harness uses (PadspanResearch planai_ha/run_ha.py REFUSAL): for an answer's text only.
REFUSAL_WORDS = re.compile(r"\b(i can'?t|i cannot|i'?m unable|i am unable|i'?m sorry|sorry, |unable to (help|assist|analy[sz]e|process)|"
                           r"can'?t (help|assist) with|not able to)\b", re.I)
# What a read was for, by the task_name ask() is given.
KINDS: tuple[str, ...] = ("photo", "stairs", "plans", "plan_build", "other")
_KIND_OF_TASK = {"PadSpan Live Aboard photo": "photo", "PadSpan Live Aboard stairs": "stairs",
                 "PadSpan plans": "plans", "PadSpan plan build": "plan_build"}
# Who makes the AI, by its integration (the entity registry's platform).
MAKERS: tuple[str, ...] = ("claude", "openai", "google", "ollama", "other")
_MAKER_OF_PLATFORM = {"anthropic": "claude", "openai_conversation": "openai", "azure_openai_conversation": "openai",
                      "google_generative_ai_conversation": "google", "ollama": "ollama"}
# The warning (Settings → AI): off, or one notice a month when the estimate
# passes this share of the monthly credit typed in. Off until chosen (Garry, 2026-11-09).
WARN_PCTS: tuple[int, ...] = (50, 75, 90)
CREDIT_MAX_USD = 100000.0

# ── The estimate (section 9) ────────────────────────────────────────────────
# input tokens  = min(width × height ÷ 750, 4,784) + prompt characters ÷ 4 + 300
# output tokens = 400
# dollars       = (input × in-price + output × out-price) ÷ 1,000,000 × CALIBRATION
#
# The ÷750 rule is Anthropic's vision guidance as recalled, not re-read; the
# 4,784-token cap a picture (2576 px, 3.75 MP; larger ones the API scales
# down, Stage 0b, 2026-11-09) is from the claude-api reference (2026-10-06).
# 300 is Home Assistant's own wrapping of a read and 400 the answer with the
# thinking unseen through Home Assistant: both starting guesses.
PICTURE_PX_PER_TOKEN = 750
PICTURE_TOKENS_MAX = 4784
PROMPT_CHARS_PER_TOKEN = 4
HA_OVERHEAD_TOKENS = 300
OUTPUT_TOKENS = 400
# CALIBRATION: the Console's dollars ÷ this estimate, for the same reads. 1.0
# is the token math alone: no Console figure has been read yet. THE ONE PLACE
# TO ADJUST once Garry reads the Console's figure for 2026-11-09 (the 175-read
# Claude Opus 5.5 run, ~100 KB pictures, thinking low, and a few tiny checks)
# for the key Home Assistant uses: CALIBRATION = that figure ÷ this
# estimate for the same day, kept within CALIBRATION_RANGE.
CALIBRATION = 1.0
CALIBRATION_RANGE = (0.2, 5.0)

# US dollars per million tokens (input, output) by family and version, from
# the claude-api reference's model table (cached 2026-10-06, read 2026-11-09).
# A model not here is counted with no dollar figure.
PRICES: dict[tuple[str, str], tuple[float, float]] = {
    ("fable", "5.1"): (10.0, 50.0), ("fable", "5"): (10.0, 50.0), ("mythos", "5.1"): (10.0, 50.0),
    ("opus", "5.5"): (4.0, 20.0), ("opus", "5"): (5.0, 25.0),
    ("opus", "4.8"): (5.0, 25.0), ("opus", "4.7"): (5.0, 25.0), ("opus", "4.6"): (5.0, 25.0),
    ("sonnet", "5.5"): (2.0, 10.0), ("sonnet", "5"): (2.0, 10.0), ("sonnet", "4.6"): (3.0, 15.0),
    ("haiku", "5.5"): (0.10, 0.50), ("haiku", "4.5"): (1.0, 5.0),
}

# Opt-in report bands (telemetry.AI_USAGE_EVENTS): the month just ended, once.
READS_MONTH_BANDS: tuple[str, ...] = ("0", "1_20", "21_100", "101_500", "gt500")
CREDIT_MONTH_BANDS: tuple[str, ...] = ("none", "lt1", "1_5", "5_20", "20_50", "gt50")
WARN_EVENTS: tuple[str, ...] = ("set_50", "set_75", "set_90", "off", "fired")


# ── pure parts ───────────────────────────────────────────────────────────────

def kind_of(task_name: str) -> str:
    return _KIND_OF_TASK.get(str(task_name or ""), "other")


def maker_of(platform: str | None) -> str:
    return _MAKER_OF_PLATFORM.get(str(platform or ""), "other")


def price_of(model: str | None) -> tuple[float, float] | None:
    """(input, output) dollars a million tokens, or None for a model not known.
    The name is read by plan_ai.claude_model, as the unlock reads it (review B5)."""
    from .plan_ai import claude_model  # noqa: PLC0415
    got = claude_model(model)
    if got is None:
        return None
    fam, (major, minor) = got
    return PRICES.get((fam, f"{major}.{minor}" if minor else f"{major}"))


def estimate_usd(price: tuple[float, float] | None, size: tuple[int, int] | None, prompt_chars: int) -> float | None:
    """One read's estimated dollars (section 9), or None with no price."""
    if price is None:
        return None
    pic = min(size[0] * size[1] / PICTURE_PX_PER_TOKEN, PICTURE_TOKENS_MAX) if size else 0
    tokens_in = pic + max(0, int(prompt_chars)) / PROMPT_CHARS_PER_TOKEN + HA_OVERHEAD_TOKENS
    lo, hi = CALIBRATION_RANGE
    return (tokens_in * price[0] + OUTPUT_TOKENS * price[1]) / 1_000_000 * min(hi, max(lo, CALIBRATION))


JPEG_SCAN_MAX = 256 * 1024            # a JPEG's frame header is looked for this far in, no further (review R6)


def prompt_chars(instructions: Any, structure: Any) -> int:
    """The characters a read's prompt sends (its words and its structure).
    Never raises: it is counted in ask()'s finally, over the AI's answer."""
    try:
        return len(str(instructions or "")) + (len(json.dumps(structure, default=str)) if structure else 0)
    except Exception:  # noqa: BLE001
        return len(str(instructions or ""))


def picture_size(raw: bytes) -> tuple[int, int] | None:
    """A JPEG's, PNG's or WebP's width and height from its header, or None."""
    try:
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", raw[16:24])
            return w, h
        if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
            tag = raw[12:16]
            if tag == b"VP8 ":
                w, h = struct.unpack("<HH", raw[26:30])
                return w & 0x3FFF, h & 0x3FFF
            if tag == b"VP8L":
                b = raw[21:25]
                return 1 + (((b[1] & 0x3F) << 8) | b[0]), 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
            if tag == b"VP8X":
                return 1 + int.from_bytes(raw[24:27], "little"), 1 + int.from_bytes(raw[27:30], "little")
            return None
        if raw[:2] == b"\xff\xd8":
            i, end = 2, min(len(raw), JPEG_SCAN_MAX)       # the frame header is near the start; never a walk through the whole file
            while i + 9 < end:
                if raw[i] != 0xFF:
                    i += 1
                    continue
                marker = raw[i + 1]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
                    i += 1 if marker == 0xFF else 2
                    continue
                seg = struct.unpack(">H", raw[i + 2:i + 4])[0]
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    h, w = struct.unpack(">HH", raw[i + 5:i + 9])
                    return w, h
                i += 2 + seg
    except (struct.error, IndexError):
        return None
    return None


def band(n: float, edges: tuple[tuple[float, str], ...], top: str) -> str:
    """The first band whose upper edge n is under (≤ for whole counts), else top."""
    for edge, name in edges:
        if n <= edge:
            return name
    return top


def reads_band(n: int) -> str:
    return band(n, ((0, "0"), (20, "1_20"), (100, "21_100"), (500, "101_500")), "gt500")


def credit_band(usd: float | None) -> str:
    if usd is None:
        return "none"
    for edge, name in ((1, "lt1"), (5, "1_5"), (20, "5_20"), (50, "20_50")):
        if usd < edge:
            return name
    return "gt50"


def stop_reason(err: BaseException, *, no_media: bool, unreachable: bool) -> str:
    """The one STOP_REASONS name for a read that raised: a refusal only when
    the integration says the model refused (REFUSAL_KEYS, or its words for
    it), never because an error's text says sorry."""
    if no_media:
        return "no_media"
    if isinstance(err, TimeoutError):
        return "timeout"
    if unreachable:
        return "unreachable"
    keys, e = set(), err
    for _ in range(5):                                   # the error, and what it was raised from
        if e is None:
            break
        keys.add(getattr(e, "translation_key", None))
        e = e.__cause__ or e.__context__
    text = str(err)
    if keys & REFUSAL_KEYS or REFUSAL_ERROR_WORDS.search(text):
        return "refusal"
    if CREDIT_WORDS.search(text):
        return "no_credit"
    if keys & BAD_ANSWER_KEYS:
        return "bad_answer"
    return "error"


# ── the store ────────────────────────────────────────────────────────────────

def empty() -> dict[str, Any]:
    return {"schema": 1, "months": {}, "told": None, "warned": {}}


def _bump(hass: HomeAssistant, event: str) -> None:
    """Count one AI_USAGE_EVENTS event (nothing while the usage report is off)."""
    try:
        from .telemetry import bump  # noqa: PLC0415
        bump(hass, event)
    except Exception:  # noqa: BLE001
        pass


def _now_local():
    from homeassistant.util import dt as dt_util  # noqa: PLC0415
    return dt_util.as_local(dt_util.utcnow())


def month_now() -> tuple[str, str]:
    """("2026-11", "09") in Home Assistant's local time."""
    now = _now_local()
    return f"{now.year:04d}-{now.month:02d}", f"{now.day:02d}"


def _prev_month(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    return f"{y - 1:04d}-12" if mo == 1 else f"{y:04d}-{mo - 1:02d}"


class Usage:
    """padspan_ha.ai_usage: the months' counts. No file until the first read."""

    def __init__(self, hass: HomeAssistant) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.hass = hass
        self.store = Store(hass, 1, STORE_KEY)
        self.data: dict[str, Any] = empty()
        self.loaded = False

    async def async_load(self) -> None:
        if self.loaded:
            return
        self.loaded = True
        try:
            raw = await self.store.async_load()
        except Exception as err:  # noqa: BLE001 — a store that can't be read starts empty
            _LOGGER.debug("PadSpan AI usage not read back: %s", err)
            raw = None
        if isinstance(raw, dict) and isinstance(raw.get("months"), dict):
            self.data = {**empty(), **raw}

    def save(self) -> None:
        try:
            self.store.async_delay_save(lambda: self.data, SAVE_DELAY_S)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("PadSpan AI usage not saved: %s", err)

    def entity(self, month: str, eid: str, maker: str | None = None, model: str | None = None) -> dict[str, Any]:
        months = self.data.setdefault("months", {})
        rows = months.setdefault(month, {})
        for old in sorted(months)[:-MONTHS_KEPT]:
            months.pop(old, None)
        row = rows.get(eid)
        if not isinstance(row, dict):
            row = rows[eid] = {"maker": maker or "other", "model": model, "reads": 0, "stops": {}, "by_kind": {},
                               "days": {}, "megapixels": 0.0, "prompt_chars": 0, "secs": 0.0, "est_usd": 0.0,
                               "priced": False}
        if maker:
            row["maker"] = maker
        if model:
            row["model"] = model
        return row


def usage(hass: HomeAssistant) -> Usage:
    dom = hass.data.setdefault(DOMAIN, {})
    u = dom.get(DATA_AI_USAGE)
    if not isinstance(u, Usage):
        u = dom[DATA_AI_USAGE] = Usage(hass)
    return u


async def async_ready(hass: HomeAssistant) -> Usage:
    u = usage(hass)
    await u.async_load()
    return u


def _platform(hass: HomeAssistant, eid: str) -> str | None:
    """The AI Task's integration (ws_house3d_photo._platform, the one reader)."""
    from .ws_house3d_photo import _platform as platform_of  # noqa: PLC0415
    return platform_of(hass, eid)


def model_of(hass: HomeAssistant, eid: str) -> str | None:
    """The Claude model behind an AI Task ("Claude Opus 5.5"), read where the
    unlock reads it (plan_ai.model_sources through plan_ai.claude_model,
    review B5): the first source that names one; None when none does."""
    from .plan_ai import claude_model, model_sources  # noqa: PLC0415
    for src in model_sources(hass, eid):
        got = claude_model(src)
        if got is not None:
            fam, (major, minor) = got
            return f"Claude {fam.capitalize()} {major}.{minor}"
    return None


def _settings(hass: HomeAssistant) -> dict[str, Any]:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return (st.data if st else {}) or {}


# ── counting ─────────────────────────────────────────────────────────────────

def note_read(hass: HomeAssistant, eid: str, task_name: str, *, size: tuple[int, int] | None, prompt_chars: int,
              secs: float, sent: bool, reason: str | None) -> None:
    """One ask(): a read sent to the AI Task (sent), and the reason it stopped
    (None when it answered). A read that never got to the AI Task (no media
    folder) counts as a stop only; one sent that couldn't reach the AI or had
    no credit counts as a read with no spend; one that answered or ran out of
    time counts its estimated spend. Never raises."""
    try:
        u = usage(hass)
        month, day = month_now()
        _tell_ended(hass, u, month)
        plat = _platform(hass, eid)
        maker = maker_of(plat)
        model = model_of(hass, eid)
        row = u.entity(month, eid, maker, model)
        kind = kind_of(task_name)
        reached = sent and reason not in ("no_media", "unreachable", "no_credit", "error")
        if sent:
            row["reads"] = int(row.get("reads") or 0) + 1
            row["by_kind"][kind] = int(row["by_kind"].get(kind) or 0) + 1
            row["prompt_chars"] = int(row.get("prompt_chars") or 0) + max(0, int(prompt_chars))
            row["secs"] = round(float(row.get("secs") or 0) + max(0.0, float(secs)), 1)
            if size:
                row["megapixels"] = round(float(row.get("megapixels") or 0) + size[0] * size[1] / 1e6, 3)
            d = row["days"].setdefault(day, {"reads": 0, "est_usd": 0.0})
            d["reads"] = int(d.get("reads") or 0) + 1
            usd = estimate_usd(price_of(model), size, prompt_chars) if maker == "claude" and (reached or reason == "timeout") else None
            if usd is not None:
                row["priced"] = True
                row["est_usd"] = round(float(row.get("est_usd") or 0) + usd, 6)
                d["est_usd"] = round(float(d.get("est_usd") or 0) + usd, 6)
            _bump(hass, f"ai_reads_kind:{kind}")
            _bump(hass, f"ai_reads_maker:{maker}")
        if reason is not None:
            _stop(hass, row, reason)
        u.save()
        _check_warning(hass, u, month)
    except Exception as err:  # noqa: BLE001 — counting must never fail a read
        _LOGGER.debug("PadSpan AI usage: a read not counted: %s", err)


def _stop(hass: HomeAssistant, row: dict, reason: str) -> None:
    reason = reason if reason in STOP_REASONS else "error"
    row["stops"][reason] = int(row["stops"].get(reason) or 0) + 1
    _bump(hass, f"ai_reads_fail:{reason}")


def unusable(hass: HomeAssistant, eid: str | None, answer: Any = None) -> str:
    """A read that answered with nothing the caller could use: counted as a
    refusal when the answer says so in words, else as a bad answer. Returns
    the reason counted."""
    reason = "refusal" if isinstance(answer, str) and REFUSAL_WORDS.search(answer) else "bad_answer"
    try:
        u = usage(hass)
        month, _day = month_now()
        _stop(hass, u.entity(month, str(eid or "")), reason)
        u.save()
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("PadSpan AI usage: an unusable answer not counted: %s", err)
    return reason


async def refused(hass: HomeAssistant, reason: str, eid: str | None = None) -> None:
    """A read refused before it was sent (no_ai, no_fallback): a stop, no read.
    The stored months are read first: a refusal can be the first AI event
    after a restart, and a save before that would empty them (review B2)."""
    try:
        u = await async_ready(hass)
        month, _day = month_now()
        _stop(hass, u.entity(month, str(eid or "")), reason)
        u.save()
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("PadSpan AI usage: a refused read not counted: %s", err)


def _claude_usd(rows: dict) -> float | None:
    """The month's estimated dollars over its Claude AI Tasks, or None with none priced."""
    priced = [r for r in rows.values() if isinstance(r, dict) and r.get("maker") == "claude" and r.get("priced")]
    return round(sum(float(r.get("est_usd") or 0) for r in priced), 6) if priced else None


def _tell_ended(hass: HomeAssistant, u: Usage, month: str) -> None:
    """The opt-in report's month bands, once for each month that ended since
    the last told (a month with no reads at all, after one with some, is 0)."""
    months = u.data.get("months") or {}
    told = u.data.get("told")
    if not months:
        return
    prev = _prev_month(month)
    ended = sorted(m for m in months if m < month and (told is None or m > told))
    if prev not in months and (told is None or prev > told) and any(m < prev for m in months):
        ended.append(prev)
    for m in ended:
        rows = months.get(m) or {}
        _bump(hass, f"ai_reads_month:{reads_band(sum(int(r.get('reads') or 0) for r in rows.values() if isinstance(r, dict)))}")
        _bump(hass, f"ai_credit_month:{credit_band(_claude_usd(rows))}")
    if ended:
        u.data["told"] = max(ended)
        u.save()


def _check_warning(hass: HomeAssistant, u: Usage, month: str) -> None:
    """One notice a month when the estimate passes the chosen share (Settings → AI)."""
    s = _settings(hass)
    pct, credit = s.get("ai_credit_warn_pct"), s.get("ai_credit_month_usd")
    if pct not in WARN_PCTS or not isinstance(credit, (int, float)) or isinstance(credit, bool) or credit <= 0:
        return
    warned = u.data.setdefault("warned", {})
    if month in warned:
        return
    usd = _claude_usd((u.data.get("months") or {}).get(month) or {})
    if usd is None or usd < credit * pct / 100:
        return
    warned[month] = pct
    for old in sorted(warned)[:-MONTHS_KEPT]:
        warned.pop(old, None)
    u.save()
    _bump(hass, "ai_credit_warn:fired")
    try:
        from homeassistant.components.persistent_notification import async_create  # noqa: PLC0415
        async_create(hass,
                     f"Claude reads by PadSpan this month come to about ${usd:.2f}, past {pct} % of the "
                     f"${credit:g} monthly credit you typed in PadSpan's Settings → AI. This is an estimate "
                     "(experimental). The exact numbers are on the Anthropic Console's Usage page, "
                     "https://platform.claude.com/usage: filter it by the key Home Assistant uses. "
                     "This notice comes once a month.",
                     title="PadSpan: AI credit", notification_id=f"padspan_ha_ai_credit_{month}")
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("PadSpan AI credit notice not shown: %s", err)


# ── what Settings → AI shows ────────────────────────────────────────────────

def summary(hass: HomeAssistant, u: Usage) -> dict[str, Any]:
    """This month's line for Settings → AI: the main AI Task's maker, the
    month's Claude reads and estimate, every AI's reads, and the stops."""
    month, _day = month_now()
    _tell_ended(hass, u, month)
    rows = {k: r for k, r in ((u.data.get("months") or {}).get(month) or {}).items() if isinstance(r, dict)}
    s = _settings(hass)
    main = str(s.get("atlas_3d_ai_task_entity") or "").strip()
    claude = [r for r in rows.values() if r.get("maker") == "claude"]
    stops: dict[str, int] = {}
    for r in rows.values():
        for k, n in (r.get("stops") or {}).items():
            if k in STOP_REASONS and isinstance(n, int) and n > 0:
                stops[k] = stops.get(k, 0) + n
    model = model_of(hass, main) if main else None
    return {
        "month": month,
        "main_maker": maker_of(_platform(hass, main)) if main else None,
        "main_priced": price_of(model) is not None,
        "claude_reads": sum(int(r.get("reads") or 0) for r in claude),
        "claude_usd": _claude_usd(rows),
        "reads": sum(int(r.get("reads") or 0) for r in rows.values()),
        "stops": [{"reason": k, "n": stops[k], "words": STOP_WORDS[k]} for k in STOP_REASONS if k in stops],
        "credit_usd": s.get("ai_credit_month_usd") or 0,
        "warn_pct": s.get("ai_credit_warn_pct") or 0,
        "warned": month in (u.data.get("warned") or {}),
        "estimate": {"calibration": CALIBRATION, "calibrated": CALIBRATION != 1.0},
    }


@websocket_api.websocket_command({"type": "padspan_ha/ai_usage_get"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ai_usage_get(hass: HomeAssistant, connection, msg) -> None:
    """Settings → AI's line: this month's reads, estimate and stops (summary)."""
    u = await async_ready(hass)
    connection.send_result(msg["id"], summary(hass, u))


WS_COMMANDS = (ws_ai_usage_get,)
