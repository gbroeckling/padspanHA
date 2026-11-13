"""Small fixes from the 2026-11-11/12 reviews whose behaviour has no runnable harness: the wiring is held here.
(The Rooms page's busy button is run in tests/js/rooms_page.mjs, the 3D card's Escape in tests/js/live_aboard_use.mjs.)"""
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"


def test_the_scale_bar_is_an_ordinary_row_on_a_phone() -> None:
    # Held at the bottom of a 390 px screen it lay over the picture, where the two ends are tapped.
    sn = (_VIEWS / "scale_nudge.js").read_text(encoding="utf-8")
    assert 'const stacked = typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches;' in sn
    assert 'style: stacked ? PM.STICKY_BAR.replace("position:sticky;bottom:0;", "") : PM.STICKY_BAR' in sn
    # The replace must still find its words in the bar's style.
    assert 'export const STICKY_BAR = "position:sticky;bottom:0;' in (_VIEWS / "plan_measure.js").read_text(encoding="utf-8")


def test_the_atlas_header_tip_follows_the_tick_as_it_is_pressed() -> None:
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert 'if (key === "light_taps") { if (typeof host.onShowLine === "function") host.onShowLine(key); return; }' in lm
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert "onShowLine: ()=>{ if(this._tipEl) this._tipEl.textContent = this._tipText(); }," in lp
    assert '(this._tipEl = el("span",{class:"lv-hint"},this._tipText())),' in lp


def test_the_builder_guide_is_seen_once_it_has_opened_itself() -> None:
    maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    auto = maps[maps.index("if (!ctx.state._lightsTour && !ctx.state._lightsTourAutoChecked) {"):]
    auto = auto[:auto.index("if (!paid) {")]
    assert auto.index("ctx.state._lightsTour = { step: 1 };") < auto.index('localStorage.setItem("padspan_ha_lights_tour_seen", "1")')


def test_one_receiver_is_not_receivers() -> None:
    assert '(${sc} receiver${sc === 1 ? "" : "s"})</title>' in (_VIEWS / "calibration.js").read_text(encoding="utf-8")
    tr = (_VIEWS / "training.js").read_text(encoding="utf-8")
    assert ">Radios</text>" not in tr and "Edit → Radios" not in tr
