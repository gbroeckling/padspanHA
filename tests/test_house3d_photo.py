# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P3 and P6: a photo read by the customer's own AI Task
(ws_house3d_photo.house3d_from_photo), and the builders' lists it reads.

Plan: docs/IDEA_ATLAS_3D_HOUSE.md ("From a photo", "Beacons, scanners and
people from photos"). Held here:
- the builders' lists ship as data equal to views/live_aboard_furniture.js
  itself, and the server clamps exactly as the builders' clampRecipe does;
- the structure asked for is Home Assistant's own field list, flat, built
  from every kind's settings (and FIGURE's for a person);
- the answer is checked and clamped; garbage, an empty answer or a failed AI
  Task is a plain "couldn't read it", never an error;
- the photo is a file only during the call, removed whether the call worked,
  failed, timed out or was cancelled; never stored, never logged;
- refused while off, below Pro, with no AI Task (none chosen, gone, blind, no
  service) and on Home Assistant older than 2025.8, with nothing sent.
"""

from __future__ import annotations

import asyncio
import base64
import inspect
import json
import logging
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import house3d_builders as B
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d_photo as P
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_house3d_edit import _on, disk  # noqa: F401  (disk is a fixture)
from tests.test_house3d_store import _run

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")
_AI = "ai_task.ollama_vision"
# A real 1×1 JPEG's first bytes are enough: the server sniffs, never decodes.
_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 64 + b"\xff\xd9"
_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
_WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 40
_B64 = base64.b64encode(_JPEG).decode()


@pytest.fixture(scope="module")
def js() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "live_aboard_builders_data.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


class _AiTask:
    """Home Assistant's ai_task.generate_data, faked: records each call, what
    the attachment's file held while the call ran, and answers `answer` (or
    raises it, or waits `delay` seconds first)."""

    def __init__(self, media: Path, answer=None, delay: float = 0.0):
        self.media, self.answer, self.delay, self.calls, self.seen = media, answer, delay, [], []

    async def __call__(self, domain, service, data, blocking=False, return_response=False):
        self.calls.append((domain, service, data))
        att = data["attachments"][0]["media_content_id"]
        assert att.startswith("media-source://media_source/local/")
        f = self.media / att.removeprefix("media-source://media_source/local/")
        self.seen.append((f, f.read_bytes() if f.is_file() else None))
        if self.delay:
            await asyncio.sleep(self.delay)
        if isinstance(self.answer, BaseException):
            raise self.answer
        return {"conversation_id": "c1", "data": self.answer}


def _ready(monkeypatch, tmp_path, *, answer=None, tier="pro", features=3, delay=0.0, platform="ollama"):
    h, conn = _on(tmp_path, tier=tier)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_entity"] = _AI
    media = tmp_path / "media"
    media.mkdir(exist_ok=True)
    h.config.media_dirs = {"local": str(media)}
    h.services.has_service = lambda d, s: (d, s) == ("ai_task", "generate_data")
    h.states.get = lambda eid: SimpleNamespace(attributes={"friendly_name": "Ollama vision",
                                                           "supported_features": features}) if eid == _AI else None
    ai = _AiTask(media, answer, delay)
    h.services.async_call = ai
    monkeypatch.setattr(P, "_ha_version", lambda: (2026, 7))
    monkeypatch.setattr(P, "_platform", lambda hass, eid: platform)
    return h, conn, ai, media


def _photo(h, conn, **kw):
    conn.send_result.reset_mock()
    conn.send_error.reset_mock()
    msg = {"id": 9, "type": "padspan_ha/house3d_from_photo", "target": "furniture", "photo": _B64, **kw}
    _run(P.ws_house3d_from_photo(h, conn, {k: v for k, v in msg.items() if v is not ...}))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1], "message": conn.send_error.call_args[0][2]}
    return conn.send_result.call_args[0][1]


def _leftovers(media: Path) -> list[str]:
    return sorted(p.name for p in media.rglob("*"))


_SOFA = {"param_seats": 3, "param_arms": "slim", "param_legs": "tapered", "color_1": "#5B6B7A", "color_2": "c8b89a",
         "width_m": 2.2, "depth_m": 0.92, "height_m": 0.84, "size_confidence": "medium", "style": "Mid-Century",
         "material": "fabric", "rooms": ["living", "office", "spaceship"], "features": ["has_arms", "flies"],
         "outdoor": False, "seats": 3, "title": "  Three-seat grey sofa,\nslim arms  "}


# ═══ the builders' lists: one source ═════════════════════════════════════════

def test_the_builders_data_equals_the_builders_module(js):
    """live_aboard_builders.json is the module's own FURNITURE_KINDS,
    FURNITURE and FIGURE. When a builder changes, rewrite it with:
    node tests/js/live_aboard_builders_data.mjs custom_components/padspan_ha/www/padspan-ha --write"""
    shipped = json.loads((_ROOT / "custom_components" / "padspan_ha" / "live_aboard_builders.json")
                         .read_text(encoding="utf-8"))
    assert shipped == js["data"], "live_aboard_builders.json is out of date: rewrite it (see this test's docstring)"


def _close(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) < 1e-9
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_close(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y) for x, y in zip(a, b, strict=True))
    return a == b


def test_the_server_clamps_exactly_as_the_builders_do(js):
    """Every probe (each setting below, inside and above its range, text for
    numbers, bad choices and colours, sizes out of range, unknown kinds and
    keys) comes out of the server's clamp_recipe as out of clampRecipe."""
    assert len(js["probes"]) >= 5 * len(js["data"]["furniture"])
    wrong = [(p["in"], B.clamp_recipe(p["in"]), p["out"]) for p in js["probes"]
             if not _close(B.clamp_recipe(p["in"]), p["out"])]
    assert not wrong, f"{len(wrong)} differ, first: {wrong[0]}"


