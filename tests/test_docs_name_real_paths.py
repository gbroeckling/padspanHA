# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What users read names only the Settings tabs and Mapping tabs the panel has,
and gives Home Assistant's minimum as hacs.json does.

The Settings tab "Presence" became "Tracking" in 0.38.202 (2026-10-30), and the
wall-screens card moved from UI Structure to the new Atlas tab the same day.
Three weeks later seven site guides, the home page, a docs guide and the
0.38.274 release note still sent people to "Settings → Presence", the
wall-screens guide to "Settings → UI Structure", and the user guides to
"Mapping → Rooms" (now Layout) and "Mapping → Atlas" (now Atlas builder): the
panel was renamed and the words around it were not (docs audit, 2026-11-21).

The real labels are read from the panel's own code, never typed here:
  * Settings tabs: views/settings.js `_tabDefs`
  * Tracking's sections: views/settings.js `PRESENCE_SECTIONS`
  * what each tab shows: the text in its own code (the function `_tabBody` draws
    it with, the settings.js functions that one calls, and the modules they use)
  * Basic mode's Settings buttons: the `data-settings-open` buttons
  * Mapping's tabs: views/maps.js `tabDefs`, plus Furnish
  * Home Assistant's minimum: hacs.json

What it reads (user-facing only; the internal design notes in docs/ are not read):
  * README.md and SECURITY.md
  * the user guides in docs/ (USER_DOCS below) and every chapter of the manual, docs/manual/*.md
  * site/index.html outside its release history, every site guide and its de/ twin
  * the in-panel help: help_content.js and i18n/{de,fr,nl}/help.json
  * the release notes waiting in changelog.d/, and CHANGELOG.md's sections from
    0.38.202 on (the Settings rules only: older sections were right when written,
    and the site's release history is built from these)

The rules:
  1. "Settings → X": X is a Settings tab, a Basic-mode Settings button, or a page
     of Home Assistant's (or the phone's) own Settings (HA_PAGES).
  2. "Settings → <tab> → X": X is on that tab (for Tracking, also one of its
     sections). This is what a moved card breaks: "Settings → UI Structure →
     Wall screens" names a real tab, but the card is on Atlas.
  3. "Mapping → X": X is a Mapping tab.
  4. A lower bound on Home Assistant ("2024.8 or newer", "HA 2024.8+") is never
     below hacs.json's, "PadSpan … needs/runs on …" names exactly it, and the
     README, GETTING_STARTED and MINIMUM_REQUIREMENTS each state it.

In German (0.38.277 put most of the panel's own words into German; the German
site guides and the German manual name them as the German panel shows them):
the German names are read from i18n/de/*.json (English → German, every group
the panel loads), never typed here. In the German guides and docs/manual/de:
  5. "Einstellungen → X": X is a Settings tab or Basic-mode button as the German
     panel names it, or a page of Home Assistant's (or the phone's) own Settings,
     in German (HA_PAGES_DE) or English (HA_PAGES).
  6. "Einstellungen → <tab> → X": X is on that tab, in German or, where the tab
     still shows English (the wall screens card), in English.
  7. "Karten → X": X is a Mapping tab as the German panel names it.
  8. The English menu words name only what is still English there: "Settings → X"
     only a page of Home Assistant's or the phone's own (an app's English docs),
     and "Mapping → X" nothing, since the German menu says Einstellungen and Karten.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
SETTINGS_JS = WWW / "views" / "settings.js"
MAPS_JS = WWW / "views" / "maps.js"

USER_DOCS = (
    "GETTING_STARTED", "FLOOR_PLAN_SETUP", "ATLAS_GUIDE", "LIVE_ABOARD_GUIDE", "FURNISH_GUIDE",
    "WALL_SCREEN_GUIDE", "WALLS_GUIDE", "GUEST_TAGS_GUIDE", "MINIMUM_REQUIREMENTS", "PADSPAN_PRO",
    "BENCHMARK", "HOW_PADSPAN_IS_BUILT", "08_RSSI_VECTOR_CAPTURE", "02_WEBSOCKET_API",
)
# Pages of Home Assistant's own Settings (and of the phone's, for the Companion
# app and pairing), which the guides send people to as well.
HA_PAGES = (
    "Marketplace", "Devices & services", "Devices &amp; services", "Devices & Services", "Devices &amp; Services",
    "System", "Repairs", "Areas, labels & zones", "Areas, labels &amp; zones", "People", "Voice assistants",
    "Automations & scenes", "Automations &amp; scenes", "Tools", "Companion App", "Companion app", "Bluetooth",
    "Tags", "About", "Updates",   # Settings → Updates: Home Assistant 2026.11's page for updates
)
# The same pages as Home Assistant names them in German.
HA_PAGES_DE = (
    "Geräte & Dienste", "Geräte &amp; Dienste", "Bereiche, Labels & Zonen", "Bereiche, Labels &amp; Zonen",
    "Personen", "Automationen & Szenen", "Automationen &amp; Szenen", "Reparaturen", "Werkzeuge", "Info",
)
# The release note that announced the rename names the old tab on purpose.
RENAME_NOTE = re.compile(r"Presence is (?:now )?Settings")
# Where CHANGELOG's sections start being checked: the tabs were renamed in 0.38.202.
FIRST_CHECKED = (0, 38, 202)

ARROW = r"\s*(?:→|&rarr;)\s*"
SETTINGS_PATH = re.compile(r"\bSettings" + ARROW)
MAPPING_PATH = re.compile(r"\bMapping" + ARROW)
SETTINGS_PATH_DE = re.compile(r"\bEinstellungen" + ARROW)
MAPPING_PATH_DE = re.compile(r"\bKarten" + ARROW)
# Quotes, bold and a link may sit round a label.
_LEAD = re.compile(r'^(?:[\s "“„«*]|<b>|<a [^>]*>)+')

pytestmark = pytest.mark.skipif(not (ROOT / "docs").is_dir() or not (ROOT / "site").is_dir(),
                                reason="the Bright derivation carries no docs/ or site/")


# ── the panel's own labels ──────────────────────────────────────────────────

def _js_strings(src: str) -> list[str]:
    out = []
    for s in re.findall(r'"((?:[^"\\\n]|\\.)*)"', src):
        try:
            out.append(json.loads('"' + s + '"'))
        except ValueError:
            out.append(s)
    return out


@lru_cache(maxsize=None)
def _settings_src() -> str:
    return SETTINGS_JS.read_text(encoding="utf-8")


def _tab_defs() -> list[tuple[str, str]]:
    src = _settings_src()
    block = src[src.index("const _tabDefs = ["):]
    block = block[:block.index("\n  ];")]
    return re.findall(r'^\s*\["([a-z]+)",\s*(?:t\()?"([^"]+)"\)?,', block, re.M)   # the English, in t() or not


def _settings_tabs() -> list[str]:
    return [label for _, label in _tab_defs()]


def _tracking_sections() -> list[str]:
    src = _settings_src()
    block = src[src.index("export const PRESENCE_SECTIONS = ["):]
    block = block[:block.index("];")]
    return re.findall(r'\["[a-z]+",\s*(?:\(\) => t\()?"([^"]+)"\)?\]', block)   # the English, in a t() getter or not


def _basic_buttons(german: bool = False) -> list[str]:
    found = re.findall(r'"data-settings-open":"[a-z_]+"[^}]*\}\s*,\s*(?:t\()?"([^"]+)"', _settings_src())
    return [(_german(b) if german else b).rstrip(" →") for b in found]


def _top_functions(src: str) -> dict[str, str]:
    """settings.js's top-level functions by name, each with its text up to the next one."""
    heads = list(re.finditer(r"^(?:export )?(?:async )?function (\w+)\(", src, re.M))
    return {m.group(1): src[m.start():(heads[i + 1].start() if i + 1 < len(heads) else len(src))]
            for i, m in enumerate(heads)}


@lru_cache(maxsize=None)
def _tab_texts() -> dict[str, str]:
    """Each Settings tab's label → every string its code shows: the function _tabBody
    draws it with, the settings.js functions that calls (and so on), and the modules
    they use (wall_card.js for the Atlas tab's Wall screens card, and the like)."""
    src = _settings_src()
    funcs = _top_functions(src)
    body = src[src.index("const _tabBody = (id) =>"):]
    body = body[:body.index(";\n")]
    entry = dict(re.findall(r'id === "(\w+)" \? (\w+)\(', body))
    entry["scannermap"] = re.findall(r":\s*(\w+)\(ctx, el, haFloors\)", body)[-1]
    mods = {}
    for names, path in re.findall(r"^const (\w+|\{[^}]+\}) = await import\(`\./(\w+\.js)", src, re.M):
        for n in re.findall(r"\w+", names):
            mods[n] = (SETTINGS_JS.parent / path).read_text(encoding="utf-8")
    out = {}
    for tab_id, label in _tab_defs():
        seen, todo = set(), [entry[tab_id]]
        while todo:
            f = todo.pop()
            if f in seen or f not in funcs:
                continue
            seen.add(f)
            todo += [g for g in re.findall(r"\b(_\w+)\(", funcs[f]) if g in funcs]
        code = "".join(funcs[f] for f in seen)
        code += "".join(m for n, m in mods.items() if re.search(r"\b" + n + r"\b", code))
        out[label] = "\n".join(_js_strings(code))
    return out


def _mapping_tabs() -> list[str]:
    src = MAPS_JS.read_text(encoding="utf-8")
    line = next(ln for ln in src.splitlines() if ln.strip().startswith(': [["library",t("Library")]'))
    return re.findall(r'\["[a-z0-9]+",t\("([^"]+)"\)\]', line) + ["Furnish"]


def _labels_ok(rest: str, labels) -> bool:
    """`rest` (the text after an arrow) starts with one of `labels`, as a whole label."""
    rest = _LEAD.sub("", rest)
    return any(rest.startswith(lb) and not re.match(r"[\w&]", rest[len(lb):len(lb) + 1]) for lb in labels)


# ── the German panel's labels ───────────────────────────────────────────────

@lru_cache(maxsize=None)
def _de() -> dict[str, str]:
    """The German panel's words, English → German: i18n/de/*.json, every group the
    panel loads (panel.js _loadPanelLanguage: all but the help). A string not there
    shows in English."""
    out = {}
    for p in sorted((WWW / "i18n" / "de").glob("*.json")):
        if p.name != "help.json":
            out.update((k, v) for k, v in json.loads(p.read_text(encoding="utf-8")).items() if isinstance(v, str))
    return out


def _german(english: str) -> str:
    return _de().get(english, english)


def _german_tab_texts() -> dict[str, str]:
    """Each Settings tab's German label → what it shows: its strings in German, and in
    English as well, for a card the German panel still shows in English (Wall screens)."""
    out = {}
    for tab, text in _tab_texts().items():
        lines = text.splitlines() + (_tracking_sections() if tab == "Tracking" else [])
        out[_german(tab)] = "\n".join(lines + [_german(s) for s in lines])
    return out


# ── what users read ─────────────────────────────────────────────────────────

def _strip_release_history(s: str) -> str:
    a = s.index('id="whatsnew"')
    return s[:a] + s[s.index("</section>", a):]


def _help_texts() -> list[tuple[str, str]]:
    out = [("help_content.js", "\n".join(_js_strings((WWW / "help_content.js").read_text(encoding="utf-8"))))]
    for p in sorted((WWW / "i18n").glob("*/help.json")):
        out.append((p.relative_to(ROOT).as_posix(), "\n".join(json.loads(p.read_text(encoding="utf-8")).values())))
    return out


