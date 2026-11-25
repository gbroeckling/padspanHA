# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Share a replay (views/share_replay.js, views/gif_encoder.js, views/mp4_remux.js), RUN (tests/js/share_replay.mjs).

2026-11-23, the owner: one button in Traceback turns the chosen stretch into a
10 to 30 second clip of people moving through the house, ready to post.
Privacy is the whole feature: names become "Person 1" or initials, device
names are hidden, room names are kept or made generic, no address,
coordinates or plan image leave the browser, and the dialog shows the clip
and what is hidden before saving. MP4 or WebM (whichever the browser's
MediaRecorder makes) or a GIF, wide or vertical, with a "made with PadSpan"
mark that can be switched off. Free on every tier.
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
_SCRIPT = Path(__file__).parent / "js" / "share_replay.mjs"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def run():
    if _NODE is None:
        pytest.skip("node is not installed")
    r = subprocess.run([_NODE, str(_SCRIPT)], capture_output=True, text=True, encoding="utf-8", timeout=180, cwd=str(_ROOT))
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("case", ["initials", "people", "person-labels", "rooms", "hidden", "options", "lead-with-moving",
                                  "draw-private", "mark", "gif", "remux", "dialog", "video", "german"])
def test_share_replay(run, case):
    assert run["cases"].get(case) is True, json.dumps([f for f in run["failures"] if f["name"] == case], indent=1)[:4000]


def _src(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_nothing_leaves_the_browser() -> None:
    """No upload code at all: the clip is made and saved in the browser. The
    only call out is the opt-in report's count, through the panel's own."""
    for rel in ("views/share_replay.js", "views/gif_encoder.js", "views/mp4_remux.js"):
        code = "\n".join(line for line in _src(rel).split("\n") if not line.lstrip().startswith("//"))
        for word in ("fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "callWS", "wsCall", "EventSource", "FormData", "postMessage"):
            assert word not in code, (rel, word)
    share = _src("views/share_replay.js")
    assert 'ctx.actions.telemetryEvent("share_replay:" + word)' in share
    # The clip is drawn from room outlines: no picture is ever drawn into it.
    assert "drawImage" not in share and "Image(" not in share


def test_counts_only_from_a_closed_list() -> None:
    words = {"opened", "saved_mp4", "saved_webm", "saved_gif", "wide", "vertical", "person", "initials", "rooms_kept", "mark_off", "failed"}
    assert set(T.SHARE_REPLAY_WORDS) == words
    assert all(T.event_allowed(f"share_replay:{w}") for w in words)
    assert not T.event_allowed("share_replay:Kitchen") and not T.event_allowed("share_replay:saved_avi")
    share = _src("views/share_replay.js")
    sent = set(re.findall(r'count\("([a-z_]+)"\)', share)) | {f"saved_{f}" for f in ("mp4", "webm", "gif")} | {"wide", "vertical", "person", "initials"}
    assert sent <= words, sent - words


def test_the_button_is_in_traceback_and_plays_the_floor_stack() -> None:
    tb = _src("views/traceback.js")
    assert 'shareBtn.textContent = t("Share a replay");' in tb
    assert "share.openShareReplay(ctx, { frames: tb.rawFrames || tb.frames, scene: _shareScene() });" in tb
    # One path for a storey's rooms: the playback drawing and the clip both use _levelGeometry.
    assert tb.count("= _levelGeometry(z, group);") == 2
