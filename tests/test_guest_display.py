"""Guest tags, the display side: a tag lent to a guest (snapshot o.guest)
is named for the guest on Live Aboard's and the flat Atlas's tag markers,
with its own label kept on the tap card; with no o.guest nothing changes.
Traceback takes a one-shot preset (key + window) from ctx.state."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

_SCRIPT = r"""
const T = await import(process.argv[1]);
const obj = (extra) => ({ key: "AA:BB", kind: "ble", user_label: "Guest tag 1", x_m: 1, y_m: 2,
                          floor_id: "main", room: "Den", age_s: 3, knn_confidence: 0.8, sources: [], ...extra });
const run = (o) => {
  const snapshot = { objects: { list: [o] } };
  const w = T.wantedOf({ model: {}, snapshot, tags: true, people: false }).find(x => x.kind === "beacon");
  return { tracked: T.trackedOf(snapshot)[0], want: { name: w.name, guest: w.guest, title: w.card.title, lines: w.card.lines } };
};
console.log(JSON.stringify({ plain: run(obj({})), guest: run(obj({ guest: { name: "Anna", session: "s1" } })) }));
"""


@pytest.fixture(scope="module")
def out() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    url = (_VIEWS / "live_aboard_tracked.js").as_uri()
    res = subprocess.run([_NODE, "--input-type=module", "-e", _SCRIPT, url],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr[-2000:]
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_a_plain_tag_is_as_it_was(out) -> None:
    assert "guest" not in out["plain"]["tracked"]
    assert out["plain"]["want"]["name"] == "Guest tag 1"
    assert out["plain"]["want"].get("guest") is None
    assert out["plain"]["want"]["title"] == "Guest tag 1"


def test_a_guest_tag_is_named_for_the_guest_and_keeps_its_label(out) -> None:
    g = out["guest"]
    assert g["tracked"]["guest"] == "Anna"
    assert g["want"]["name"] == "Anna · Guest"
    assert g["want"]["guest"] is True
    assert g["want"]["title"] == "Anna (Guest)"
    assert g["want"]["lines"][0] == "Guest tag: Guest tag 1"


def test_the_traceback_preset_is_used_up_once() -> None:
    src = (_VIEWS / "traceback.js").read_text(encoding="utf-8")
    assert "export function openTracebackFor(ctx, preset)" in src
    assert "delete ctx.state._tracebackPreset;" in src
    assert "tb.filterKey = String(_preset.key);" in src


def test_overview_and_atlas_draw_the_guest_only_when_there_is_one() -> None:
    ov = (_VIEWS / "overview.js").read_text(encoding="utf-8")
    assert "function _guestName(o){ return (o && o.guest && o.guest.name)" in ov
    assert "if(b.guest) s+=" in (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    assert "if (!!w.guest !== !!it.guest)" in (_VIEWS / "atlas_aboard.js").read_text(encoding="utf-8")