def test_the_box_and_the_groups_the_photo_step_reads():
    d = B.data()
    assert B.BOX_KIND in d["furniture"], "what no builder fits is the builders' own box"
    assert B.kinds_of(("furniture", "device")), "furniture kinds"
    for target, groups in P._GROUPS.items():
        assert set(groups) <= {"furniture", "device", "tag", "scanner"}
        for k in B.kinds_of(groups):
            assert d["furniture"][k]["group"] in groups
    assert d["figure"].get("params") and isinstance(d["figure"].get("colors"), dict), "FIGURE has settings and colours"


# ═══ the structure: Home Assistant's own field list ══════════════════════════

_SELECTORS = {"number", "select", "boolean", "text"}


def _well_formed(structure: dict) -> None:
    """The shape ai_task.generate_data's own schema takes (STRUCTURE_FIELD_SCHEMA):
    {name: {description, required?, selector: {one kind: config}}}, flat."""
    assert structure and isinstance(structure, dict)
    for name, f in structure.items():
        assert isinstance(name, str) and name.isidentifier(), name
        assert set(f) <= {"description", "required", "selector"} and isinstance(f["description"], str)
        assert isinstance(f.get("required", False), bool)
        (sel, cfg), = f["selector"].items()
        assert sel in _SELECTORS, (name, sel)
        if sel == "number":
            assert cfg["min"] <= cfg["max"] and cfg["mode"] == "box"
            assert cfg["step"] == "any" or cfg["step"] >= 0.001
        if sel == "select":
            assert cfg["options"] and all(isinstance(o, str) for o in cfg["options"])
            assert len(set(cfg["options"])) == len(cfg["options"])
    json.dumps(structure)


@pytest.mark.parametrize("target", ["furniture", "tag", "scanner"])
def test_every_kind_asks_for_exactly_its_own_settings(target):
    fur = B.data()["furniture"]
    kinds = B.kinds_of(P._GROUPS[target])
    if not kinds and target != "furniture":
        pytest.skip(f"the builders have no {target} kinds yet")
    assert kinds
    for kind in kinds:
        text, s = P.request(target, kind)
        _well_formed(s)
        assert "kind" not in s, "the person said what it is"
        params = fur[kind].get("params") or []
        asked = {k.removeprefix("param_") for k in s if k.startswith("param_")}
        assert asked == {p["key"] for p in params}, kind
        for p in params:
            (sel, cfg), = s[f"param_{p['key']}"]["selector"].items()
            if p["type"] in ("int", "num"):
                assert sel == "number" and (cfg["min"], cfg["max"]) == (p["min"], p["max"]), (kind, p)
            elif p["type"] == "choice":
                assert sel == "select" and cfg["options"] == [str(c) for c in p["choices"]], (kind, p)
            else:
                assert sel == "boolean", (kind, p)
        for d in B.DIMS:
            cfg = s[d]["selector"]["number"]
            assert (cfg["min"], cfg["max"]) == tuple(fur[kind]["size"][d][:2]), (kind, d)
        assert {"color_1", "color_2", "color_3", "size_confidence", "title"} <= set(s)
        assert s["size_confidence"]["selector"]["select"]["options"] == ["high", "medium", "low"]
        assert "#rrggbb" in text and "metres" in text


