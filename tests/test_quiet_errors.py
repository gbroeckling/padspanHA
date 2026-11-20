# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Errors handled quietly are counted (quiet_errors.py).

A handler that catches everything and carries on says so in one line, so the
ones that really fire can be found. This file holds:

- the helper: it counts by site, keeps the last error in memory, is bounded
  and never raises;
- the source: every site name is a fixed word, used once, and listed in SITES;
- the hot path: the poll, the smoothing and the advertisement callback count
  with a dict increment and nothing else;
- the ratchet: no new catch-all that discards its error without counting it;
- where the counts go: an administrator's Diagnostics (with the error text)
  and the opt-in usage report (site names and numbers only).
"""

from __future__ import annotations

import ast
import asyncio
import json
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import quiet_errors as Q
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_diagnostics as WD
from tests.test_telemetry import _hass

_ROOT = Path(__file__).resolve().parents[1]
_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_SITE_RE = re.compile(r"[a-z][a-z0-9_]*:[a-z0-9_]+")
_LOUD = {"warning", "warn", "error", "exception", "critical"}

# Catch-all handlers that discard their error and do not count it. This number
# only goes down: count the error (or narrow the `except`) in any new handler.
UNMARKED_TODAY = 0


# ── the helper ───────────────────────────────────────────────────────────────

@pytest.fixture
def clock(monkeypatch):
    """The helper's clock, moved by hand: clock.t += seconds."""
    class _Clock:
        t = 1_800_000_000.0
    monkeypatch.setattr(Q, "time", SimpleNamespace(time=lambda: _Clock.t))
    return _Clock


def test_note_counts_by_site_and_keeps_the_last_error(clock):
    for text in ("first", "second"):
        clock.t += 5
        try:
            raise ValueError(text)
        except Exception:
            Q.note("snapshot:areas")
    try:
        raise KeyError("k")
    except Exception as err:
        Q.note("snapshot:ble", err)
    rows = Q.listing()
    assert [(r["site"], r["count"], r["type"], r["text"], r["at"]) for r in rows] == [
        ("snapshot:areas", 2, "ValueError", "second", clock.t), ("snapshot:ble", 1, "KeyError", "'k'", clock.t)]


def test_a_handler_firing_in_a_loop_counts_each_and_keeps_one_error_a_second(clock):
    for i in range(1000):
        Q.note("snapshot:areas", ValueError(f"row {i}"))
    assert (Q.COUNTS["snapshot:areas"], Q.listing()[0]["text"]) == (1000, "row 0")
    clock.t += Q.KEEP_EVERY_S
    Q.note("snapshot:areas", ValueError("later"))
    assert Q.listing()[0]["text"] == "later"
    clock.t -= 3600                              # the clock set back: the next error is kept, not waited out
    Q.note("snapshot:areas", ValueError("after the clock moved"))
    assert Q.listing()[0]["text"] == "after the clock moved"


def test_the_error_text_is_cut_and_a_broken_error_never_raises():
    class Loud(Exception):
        def __str__(self):
            raise RuntimeError("no text for you")

    Q.note("snapshot:areas", ValueError("x" * 5000))
    assert len(Q.listing()[0]["text"]) == Q.TEXT_MAX
    Q.note("snapshot:ble", Loud())          # counted, though its text cannot be read
    Q.note(None)                            # type: ignore[arg-type]  # and nonsense is swallowed
    assert Q.COUNTS["snapshot:ble"] == 1


def test_the_number_of_sites_is_bounded():
    for i in range(Q.MAX_SITES + 50):
        Q.note(f"made_up:site_{i}", ValueError("x"))
    assert len(Q.COUNTS) <= Q.MAX_SITES + 1 and len(Q._LAST) <= Q.MAX_SITES + 1
    assert Q.COUNTS[Q.OVERFLOW] == 50


def test_a_count_only_site_lists_with_no_error_text():
    Q.COUNTS["presence:poll_interval"] += 1
    Q.COUNTS["presence:poll_interval"] += 1
    assert Q.listing() == [{"site": "presence:poll_interval", "count": 2, "type": "", "text": "", "at": None}]


def test_the_report_carries_site_names_and_counts_since_the_last_one():
    a, b = sorted(Q.SITES)[:2]
    Q.note(a, ValueError("kitchen light.kitchen_valance 48:87:2D:9D:BC:88"))
    Q.note(a, ValueError("again"))
    Q.COUNTS[b] += 1
    Q.note("made_up:not_listed", ValueError("x"))
    assert Q.report_counts() == {a: 2, b: 1}, "names from SITES and numbers, never the text"
    assert Q.report_counts() == {a: 2, b: 1}, "a preview takes nothing"
    assert Q.report_counts(consume=True) == {a: 2, b: 1}
    assert Q.report_counts() == {}
    Q.note(a, ValueError("x"))
    assert Q.report_counts() == {a: 1}
    Q.check_report(Q.report_counts())


