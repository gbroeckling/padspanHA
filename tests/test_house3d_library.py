# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P4: the shared furniture library, this house's side
(house3d_library.py, ws_house3d_library.py).

The plan's "Done when", the install's half: a share carries only the recipe's
keys, its details sheet and its own bookkeeping — "nothing outside a piece's
recipe ever leaves the house" — held on the wire and end to end against the
port of server/furniture_library.php (tests/test_furniture_library_server.py);
a piece missing a required detail is not shared; a title with an email
address, a phone number, a street address or a web address is refused before
anything is sent; off means no network (the master switch, below Pro, the
library's own switch); a library that does not answer leaves Furnish working
and the share waiting for the next successful fetch; withdrawal deletes there
and forgets here. The same fixtures as the server's run here, and the lists
and patterns are held equal to the PHP's.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import house3d_library as L
from custom_components.padspan_ha import ws_house3d_library as WL
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN, HOUSE3D_STORE_KEY
from custom_components.padspan_ha.const import DATA_HOUSE3D
from tests.test_furniture_library_server import (_Library, _fixture, _php, _php_list, _php_pairs, _php_patterns,
                                                 _php_string, _seed)
from tests.test_house3d_store import _FakeStore, _house, store  # noqa: F401 — the store fixture

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_DETAILS = {"category": "seating", "kind": "sofa", "rooms": ["living"], "style": "mid-century", "material": "fabric",
            "color_family": "grey", "size_class": "large", "seats": 3, "features": ["has_arms"], "outdoor": False,
            "title": "Three-seat grey sofa, slim arms", "checked": True}
# A recipe as a piece in the house holds it, with things that must never leave.
_RECIPE = {"kind": "sofa", "params": {"seats": 3, "arms": "slim", "back_h_m": 0.8, "legs": "tapered", "cushions": 3,
                                      "note": "Mum's couch, call 604 555 0123"},
           "colors": ["#5B6B7A", "#c8b89a"], "width_m": 2.2, "depth_m": 0.9, "height_m": 0.8,
           "label": "Mum's old couch", "x_m": 3.412, "y_m": 1.25, "floor_id": "main", "rotation": 90.0,
           "entity_id": "light.lounge_lamp", "photo": "data:image/jpeg;base64,AAAA", "future": {"a": 1},
           "details": {**_DETAILS, "confidence": 0.9, "room": "Lounge"}}
_NEVER = ("Mum", "604 555", "Lounge", "3.412", "1.25", "light.lounge_lamp", "data:image", "future", "confidence",
          "rotation", "floor_id", "main")
_NETWORK = ("search", "get", "report", "share", "withdraw")


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class _Resp:
    def __init__(self, status: int, reply):
        self.status = status
        self._raw = reply if isinstance(reply, bytes) else json.dumps(reply).encode("utf-8")
        self.content = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def iter_chunked(self, n):
        yield self._raw


class _Wire:
    """Every POST the house makes, and what the far end answers:
    `answer(url, body) -> (status, reply)`, or raise for a dead network."""

    def __init__(self, answer):
        self.answer = answer
        self.posts: list[tuple[str, dict]] = []

    def post(self, url, data=None, headers=None, timeout=None):
        body = json.loads(data)
        self.posts.append((url, body))
        status, reply = self.answer(url, body)
        return _Resp(status, reply)


def _wire(monkeypatch, answer) -> _Wire:
    w = _Wire(answer)
    fake = types.ModuleType("homeassistant.helpers.aiohttp_client")
    fake.async_get_clientsession = lambda hass: w
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake)
    return w


def _down(url, body):
    raise OSError("no route to host")


def _via(server: _Library):
    """The far end is the port of furniture_library.php."""
    return lambda url, body: server.handle(json.dumps(body).encode("utf-8"))


def _home(tmp_path, *, library: bool = True, terms: bool = True):
    h = _house(tmp_path, on=True)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_library"] = library
    if terms:
        _FakeStore.saved[HOUSE3D_STORE_KEY] = {"schema": 1, "pieces": {}, "lights": {}, "openings": {}, "devices": {},
                                               "figures": {}, "library": {"terms_version": L.TERMS_VERSION,
                                                                          "accepted_at": "2026-10-04T12:00:00+00:00"}}
    return h


def _call(h, name: str, **msg):
    conn = MagicMock()
    _run(getattr(WL, f"ws_house3d_{name}")(h, conn, {"id": 1, **msg}))
    if conn.send_error.called:
        return "error", conn.send_error.call_args[0][1], conn.send_error.call_args[0][2]
    return "result", conn.send_result.call_args[0][1], None


