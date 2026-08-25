# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""node is a REQUIREMENT of this suite, and a missing one says so out loud.

Half of this project is JavaScript, and the only thing that ever executes it
is node. Sixteen test files run their assertions inside it — the parse check,
the render smoke, the point-align solver, the master-recovery harnesses, the
lights and metre-anchor checks, the map draw sites, and, since Release 1, the
placement mirror. The count is read off disk below rather than written here,
because a stale list is the same failure in miniature.

That last one is the sharp case. `stack_transform.js` and `traceback.js` carry
their own copy of

    metres = origin + R(ρ) · [[Sx, -Sy·sin σ], [0, Sy·cos σ]] · frac

because the panel draws through them without asking the backend. Reverting
BOTH of them to the five-field arithmetic — a frontend that draws every
sheared map metres from where the backend says it is — is caught by exactly
one assertion, in one test, `test_the_js_twins_agree_with_python_to_the_micron`
(worst case 31.82 m against a 1e-9 threshold).

Every one of those files is `skipif(shutil.which("node") is None)`. With node
off PATH that same desynchronised mirror gives 985 passed, 116 skipped and
ZERO failures: a green suite over a frontend nobody checked. A silent skip is
the wrong shape for a missing REQUIREMENT — it reports absence of evidence as
evidence of absence, once per file, in the quietest way pytest offers.

So it is loud, exactly once, here. One failure that names what is unguarded
beats 116 dots that do not. `PADSPAN_TESTS_ALLOW_NO_NODE=1` accepts the gap
for a contributor working on the Python half who has no node installed; the
point is not to block them, it is that accepting it should be an ACT rather
than an accident.

Chosen over the alternative — covering the mirror a second way that needs no
node — deliberately. The twins are JavaScript. Every node-free check of them
that was considered is a check of their SOURCE TEXT rather than of the numbers
they produce, and a source-text check that reads as proof and is not one is
the failure mode this whole release is closing out.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest

_TESTS = Path(__file__).resolve().parent
_OPT_OUT = "PADSPAN_TESTS_ALLOW_NO_NODE"


def _node_gated_files() -> list[str]:
    """The files whose assertions do not run without node.

    Read off disk rather than listed here, so the failure message stays true
    as node-backed tests are added and this file is not quietly describing
    the suite as it was.
    """
    out = []
    for path in sorted(_TESTS.glob("test_*.py")):
        if path.name == Path(__file__).name:
            continue
        if 'shutil.which("node")' in path.read_text(encoding="utf-8"):
            out.append(path.name)
    return out


def test_node_is_installed_or_the_frontend_half_is_unguarded() -> None:
    gated = _node_gated_files()
    assert len(gated) >= 5, (
        f"only {len(gated)} node-backed test files found — the scan is wrong, "
        "and this guard is reporting on a suite that is not the one running"
    )
    if shutil.which("node"):
        return
    if os.environ.get(_OPT_OUT) == "1":
        pytest.skip(f"node absent, accepted deliberately by {_OPT_OUT}=1")
    pytest.fail(
        "node is not on PATH, so every assertion in these files SKIPPED "
        "rather than passed:\n  " + "\n  ".join(gated) + "\n\n"
        "That includes the only check that the frontend's copy of the "
        "placement model still agrees with the backend's — a frontend drawing "
        "every sheared map metres from where the backend puts it leaves this "
        "suite green without it. Install node, or set "
        f"{_OPT_OUT}=1 to accept the gap on purpose."
    )


# ── the gate's own behaviour ─────────────────────────────────────────────────
#
# One character apart, `==` and `!=` on the opt-out check, is the difference
# between the failure above and the silent skip it exists to end: with node off
# PATH and the two JS twins desynchronised, `!=` gives a green suite with zero
# failures and 100-odd dots where the frontend half should have been. Nothing
# else in this suite can see that — every other test either has node or is
# skipped — so the gate is exercised here directly, in both directions.


def _run_gate() -> None:
    test_node_is_installed_or_the_frontend_half_is_unguarded()


# BOTH outcomes are caught and the TYPE is asserted, never `raises(Failed)`
# alone: a gate that skips where it should fail would let the Skipped escape
# and pytest would report this test itself as skipped — green, quiet, and the
# same silent-skip failure one level up.
_OUTCOMES = (pytest.fail.Exception, pytest.skip.Exception)


def test_with_no_node_and_no_opt_out_the_gate_FAILS(monkeypatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    monkeypatch.delenv(_OPT_OUT, raising=False)
    with pytest.raises(_OUTCOMES) as err:
        _run_gate()
    assert err.type is pytest.fail.Exception, (
        "the gate SKIPPED an absent node instead of failing — which is the "
        "state it exists to end, now reported by the guard itself"
    )
    assert "node is not on PATH" in str(err.value)
    assert _OPT_OUT in str(err.value), "the failure has to say how to accept the gap"


def test_the_opt_out_is_the_only_thing_that_turns_it_into_a_skip(monkeypatch) -> None:
    """Accepting the gap is an ACT. Set to anything else, it is not accepted —
    which is the other side of the same character, and the side a `!=` breaks."""
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    monkeypatch.setenv(_OPT_OUT, "1")
    with pytest.raises(_OUTCOMES) as err:
        _run_gate()
    assert err.type is pytest.skip.Exception, "the deliberate opt-out was refused"
    for _not_the_opt_out in ("0", "", "true", "yes"):
        monkeypatch.setenv(_OPT_OUT, _not_the_opt_out)
        with pytest.raises(_OUTCOMES) as err:
            _run_gate()
        assert err.type is pytest.fail.Exception, (
            f"{_OPT_OUT}={_not_the_opt_out!r} was read as accepting the gap"
        )


def test_with_node_present_the_gate_passes(monkeypatch) -> None:
    """The control: it is not simply always raising."""
    monkeypatch.setattr(shutil, "which", lambda _name: "/usr/bin/node")
    monkeypatch.delenv(_OPT_OUT, raising=False)
    _run_gate()
