# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard: a Look per screen (Views ▾ → Look, by the sun too), and the
rooms by name (the chips along the top, a room's panel beside the house).

tests/js/live_aboard_looks_rooms.mjs runs views/live_aboard_looks.js and
views/live_aboard_rooms.js inside the real 3D view (views/live_aboard.js) and
the shared room sheet (views/lights_map.js) under the DOM shim and a stub GL:
the Look list and its swatches, a pick kept per screen and forgotten with
Same as Settings, Classic and Studio switching without building the house, by
the sun from sun.sun, the Showcase themes only for a tier that has them,
Settings' own still deciding; the chips grouped by floor, a chip showing its
floor and opening its room's panel, one Rooms ▾ on a narrow screen and a
wall; the panel in place of the host's sheet with More devices of the area,
every button there with Undo, the room framed beside it, how it closes, and
the taps that already meant something meaning the same.

The rest is held here: the new helpers are named for the opt-in report's
errors, the host hands the themes over only behind the Showcase gate, and the
help says what a person now sees.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_looks_rooms.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("look:", 7), ("chips:", 3), ("panel:", 4), ("taps:", 1)])
def test_the_harness_covers_each_part(harness, prefix, least) -> None:
    got = {k: v for k, v in harness["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} cases: {sorted(harness['cases'])}"
    bad = [f for f in harness["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)


def test_every_case_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:4], indent=2, ensure_ascii=False)


def test_the_new_helpers_are_named_for_the_report() -> None:
    for name in ("live_aboard_looks", "live_aboard_rooms"):
        assert (_VIEWS / f"{name}.js").exists() and name in T.UI_ERROR_HELPERS, name


def test_the_themes_are_handed_over_only_behind_the_showcase_gate() -> None:
    """The flat Atlas's own gate (lightingUnlocked): below it the host hands no
    themes, so a screen lists none and draws none."""
    lm = _js(_VIEWS / "lights_map.js")
    assert "showcaseThemes: lightingUnlocked(host.tier) ? SHOWCASE_THEMES : null," in lm
    la = _js(_VIEWS / "live_aboard.js")
    assert "p.showcaseThemes && typeof p.showcaseThemes === \"object\" ? p.showcaseThemes : null" in la


def test_the_look_and_the_rooms_ask_nothing_of_home_assistant() -> None:
    """Pure rules and elements: no service call, no websocket, no three.js."""
    for name in ("live_aboard_looks.js", "live_aboard_rooms.js"):
        code = "\n".join(ln for ln in _js(_VIEWS / name).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))
        for word in ("callService", "callWS", "import(", "THREE"):
            assert word not in code, (name, word)


def test_the_help_says_what_a_person_sees() -> None:
    help_en = _js(_WWW / "help_content.js")
    for words in ("Views ▾ → Look", "By the sun", "More devices of the area", "Rooms ▾"):
        assert words in help_en, words
    for lang in ("de", "fr", "nl"):
        tr = json.loads((_WWW / "i18n" / lang / "help.json").read_text(encoding="utf-8"))
        for key in [k for k in _help_sentences(help_en) if "Views ▾ → Look" in k or "More devices of the area" in k]:
            assert key in tr and tr[key].strip(), (lang, key[:60])


def _help_sentences(src: str) -> list[str]:
    return [json.loads(f'"{m}"') for m in re.findall(r't\("((?:[^"\\]|\\.)*)"\)', src)]