def _lib() -> dict:
    return (_FakeStore.saved.get(HOUSE3D_STORE_KEY) or {}).get("library") or {}


def _share(h, recipe=None, **more):
    return _call(h, "library_share", recipe=dict(recipe or _RECIPE), **more)


_ASK = {"library_search": {}, "library_get": {"library_id": "lib_000000000001"},
        "library_report": {"library_id": "lib_000000000001", "reason": "title"},
        "library_share": {"recipe": _RECIPE}, "library_withdraw": {}}


# ═══ 1. the same rules as the server ══════════════════════════════════════════

def test_the_lists_and_patterns_are_the_servers() -> None:
    src = _php()
    for name in ("CATEGORIES", "ROOMS", "STYLES", "MATERIALS", "COLOR_FAMILIES", "SIZE_CLASSES", "BED_SIZES",
                 "FEATURES", "FIXTURES", "FORMS", "SORTS", "REASONS", "RECIPE_KEYS", "DETAIL_KEYS", "REQUIRED",
                 "FILTER_KEYS", "WORDS"):
        assert list(getattr(L, name)) == _php_list(src, name), name
    for name in ("KIND_RX", "PARAM_KEY_RX", "PARAM_STR_RX", "COLOR_RX", "SUB_RX", "TOKEN_RX", "LIB_RX", "PREFIX_RX"):
        assert "/^" + getattr(L, name).pattern + "$/D" == _php_string(src, name), name
    php = [(w, p) for w, p in _php_patterns(src, "SECRETS")]
    assert [(w, f"/{p}/" + ("i" if i else "")) for w, p, i in L.SECRETS] == php
    php = [(w, p) for w, p in _php_patterns(src, "PERSONAL")]
    assert [(w, f"/{p}/" + ("i" if i else "")) for w, p, i in L.PERSONAL] == php
    assert _php_pairs(src, "COUNTS") == L.COUNTS and _php_pairs(src, "TEXT") == L.TEXT


@pytest.mark.parametrize("case", _fixture("freetext.json")["cases"], ids=lambda c: c["text"][:40])
def test_free_text_is_refused_before_it_is_sent(case) -> None:
    assert (L.text_problem(case["text"]) or None) == case["refused"]


@pytest.mark.parametrize("case", _fixture("details.json")["cases"], ids=lambda c: c["name"])
def test_the_details_sheet_is_checked_here_as_there(case) -> None:
    fx = _fixture("details.json")
    if "whole" in case:
        d = case["whole"]
    else:
        d = {k: v for k, v in fx["details"].items() if k in case.get("only", fx["details"])}
        for k in case.get("drop", []):
            d.pop(k, None)
        d.update(case.get("set", {}))
    clean, field, problem = L.check_details(d, fx["kind"])
    if case["field"] is None:
        assert clean is not None, (field, problem)
    else:
        assert (field, problem) == (case["field"], case["problem"])


# ═══ 2. off means no network ══════════════════════════════════════════════════

@pytest.mark.parametrize("why", ["off", "below_pro", "library_off"])
@pytest.mark.parametrize("name", list(_ASK))
def test_off_means_no_network_and_no_write(store, monkeypatch, tmp_path, name, why) -> None:
    wire = _wire(monkeypatch, lambda url, body: (200, {"ok": True}))
    h = _home(tmp_path, library=why != "library_off")
    if why == "off":
        h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    if why == "below_pro":
        h.data[DOMAIN][DATA_SETTINGS].data["forensics_license_key"] = ""
    before = json.dumps(_FakeStore.saved, sort_keys=True)
    kind, code, _ = _call(h, name, **_ASK[name])
    assert kind == "error" and code == (WL.LIBRARY_OFF_CODE if why == "library_off" else "house3d_off")
    assert wire.posts == [], "not a single request while off"
    assert json.dumps(_FakeStore.saved, sort_keys=True) == before and not any(
        ev == "save" for ev, _k in _FakeStore.events)


def test_accepting_the_terms_needs_no_network_but_is_refused_while_off(store, monkeypatch, tmp_path) -> None:
    wire = _wire(monkeypatch, lambda url, body: (200, {"ok": True}))
    h = _home(tmp_path, library=False, terms=False)
    kind, out, _ = _call(h, "terms_accept", version=L.TERMS_VERSION)
    assert kind == "result" and out["library"]["terms_version"] == L.TERMS_VERSION and wire.posts == []
    assert _lib()["accepted_at"]
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    assert _call(h, "terms_accept", version=L.TERMS_VERSION)[1] == "house3d_off"