def test_without_a_kind_it_asks_what_it_is_from_the_builders_list():
    text, s = P.request("furniture", None)
    _well_formed(s)
    opts = s["kind"]["selector"]["select"]["options"]
    assert opts == B.kinds_of(("furniture", "device")) and B.BOX_KIND in opts
    assert s["kind"]["required"] is True
    assert not any(k.startswith("param_") for k in s), "no one kind's settings before the kind is known"
    for key in ("category", "rooms", "style", "material", "features", "outdoor", "title"):
        assert key in s, key
    assert s["rooms"]["selector"]["select"]["multiple"] is True
    for d in B.DIMS:   # the union of every kind's range
        cfg = s[d]["selector"]["number"]
        assert cfg["min"] == min(B.data()["furniture"][k]["size"][d][0] for k in opts)
    _, s2 = P.request("furniture", "a kind nobody has")
    assert "kind" in s2


def test_a_person_asks_for_the_figure_only():
    text, s = P.request("person", "sofa")
    _well_formed(s)
    fig = B.data()["figure"]
    assert {k.removeprefix("param_") for k in s if k.startswith("param_")} == {p["key"] for p in fig["params"]}
    assert {k.removeprefix("color_") for k in s if k.startswith("color_")} == set(fig["colors"])
    assert not {"kind", "title", "width_m", "rooms"} & set(s), "a figure has no recipe, no details"
    assert "never a likeness" in text and "do not say who" in text.lower()


# ═══ the answer, checked and clamped ═════════════════════════════════════════

def test_a_good_answer_is_a_clamped_recipe_with_its_details():
    out = P.parse("furniture", "sofa", dict(_SOFA))
    assert out["ok"] and out["kind"] == "sofa"
    r = out["recipe"]
    assert r == B.clamp_recipe(r), "already clamped"
    assert r["params"]["seats"] == 3 and r["params"]["arms"] == "slim"
    assert r["colors"][:2] == ["#5b6b7a", "#c8b89a"]
    assert (r["width_m"], r["depth_m"], r["height_m"]) == (2.2, 0.92, 0.84)
    assert out["size"] == {"width_m": 2.2, "depth_m": 0.92, "height_m": 0.84, "confidence": "medium"}
    d = out["details"]
    assert d["category"] == B.data()["furniture"]["sofa"]["category"]
    assert d["rooms"] == ["living", "office"] and d["features"] == ["has_arms"]
    assert d["style"] == "mid-century" and d["material"] == "fabric" and d["outdoor"] is False
    assert d["title"] == "Three-seat grey sofa, slim arms" and d["checked"] is False and d["seats"] == 3


def test_numbers_are_clamped_and_bad_choices_and_colours_fall_back():
    fur = B.data()["furniture"]["sofa"]
    seats = next(p for p in fur["params"] if p["key"] == "seats")
    out = P.parse("furniture", "sofa", {**_SOFA, "param_seats": 99, "param_arms": "tentacles", "color_1": "red",
                                        "color_2": "#12345", "width_m": 40, "depth_m": -1, "height_m": "0.9"})
    r = out["recipe"]
    assert out["ok"] and r["params"]["seats"] == seats["max"]
    assert r["params"]["arms"] == next(p for p in fur["params"] if p["key"] == "arms")["def"]
    assert r["colors"] == fur["colors"], "no colour could be read: the builder's own"
    assert r["width_m"] == fur["size"]["width_m"][1]
    assert r["depth_m"] == fur["size"]["depth_m"][2], "a size of 0 or less is not a size: the default"
    assert r["height_m"] == 0.9 and out["size"]["depth_m"] is None


