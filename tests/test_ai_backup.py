# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The backup AI Task (Settings → AI; Garry, 2026-10-30): photo and stair
reads switch to it on their own when the main AI Task is away.

Held here (ws_house3d_photo.ask_ai and unreachable()):
- no backup set: exactly today's reads (one call to the main one, no probe,
  the same answers and results);
- the main one unavailable or gone, remembered as unreachable, its server not
  taking a connection, or its call failing because it can't be reached: the
  backup reads, the result says so, and a failed main one is skipped for
  MAIN_AWAY_S and then tried again;
- a slow main one, a timeout while it reads, a bad answer or any other
  failure: no switch;
- the setting: an ai_task.* that is not the main one, an administrator's,
  none by default; the report: two counters and a yes-only feature word.
"""

from __future__ import annotations

import asyncio
import errno
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d_photo as P
from custom_components.padspan_ha import ws_house3d_stairs as S
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_house3d_edit import disk  # noqa: F401  (disk is a fixture)
from tests.test_house3d_photo import _AI, _SOFA, _leftovers, _photo, _ready
from tests.test_house3d_store import _house, _run

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_BK = "ai_task.server_vision"


class HomeAssistantError(Exception):
    """Home Assistant's own (homeassistant.exceptions; stubbed in these tests): a plain Exception."""


class _Ai:
    """ai_task.generate_data faked per entity: each entity's answer (or the
    error it raises, or a pause first); every call recorded."""

    def __init__(self, answers: dict, delay: dict | None = None):
        self.answers, self.delay, self.calls = answers, delay or {}, []

    async def __call__(self, domain, service, data, blocking=False, return_response=False):
        eid = data["entity_id"]
        self.calls.append(eid)
        if self.delay.get(eid):
            await asyncio.sleep(self.delay[eid])
        a = self.answers[eid]
        if isinstance(a, BaseException):
            raise a
        return {"conversation_id": "c1", "data": a}


def _with_backup(monkeypatch, tmp_path, *, main=None, backup=None, main_state="2026-10-30T10:00:00+00:00",
                 backup_state="2026-10-30T09:00:00+00:00", backup_set=True, delay=None):
    h, conn, _unused, media = _ready(monkeypatch, tmp_path)
    if backup_set:
        h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_backup_entity"] = _BK
    states = {}
    if main_state is not None:
        states[_AI] = SimpleNamespace(state=main_state, attributes={"friendly_name": "Mac vision", "supported_features": 3})
    if backup_state is not None:
        states[_BK] = SimpleNamespace(state=backup_state, attributes={"friendly_name": "Server vision", "supported_features": 3})
    h.states.get = states.get
    ai = _Ai({_AI: dict(_SOFA) if main is None else main, _BK: dict(_SOFA) if backup is None else backup}, delay)
    h.services.async_call = ai
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.append(e))
    probes = []

    async def _probe(hass, eid):
        probes.append(eid)
        return None

    monkeypatch.setattr(P, "_probe", _probe)
    return h, conn, ai, media, counted, probes


def _furniture(h, conn):
    """A read with the kind said, so one call (no second look)."""
    return _photo(h, conn, kind="sofa")


# ═══ no backup set: today exactly ═══════════════════════════════════════════

def test_no_backup_set_is_todays_read_exactly(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, backup_set=False)
    assert P.ai_task(h, with_backup=True) == P.ai_task(h)
    assert "backup" not in P.ai_task(h, with_backup=True)
    out = _furniture(h, conn)
    assert out["ok"] and out["ai_task"] == _AI and "by_backup" not in out
    assert ai.calls == [_AI] and probes == [] and not [e for e in counted if e.startswith("ai_backup")]
    # A main one that can't be reached, with no backup: the plain failure it always was, nothing remembered.
    ai.answers[_AI] = ConnectionRefusedError(errno.ECONNREFUSED, "refused")
    out = _furniture(h, conn)
    assert out["ok"] is False and out["reason"] == "error" and ai.calls == [_AI, _AI]
    assert not P._away_until(h) and _leftovers(media) == []


def test_no_backup_and_a_gone_main_is_refused_as_before(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, backup_set=False, main_state=None)
    assert _furniture(h, conn)["error"] == "no_ai_task" and ai.calls == []


# ═══ the main one away: the backup reads ═══════════════════════════════════

def test_main_unavailable_reads_with_the_backup(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, main_state="unavailable")
    out = _furniture(h, conn)
    assert out["ok"] and out["ai_task"] == _BK and out["by_backup"] is True
    assert ai.calls == [_BK] and probes == [] and counted.count("ai_backup_used") == 1
    assert _leftovers(media) == []