# ═══ 3. what a share carries ══════════════════════════════════════════════════

def test_a_share_carries_only_the_recipe_its_details_and_its_bookkeeping(store, monkeypatch, tmp_path) -> None:
    server = _Library(_php())
    wire = _wire(monkeypatch, _via(server))
    h = _home(tmp_path)
    kind, out, _ = _share(h)
    assert kind == "result" and out["status"] == "shared", out
    (url, body), = wire.posts
    assert url == L.LIBRARY_URL == "https://padspan.traks.ca/api/furniture_library.php"
    assert set(body) == {"schema", "action", "submission_id", "owner_token", "terms_version", "version", "recipe"}
    assert set(body["recipe"]) == {"kind", "params", "colors", "width_m", "depth_m", "height_m", "details"}
    assert set(body["recipe"]["details"]) <= set(L.DETAIL_KEYS)
    assert body["recipe"]["params"] == {"seats": 3, "arms": "slim", "back_h_m": 0.8, "legs": "tapered", "cushions": 3}
    assert body["recipe"]["colors"] == ["#5b6b7a", "#c8b89a"]
    flat = json.dumps(body)
    for never in _NEVER:
        assert never not in flat, never
    # And the far end took it: a share the server could keep.
    stored, = server.db["entries"].values()
    assert stored["recipe"]["kind"] == "sofa" and stored["details"]["title"] == "Three-seat grey sofa, slim arms"
    sub = _lib()["submissions"][body["submission_id"]]
    assert sub["owner_token"] == body["owner_token"] and sub["library_id"] == out["library_id"]
    assert body["submission_id"].startswith("sub_" + _lib()["prefix"])


def test_results_never_carry_an_owner_token(store, monkeypatch, tmp_path) -> None:
    _wire(monkeypatch, _via(_Library(_php())))
    h = _home(tmp_path)
    _, shared, _ = _share(h)
    _, gone, _ = _call(h, "library_withdraw")
    _, terms, _ = _call(h, "terms_accept", version=L.TERMS_VERSION)
    for out in (shared, gone, terms):
        assert "owner_token" not in json.dumps(out) and not re.search(r"[0-9a-f]{32}", json.dumps(out))


@pytest.mark.parametrize("drop", ["category", "rooms", "style", "material", "color_family", "size_class"])
def test_a_piece_missing_a_required_detail_is_not_shared(store, monkeypatch, tmp_path, drop) -> None:
    wire = _wire(monkeypatch, lambda url, body: (200, {"ok": True}))
    h = _home(tmp_path)
    recipe = {**_RECIPE, "details": {k: v for k, v in _DETAILS.items() if k != drop}}
    kind, code, words = _share(h, recipe)
    assert (kind, code) == ("error", "invalid") and "fill in" in words
    assert wire.posts == [] and not _lib().get("submissions")


@pytest.mark.parametrize("field, text, what", [
    ("title", "Ask bob@example.com", "an email address"),
    ("title", "Call 604 555 0123", "a phone number"),
    ("title", "From 42 Maple Street", "a street address"),
    ("title", "See sofas.com", "a web address"),
    ("brand", "www.ikea-hack.net", "a web address"),
    ("model", "604-555-0123", "a phone number"),
])
def test_free_text_with_personal_details_is_refused_before_sending(store, monkeypatch, tmp_path, field, text,
                                                                   what) -> None:
    wire = _wire(monkeypatch, lambda url, body: (200, {"ok": True}))
    h = _home(tmp_path)
    kind, code, words = _share(h, {**_RECIPE, "details": {**_DETAILS, field: text}})
    assert (kind, code) == ("error", "invalid") and what in words
    assert wire.posts == []


def test_sharing_needs_the_terms_and_browsing_does_not(store, monkeypatch, tmp_path) -> None:
    server = _Library(_php())
    wire = _wire(monkeypatch, _via(server))
    h = _home(tmp_path, terms=False)
    assert _share(h)[:2] == ("error", "terms_required") and wire.posts == []
    assert _call(h, "library_search")[0] == "result", "browsing needs no terms"
    assert _call(h, "terms_accept", version=L.TERMS_VERSION + 1)[1] == "terms_changed"
    assert _call(h, "terms_accept", version=L.TERMS_VERSION)[0] == "result"
    assert _share(h)[1]["status"] == "shared"
    # A later terms version asks again before the next share.
    _FakeStore.saved[HOUSE3D_STORE_KEY]["library"]["terms_version"] = L.TERMS_VERSION - 1
    h.data[DOMAIN].pop(DATA_HOUSE3D, None)   # read the file again
    assert _share(h)[:2] == ("error", "terms_required")


