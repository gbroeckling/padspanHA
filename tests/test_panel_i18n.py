# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The panel's translations helper, views/i18n.js (translation plan, Phase 0).

English is the source text and the key, so English never loads a file and
never changes. A language file under www/padspan-ha/i18n/<lang>/<group>.json
is a flat {"English": "Translation"} map, and it is held here to the strings
the code actually asks for: a key nobody calls t()/tn() with is an orphan
(the English was edited, the old translation would never show), placeholders
must match the English by name, values are plain text (no markup), and no
value names the product itself ({product} does, so the Bright build's rename
keeps working).

tests/js/panel_i18n.mjs runs the module for real.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_HELPER = _WWW / "views" / "i18n.js"
_LANG_DIR = _WWW / "i18n"
_NODE = shutil.which("node")

_JS_STR = r'"((?:[^"\\]|\\.)*)"'
_T_RE = re.compile(r"(?<![\w.$])t\(\s*" + _JS_STR)
_TN_RE = re.compile(r"(?<![\w.$])tn\(\s*[^,()]+,\s*" + _JS_STR + r"\s*,\s*" + _JS_STR)
_PH_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")
_PLURAL_CATS = {"zero", "one", "two", "few", "many", "other"}
_HELPER_BUDGET = 4096        # bytes, comments included
_GROUP_BUDGET = 60 * 1024    # bytes per language group file


def _unjs(s: str) -> str:
    return json.loads('"' + s + '"')


def _catalog() -> dict[str, set[str]]:
    """English key -> its placeholder names, from every t()/tn() literal in a
    file that imports the helper. For tn() the key is the "other" form."""
    cat: dict[str, set[str]] = {}
    for p in _WWW.rglob("*.js"):
        if p == _HELPER:
            continue
        src = p.read_text(encoding="utf-8")
        if "i18n.js" not in src:
            continue
        for m in _T_RE.finditer(src):
            k = _unjs(m.group(1))
            cat[k] = set(_PH_RE.findall(k))
        for m in _TN_RE.finditer(src):
            one, other = _unjs(m.group(1)), _unjs(m.group(2))
            cat[other] = set(_PH_RE.findall(one)) | set(_PH_RE.findall(other)) | {"n"}
    return cat


def _problems(name: str, data: object, catalog: dict[str, set[str]]) -> list[str]:
    out: list[str] = []
    if not isinstance(data, dict):
        return [f"{name}: not a JSON object"]

    def text(key: str, val: object) -> None:
        if not isinstance(val, str) or not val.strip():
            out.append(f"{name}: {key!r} is not text")
            return
        if "<" in val or ">" in val:
            out.append(f"{name}: {key!r} contains markup")
        if "PadSpan" in val or "Bright" in val:
            out.append(f"{name}: {key!r} names the product (use {{product}})")
        extra = set(_PH_RE.findall(val)) - catalog.get(key, set()) - {"product"}
        if extra:
            out.append(f"{name}: {key!r} has placeholders the English does not: {sorted(extra)}")

    for key, val in data.items():
        if key not in catalog:
            out.append(f"{name}: orphan {key!r} (no t()/tn() asks for it)")
            continue
        if isinstance(val, dict):
            if "other" not in val or not set(val) <= _PLURAL_CATS:
                out.append(f"{name}: {key!r} plural needs 'other' and only {sorted(_PLURAL_CATS)}")
            for cat, v in val.items():
                text(key, v)
        else:
            text(key, val)
    return out


def _language_files() -> list[Path]:
    return sorted(_LANG_DIR.glob("*/*.json")) if _LANG_DIR.is_dir() else []


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "panel_i18n.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)
    assert len(harness["cases"]) >= 20


def test_the_helper_stays_small() -> None:
    assert _HELPER.stat().st_size <= _HELPER_BUDGET, f"views/i18n.js is {_HELPER.stat().st_size} bytes"


def test_language_files_fit_the_budget_and_the_code() -> None:
    catalog = _catalog()
    problems: list[str] = []
    for p in _language_files():
        rel = str(p.relative_to(_WWW))
        if p.stat().st_size > _GROUP_BUDGET:
            problems.append(f"{rel}: {p.stat().st_size} bytes, over {_GROUP_BUDGET}")
        problems += _problems(rel, json.loads(p.read_text(encoding="utf-8")), catalog)
    assert not problems, "\n".join(problems[:30])


def test_shipped_languages_have_files() -> None:
    src = _HELPER.read_text(encoding="utf-8")
    m = re.search(r"export const LANGUAGES = Object\.freeze\(\[([^\]]*)\]\);", src)
    assert m, "LANGUAGES must stay a literal list the tests can read"
    for lang in re.findall(r'"([a-z]{2,3})"', m.group(1)):
        assert list((_LANG_DIR / lang).glob("*.json")), f"LANGUAGES lists {lang} but i18n/{lang}/ is empty"


def test_the_checks_bite() -> None:
    """The file checks are only worth having if they fail on a bad file."""
    cat = {"Remove {name}?": {"name"}, "{n} devices": {"n"}, "Restore": set()}
    assert _problems("ok", {"Remove {name}?": "{name} verwijderen?", "Restore": "Herstellen",
                            "{n} devices": {"one": "{n} apparaat", "other": "{n} apparaten"}}, cat) == []
    bad = {"Gone": "Weg", "Remove {name}?": "{naam} verwijderen?", "Restore": "<b>Herstellen</b>",
           "{n} devices": {"one": "1 apparaat"}}
    msgs = "\n".join(_problems("bad", bad, cat))
    for needle in ("orphan 'Gone'", "placeholders the English does not", "markup", "needs 'other'"):
        assert needle in msgs, needle
    assert "names the product" in "\n".join(_problems("p", {"Restore": "PadSpan HA herstellen"}, cat))


def test_the_extractor_reads_calls() -> None:
    src = 'x = t("Plain"); y = t("Hi \\"{who}\\"", {who}); z = tn(n, "{n} room", "{n} rooms"); a.t("no"); fmt("no")'
    keys = {_unjs(m.group(1)) for m in _T_RE.finditer(src)}
    assert keys == {"Plain", 'Hi "{who}"'}
    assert [(_unjs(a), _unjs(b)) for a, b in _TN_RE.findall(src)] == [("{n} room", "{n} rooms")]


def test_the_product_name_is_one_literal() -> None:
    """{product} is filled from PRODUCT, which the Bright rename rewrites."""
    src = _HELPER.read_text(encoding="utf-8")
    assert 'export const PRODUCT = "PadSpan HA";' in src
    assert "new URL(`../i18n/${lang}/${g}.json${q}`, import.meta.url)" in src
