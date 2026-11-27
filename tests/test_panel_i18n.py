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
value names the product unless its English does, and then exactly as the
English does ({product} otherwise, so the Bright build's rename keeps working).

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
_HELPER_BUDGET = 4066        # bytes, comments included, the product's name not
_GROUP_BUDGET = 60 * 1024    # bytes per language group file
# The help group is the exception: its keys are whole English paragraphs
# (~60 KB on their own) beside the translation, so one language is ~120-130 KB
# (~45 KB gzipped). It loads once, lazily, only for a shipped language, never
# for English; splitting it would only add fetches for the same bytes.
# 2026-10-31: the help was rewritten and roughly doubled (89 topics, every
# screen covered), so a fully translated help.json is ~340 KB (~110 KB
# gzipped). Fetched once, lazily: not at startup but on the first "?" or the
# first visit to Training (panel.js _loadHelpLanguage; tests/js/help_lazy.mjs),
# and only for a shipped language.
_HELP_BUDGET = 432 * 1024   # was 400 KiB; 2026-11-13: French reached it after four help rounds, and cutting more sentences costs clarity; 416 KiB until 2026-11-21 (French 417 KiB with the plain problems, Setup's phone step and the docs fixes)
_HELP = _WWW / "help_content.js"
_SHIPPED = ("nl", "de", "fr")


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


def _names(s: str) -> set[str]:
    """The product and edition names in a string: PadSpan, PadSpan™, PadSpan Pro, PadSpan HA ..."""
    return set(re.findall(r"PadSpan™?(?: (?:HA|Bright|Pro)\b)*", s))


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
        if ("PadSpan" in val or "Bright" in val) and (_names(val) != _names(key) or ("Bright" in val) != ("Bright" in key)):
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
    # Measured with LF line endings: a Windows checkout stores CRLF, which would
    # make the same file look bigger than it is in git and in the release zip.
    # The product's name is not counted: the Bright build renames it (three
    # times, a longer name), which would make the same file bigger there.
    data = _HELPER.read_bytes().replace(b"\r\n", b"\n")
    product = re.search(rb'export const PRODUCT = "([^"]+)";', data).group(1)
    size = len(data) - data.count(product) * len(product)
    assert size <= _HELPER_BUDGET, f"views/i18n.js is {size} bytes"


def test_language_files_fit_the_budget_and_the_code() -> None:
    catalog = _catalog()
    problems: list[str] = []
    for p in _language_files():
        rel = str(p.relative_to(_WWW))
        budget = _HELP_BUDGET if p.name == "help.json" else _GROUP_BUDGET
        if p.stat().st_size > budget:
            problems.append(f"{rel}: {p.stat().st_size} bytes, over {budget}")
        if p.name == "server.json":
            continue   # the backend's sentences: test_the_server_group_is_the_backends_sentences
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


# ── Phase 1: the help in nl / de / fr ────────────────────────────────────────

def _help_keys() -> tuple[set[str], set[str]]:
    """Every t() string in help_content.js, and settings_tiers' (the editions
    page). That page was left English at first; it is translated now, with
    PadSpan HA, PadSpan Bright, PadSpan Pro and PadSpan Bright Pro written
    as the English writes them, like every other sentence."""
    src = _HELP.read_text(encoding="utf-8")
    keys = {_unjs(m.group(1)) for m in _T_RE.finditer(src)}
    a = src.index("  settings_tiers: {")
    tiers = {_unjs(m.group(1)) for m in _T_RE.finditer(src[a: src.index("\n  },", a)])}
    return keys, tiers


@pytest.fixture(scope="module")
def help_harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "help_i18n.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the help harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_the_help_in_english_is_unchanged_and_each_language_loads(help_harness) -> None:
    """English built through t() equals the help with the wrappers taken off;
    nl/de/fr follow hass and the per-browser choice; anything else fetches
    nothing (tests/js/help_i18n.mjs)."""
    assert not help_harness["failures"], json.dumps(help_harness["failures"][:6], indent=2, ensure_ascii=False)
    assert len(help_harness["cases"]) >= 25
    assert set(help_harness["samples"]) == set(_SHIPPED)


def test_the_shipped_languages_are_nl_de_fr() -> None:
    m = re.search(r"export const LANGUAGES = Object\.freeze\(\[([^\]]*)\]\);", _HELPER.read_text(encoding="utf-8"))
    assert m and tuple(re.findall(r'"([a-z]{2,3})"', m.group(1))) == _SHIPPED


def test_each_help_translation_covers_the_help_and_copies_no_english() -> None:
    keys, tiers = _help_keys()
    assert len(keys) >= 340 and tiers
    for lang in _SHIPPED:
        data = json.loads((_LANG_DIR / lang / "help.json").read_text(encoding="utf-8"))
        assert set(data) == keys, (lang, sorted(keys - set(data))[:3], sorted(set(data) - keys)[:3])
        copies = [k for k, v in data.items() if v.strip() == k.strip()]
        assert not copies, (lang, copies[:3])
        for k, v in data.items():
            assert v.startswith(" ") == k.startswith(" "), (lang, k)   # the indented AUTOMORPH sub-controls
            # Product and edition names as the English writes them (PadSpan,
            # PadSpan™, PadSpan Pro), never {product}: that is "PadSpan HA".
            assert _names(v) == _names(k) and "{product}" not in v, (lang, k)


def test_the_panel_loads_the_help_language_and_keeps_english_as_imported() -> None:
    src = (_WWW / "panel.js").read_text(encoding="utf-8")
    help_src = _HELP.read_text(encoding="utf-8")
    # One module instance: help_content.js asks with its own ?b=, which is panel's BUILD_ID.
    assert "_i18nPromise = import(`./views/i18n.js?b=${BUILD_ID}`)" in src
    # and if the helper fails to load, the help is still the English.
    assert "await import(`./views/i18n.js${new URL(import.meta.url).search}`)\n" in help_src
    assert '.catch(() => ({ t: (s) => s, currentLanguage: () => "en" }));' in help_src
    assert "export const HELP = helpTexts();" in help_src
    assert 'I18N.useLanguage(this._hass, ["help"])' in src
    assert 'HELP = got === "en" ? HELP_MOD.HELP : HELP_MOD.helpTexts();' in src
    # English: helpNote() is "", so the modal gets nothing new.
    assert "if(note){" in src and 'return currentLanguage() === "en" ? ""' in help_src


def test_the_translated_help_is_fetched_on_first_need_not_at_startup() -> None:
    """help.json (~340 KB) is not fetched when the panel loads, only on the
    first "?" (its modal opens at once with a loading line, filled in when the
    translation arrives or in English after 2 s; a late translation replaces
    that English while the same help is open, followed to a language changed
    meanwhile; a failed load is tried again by a "?" a minute later; a "?"
    before help_content.js is in waits for it) or the first visit to
    Training; English fetches nothing (tests/js/help_lazy.mjs)."""
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "help_lazy.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, res.stderr[-3000:]
    out = json.loads(lines[-1])
    assert not out["failures"] and len(out["cases"]) == 20, out["failures"]


def test_the_training_manual_opens_with_the_note_only_when_translated() -> None:
    """Quick Start and Full Manual mix English section names with translated
    help paragraphs: the help modal's note once at the top, nothing in English
    (tests/js/training_help_note.mjs renders views/training.js for real)."""
    src = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert 'helpNote: () => (HELP_MOD && HELP_MOD.helpNote ? HELP_MOD.helpNote() : ""),' in src
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "training_help_note.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, res.stderr[-3000:]
    out = json.loads(lines[-1])
    assert not out["failures"] and len(out["cases"]) == 7, out["failures"]


# ── The panel's own words: group "panel", i18n/<lang>/panel.json (2026-11-21) ──
# Every file but the help that imports the helper asks for its words through
# t()/tn(); phase 1 is the first-run screens (the sample-house banner and the
# Data switch, Getting started, Setup, Track your phone, the accuracy tips).
# scripts/i18n_coverage.py prints how many keys each language has.

def _coverage():
    import importlib.util
    script = _ROOT / "scripts" / "i18n_coverage.py"
    if not script.is_file():
        pytest.skip("no scripts/i18n_coverage.py in this tree (the Bright derivation carries none)")
    spec = importlib.util.spec_from_file_location("i18n_coverage", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_every_t_call_names_its_english() -> None:
    """A key the extractor can't read is a key no translation can reach: every
    t( and tn( call in a file that imports the helper starts with the English
    as a plain string literal (not a variable, a template or a ternary)."""
    cov = _coverage()
    call = re.compile(r"(?<![\w.$])(tn?)\(")
    bad: list[str] = []
    for files in cov.group_files().values():
        for p in files:
            src = p.read_text(encoding="utf-8")
            ok = {m.start() for m in _T_RE.finditer(src)} | {m.start() for m in _TN_RE.finditer(src)}
            for m in call.finditer(src):
                before = src[max(0, m.start() - 9):m.start()]
                line_start = src[src.rfind("\n", 0, m.start()) + 1:m.start()]
                comment = "//" in line_start or line_start.lstrip().startswith(("*", "/*"))
                if before.endswith("function ") or comment or m.start() in ok:
                    continue
                line = src.count("\n", 0, m.start()) + 1
                bad.append(f"{p.relative_to(_WWW)}:{line}: {src[m.start():m.start() + 60]!r}")
    assert not bad, "\n".join(bad[:20])


def test_traceback_writes_no_english_past_t() -> None:
    """Traceback's empty map said "No traceback frames loaded" in English
    with German loaded: a sentence written straight into the page never
    reaches the translation. With every t()/tn() call taken out, no English
    words are left in the text, a title, a placeholder or a button label."""
    src = (_WWW / "views" / "traceback.js").read_text(encoding="utf-8")
    rest = _TN_RE.sub("", _T_RE.sub("", src))
    rest = "\n".join(ln for ln in rest.splitlines() if not ln.lstrip().startswith(("//", "*", "console.")))
    for gone in ("No traceback frames loaded", "Failed to load traceback data", "No beacon activity",
                 "No beacon or house activity", "Loading house history", "Switched by Vacation Mode",
                 '"Insights"', '"Busy Times"', '"5 min"', '"15 min"', '"30 min"'):
        assert gone not in rest, gone
    bare = [
        r'(?:textContent|placeholder)\s*=\s*"[^"]*[A-Za-z]{2}',   # a label or placeholder set to a literal
        r'\blabel\s*:\s*"[^"]*[A-Za-z]{2}',                       # a preset button's label
        r'title="[A-Za-z][a-z]+ [a-z]',                           # a tooltip in markup
        r'>[A-Z][a-z]+ [a-z]+[^<$]*</',                           # a sentence between tags
        r'\$\{[^{}]*\?\s*"[A-Z][a-z]+ [a-z]',                      # a sentence picked by a ternary in a template
    ]
    found = [(p, m.group(0)) for p in bare for m in re.finditer(p, rest)]
    assert not found, found[:10]
    # And German has each of them (the traceback group is complete in German).
    de = json.loads((_LANG_DIR / "de" / "traceback.json").read_text(encoding="utf-8"))
    assert de["No traceback frames loaded. Select a time range and press Play."].startswith("Keine Traceback-Frames")


_PANEL_GROUPS =("panel", "setup", "mapping", "stack", "plans", "calibration", "beacon", "screens", "health", "devices", "bluetooth", "settings", "tracking", "tracking2", "features", "ai", "atlas", "manage", "manage2", "training", "training2", "training3", "rooms", "traceback", "atlas1", "atlasmap", "atlasmap2", "aboard", "aboard2", "furnish", "furnish2", "furniture", "tips", "server")
# German first (2026-11-23): these groups are complete in German only. Their nl/fr files exist (an empty map, so the
# panel's one request per group still answers and the screen stays English there) and hold no key the code does not
# ask for; they need not be complete until French and Dutch are translated. Take a group out of this list then.
_GERMAN_FIRST = ("rooms", "traceback", "atlas1", "atlasmap", "atlasmap2", "aboard", "aboard2", "furnish", "furnish2", "furniture", "tips")


def _check_group(cov, group: str, keys: dict) -> None:
    """i18n/<lang>/<group>.json holds exactly the group's keys (none the code
    no longer asks for), each language has every one (as the help does), and
    no value is the English copied."""
    figures = cov.coverage()[group]
    assert set(figures) == set(_SHIPPED)
    for lang in _SHIPPED:
        data = json.loads((_LANG_DIR / lang / f"{group}.json").read_text(encoding="utf-8"))
        extra = sorted(set(data) - set(keys))
        assert not extra, (lang, group, "not asked for", extra[:5])
        if group in _GERMAN_FIRST and lang != "de":
            continue
        assert not figures[lang]["missing"], (lang, "still English: add it to i18n/%s/%s.json" % (lang, group), figures[lang]["missing"][:5])
        assert figures[lang]["translated"] == figures[lang]["keys"] == len(keys)
        # Product and edition names as the English writes them; a word that is
        # the same in both languages ("Live", "Setup", "OK") is fine, a sentence copied is not.
        copies = [k for k, v in data.items() if isinstance(v, str) and v == k and len(k.split()) > 3]
        assert not copies, (lang, group, copies[:3])
        for k, v in data.items():
            for s in (v.values() if isinstance(v, dict) else [v]):
                assert _names(s) == _names(k) and "{product}" not in s, (lang, k)


def test_each_panel_group_is_its_screens_words_and_fully_translated() -> None:
    """Every group but the help and server: the t()/tn() keys of its files
    (scripts/i18n_coverage.py GROUPS; panel is panel.js and the rest)."""
    cov = _coverage()
    files = cov.group_files()
    assert set(files) == {"help"} | set(_PANEL_GROUPS) - {"server"}
    # Mapping's words left setup for their own group in phase 3 (maps.js with them).
    assert len(cov.keys_in(files["panel"])) >= 30 and len(cov.keys_in(files["setup"])) >= 120
    assert len(cov.keys_in(files["mapping"])) >= 150
    for group in _PANEL_GROUPS:
        if group != "server":
            _check_group(cov, group, cov.keys_in(files[group]))


def test_the_server_group_is_the_backends_sentences() -> None:
    """i18n/<lang>/server.json: the sentences the backend sends whole (every
    send_error message and System Critics' words that are one literal), so
    the panel can show them in its language by their exact English
    (views/ui_error.js serverText). A sentence the backend no longer sends is
    an orphan; one it sends now is translated in each language."""
    cov = _coverage()
    keys = cov.server_sentences()
    assert len(keys) >= 150, len(keys)
    assert "Only an admin can change this while Enhanced security is on" in keys
    assert any(k.startswith("PadSpan hasn't finished loading.") for k in keys)   # NOT_LOADED_MESSAGE, by name
    _check_group(cov, "server", keys)
    # One mechanism: errorText and Health's System Critics both look them up through serverText,
    # by the template a sentence with a name in it came with (a refusal's translation_key, a critic's
    # title_key / message_key / action_key), else by its exact English.
    ui = (_WWW / "views" / "ui_error.js").read_text(encoding="utf-8")
    assert "return serverText(msg, e.translation_key, e.translation_placeholders) || ERROR_WORDS.other;" in ui
    assert "export function serverText(s, key, args)" in ui
    health = (_WWW / "views" / "health.js").read_text(encoding="utf-8")
    for field in ("title", "message", "action"):
        assert f"_escHtml(serverText(critic.{field}, critic.{field}_key, critic.args))" in health, field
    templates = {k for k in keys if _PH_RE.search(k)}
    assert len(templates) >= 20, len(templates)
    for lang in _SHIPPED:
        data = json.loads((_LANG_DIR / lang / "server.json").read_text(encoding="utf-8"))
        assert not _problems(f"{lang}/server.json", data, {k: set(_PH_RE.findall(k)) for k in keys})
        # A template's translation puts in every value the English does: a name left out is a name lost.
        lost = [k for k in templates if k in data and set(_PH_RE.findall(data[k])) != set(_PH_RE.findall(k))]
        assert not lost, (lang, lost[:5])


def test_the_panel_loads_its_words_at_startup_and_on_a_language_change() -> None:
    src = (_WWW / "panel.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    # One module instance with the views' (?b=BUILD_ID), English until it is in.
    assert "_i18nPromise.then(m => { _I18N = m; });" in src
    assert "function t(text, vars){ return _I18N ? _I18N.t(text, vars) : _enFill(text, vars); }" in src
    # Set-hass asks once per HA language, outside the lines help_lazy.mjs lifts (the help stays lazy).
    hass_lines = src[src.index("    const langSeen = hass ?"):src.index("\n    if(this.state?.settings?.theme_follow_sun")]
    assert "_loadPanelLanguage" not in hass_lines
    assert "if(hass && langSeen !== this._panelLangSeen){ this._panelLangSeen = langSeen; this._loadPanelLanguage(); }" in src
    # Every group but the help, at once: no screen waits for its words.
    asked = "m.useLanguage(this._hass, [" + ", ".join(f'"{g}"' for g in _PANEL_GROUPS) + "])"
    assert asked in src
    if (_ROOT / "scripts" / "i18n_coverage.py").is_file():
        assert set(_coverage().group_keys()) == {"help"} | set(_PANEL_GROUPS)
    # The help's failed-load retry asks about help.json itself, not "any group".
    assert 'if(got !== "en" && I18N && I18N.loaded && !I18N.loaded("help")) got = "en";' in src


def test_the_coverage_script_counts_every_group() -> None:
    cov = _coverage().coverage()
    assert set(cov) == {"help"} | set(_PANEL_GROUPS)
    for group in cov.values():
        for c in group.values():
            assert c["keys"] > 0 and 0 <= c["translated"] <= c["keys"] and len(c["missing"]) == c["keys"] - c["translated"]