def test_new_details_for_a_shared_piece_go_as_an_edit(store, monkeypatch, tmp_path) -> None:
    server = _Library(_php())
    _wire(monkeypatch, _via(server))
    h = _home(tmp_path)
    _, first, _ = _share(h)
    _, again, _ = _share(h, {**_RECIPE, "details": {**_DETAILS, "style": "modern"}},
                         submission_id=first["submission_id"])
    assert again["status"] == "updated" and again["submission_id"] == first["submission_id"]
    assert len(server.db["entries"]) == 1 and next(iter(server.db["entries"].values()))["details"]["style"] == "modern"
    _, other, _ = _share(h, submission_id="sub_ffffff0000000000")
    assert other["submission_id"] != "sub_ffffff0000000000", "an id this house never made starts a new share"


def test_a_share_the_library_refuses_is_forgotten(store, monkeypatch, tmp_path) -> None:
    wire = _wire(monkeypatch, lambda url, body: (400, {"ok": False, "why": "details", "field": "style",
                                                       "problem": "value", "error": "No."}))
    h = _home(tmp_path)
    kind, code, words = _share(h)
    assert (kind, code) == ("error", "refused") and "style" in words and len(wire.posts) == 1
    assert _lib()["submissions"] == {} and _lib()["pending_shares"] == []


# ═══ 4. the library down: Furnish still works, shares wait ════════════════════

def test_a_library_that_does_not_answer_is_said_plainly(store, monkeypatch, tmp_path) -> None:
    _wire(monkeypatch, _down)
    h = _home(tmp_path)
    assert _call(h, "library_search")[:2] == ("error", "unreachable")
    _wire(monkeypatch, lambda url, body: (503, {"ok": False, "why": "full"}))
    assert _call(h, "library_search")[:2] == ("error", "unreachable")
    _wire(monkeypatch, lambda url, body: (200, b"<html>maintenance</html>"))
    assert _call(h, "library_search")[:2] == ("error", "unreachable")


def test_offline_shares_wait_and_go_at_the_next_successful_fetch(store, monkeypatch, tmp_path) -> None:
    _wire(monkeypatch, _down)
    h = _home(tmp_path)
    kind, out, _ = _share(h)
    assert kind == "result" and out["status"] == "queued" and out["library"]["waiting"] == 1
    sid = out["submission_id"]
    waiting, = _lib()["pending_shares"]
    assert waiting["submission_id"] == sid and set(waiting["recipe"]) == set(L.RECIPE_KEYS)
    assert _lib()["submissions"][sid]["owner_token"], "kept here before it went, so it can be withdrawn"
    server = _Library(_php())
    wire = _wire(monkeypatch, _via(server))
    assert _call(h, "library_search")[0] == "result"
    assert [b["action"] for _u, b in wire.posts] == ["search", "share"]
    assert _lib()["pending_shares"] == [] and _lib()["submissions"][sid]["library_id"] in server.db["entries"]


def test_an_answer_lost_on_the_way_still_leaves_a_piece_this_house_can_withdraw(store, monkeypatch,
                                                                                tmp_path) -> None:
    server = _Library(_php())

    def kept_then_lost(url, body):
        server.handle(json.dumps(body).encode("utf-8"))
        raise TimeoutError("the answer never came")
    _wire(monkeypatch, kept_then_lost)
    h = _home(tmp_path)
    assert _share(h)[1]["status"] == "queued" and len(server.db["entries"]) == 1
    _wire(monkeypatch, _via(server))
    kind, out, _ = _call(h, "library_withdraw")
    assert kind == "result" and out["withdrawn"] == 1 and server.db["entries"] == {}
    assert _lib()["submissions"] == {} and _lib()["pending_shares"] == []


def test_withdraw_deletes_there_and_forgets_here(store, monkeypatch, tmp_path) -> None:
    server = _Library(_php())
    wire = _wire(monkeypatch, _via(server))
    h = _home(tmp_path)
    _share(h)
    _share(h, {**_RECIPE, "width_m": 3.0})
    assert len(server.db["entries"]) == 2
    kind, out, _ = _call(h, "library_withdraw")
    assert kind == "result" and out == {"withdrawn": 2, "left": 0, "library": out["library"]}
    assert server.db["entries"] == {} and len(server.withdrawals) == 2
    body = wire.posts[-1][1]
    assert body["action"] == "withdraw" and all(set(i) == {"submission_id", "owner_token"} for i in body["items"])


