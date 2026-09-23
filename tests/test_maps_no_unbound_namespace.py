"""maps.js must never reference a module namespace it does not bind.

Found live 2026-09-23 during the head-to-toe 2D map review: Atlas threw
``Uncaught ReferenceError: LM is not defined`` from a ResizeObserver
callback on every resize. maps.js imports lights_map.js by DESTRUCTURING
(``const { layoutTierFor, ... } = await import(...)``) — there is no ``LM``
binding — but the layout v2 column switch (commit c8b3fcb3, 2026-09-21)
was written as ``LM.layoutTierFor(w)``, the spelling the test files and
lights_panel.js use. No test ran that callback, so the two/three-column
Atlas layout silently never engaged for two days.

The unit test below is a static guard: any ``LM.`` (or other bare
``<Name>.``-style namespace call that is not actually bound) in maps.js is
a bug of this exact class. It also checks the same for the other views
that import lights_map by destructuring.
"""

from __future__ import annotations

import re
from pathlib import Path

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"


def _bound_names(src: str) -> set[str]:
    """Every identifier the module binds at top level: const/let/var/function/class/import."""
    names: set[str] = set()
    for m in re.finditer(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=", src):
        names.add(m.group(1))
    for m in re.finditer(r"\b(?:const|let|var)\s*\{([^}]*)\}\s*=", src, re.S):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            names.add(part.split(":")[-1].strip().split("=")[0].strip())
    for m in re.finditer(r"\bfunction\s+([A-Za-z_$][\w$]*)", src):
        names.add(m.group(1))
    for m in re.finditer(r"\bclass\s+([A-Za-z_$][\w$]*)", src):
        names.add(m.group(1))
    for m in re.finditer(r"\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)", src):
        names.add(m.group(1))
    for m in re.finditer(r"\bimport\s+([A-Za-z_$][\w$]*)\s+from", src):
        names.add(m.group(1))
    return names


def _strip_comments(src: str) -> str:
    """Blank out // line comments and /* */ blocks, keeping line numbers intact."""
    src = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), src, flags=re.S)
    return re.sub(r"//[^\n]*", "", src)


def test_maps_js_does_not_call_an_unbound_LM_namespace():
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert "LM" not in _bound_names(src), "if maps.js now binds LM, update this test's intent"
    code = _strip_comments(src)
    hits = [ln for ln, line in enumerate(code.splitlines(), 1) if re.search(r"\bLM\.", line)]
    assert not hits, f"maps.js references the unbound namespace LM. on line(s) {hits} — it destructures lights_map.js, there is no LM"


def test_layout_tier_callback_uses_the_destructured_import():
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert "layoutTierFor" in _bound_names(src)
    assert re.search(r"const tier = layoutTierFor\(w\);", src), "the layout v2 ResizeObserver must call the destructured layoutTierFor"