def test_a_report_that_failed_gives_its_counts_back():
    a = sorted(Q.SITES)[0]
    Q.note(a, ValueError("x"))
    Q.mark_reported()
    Q.note(a, ValueError("x"))
    Q.unmark_reported()
    assert Q.report_counts() == {a: 2}


def test_the_report_is_the_busiest_sites_and_says_how_many_it_left_out():
    names = sorted(Q.SITES)[:Q.REPORT_SITES + 3]
    assert len(names) == Q.REPORT_SITES + 3, "this test needs more sites than the report carries"
    for i, s in enumerate(names):
        Q.COUNTS[s] += i + 1
    out = Q.report_counts()
    assert out.pop(Q.REPORT_MORE) == 3
    assert sorted(out) == sorted(names[3:]) and len(out) == Q.REPORT_SITES
    Q.check_report(Q.report_counts())


@pytest.mark.parametrize("bad", [
    {"kitchen": 1}, {"snapshot:made_up": 1}, ["snapshot:areas"], "x",
    {"__SITE__": "1"}, {"__SITE__": True}, {"__SITE__": -1}, {"__SITE__": 1.5},
])
def test_the_report_check_refuses_anything_but_sites_and_counts(bad):
    site = sorted(Q.SITES)[0]
    if isinstance(bad, dict):
        bad = {(site if k == "__SITE__" else k): v for k, v in bad.items()}
    with pytest.raises(ValueError, match="health.quiet_errors"):
        Q.check_report(bad)


def test_the_helper_imports_nothing_from_padspan_or_home_assistant():
    tree = ast.parse((_CC / "quiet_errors.py").read_text(encoding="utf-8"))
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            assert n.level == 0 and not (n.module or "").startswith("homeassistant"), ast.unparse(n)
        if isinstance(n, ast.Import):
            assert not any(a.name.startswith("homeassistant") for a in n.names), ast.unparse(n)


# ── the source ───────────────────────────────────────────────────────────────

def _modules():
    for f in sorted(_CC.glob("*.py")):
        if f.name != "quiet_errors.py":
            yield f, ast.parse(f.read_text(encoding="utf-8"))


def _site_of(node: ast.AST) -> ast.expr | None:
    """The site argument of a counting line, or None for any other node."""
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_quiet_error":
        return node.args[0] if node.args else ast.Constant(value=None)
    if (isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Subscript)
            and isinstance(node.target.value, ast.Name) and node.target.value.id == "_QUIET_COUNTS"):
        return node.target.slice
    return None


def _sites_in_source() -> list[tuple[str, int, ast.expr]]:
    return [(f.name, n.lineno, s) for f, tree in _modules() for n in ast.walk(tree)
            if (s := _site_of(n)) is not None]


def test_every_site_is_a_fixed_name_written_in_the_source():
    found = _sites_in_source()
    assert len(found) > 50, "the scan found too few counting lines to mean anything"
    for fname, line, s in found:
        where = f"{fname}:{line}"
        assert isinstance(s, ast.Constant) and isinstance(s.value, str), \
            f"{where}: the site must be a plain string, never built from data"
        assert _SITE_RE.fullmatch(s.value) and len(s.value) <= 40, \
            f"{where}: {s.value!r} is not module:word (lower case, at most 40 characters)"


def test_the_listed_sites_are_exactly_the_ones_in_the_source():
    names = [s.value for _f, _l, s in _sites_in_source()]
    twice = sorted({n for n in names if names.count(n) > 1})
    assert not twice, f"each handler has its own site name; used more than once: {twice}"
    assert sorted(set(names) - Q.SITES) == [], "add these to SITES in quiet_errors.py"
    assert sorted(Q.SITES - set(names)) == [], "no handler uses these any more: take them out of SITES"
    assert len(Q.SITES) < Q.MAX_SITES and Q.OVERFLOW not in Q.SITES and Q.REPORT_MORE not in Q.SITES


def test_every_site_name_may_go_in_the_report():
    """The report refuses identifier shapes in keys too (an entity id, a MAC)."""
    names = sorted(Q.SITES)
    for i in range(0, len(names), Q.REPORT_SITES):
        T.assert_shareable({"health": {"quiet_errors": {n: 1 for n in names[i:i + Q.REPORT_SITES]}}})


# ── the hot path ─────────────────────────────────────────────────────────────

_HOT = {
    "presence_coordinator.py": ("_async_poll", "_smooth_room"),
    "bluetooth_live.py": ("_on_adv", "_service_info_to_record"),
}