def test_withdraw_with_the_library_down_drops_what_waited_and_keeps_the_rest(store, monkeypatch, tmp_path) -> None:
    server = _Library(_php())
    _wire(monkeypatch, _via(server))
    h = _home(tmp_path)
    _share(h)
    _wire(monkeypatch, _down)
    _share(h, {**_RECIPE, "width_m": 3.0})
    assert len(_lib()["pending_shares"]) == 1
    kind, code, _ = _call(h, "library_withdraw")
    assert (kind, code) == ("error", "unreachable")
    assert _lib()["pending_shares"] == [], "a share waiting to go never goes once withdrawn"
    assert len(_lib()["submissions"]) == 2, "kept, to withdraw again"
    _wire(monkeypatch, _via(server))
    assert _call(h, "library_withdraw")[1]["withdrawn"] == 2 and server.db["entries"] == {}


# ═══ 5. browsing, placing, reporting ══════════════════════════════════════════

def test_search_and_placing_go_through_to_the_library(store, monkeypatch, tmp_path) -> None:
    server = _Library(_php())
    _seed(server)
    wire = _wire(monkeypatch, _via(server))
    h = _home(tmp_path, terms=False)
    kind, out, _ = _call(h, "library_search", filters={"room": "bedroom"}, sort="placed")
    assert kind == "result" and [e["library_id"][-1] for e in out["entries"]] == ["4", "8", "b", "9", "3"]
    assert out["total"] == 5 and set(out["entries"][0]) == {"library_id", "recipe", "houses", "copies", "checked",
                                                            "created"}
    kind, out, _ = _call(h, "library_get", library_id="lib_000000000003", placed=True)
    assert kind == "result" and out["entry"]["houses"] == 2
    assert wire.posts[-1][1] == {"schema": 1, "action": "get", "library_id": "lib_000000000003", "placed": True}
    assert _call(h, "library_search", filters={"colour": "grey"})[:2] == ("error", "invalid")
    assert _call(h, "library_search", sort="fit")[:2] == ("error", "invalid"), "best fit needs Fits here"


def test_a_report_sends_the_piece_a_reason_and_this_houses_prefix_only(store, monkeypatch, tmp_path) -> None:
    server = _Library(_php())
    _seed(server)
    wire = _wire(monkeypatch, _via(server))
    h = _home(tmp_path)
    assert _call(h, "library_report", library_id="lib_000000000001", reason="title")[0] == "result"
    body = wire.posts[-1][1]
    assert body == {"schema": 1, "action": "report", "library_id": "lib_000000000001", "reason": "title",
                    "reporter": _lib()["prefix"]}
    assert server.db["entries"]["lib_000000000001"]["reports"] == {_lib()["prefix"]: "title"}
    assert _call(h, "library_report", library_id="lib_000000000001", reason="rude")[:2] == ("error", "invalid")


# ═══ 6. registration and permissions ══════════════════════════════════════════

def test_the_commands_are_registered_beside_the_3d_houses_with_their_gates() -> None:
    ws = (_CC / "websocket.py").read_text(encoding="utf-8")
    assert "from .ws_house3d_library import WS_COMMANDS as _house3d_library_commands" in ws
    assert ws.index("ws_house3d_library") > ws.index("from .ws_house3d import WS_COMMANDS")
    src = (_CC / "ws_house3d_library.py").read_text(encoding="utf-8")
    names = ["library_search", "library_get", "library_report", "library_share", "library_withdraw", "terms_accept"]
    assert [f.ws_schema["type"] for f in WL.WS_COMMANDS] == [f"padspan_ha/house3d_{n}" for n in names]
    for n in names:
        decorators = src.split(f'"padspan_ha/house3d_{n}"')[1].split(f"async def ws_house3d_{n}")[0]
        assert ("@websocket_api.require_admin" in decorators) is (n == "library_withdraw"), n


def test_nothing_here_reaches_any_other_address() -> None:
    src = (_CC / "house3d_library.py").read_text(encoding="utf-8")
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
    assert re.findall(r"https?://[^\s\"']+", code) == [L.LIBRARY_URL]
    assert src.count("session.post(") == 1 and "session.get(" not in src
