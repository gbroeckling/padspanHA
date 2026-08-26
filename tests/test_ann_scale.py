"""Map annotations must re-scale while the panel is being resized.

Every label, beacon glyph, scanner marker and badge on the 3D map is
counter-scaled by one factor `k` so it reads at a designed size whatever the
map's zoom. `k` was computed once, when the SVG was built, and the only thing
that recomputed it was a full rebuild — gated behind a 4% width change.

So a resize smaller than that never corrected the text at all, and dragging the
panel left it wrong until the threshold tripped and an expensive rebuild
finished. Beacon text and symbols looked too big while scaling.

`_applyAnnScale` re-derives the transforms in place on every resize tick, from
the contract already in the markup (`data-ann` anchors, `data-ann-k` factor) —
the same contract purelive.js uses to counter zoom.

This is resize behaviour: nobody exercises it by hand, and it fails by looking
slightly wrong rather than by throwing. So `tests/js/ann_scale.mjs` RUNS it
against real numbers rather than reading the source.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_OVERVIEW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "overview.js"
_SCRIPT = Path(__file__).parent / "js" / "ann_scale.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def run() -> subprocess.CompletedProcess:
    return subprocess.run(
        [_NODE, str(_SCRIPT), str(_OVERVIEW)],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )


def test_annotations_rescale_to_the_current_width(run) -> None:
    if run.returncode != 0:
        pytest.fail("the annotation re-scale is wrong — labels and beacon glyphs "
                    f"would be the wrong size after a resize:\n{run.stdout}\n{run.stderr[-2000:]}")


def test_the_harness_actually_ran_its_cases(run) -> None:
    m = re.search(r"(\d+) passed, (\d+) failed", run.stdout)
    assert m, f"harness produced no summary:\n{run.stdout}\n{run.stderr[-1500:]}"
    assert int(m.group(1)) >= 12, f"only {m.group(1)} case(s) ran:\n{run.stdout}"


def test_the_resize_observer_rescales_on_every_tick() -> None:
    """The cheap correction must not be behind the rebuild threshold.

    The whole defect was that the ONLY response to a resize was a full rebuild
    past 4%. If `_applyAnnScale()` ever moves inside that `if`, the symptom
    returns exactly as it was and no unit test would notice, because the
    function itself would still be correct.
    """
    src = _OVERVIEW.read_text(encoding="utf-8")
    m = re.search(r"_annRO = new ResizeObserver\(\(\)=>\{(.*?)\n      \}\);", src, re.S)
    assert m, "the annotation ResizeObserver is gone — did the scaling change?"
    body = m.group(1)
    call = body.find("_applyAnnScale()")
    gate = body.find("> 0.04")
    assert call >= 0, "the observer no longer re-scales annotations at all"
    assert gate >= 0, "the rebuild threshold is gone"
    assert call < gate, (
        "_applyAnnScale() is called after/inside the 4% rebuild gate. It must run on "
        "EVERY tick — being behind the gate is precisely the bug: a smaller resize "
        "never corrects the text, and a drag leaves it wrong until the threshold trips.")


def test_the_map_svg_is_never_height_capped_again() -> None:
    """A height cap on the iso svg puts blank bars down the sides.

    Commit 1f31908 (2026-08-17) removed exactly that — "max-height:${vh}px
    capped the rendered width to ~vw px. Removed." — after, in its own words,
    five attempts had failed to fit the drawing any other way. The svg is
    width:100% with a viewBox, so constraining its height makes it letterbox:
    the drawing shrinks to fit the height and is centred, leaving dead space
    left and right, and every annotation is then oversized for the small map
    that remains.

    It was reintroduced on 2026-08-25 while chasing oversized beacon labels,
    and reproduced the identical symptom on the maintainer's screen. The commit
    message was the whole answer and nothing enforced it, so now something does.

    If a height cap is ever genuinely wanted here, delete this test in the same
    commit and say why — do not weaken it.
    """
    src = _OVERVIEW.read_text(encoding="utf-8")
    m = re.search(r"return `<svg viewBox=[^`]*`", src)
    assert m, "the iso svg header is gone — did the renderer change?"
    header = m.group(0)
    assert "max-height" not in header and "maxHeight" not in header, (
        "the iso <svg> carries a height cap. It is width:100% with a viewBox, so this "
        "letterboxes the drawing and puts blank bars down the sides — the exact bug "
        f"commit 1f31908 removed:\n{header[:220]}")

    # ...and not smuggled onto the container either, which has the same effect.
    m2 = re.search(r"isoDiv\.style\.cssText\s*=\s*([^;]+);", src)
    assert m2, "the iso container styling is gone"
    assert "max-height" not in m2.group(1) and "maxHeight" not in m2.group(1), (
        "the iso map container is height-capped, which letterboxes the svg inside it "
        f"just the same:\n{m2.group(1)[:220]}")