def test_the_kind_the_person_picked_wins_and_the_ais_kind_is_read_otherwise():
    assert P.parse("furniture", "bed", {**_SOFA, "kind": "sofa"})["kind"] == "bed"
    assert P.parse("furniture", None, {**_SOFA, "kind": "Sofa "})["kind"] == "sofa"
    other = P.parse("furniture", None, {**_SOFA, "kind": "spaceship"})
    assert other["ok"] and other["kind"] == B.BOX_KIND, "what no builder fits is a box"
    assert other["recipe"]["width_m"] == 2.2, "a box of the photo's size"


@pytest.mark.parametrize("answer", [None, "", "  ", "garbage", "[1, 2]", [], {}, 42, True,
                                    {"kind": "spaceship"}, {"title": "A sofa"}, {"color_1": "red", "width_m": "wide"},
                                    {"width_m": 0, "depth_m": -2}, {"param_seats": "lots"}])
def test_garbage_is_a_plain_couldnt_read_it_never_an_error(answer):
    out = P.parse("furniture", "sofa", answer)
    assert out["ok"] is False and out["reason"] == "bad_answer" and out["message"] == P.BAD_ANSWER
    assert out["kind"] == "sofa", "the screen falls back to Build with the kind picked"
    assert P.parse("furniture", None, answer)["kind"] is None


def test_an_answer_sent_as_text_is_read():
    out = P.parse("furniture", "sofa", "```json\n" + json.dumps(_SOFA) + "\n```")
    assert out["ok"] and out["recipe"]["params"]["seats"] == 3


def test_tags_and_scanners_are_device_looks():
    for target in ("tag", "scanner"):
        kinds = B.kinds_of(P._GROUPS[target])
        if not kinds:
            pytest.skip(f"the builders have no {target} kinds yet")
        k = kinds[0] if len(kinds) == 1 else B.BOX_KIND
        out = P.parse(target, None, {"color_1": "#ffffff", "width_m": 0.04, "depth_m": 0.04, "height_m": 0.01,
                                     "size_confidence": "low", "title": "White puck tag", "material": "plastic"})
        assert out["ok"] and out["kind"] == k and out["details"]["category"] == "device"
        assert out["recipe"]["colors"][0] == "#ffffff" and out["details"]["title"] == "White puck tag"


def test_a_person_gives_figure_settings_and_nothing_else():
    fig = B.data()["figure"]
    p0 = fig["params"][0]
    ans = {f"param_{p0['key']}": 99, **{f"color_{n}": "#102030" for n in fig["colors"]}, "name": "Garry"}
    out = P.parse("person", None, ans)
    assert out["ok"] and set(out) == {"ok", "target", "figure"} and out["figure"]["origin"] == "photo"
    params = out["figure"]["params"]
    assert params == B.clamp_figure(params) and "name" not in params
    if p0["type"] in ("int", "num"):
        assert params[p0["key"]] == p0["max"]
    assert set(params["colors"]) == set(fig["colors"]) and set(params["colors"].values()) == {"#102030"}
    assert P.parse("person", None, {"name": "Garry", "age": 40})["ok"] is False


# ═══ the call: the photo is a file only while the AI Task reads it ═════════════

def test_a_photo_is_read_and_its_file_is_gone_after(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=dict(_SOFA))
    out = _photo(h, conn, kind="sofa")
    assert out["ok"] and out["recipe"]["kind"] == "sofa" and out["ai_task"] == _AI
    (domain, service, data), = ai.calls
    assert (domain, service, data["entity_id"]) == ("ai_task", "generate_data", _AI)
    assert data["structure"] == P.request("furniture", "sofa")[1]
    assert data["instructions"] == P.request("furniture", "sofa")[0]
    assert data["attachments"][0]["media_content_type"] == "image/jpeg"
    (f, held), = ai.seen
    assert held == _JPEG, "the AI Task's attachment is the photo"
    assert f.parent.name.startswith(".padspan_ha_photo_") and f.parent.parent == media, "hidden, in the media folder"
    assert len(f.parent.name) >= len(".padspan_ha_photo_") + 32, "a name nobody can guess"
    assert _leftovers(media) == [], "no file and no folder left"
    assert disk.writes == [], "nothing stored"
    assert _B64 not in json.dumps(out), "the photo never comes back"