def test_main_gone_from_home_assistant_reads_with_the_backup(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, main_state=None)
    info = P.ai_task(h, with_backup=True)
    assert info["ready"] and info["main_away"] and info["name"] == "Server vision"
    out = _furniture(h, conn)
    assert out["ok"] and out["by_backup"] is True and ai.calls == [_BK]


def test_unknown_is_a_main_one_never_used_yet_not_away(monkeypatch, tmp_path, disk):
    """Home Assistant's AI Task entity is "unknown" until its first task."""
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, main_state="unknown")
    out = _furniture(h, conn)
    assert out["ok"] and out["ai_task"] == _AI and "by_backup" not in out and ai.calls == [_AI]


def test_a_connection_error_switches_and_is_remembered_then_the_main_is_tried_again(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(
        monkeypatch, tmp_path, main=ConnectionError("Failed to connect to Ollama."))
    out = _furniture(h, conn)
    assert out["ok"] and out["by_backup"] is True and ai.calls == [_AI, _BK]
    assert _AI in P._away_until(h) and counted.count("ai_backup_used") == 1
    # The next read doesn't wait on the main one: straight to the backup, no probe.
    probes.clear()
    out = _furniture(h, conn)
    assert out["by_backup"] is True and ai.calls == [_AI, _BK, _BK] and probes == []
    # After MAIN_AWAY_S the main one is tried again (here: back home, it answers).
    P._away_until(h)[_AI] = 0.0
    ai.answers[_AI] = dict(_SOFA)
    out = _furniture(h, conn)
    assert out["ai_task"] == _AI and "by_backup" not in out and ai.calls[-1] == _AI
    assert probes == [_AI] and _AI not in P._away_until(h)
    assert _leftovers(media) == []


def test_home_assistant_wrapping_an_unreachable_server_switches(monkeypatch, tmp_path, disk):
    """Ollama's integration raises HomeAssistantError from the client's error;
    the cause decides."""
    httpx_connect = type("ConnectError", (Exception,), {"__module__": "httpx"})
    try:
        try:
            raise httpx_connect("All connection attempts failed")
        except Exception as inner:
            raise HomeAssistantError("Sorry, I had a problem talking to the Ollama server") from inner
    except HomeAssistantError as err:
        wrapped = err
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, main=wrapped)
    out = _furniture(h, conn)
    assert out["by_backup"] is True and ai.calls == [_AI, _BK]


def test_a_server_that_takes_no_connection_switches_before_any_call(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path)

    async def _away(hass, eid):
        return "no connection in 5 s"

    monkeypatch.setattr(P, "_probe", _away)
    out = _furniture(h, conn)
    assert out["by_backup"] is True and ai.calls == [_BK] and _AI in P._away_until(h)


def test_the_backup_failing_too_is_counted_and_a_plain_failure(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(
        monkeypatch, tmp_path, main=ConnectionRefusedError(errno.ECONNREFUSED, "refused"),
        backup=HomeAssistantError("model not found"))
    out = _furniture(h, conn)
    assert out["ok"] is False and out["reason"] == "error" and ai.calls == [_AI, _BK]
    assert counted.count("ai_backup_used") == 1 and counted.count("ai_backup_failed") == 1
    assert _leftovers(media) == []


# ═══ no switch ═════════════════════════════════════════════════════════════

def test_a_slow_but_working_main_is_never_switched(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, delay={_AI: 0.2})
    out = _furniture(h, conn)
    assert out["ok"] and out["ai_task"] == _AI and ai.calls == [_AI] and "by_backup" not in out


def test_a_main_that_times_out_while_reading_is_not_switched(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, delay={_AI: 5})
    monkeypatch.setattr(P, "PHOTO_TIMEOUT_S", 0.05)
    out = _furniture(h, conn)
    assert out["ok"] is False and "no answer" in out["message"] and ai.calls == [_AI]
    assert not P._away_until(h) and _leftovers(media) == []


@pytest.mark.parametrize("answer", ["I can't tell what this is.", "", {"nonsense": 1}])
def test_a_bad_answer_is_the_models_not_absence(monkeypatch, tmp_path, disk, answer):
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, main=answer)
    out = _furniture(h, conn)
    assert out["ok"] is False and out["reason"] == "bad_answer" and ai.calls == [_AI]
    assert not [e for e in counted if e.startswith("ai_backup")]


