"""Atlas's multi-column layout (layout v2) is gated to Pro specifically.

Garry, 2026-09-23: asked whether the new multi-column Atlas layout should be
gated to Pro licenses, then confirmed: "pro."

The setting itself (settings.atlas_layout_v2) defaults to True for every
install (settings_store.py) — it was shipped on for everyone during its
2026-09-21 trial. Below Pro, the layout must never actually switch to
columns regardless of what's stored, and the "Classic layout"/"New layout"
toggle that lets someone turn it on/off must not appear at all — that
toggle only renders when host.onLayoutV2 is non-null (lights_map.js), so
gating the callback to null below Pro hides the control itself, not just
its effect.

This is a static source check, not a live render — both sites are deep
inside a large ctx-dependent host construction (maps.js's _lightsTab /
lights_panel.js's connectedCallback) that would need a large fixture to
render standalone, the same reason none of the dozens of other paid-tier
gates in maps.js (onPlaceRow, onLinkDoorOpener, etc.) have a dedicated
render test either — they're verified by reading the conditional. This
test exists so the specific "pro, not bright-or-pro" distinction Garry
asked for can't silently regress to the ordinary paid/bright-or-pro gate
everything else on this screen uses.
"""

from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_MAPS = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
_PANEL = (_WWW / "lights_panel.js").read_text(encoding="utf-8")


def test_builder_layoutV2_requires_proTier_not_the_bright_or_pro_gate():
    m = re.search(r"layoutV2:\s*([^\n]+),", _MAPS)
    assert m, "could not find the layoutV2 field in maps.js's Atlas host"
    expr = m.group(1)
    assert "proTier" in expr, f"layoutV2 must be gated on proTier (Pro only): got {expr!r}"
    assert re.search(r"\bpaid\b", expr) is None, f"layoutV2 must not use the bright-or-pro `paid` gate: got {expr!r}"


def test_builder_onLayoutV2_toggle_is_null_below_pro():
    m = re.search(r"onLayoutV2:\s*proTier\s*\?", _MAPS)
    assert m, "onLayoutV2 must be `proTier ? <fn> : null` so the toggle itself disappears below Pro"


def test_sidebar_layoutV2_checks_tier_is_exactly_pro():
    m = re.search(r'layoutV2:\s*([^\n]+),', _PANEL)
    assert m, "could not find the layoutV2 field in lights_panel.js's host"
    expr = m.group(1)
    assert '==="pro"' in expr.replace(" ", "") or "=== 'pro'" in expr, \
        f"sidebar layoutV2 must check tier is exactly 'pro': got {expr!r}"