def test_the_hot_path_counts_with_a_dict_increment_and_nothing_else():
    for fname, funcs in _HOT.items():
        tree = ast.parse((_CC / fname).read_text(encoding="utf-8"))
        seen = set()
        for fn in ast.walk(tree):
            if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) and fn.name in funcs:
                seen.add(fn.name)
                lines = [n for n in ast.walk(fn) if _site_of(n) is not None]
                assert lines, f"{fname} {fn.name}: no counting line found"
                for n in lines:
                    assert isinstance(n, ast.AugAssign) and isinstance(n.op, ast.Add) \
                        and isinstance(n.value, ast.Constant) and n.value.value == 1, \
                        f"{fname}:{n.lineno}: in {fn.name} the count is `_QUIET_COUNTS[site] += 1` and nothing else"
        assert seen == set(funcs), f"{fname}: not found: {sorted(set(funcs) - seen)}"
    from custom_components.padspan_ha import bluetooth_live, presence_coordinator
    assert bluetooth_live._QUIET_COUNTS is Q.COUNTS and presence_coordinator._QUIET_COUNTS is Q.COUNTS
    Q.COUNTS["presence:poll_interval"] += 1          # a name never counted before must not raise
    assert Q.COUNTS["presence:poll_interval"] == 1


# ── the ratchet ──────────────────────────────────────────────────────────────

def _catches_everything(h: ast.ExceptHandler) -> bool:
    if h.type is None:
        return True
    types = h.type.elts if isinstance(h.type, ast.Tuple) else [h.type]
    return any(isinstance(t, ast.Name) and t.id in ("Exception", "BaseException") for t in types)