@pytest.mark.parametrize("fail", [RuntimeError("Ollama: connection refused"), ValueError("bad structure"),
                                  TimeoutError(), asyncio.CancelledError(),
                                  RuntimeError(f"400 bad request: {{'images': ['{_B64}']}}")],
                         ids=["refused", "invalid", "timeout", "cancelled", "echoes the photo"])
def test_the_file_is_gone_when_the_call_fails(monkeypatch, tmp_path, disk, caplog, fail):
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=fail)
    with caplog.at_level(logging.DEBUG):
        if isinstance(fail, asyncio.CancelledError):
            with pytest.raises(asyncio.CancelledError):
                _photo(h, conn)
        else:
            out = _photo(h, conn)
            assert out["ok"] is False and out["reason"] == "error" and out["message"].startswith("Couldn't read it")
            assert _B64[:40] not in out["message"], "never shown back"
    assert ai.seen[0][1] == _JPEG
    assert _leftovers(media) == [] and disk.writes == []
    assert _B64[:40] not in caplog.text and "JFIF" not in caplog.text, "never logged"


def test_a_slow_ai_task_times_out_plainly_and_the_file_goes(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=dict(_SOFA), delay=5)
    monkeypatch.setattr(P, "PHOTO_TIMEOUT_S", 0.05)
    out = _photo(h, conn)
    assert out["ok"] is False and out["reason"] == "error" and "no answer" in out["message"]
    assert _leftovers(media) == []


def test_a_bad_answer_from_the_call_falls_back(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer="I see a lovely room!")
    out = _photo(h, conn, kind="bed")
    assert out == {"ok": False, "target": "furniture", "reason": "bad_answer", "message": P.BAD_ANSWER,
                   "kind": "bed", "ai_task": _AI}
    assert _leftovers(media) == []


def test_no_media_folder_is_a_plain_couldnt_read_it(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=dict(_SOFA))
    h.config.media_dirs = {"local": str(tmp_path / "not_there")}
    out = _photo(h, conn)
    assert out["ok"] is False and out["message"] == P.NO_MEDIA and ai.calls == []
    assert not (tmp_path / "not_there").exists(), "the media folder is never created"


@pytest.mark.parametrize("raw,mime", [(_JPEG, "image/jpeg"), (_PNG, "image/png"), (_WEBP, "image/webp")])
def test_jpeg_png_and_webp_are_taken(raw, mime):
    assert P.decode(base64.b64encode(raw).decode()) == (raw, mime)
    assert P.decode("data:image/x;base64," + base64.b64encode(raw).decode()) == (raw, mime)


_BAD_PHOTOS = {"empty": ("", "bad_photo"), "not base64": ("not base64!", "bad_photo"),
               "a gif": (base64.b64encode(b"GIF89a....").decode(), "bad_photo"),
               "a pdf": (base64.b64encode(b"%PDF-1.7").decode(), "bad_photo"),
               "over the limit": (None, "photo_too_big")}


@pytest.mark.parametrize("why", sorted(_BAD_PHOTOS))
def test_a_bad_or_huge_photo_is_refused_and_nothing_is_sent(monkeypatch, tmp_path, disk, why):
    photo, code = _BAD_PHOTOS[why]
    if photo is None:
        photo = "A" * (P.MAX_PHOTO_BYTES * 4 // 3 + 8)
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=dict(_SOFA))
    out = _photo(h, conn, photo=photo)
    assert out["error"] == code and ai.calls == [] and _leftovers(media) == []


# ═══ refused: off, below Pro, no AI Task, older Home Assistant ═════════════════

def test_refused_while_off_with_no_call_and_no_file(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=dict(_SOFA))
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    out = _photo(h, conn)
    assert out["error"] == "house3d_off" and ai.calls == [] and _leftovers(media) == []
    out = _photo(h, conn, photo=...)
    assert out["error"] == "house3d_off", "the check-only call too"