def _recent_changelog() -> str:
    keep = []
    for sec in re.split(r"(?m)^(?=## )", (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")):
        m = re.match(r"## (\d+)\.(\d+)\.(\d+)", sec)
        if m and tuple(map(int, m.groups())) >= FIRST_CHECKED:
            keep.append(sec)
    return "".join(keep)


def _sources(with_changelog: bool) -> list[tuple[str, str]]:
    out = [(n, (ROOT / n).read_text(encoding="utf-8")) for n in ("README.md", "SECURITY.md")]
    out += [(f"docs/{d}.md", (ROOT / "docs" / f"{d}.md").read_text(encoding="utf-8")) for d in USER_DOCS]
    out += [(p.relative_to(ROOT).as_posix(), p.read_text(encoding="utf-8")) for p in sorted((ROOT / "docs" / "manual").glob("*.md"))]
    out.append(("site/index.html", _strip_release_history((ROOT / "site" / "index.html").read_text(encoding="utf-8"))))
    guides = ROOT / "site" / "guides"
    for p in sorted(guides.glob("*/index.html")) + sorted(guides.glob("*/de/index.html")):
        out.append((p.relative_to(ROOT).as_posix(), p.read_text(encoding="utf-8")))
    out += _help_texts()
    for p in sorted((ROOT / "changelog.d").glob("*.md")):
        if p.name != "README.md":
            out.append((p.relative_to(ROOT).as_posix(), p.read_text(encoding="utf-8")))
    if with_changelog:
        out.append(("CHANGELOG.md (0.38.202 on)", _recent_changelog()))
    return out


def _german_sources() -> list[tuple[str, str]]:
    """What German readers read about the panel: every German site guide and every
    chapter of the German manual."""
    paths = sorted((ROOT / "site" / "guides").glob("*/de/index.html")) + sorted((ROOT / "docs" / "manual" / "de").glob("*.md"))
    return [(p.relative_to(ROOT).as_posix(), p.read_text(encoding="utf-8")) for p in paths]


def _where(text: str, i: int) -> str:
    return text[max(0, i - 40):i + 80].replace("\n", " ")


# ── the checks ──────────────────────────────────────────────────────────────

def _bad_settings_tabs(sources) -> list[str]:
    tabs = _settings_tabs() + _basic_buttons() + list(HA_PAGES)
    bad = []
    for name, text in sources:
        for m in SETTINGS_PATH.finditer(text):
            rest = text[m.end():]
            if not _labels_ok(rest, tabs) and not RENAME_NOTE.match(rest):
                bad.append(f"{name}: …{_where(text, m.start())}…")
    return bad


def _starts(text: str, most: int = 6) -> set[str]:
    """The first one to `most` words of every line of `text` (a line is one of the
    tab's strings), leading emoji and marks taken off: what a label can begin with."""
    out = set()
    for line in text.splitlines():
        words = [w.rstrip(",.;:") for w in re.sub(r"^\W+", "", line).split()]
        out.update(" ".join(words[:n]) for n in range(1, min(most, len(words)) + 1))
    return out


def _bad_deeper_settings(sources) -> list[str]:
    texts = dict(_tab_texts())
    texts["Tracking"] += "\n" + "\n".join(_tracking_sections())
    return _not_on_the_tab(sources, "Settings", texts)


def _not_on_the_tab(sources, menu: str, texts: dict[str, str]) -> list[str]:
    """Each "<menu> → <tab> → X" whose X isn't on the tab: `texts` maps each tab's label to what it shows."""
    starts = {tab: _starts(t) for tab, t in texts.items()}
    deeper = re.compile(r"\b" + menu + ARROW + "(" + "|".join(re.escape(t) for t in texts) + ")" + ARROW)
    bad = []
    for name, text in sources:
        for m in deeper.finditer(text):
            # The next part of the path, up to the next arrow or a mark. Prose may run on
            # after it ("… → Performance if Home Assistant …"), so it is on the tab when
            # its first words begin one of the tab's own strings: a card, a section, a
            # switch or a button.
            seg = re.match(r"[^\n<*`\"“”«»(),.;:]*", _LEAD.sub("", text[m.end():])).group(0)
            words = re.sub(r"^\W+", "", re.split(ARROW, seg)[0]).split()
            if words and not any(" ".join(words[:n]) in starts[m.group(1)] for n in range(1, min(6, len(words)) + 1)):
                bad.append(f"{name}: …{_where(text, m.start())}…  ({' '.join(words)!r} is not on {m.group(1)})")
    return bad


def _bad_mapping_tabs(sources) -> list[str]:
    tabs = _mapping_tabs()
    return [f"{name}: …{_where(text, m.start())}…" for name, text in sources
            for m in MAPPING_PATH.finditer(text) if not _labels_ok(text[m.end():], tabs)]


def _bad_german_paths(sources) -> list[str]:
    """Rules 5 to 8: German text names Settings and Mapping as the German panel shows them."""
    tabs = [_german(t) for t in _settings_tabs()] + _basic_buttons(german=True) + list(HA_PAGES_DE) + list(HA_PAGES)
    mapping = [_german(t) for t in _mapping_tabs()]
    checks = (
        (SETTINGS_PATH_DE, tabs, "not a tab of the German panel's Settings"),
        (MAPPING_PATH_DE, mapping, "not a tab of the German panel's Mapping"),
        (SETTINGS_PATH, HA_PAGES, "the German panel's menu says Einstellungen"),
        (MAPPING_PATH, (), "the German panel's menu says Karten"),
    )
    bad = [f"{name}: …{_where(text, m.start())}…  ({why})" for name, text in sources
           for path, labels, why in checks for m in path.finditer(text) if not _labels_ok(text[m.end():], labels)]
    return bad + _not_on_the_tab(sources, "Einstellungen", _german_tab_texts())


def _ha_min() -> tuple[int, int]:
    v = json.loads((ROOT / "hacs.json").read_text(encoding="utf-8"))["homeassistant"]
    return tuple(int(x) for x in v.split(".")[:2])


LOWER_BOUND = re.compile(r"(?:Home Assistant|HA)\W{0,8}(20\d\d)\.(\d{1,2})(?:\.\d+)?\W{0,8}"
                         r"(?:or newer|or later|and newer|and later|\+|oder neuer|und neuer|ou plus récent|of nieuwer)", re.I)
PADSPAN_NEEDS = re.compile(r"PadSpan(?: HA| itself| selbst)?\W{0,3}(?:needs|requires|runs on|läuft ab)\W{0,3}"
                           r"(?:Home Assistant\W{0,3})?(20\d\d)\.(\d{1,2})")


def _bad_ha_minimum(sources) -> list[str]:
    least = _ha_min()
    bad = []
    for name, text in sources:
        for m in LOWER_BOUND.finditer(text):
            if (int(m.group(1)), int(m.group(2))) < least:
                bad.append(f"{name}: …{_where(text, m.start())}…")
        for m in PADSPAN_NEEDS.finditer(text):
            if (int(m.group(1)), int(m.group(2))) != least:
                bad.append(f"{name}: …{_where(text, m.start())}…")
    return bad


# ── the tests ───────────────────────────────────────────────────────────────

def test_the_labels_are_read_from_the_panel() -> None:
    """If the code's shape changes, this says so, rather than every check below passing on nothing."""
    assert "Tracking" in _settings_tabs() and "Atlas" in _settings_tabs() and "Presence" not in _settings_tabs()
    assert "Rooms and timing" in _tracking_sections() and len(_tracking_sections()) == 8
    tabs = _tab_texts()
    assert set(tabs) == set(_settings_tabs())
    assert "Home/Away Timeout" in tabs["Tracking"] and "Low-memory mode" in tabs["Tracking"]
    assert "Wall screens" in tabs["Atlas"] and "Wall screens" not in tabs["UI Structure"]
    assert "PadSpan licence" in tabs["Features"] and "Theme" in tabs["Appearance"]
    assert _basic_buttons() == ["Usage report", "Guest tags"]
    assert {"Library", "Layout", "3D Stack", "Atlas builder"} <= set(_mapping_tabs()) and "Rooms" not in _mapping_tabs()
    names = [n for n, _ in _sources(True)]
    assert "site/guides/get-started/de/index.html" in names and "help_content.js" in names
    assert "docs/manual/README.md" in names and "docs/manual/03-install-update-uninstall.md" in names
    # The German names, read from i18n/de: if a translation goes, the check below says so.
    assert _german("Tracking") == "Ortung" and "Ortung" in _german_tab_texts() and "Leistung" in _german_tab_texts()["Ortung"]
    assert "Gast-Tags" in _basic_buttons(german=True) and {"Aufteilung", "3D-Stapel", "Atlas-Editor"} <= {_german(t) for t in _mapping_tabs()}
    assert "Wall screens" in _german_tab_texts()["Atlas"]   # still English there
    de_names = [n for n, _ in _german_sources()]
    assert "site/guides/get-started/de/index.html" in de_names and "docs/manual/de/README.md" in de_names


def test_every_settings_path_names_a_real_tab() -> None:
    bad = _bad_settings_tabs(_sources(True))
    assert not bad, ("These name a Settings tab the panel doesn't have (its tabs: "
                     f"{', '.join(_settings_tabs())}):\n" + "\n".join(bad))


def test_every_deeper_settings_path_is_on_that_tab() -> None:
    bad = _bad_deeper_settings(_sources(True))
    assert not bad, "These name something in Settings on a tab that doesn't show it:\n" + "\n".join(bad)


def test_every_german_path_names_what_the_german_panel_shows() -> None:
    bad = _bad_german_paths(_german_sources())
    assert not bad, ("These name a Settings or Mapping tab the German panel doesn't show (its Settings tabs: "
                     f"{', '.join(_german(t) for t in _settings_tabs())}; its Mapping tabs: "
                     f"{', '.join(_german(t) for t in _mapping_tabs())}):\n" + "\n".join(bad))


def test_every_mapping_path_names_a_real_tab() -> None:
    bad = _bad_mapping_tabs(_sources(False))
    assert not bad, f"These name a Mapping tab the panel doesn't have (its tabs: {', '.join(_mapping_tabs())}):\n" + "\n".join(bad)


def test_no_document_states_another_home_assistant_minimum() -> None:
    least = _ha_min()
    bad = _bad_ha_minimum(_sources(False))
    assert not bad, f"hacs.json says Home Assistant {least[0]}.{least[1]}; these say otherwise:\n" + "\n".join(bad)
    for doc in ("README.md", "docs/GETTING_STARTED.md", "docs/MINIMUM_REQUIREMENTS.md"):
        text = (ROOT / doc).read_text(encoding="utf-8")
        assert any((int(m.group(1)), int(m.group(2))) == least for m in LOWER_BOUND.finditer(text)), (
            f"{doc} no longer states Home Assistant {least[0]}.{least[1]} as the minimum")


@pytest.mark.parametrize("sentence", [
    "Low-memory mode is in Settings → Presence.",
    "In <b>Settings → UI Structure → 📺 Wall screens</b>, choose Size for my room.",
    "Settings → Phone Tracking → Detailed Setup Guide has the steps.",
    "**Settings → Optimize for scale** (off by default)",
    "Rooms made this way edit in **Mapping → Rooms** like any other.",
    "Open Mapping → Atlas and pick a light.",
    "PadSpan needs Home Assistant 2024.1 or newer.",
])
def test_it_catches_the_drift_it_was_written_for(sentence: str) -> None:
    """Each is a sentence the audit found, or its shape: one of the checks refuses it."""
    src = [("example", sentence)]
    found = _bad_settings_tabs(src) + _bad_deeper_settings(src) + _bad_mapping_tabs(src) + _bad_ha_minimum(src)
    assert found, f"no check caught {sentence!r}"


@pytest.mark.parametrize("sentence", [
    "Schalte unter <b>Einstellungen → Tracking → Leistung</b> den Speichersparmodus ein.",   # the English tab
    "Der Speichersparmodus ist unter Einstellungen → Präsenz.",
    "Wähl in <b>Einstellungen → Atlas → 📺 Wandbildschirme</b> die Option Size for my room.",   # that card is English
    "Einstellungen → Ortung → Wall screens",
    "Räume ohne Bild legst du unter <b>Karten → Räume</b> an.",
    "Die fünf Minuten änderst du unter <b>Settings → Tracking → Rooms and timing</b>.",   # the English menu
    "Öffne <b>Mapping → Aufteilung</b>.",
])
def test_the_german_check_catches_a_wrong_name(sentence: str) -> None:
    assert _bad_german_paths([("example", sentence)]), f"no check caught {sentence!r}"


@pytest.mark.parametrize("sentence", [
    "Schalte unter <b>Einstellungen → Ortung → Leistung</b> den <b>Speichersparmodus</b> ein.",
    "Wähl in <b>Einstellungen → Atlas → 📺 Wall screens</b> die Option Size for my room.",
    "Du kannst Pro unter <b>Einstellungen → Funktionen → PadSpan-Lizenz</b> testen.",
    "Leg sie unter <b>Karten → Aufteilung</b> an und richte sie unter <b>Karten → 3D-Stapel</b> aus.",
    "Prüf unter <b>Einstellungen → Bereiche, Labels &amp; Zonen</b>, ob sein Bereich stimmt.",
    "in der Doku der App, auf Englisch: <b>Settings → Companion app → Manage sensors</b>",
])
def test_the_german_check_passes_a_german_name(sentence: str) -> None:
    assert not _bad_german_paths([("example", sentence)])