def _discards_its_error(h: ast.ExceptHandler) -> bool:
    """It does not raise, does not log at warning or above, and does not hand
    the error on (a debug or info line is not handing it on: nobody sees it)."""
    nodes = [n for s in h.body for n in ast.walk(s)]
    if any(isinstance(n, ast.Raise) for n in nodes):
        return False
    logs = [n for n in nodes if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    if any(n.func.attr in _LOUD for n in logs):
        return False
    if h.name is None:
        return True
    unseen = {id(x) for n in logs if n.func.attr in ("debug", "info") for x in ast.walk(n)}
    return not any(isinstance(n, ast.Name) and n.id == h.name and id(n) not in unseen for n in nodes)


def _quiet_handlers() -> list[tuple[str, int, bool]]:
    """(file, line, counted) for every catch-all handler that discards its error."""
    out = []
    for f, tree in _modules():
        for n in ast.walk(tree):
            if isinstance(n, ast.ExceptHandler) and _catches_everything(n) and _discards_its_error(n):
                # Its own line, not one inside a handler nested in it.
                counted = any(_site_of(s.value if isinstance(s, ast.Expr) else s) is not None for s in n.body)
                out.append((f.name, n.lineno, counted))
    return out


def test_no_new_catch_all_discards_its_error_uncounted():
    handlers = _quiet_handlers()
    assert len(handlers) > 300, "the scan found too few handlers to mean anything"
    unmarked = [f"{f}:{line}" for f, line, counted in handlers if not counted]
    assert len(unmarked) <= UNMARKED_TODAY, (
        f"{len(unmarked)} catch-all handlers discard their error without counting it "
        f"(the most allowed is {UNMARKED_TODAY}): {unmarked[:20]}. "
        "Either catch only the errors you expect (`except ValueError:`), or keep the catch-all and count it: "
        "add `_quiet_error(\"module:word\")` as the handler's first line "
        "(`from .quiet_errors import note as _quiet_error`) and add the name to SITES in quiet_errors.py."
    )
    assert len(unmarked) == UNMARKED_TODAY, \
        f"well done: only {len(unmarked)} are left uncounted. Lower UNMARKED_TODAY to {len(unmarked)} in this file."


# ── where the counts go ──────────────────────────────────────────────────────

def test_diagnostics_gives_an_administrator_each_site_with_its_last_error(clock):
    try:
        raise ValueError("Kitchen has no floor")
    except Exception:
        Q.note("snapshot:areas")
    Q.COUNTS["presence:poll_interval"] += 3
    conn = MagicMock()
    asyncio.run(WD.ws_quiet_errors(MagicMock(), conn, {"id": 4, "type": "padspan_ha/quiet_errors"}))
    conn.send_result.assert_called_once_with(4, {"sites": [
        {"site": "presence:poll_interval", "count": 3, "type": "", "text": "", "at": None},
        {"site": "snapshot:areas", "count": 1, "type": "ValueError", "text": "Kitchen has no floor", "at": clock.t},
    ]})


def test_the_error_text_is_for_administrators_and_the_command_is_registered():
    tree = ast.parse((_CC / "ws_diagnostics.py").read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "ws_quiet_errors")
    assert [ast.unparse(d) for d in fn.decorator_list] == [
        "websocket_api.websocket_command({'type': 'padspan_ha/quiet_errors'})",
        "websocket_api.require_admin", "websocket_api.async_response"]
    assert "websocket_api.async_register_command(hass, ws_quiet_errors)" in (_CC / "websocket.py").read_text(encoding="utf-8")


def test_the_panel_draws_them_for_an_administrator_and_keeps_them_out_of_the_support_report():
    js = (_CC / "www" / "padspan-ha" / "views" / "diagnostics.js").read_text(encoding="utf-8")
    assert js.count('"Errors PadSpan handled quietly"') == 1
    card = js[js.index("// ── Errors PadSpan handled quietly"):]
    assert "if (ctx.hass && ctx.hass.user && ctx.hass.user.is_admin) {" in card
    assert js.count('"padspan_ha/quiet_errors"') == 1 and 'ctx.actions.callWS({ type: "padspan_ha/quiet_errors" })' in card
    # The report to send is built before the card and never from it.
    assert js.index("const text = hideIrks(JSON.stringify(payload, null, 2));") < js.index("// ── Errors PadSpan handled quietly")
    assert "quiet" not in js[js.index("const payload = {"):js.index("const text = hideIrks(")].lower()
    # The real house's errors are not asked for while the sample house shows.
    assert 'if (ctx.state.dataMode === "sample" && !(ctx.hass && ctx.hass.padspan_demo === true)) {' in card
    assert card.index('ctx.state.dataMode === "sample"') < card.index('"padspan_ha/quiet_errors"')


def test_the_usage_report_carries_the_site_counts_and_never_the_text(monkeypatch):
    h = _hass()
    a, b = "snapshot:areas", "presence:poll_interval"
    assert {a, b} <= Q.SITES
    Q.note(a, ValueError("Kitchen light.kitchen_valance 48:87:2D:9D:BC:88"))
    Q.COUNTS[b] += 2
    payload = T.build_payload(h)
    section = payload["health"]["quiet_errors"]
    assert section[a] == 1 and section[b] == 2
    # Building a report from this test's stand-in house trips a few handlers of
    # its own (a stand-in has no areas, no maps): they are counted and sent too.
    assert section == Q.report_counts() and len(section) > 2
    assert all(k in Q.SITES and isinstance(v, int) and not isinstance(v, bool) for k, v in section.items())
    T.assert_shareable(payload)
    assert "Kitchen" not in json.dumps(payload) and "kitchen_valance" not in json.dumps(payload)
    monkeypatch.setattr(Q, "report_counts", lambda consume=False: {})
    assert "quiet_errors" not in T.build_payload(h)["health"], "nothing fired: nothing sent"


def test_the_report_is_refused_with_anything_else_in_that_section():
    payload = T.build_payload(_hass())
    for bad in ({"kitchen": 1}, {"snapshot:areas": "Kitchen has no floor"}, ["snapshot:areas"]):
        payload["health"]["quiet_errors"] = bad
        with pytest.raises(ValueError, match="health.quiet_errors"):
            T.assert_shareable(payload)
    payload["health"]["quiet_errors"] = {"snapshot:areas": 3, Q.REPORT_MORE: 2}
    T.assert_shareable(payload)


def test_a_sent_report_takes_the_counts_and_a_failed_one_gives_them_back():
    h = _hass()
    T.build_payload(h)
    Q.reset()
    Q.note("snapshot:areas", ValueError("x"))
    taken = T._take_windows(h)
    assert "snapshot:areas" not in Q.report_counts(), "sent: the next report starts from none"
    Q.note("snapshot:areas", ValueError("x"))
    T._give_back_windows(h, taken)
    assert Q.report_counts()["snapshot:areas"] == 2, "not sent after all: both go with the next"
    T.reset_windows(h)
    assert "snapshot:areas" not in Q.report_counts(), "opting in starts the window"


def test_a_report_too_full_gives_up_these_counts_first(monkeypatch):
    """They ride only when there is room: no preset and no usage counter is given up for them."""
    h = _hass()
    Q.note("snapshot:areas", ValueError("x"))
    full = T.build_payload(h)
    assert "quiet_errors" in full["health"] and full["presets"]
    without = dict(full, health={k: v for k, v in full["health"].items() if k != "quiet_errors"})
    monkeypatch.setattr(T, "_MAX_BYTES", len(json.dumps(without)) + 5)
    small = T.build_payload(h)
    assert "quiet_errors" not in small["health"]
    assert small["usage"] == full["usage"] and small["presets"] == full["presets"]
    assert "usage_dropped" not in small["health"]


def test_the_readme_lists_the_section():
    readme = (_ROOT / "README.md").read_text(encoding="utf-8")
    assert "also in `health`, `quiet_errors`:" in readme and "Never the error's text" in readme
    assert "`hw` / `perf` / `runs` / `quiet_errors` that is not on their fixed lists" in readme