def test_another_failure_of_the_main_is_not_switched(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(
        monkeypatch, tmp_path, main=HomeAssistantError("Sorry, I had a problem talking to the Ollama server: model 'x' not found"))
    out = _furniture(h, conn)
    assert out["ok"] is False and ai.calls == [_AI] and not P._away_until(h)


def test_a_backup_that_is_unavailable_or_the_main_itself_is_no_backup(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path, backup_state="unavailable")
    assert "backup" not in P.ai_task(h, with_backup=True)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_backup_entity"] = _AI
    assert P.ai_task(h, with_backup=True) == P.ai_task(h)


def test_no_time_left_for_the_backup_keeps_the_mains_failure(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted, probes = _with_backup(
        monkeypatch, tmp_path, main=ConnectionResetError(errno.ECONNRESET, "reset"))
    monkeypatch.setattr(P, "PHOTO_TIMEOUT_S", 30)          # under BACKUP_MIN_S: no room for the backup
    out = _furniture(h, conn)
    assert out["ok"] is False and ai.calls == [_AI] and _AI in P._away_until(h)


# ═══ which errors are "can't be reached" ═══════════════════════════════════

def _cls(name, module, *bases):
    return type(name, bases or (Exception,), {"__module__": module})


@pytest.mark.parametrize("err,want", [
    (ConnectionRefusedError(errno.ECONNREFUSED, "refused"), True),
    (ConnectionError("Failed to connect to Ollama."), True),          # ollama-python's own
    (OSError(errno.EHOSTUNREACH, "No route to host"), True),
    (OSError(errno.ENETUNREACH, "Network is unreachable"), True),
    (__import__("socket").gaierror(-2, "Name or service not known"), True),
    (_cls("ConnectError", "httpx")("x"), True),
    (_cls("ReadError", "httpx", _cls("NetworkError", "httpx"))("dropped"), True),
    (_cls("ConnectTimeout", "httpx")("x"), True),
    (_cls("ReadTimeout", "httpx")("slow"), False),
    (_cls("ClientConnectorError", "aiohttp.client_exceptions")("x"), True),
    (_cls("ServerTimeoutError", "aiohttp.client_exceptions", TimeoutError)("slow"), False),
    (_cls("ConnectionTimeoutError", "aiohttp.client_exceptions", TimeoutError)("no connect"), True),
    (TimeoutError(), False),
    (FileNotFoundError(errno.ENOENT, "gone"), False),
    (HomeAssistantError("model not found"), False),
    (ValueError("bad"), False),
    (_cls("ConnectError", "somewhere_else")("not a network library"), False),
])
def test_unreachable(err, want):
    assert P.unreachable(err) is want


# ═══ the probe ═════════════════════════════════════════════════════════════

def test_the_probe_opens_one_connection_and_says_why_not(monkeypatch):
    h = SimpleNamespace()
    monkeypatch.setattr(P, "_server_url", lambda hass, eid: "http://mac.local:11434")
    seen = []

    class _W:
        def close(self):
            seen.append("closed")

        async def wait_closed(self):
            return None

    async def _ok(host, port):
        seen.append((host, port))
        return None, _W()

    monkeypatch.setattr(P.asyncio, "open_connection", _ok)
    assert _run(P._probe(h, _AI)) is None and seen == [("mac.local", 11434), "closed"]

    async def _refused(host, port):
        raise ConnectionRefusedError(errno.ECONNREFUSED, "refused")

    monkeypatch.setattr(P.asyncio, "open_connection", _refused)
    assert _run(P._probe(h, _AI)) == "ConnectionRefusedError"

    async def _hangs(host, port):
        await asyncio.sleep(5)

    monkeypatch.setattr(P.asyncio, "open_connection", _hangs)
    monkeypatch.setattr(P, "PROBE_S", 0.05)
    assert _run(P._probe(h, _AI)).startswith("no connection in")
    # No server known (a cloud AI Task): nothing tried.
    monkeypatch.setattr(P, "_server_url", lambda hass, eid: None)
    assert _run(P._probe(h, _AI)) is None


@pytest.mark.parametrize("url,want", [("http://10.0.0.5", ("10.0.0.5", 80)), ("https://ai.example", ("ai.example", 443)),
                                      ("mac.local", ("mac.local", 11434)), ("http://mac.local:11434/", ("mac.local", 11434))])
def test_the_probe_reads_a_url_as_ollamas_client_does(monkeypatch, url, want):
    monkeypatch.setattr(P, "_server_url", lambda hass, eid: url)
    seen = []

    async def _ok(host, port):
        seen.append((host, port))
        raise ConnectionRefusedError(errno.ECONNREFUSED, "refused")

    monkeypatch.setattr(P.asyncio, "open_connection", _ok)
    _run(P._probe(SimpleNamespace(), _AI))
    assert seen == [want]


def test_the_timings_fit_inside_the_photo_timeout():
    """A dead main one costs at most PROBE_S before the backup starts, which
    then has the rest of PHOTO_TIMEOUT_S: far more than the ~65-150 s a slow
    backup takes. A main one that fails mid-read leaves the backup at least
    BACKUP_MIN_S or it isn't asked."""
    assert P.PHOTO_TIMEOUT_S - P.PROBE_S >= 150
    assert P.MAIN_AWAY_S == 300 and 0 < P.BACKUP_MIN_S < P.PHOTO_TIMEOUT_S


# ═══ stairs ════════════════════════════════════════════════════════════════

def test_stairs_use_the_same_rule(monkeypatch, tmp_path, disk):
    from tests.test_house3d_stairs import _read, _stairs_ready
    ans = json.dumps([{"bbox_2d": [102, 164, 205, 492], "says": "UP", "up": "top"}])
    h, conn, _unused, media = _stairs_ready(monkeypatch, tmp_path, ans)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_backup_entity"] = _BK
    h.states.get = {_AI: SimpleNamespace(state="unavailable", attributes={"supported_features": 3}),
                    _BK: SimpleNamespace(state="unknown", attributes={"supported_features": 3})}.get
    ai = _Ai({_AI: ans, _BK: ans})
    h.services.async_call = ai
    out = _read(h, conn)
    assert out["ok"] and out["by_backup"] is True and out["ai_task"] == _BK and ai.calls == [_BK]
    # The main one back: read by it, no note.
    h.states.get = {_AI: SimpleNamespace(state="unknown", attributes={"supported_features": 3}),
                    _BK: SimpleNamespace(state="unknown", attributes={"supported_features": 3})}.get
    monkeypatch.setattr(P, "_probe", lambda hass, eid: asyncio.sleep(0, None))
    out = _read(h, conn)
    assert out["ok"] and "by_backup" not in out and ai.calls == [_BK, _AI]
    assert _leftovers(media) == [] and S.ws_house3d_stairs_read


# ═══ the setting ═══════════════════════════════════════════════════════════

def test_the_setting_is_none_by_default():
    assert DEFAULT_SETTINGS["atlas_3d_ai_task_backup_entity"] == ""


@pytest.mark.parametrize("raw,main,want", [
    ("ai_task.server", "ai_task.mac", "ai_task.server"), (" ai_task.server ", "ai_task.mac", "ai_task.server"),
    ("ai_task.mac", "ai_task.mac", ""), ("light.kitchen", "ai_task.mac", ""), ("ai_task.x; rm", "", ""),
    ("", "ai_task.mac", ""), (None, "ai_task.mac", ""), ("ai_task.server", "", "ai_task.server"),
])
def test_the_backup_is_an_ai_task_that_is_not_the_main_one(raw, main, want):
    assert WS._atlas_3d_ai_task_backup(raw, main) == want


def _set(h, admin=True, **kw):
    conn = MagicMock()
    conn.user = MagicMock(is_admin=admin)
    _run(WS.ws_settings_set(h, conn, {"id": 1, **kw}))
    return conn, h.data[DOMAIN][DATA_SETTINGS].data


def test_an_admin_saves_the_backup_and_the_main_cant_be_its_own_backup():
    h = _house()
    conn, data = _set(h, atlas_3d_ai_task_entity="ai_task.mac", atlas_3d_ai_task_backup_entity="ai_task.server")
    assert not conn.send_error.called and data["atlas_3d_ai_task_backup_entity"] == "ai_task.server"
    conn, data = _set(h, atlas_3d_ai_task_backup_entity="ai_task.mac")
    assert data["atlas_3d_ai_task_backup_entity"] == "", "the main one is no backup"
    _set(h, atlas_3d_ai_task_backup_entity="ai_task.server")
    conn, data = _set(h, atlas_3d_ai_task_entity="ai_task.server")
    assert data["atlas_3d_ai_task_entity"] == "ai_task.server" and data["atlas_3d_ai_task_backup_entity"] == ""


def test_changing_the_main_leaves_an_unset_backup_unwritten():
    """Existing users: saving the main one adds no backup key."""
    h = _house()
    conn, data = _set(h, atlas_3d_ai_task_entity="ai_task.mac")
    assert data["atlas_3d_ai_task_entity"] == "ai_task.mac" and "atlas_3d_ai_task_backup_entity" not in data


def test_only_an_admin_chooses_the_backup():
    h = _house()
    conn, data = _set(h, admin=False, atlas_3d_ai_task_backup_entity="ai_task.server")
    assert conn.send_error.call_args[0][1] == "unauthorized" and "atlas_3d_ai_task_backup_entity" not in data


def test_the_schema_takes_the_backup():
    sch = WS.ws_settings_set.ws_schema
    key = next(k for k in sch if str(getattr(k, "schema", k)) == "atlas_3d_ai_task_backup_entity")
    import voluptuous as vol
    v = vol.Schema(sch[key])
    assert v("ai_task.server") == "ai_task.server" and v(None) is None


# ═══ the report ════════════════════════════════════════════════════════════

def test_the_counters_and_the_feature_word_are_registered_with_plain_names():
    for e in ("ai_backup_used", "ai_backup_failed"):
        assert e in T.EVENTS and T.event_allowed(e)
    assert T._FEATURE_ON_ONLY["atlas_3d_ai_task_backup_entity"] == "ai_backup"
    ib = (WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    assert 'ai_backup: "AI: a backup AI Task is set"' in ib
    assert 'ai_backup_used: "AI read by the backup AI Task (the main one was away)"' in ib
    assert 'ai_backup_failed: "The backup AI Task failed too"' in ib


def test_the_feature_word_is_yes_only_and_never_the_entity():
    settings = {"atlas_3d_ai_task_backup_entity": "ai_task.server"}
    feats = {w: True for k, w in T._FEATURE_ON_ONLY.items() if settings.get(k)}
    assert feats == {"ai_backup": True} and "ai_task.server" not in json.dumps(feats)


# ═══ the screens ═══════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def picker() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "ai_backup_picker.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_the_settings_picker_renders_and_saves(picker):
    assert len(picker) >= 8, sorted(picker)
    bad = {k: v for k, v in picker.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


def test_the_reads_say_when_the_backup_answered():
    ph = (WWW / "views" / "live_aboard_photo.js").read_text(encoding="utf-8")
    assert 'export const BACKUP_NOTE = "Read by the backup AI task.";' in ph
    assert 'a.by_backup ? el("p", { class: "muted" }, BACKUP_NOTE) : null' in ph
    pe = (WWW / "views" / "live_aboard_people.js").read_text(encoding="utf-8")
    assert pe.count("byBackup: !!out.by_backup") == 2 and "PH.BACKUP_NOTE" in pe
    fu = (WWW / "views" / "live_aboard_furnish.js").read_text(encoding="utf-8")
    assert "r.by_backup" in fu and "Read by the backup AI task" in fu


def test_a_furniture_photos_second_look_doesnt_count_the_backup_again() -> None:
    """End-to-end check 2026-10-30: one photo read counted ai_backup_used twice
    (its second look is a second ask_ai call)."""
    src = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
           / "ws_house3d_photo.py").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert "a2, by2 = await ask_ai(hass, ai, i2, s2, raw, mime, count=False)" in src
    assert 'if count:\n        _bump(hass, "ai_backup_used")' in src


def test_the_photo_step_knows_where_the_backup_would_send_a_photo(monkeypatch, tmp_path, disk):
    """Review 2026-10-30: a local main with a cloud backup said "the photo
    stays in the house" while the backup could read it."""
    h, conn, ai, media, counted, probes = _with_backup(monkeypatch, tmp_path)
    info = P.ai_task(h, with_backup=True)
    assert info["backup"] == _BK and info["backup_name"] == "Server vision" and "backup_local" in info
    ph = (WWW / "views" / "live_aboard_photo.js").read_text(encoding="utf-8")
    assert "export const mayLeave" in ph
    pe = (WWW / "views" / "live_aboard_people.js").read_text(encoding="utf-8")
    assert "forPerson && PH.mayLeave(m.info)" in pe


def test_a_stair_read_that_worked_is_never_counted_failed():
    """Review 2026-10-30: `if (r.by_backup) …; else failed++` counted every
    plan read by the main one as failed ("The AI couldn't read the plans")."""
    fu = (WWW / "views" / "live_aboard_furnish.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert ("          if (r && r.ok) {\n"
            "            for (const st of r.stairs || []) found.push({ ...st, plan: canon(m.floor_id) });\n"
            "            if (r.by_backup) byBackup = true;\n"
            "          } else failed++;") in fu
