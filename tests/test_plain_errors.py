# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Refusals and error toasts in words a house owner understands (2026-11-21).

About 66 of the backend's ~440 refusal texts named its internal parts:
"ModelStore not loaded", "FabricStore not loaded", "Maps store not
initialized", "barrier_id is required", "Entity '…' not found in registry".
And the panel put an error's text straight into a toast in some 175 places,
so those names reached people, along with Home Assistant's own schema words
("required key not provided @ data['map_id']"), a bug's "Cannot read
properties of undefined", "[object Object]" (String() of Home Assistant's
error object) or just "3" (a lost connection).

Now every refusal is a sentence for people, each keeping its code (the code
is what other code reads), and the panel's toasts show an error through
views/ui_error.js errorText: PadSpan's own sentence as it is, a plain line
for the rest. tests/js/plain_errors.mjs runs errorText for real.
"""

from __future__ import annotations

import ast
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "custom_components" / "padspan_ha"
WWW = PKG / "www" / "padspan-ha"

# What a person can't be expected to know: a store's class name, "registry",
# "not initialized", a field name with an underscore, a Python type.
INTERNAL = re.compile(r"\b[A-Z][a-z]+(?:Store|Registry)\b|[Rr]egistry\b|not initiali[sz]ed|\bnot loaded\b|"
                      r"\b[a-z]+_[a-z_]*[a-z]\b|\bdict\b|\bfabric\b|[Cc]oordinator\b")


def _said(node: ast.AST) -> list[str]:
    """The literal words a message expression can say: its strings, the parts of
    an f-string, both sides of a + or an if/else, a dict's values (never its
    keys, nor what a condition compares: those are codes, not words)."""
    if isinstance(node, ast.Constant):
        return [node.value] if isinstance(node.value, str) else []
    if isinstance(node, ast.JoinedStr):
        return [v.value for v in node.values if isinstance(v, ast.Constant) and isinstance(v.value, str)]
    if isinstance(node, ast.BinOp):
        return _said(node.left) + _said(node.right)
    if isinstance(node, ast.IfExp):
        return _said(node.body) + _said(node.orelse)
    if isinstance(node, ast.Subscript):
        return _said(node.value)
    if isinstance(node, ast.Dict):
        return [w for v in node.values for w in _said(v)]
    if isinstance(node, ast.BoolOp):
        return [w for v in node.values for w in _said(v)]
    return []


def _templated(node: ast.Call) -> ast.Call | None:
    """send_error(msg_id, code, **refusal(template, **values)): the refusal(...) call (const.refusal)."""
    for k in node.keywords:
        if k.arg is None and isinstance(k.value, ast.Call) and getattr(k.value.func, "id", "") == "refusal":
            return k.value
    return None


def _refusals() -> list[tuple[str, int, str, list[str]]]:
    """Every send_error(...): file, line, code source, and the literal words in its message (a refusal()'s template)."""
    out = []
    for p in sorted(PKG.glob("*.py")):
        src = p.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "send_error":
                said = node.args[2] if len(node.args) >= 3 else (_templated(node).args[0] if _templated(node) else None)
                if said is not None and len(node.args) >= 2:
                    out.append((p.name, node.lineno, ast.get_source_segment(src, node.args[1]) or "", _said(said)))
    return out


def test_a_refusal_with_a_value_in_it_is_sent_as_its_template() -> None:
    """const.refusal: the English filled in, and Home Assistant's translation fields beside it, so the panel says it
    in its own language (views/ui_error.js errorText). Every value the template names is given, by name."""
    from custom_components.padspan_ha.const import DOMAIN, refusal

    assert refusal("{room} is not a room on the map.", room="Kitchen") == {
        "message": "Kitchen is not a room on the map.", "translation_key": "{room} is not a room on the map.",
        "translation_domain": DOMAIN, "translation_placeholders": {"room": "Kitchen"}}
    calls = []
    for p in sorted(PKG.glob("*.py")):
        for node in ast.walk(ast.parse(p.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "refusal":
                tpl = node.args[0]
                assert isinstance(tpl, ast.Constant) and isinstance(tpl.value, str), f"{p.name}:{node.lineno}"
                named = set(re.findall(r"\{(\w+)\}", tpl.value))
                assert named == {k.arg for k in node.keywords} and named, f"{p.name}:{node.lineno}: {tpl.value!r}"
                calls.append(tpl.value)
    assert len(calls) >= 25, len(calls)


def test_there_are_still_hundreds_of_refusals_to_check() -> None:
    assert len(_refusals()) >= 400


def test_no_refusal_names_an_internal_part() -> None:
    bad = []
    for name, line, _code, parts in _refusals():
        for text in parts:
            if INTERNAL.search(text):
                bad.append(f"{name}:{line}: {text!r}")
    assert not bad, "\n".join(bad)


def test_a_store_that_is_not_there_says_so_in_one_plain_sentence() -> None:
    from custom_components.padspan_ha.const import NOT_LOADED_MESSAGE

    assert NOT_LOADED_MESSAGE.startswith("PadSpan hasn't finished loading.") and "restart Home Assistant" in NOT_LOADED_MESSAGE
    uses = sum(p.read_text(encoding="utf-8").count("NOT_LOADED_MESSAGE)") for p in PKG.glob("*.py"))
    assert uses >= 60, uses
    # Each keeps its code: what the panel and other callers read.
    src = (PKG / "ws_fabric.py").read_text(encoding="utf-8")
    assert '"no_model", NOT_LOADED_MESSAGE' in src and '"no_fabric", NOT_LOADED_MESSAGE' in src


def test_the_panels_toasts_show_errors_through_error_text() -> None:
    """A toast that shows a caught error shows errorText(e), not e.message or String(e)."""
    toast = re.compile(r"(?:ctx\.toast|this\._toast|\btoast)\(")
    raw = re.compile(r"\b(?:e|err|error|ex|exc|e2)\??\.message\b|String\(\s*\(?\s*(?:e|err|error)\b")
    bad = []
    for p in sorted(WWW.rglob("*.js")):
        if "lib" in p.parts:
            continue
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            m = toast.search(line)
            # _callWS's admin_only toast: PadSpan's own refusal (its code checked just above), with its own fallback.
            if "err.message || \"Only an admin can change this while Enhanced security is on\"" in line:
                continue
            if m and raw.search(line[m.start():]):
                bad.append(f"{p.relative_to(WWW).as_posix()}:{i}: {line.strip()[:120]}")
    assert not bad, "\n".join(bad)
    panel = (WWW / "panel.js").read_text(encoding="utf-8")
    assert "errorText: (e) => self._errorText(e)," in panel
    assert "if (UI_ERROR && UI_ERROR.errorText) return UI_ERROR.errorText(e);" in panel
    # In the panel's language (views/i18n.js t(); English is the key).
    assert 'throw new Error(t("Home Assistant isn\'t connected yet. Wait a moment and try again."));' in panel


@pytest.fixture(scope="module")
def words() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "plain_errors.mjs"), str(WWW)],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_error_text_shows_padspans_sentence_and_a_plain_line_for_the_rest(words) -> None:
    bad = {k: v for k, v in words.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)
    assert len(words) >= 12
