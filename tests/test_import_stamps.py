# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Every panel module is asked for under ONE address: `file.js?b=<stamp>`.

The stamp (docs/06_UI_CACHE_BUSTING.md) is what makes a browser fetch a file
again after an update. Two things go wrong when an import is written another
way, and neither looks like a caching problem:

- An import with no stamp is kept by the browser, so an updated install goes on
  running the old file. A static `import … from "./x.js"` can never carry one.
- A module is one copy per ADDRESS, not per file. `x.js` and `x.js?b=1` are two
  modules, each with its own state. One file asked for both ways is downloaded
  twice and runs twice.

So there is one way to write an import, by where the file sits:

- panel.js and lights_panel.js are loaded by Home Assistant with more than the
  stamp in their address (`?v=…&b=…`). They pass on the `b` alone:
  `?b=${BUILD_ID}` in panel.js, `${STAMP}` in lights_panel.js.
- Every other module was itself loaded with `?b=<stamp>` and passes its own
  query on: `${new URL(import.meta.url).search}`, written out or held in one
  constant of the file.

lib/ (Preact, as published) and vendor/ are third-party builds: what they
import among themselves is theirs. What imports THEM is held to the rule.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_OWN = "new URL(import.meta.url).search"
_FILES = sorted(p for p in _WWW.rglob("*.js")
                if "vendor" not in p.relative_to(_WWW).parts and "lib" not in p.relative_to(_WWW).parts)
_IDS = [p.relative_to(_WWW).as_posix() for p in _FILES]

# A statement, not prose: `import "x"`, `import a, { b } from "x"`, `export { a } from "x"`, `export * from "x"`.
_STATIC = re.compile(r"""^[ \t]*(?:import\s*(?:[\w$*{},\s]+?\s*from\s*)?|export\s*(?:\*|\{[^}]*\})\s*from\s*)["'][^"'\n]+["']""", re.M)
_DYNAMIC = re.compile(r"(?<![\w.$])import\s*\(")


def _static_imports(src: str) -> list[str]:
    return [m.group(0).strip() for m in _STATIC.finditer(src)]


def _dynamic_imports(src: str) -> list[str]:
    """The argument of every `import(…)` in code (comment lines and trailing comments skipped)."""
    out = []
    for m in _DYNAMIC.finditer(src):
        before = src[src.rfind("\n", 0, m.start()) + 1:m.start()]
        if before.lstrip().startswith(("//", "*", "/*")) or re.search(r"(?<!:)//", before):
            continue
        i, depth = m.end(), 1
        while i < len(src) and depth:
            depth += (src[i] == "(") - (src[i] == ")")
            i += 1
        out.append(src[m.end():i - 1].strip())
    return out


def _badly_stamped(name: str, src: str) -> list[str]:
    """The dynamic imports in `src` that do not pass the stamp on the way `name` must."""
    if name == "panel.js":
        ok = lambda arg: "?b=${BUILD_ID}" in arg  # noqa: E731
    elif name == "lights_panel.js":
        ok = lambda arg: arg.endswith(".js${STAMP}`")  # noqa: E731
    else:
        held = set(re.findall(r"\bconst\s+([\w$]+)\s*=\s*" + re.escape(_OWN) + r"\s*;", src))
        ok = lambda arg: ("${" + _OWN + "}" in arg  # noqa: E731
                          or any(arg.endswith(".js${" + n + "}`") for n in held))
    return [arg for arg in _dynamic_imports(src) if not ok(arg)]


# The one import that takes its stamp from the module that loaded it: the
# Furnish tool's flows, handed live_aboard.js's own query as `base`.
_HANDED_DOWN = {"views/live_aboard_furnish.js": ["`./${file}${base}`"]}


@pytest.mark.parametrize("path", _FILES, ids=_IDS)
def test_every_import_carries_the_stamp(path: Path) -> None:
    name = path.relative_to(_WWW).as_posix()
    src = path.read_text(encoding="utf-8")
    assert _static_imports(src) == [], (
        f"{name} has a static import, which cannot carry the ?b= stamp: write "
        "const { x } = await import(`./file.js${" + _OWN + "}`);")
    assert _badly_stamped(name, src) == _HANDED_DOWN.get(name, []), (
        f"{name} imports a module without passing the stamp on the one way this file must (see this test's header)")


def test_the_two_pages_pass_on_the_b_of_their_own_address_and_nothing_else() -> None:
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert 'return new URL(import.meta.url).searchParams.get("b") || RELEASE_BUILD_ID;' in panel
    atlas = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert 'const STAMP = ((b) => (b ? `?b=${b}` : ""))(new URL(import.meta.url).searchParams.get("b"));' in atlas
    # Their own query has ?v= in it (panel.py): passed on whole, every file below would get a second address.
    assert "${" + _OWN + "}" not in panel and "${" + _OWN + "}" not in atlas
    # The Furnish flows' stamp is the 3D view's own query.
    assert "base: new URL(import.meta.url).search," in (_WWW / "views" / "live_aboard.js").read_text(encoding="utf-8")
    assert "const base = ctx.base || \"\";" in (_WWW / "views" / "live_aboard_furnish.js").read_text(encoding="utf-8")


def test_the_walk_reads_real_imports() -> None:
    """The check is not passing because it finds nothing."""
    found = sum(len(_dynamic_imports(p.read_text(encoding="utf-8"))) for p in _FILES)
    assert found > 250, found


@pytest.mark.parametrize("name, line", [
    ("views/calibration.js", 'import { attachPanZoom } from "./pan_zoom.js";'),
    ("views/stack_transform.js", 'export { bestCircleWall,\n         roomEdgeForCircle } from "./wall_geom.js";'),
    ("views/purelive.js", 'import "../lib/preact-bundle.js";'),
])
def test_a_static_import_is_caught(name: str, line: str) -> None:
    assert _static_imports("const a = 1;\n" + line + "\n") != [], name


@pytest.mark.parametrize("name, line", [
    ("views/overview.js", 'import("./radio_map.js?b=" + (ctx.state.buildId || "")).then(use);'),   # another stamp
    ("views/overview.js", 'const M = await import("./radio_map.js");'),                              # no stamp
    ("views/overview.js", "const M = await import(`./radio_map.js${q}`);"),                          # q is not this file's query
    ("panel.js", "const M = await import(`./views/room_color.js${new URL(import.meta.url).search}`);"),
    ("lights_panel.js", "const M = await import(`./views/light_codes.js${new URL(import.meta.url).search}`);"),
])
def test_an_import_stamped_another_way_is_caught(name: str, line: str) -> None:
    assert _badly_stamped(name, "const q = somethingElse;\n" + line + "\n") != [], line


def test_the_accepted_spellings_pass() -> None:
    own = "const A = await import(`./a.js${new URL(import.meta.url).search}`);\n"
    held = "const _q = new URL(import.meta.url).search;\nconst B = await import(`./b.js${_q}`).catch(() => null);\n"
    assert _badly_stamped("views/x.js", own + held + "// import('./c.js') in a comment\n") == []
    assert _badly_stamped("panel.js", "import(`${path}?b=${BUILD_ID}`).then(use);\n") == []
    assert _badly_stamped("lights_panel.js", "import(`./views/ui_error.js${STAMP}`);\n") == []