@pytest.mark.parametrize("tier", ["free", "bright"])
def test_below_pro_it_is_as_if_off(monkeypatch, tmp_path, disk, tier):
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=dict(_SOFA), tier=tier)
    out = _photo(h, conn)
    assert out["error"] == "house3d_off" and "Pro" in out["message"] and ai.calls == []


def test_the_light_placement_gate_any_user_no_admin():
    src = inspect.getsource(P)
    at = src.index("async def ws_house3d_from_photo(")
    assert "require_admin" not in src[src.rindex("@websocket_api.websocket_command(", 0, at):at]
    assert P.ws_house3d_from_photo in P.WS_COMMANDS
    assert {"type", "target", "photo", "kind"} <= {str(k) for k in P.ws_house3d_from_photo.ws_schema}


def _no_ai(monkeypatch, tmp_path, change):
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=dict(_SOFA))
    change(h)
    out = _photo(h, conn)
    assert out["error"] == "no_ai_task" and ai.calls == [] and _leftovers(media) == []
    check = _photo(h, conn, photo=...)
    assert check["ready"] is False and check["message"] == out["message"]
    return out["message"]


def test_no_ai_task_chosen(monkeypatch, tmp_path, disk):
    msg = _no_ai(monkeypatch, tmp_path, lambda h: h.data[DOMAIN][DATA_SETTINGS].data.update(atlas_3d_ai_task_entity=""))
    assert "2025.8" in msg and "3D house" in msg


def test_the_ai_task_is_gone(monkeypatch, tmp_path, disk):
    msg = _no_ai(monkeypatch, tmp_path, lambda h: setattr(h.states, "get", lambda eid: None))
    assert _AI in msg and "any more" in msg


def test_no_ai_task_service(monkeypatch, tmp_path, disk):
    _no_ai(monkeypatch, tmp_path, lambda h: setattr(h.services, "has_service", lambda d, s: False))


def test_an_ai_task_that_cannot_read_pictures(monkeypatch, tmp_path, disk):
    msg = _no_ai(monkeypatch, tmp_path, lambda h: setattr(
        h.states, "get", lambda eid: SimpleNamespace(attributes={"friendly_name": "Text only", "supported_features": 1})))
    assert "Text only" in msg and "vision" in msg


@pytest.mark.parametrize("version", [(2025, 7), (2024, 12), None])
def test_home_assistant_older_than_2025_8(monkeypatch, tmp_path, disk, version):
    def older(h):
        monkeypatch.setattr(P, "_ha_version", lambda: version)
    assert "2025.8" in _no_ai(monkeypatch, tmp_path, older)


@pytest.mark.parametrize("platform,local", [("ollama", True), ("openai_conversation", False),
                                            ("google_generative_ai_conversation", False), ("something_new", None)])
def test_the_check_says_which_ai_task_reads_it_and_whether_it_is_local(monkeypatch, tmp_path, disk, platform, local):
    h, conn, ai, media = _ready(monkeypatch, tmp_path, platform=platform)
    out = _photo(h, conn, photo=...)
    assert out == {"ready": True, "ai_task": _AI, "name": "Ollama vision", "local": local}
    assert ai.calls == [] and _leftovers(media) == [] and disk.writes == []


# ═══ telemetry: outcomes only ════════════════════════════════════════════════

def test_each_outcome_is_counted_by_name_only(monkeypatch, tmp_path, disk):
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.append(e))
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=dict(_SOFA))
    _photo(h, conn)
    ai.answer = "nothing"
    _photo(h, conn)
    ai.answer = RuntimeError("down")
    _photo(h, conn)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_entity"] = ""
    _photo(h, conn)
    _photo(h, conn, photo=...)                        # a check is not a read
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    _photo(h, conn)                                   # off: nothing
    assert counted == ["photo_read:ok", "photo_read:bad_answer", "photo_read:error", "photo_read:no_ai_task"]
    assert set(counted) <= T.PHOTO_EVENTS and all(T.event_allowed(e) for e in T.PHOTO_EVENTS)
    src = inspect.getsource(P)
    for e in T.PHOTO_EVENTS:
        assert f'"{e}"' in src, f"{e} has a real call site"
