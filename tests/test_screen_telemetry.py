# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The screens PadSpan runs on, in the opt-in report (2026-10-21, for 4K
walls): resolution, orientation, density, kind and how many monitors, in
buckets (client_screen:*), and how many screens a house runs
(client_screen_seen, counted once per screen per report window)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DOMAIN

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")

_DRIVE = r"""
import(process.argv[1]).then(m => {
  const win = (w, h, dpr, pointer, touch, ext) => ({ devicePixelRatio: dpr, innerWidth: w, innerHeight: h,
    screen: { width: w, height: h, isExtended: ext }, navigator: { maxTouchPoints: touch },
    matchMedia: (q) => ({ matches: q === `(pointer: ${pointer})` }) });
  const store = { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, x) { this.v[k] = x; } };
  const a = m.screenId(store), b = m.screenId(store);
  console.log(JSON.stringify({
    tv4k: m.screenWords(win(3840, 2160, 1, "none", 0, undefined)),
    phone: m.screenWords(win(390, 844, 3, "coarse", 5, undefined)),
    desk1440: m.screenWords(win(2560, 1440, 1, "fine", 0, true)),
    laptop: m.screenWords(win(1440, 900, 2, "fine", 0, false)),
    tablet: m.screenWords(win(820, 1180, 2, "coarse", 5, undefined)),
    id: [a, a === b, /^[0-9a-f]{16}$/.test(a)],
    words: m.CLIENT_SCREEN }));
});
"""


def test_the_screen_words_for_each_kind_of_screen():
    if _NODE is None:
        pytest.skip("node is not installed")
    url = (_WWW / "client_perf.js").resolve().as_uri()
    res = subprocess.run([_NODE, "-e", _DRIVE, url], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    got = json.loads(res.stdout)
    assert got["tv4k"] == ["res_4k", "orient_land", "dpr_1", "kind_large", "screens_unknown"]
    assert got["phone"] == ["res_1080", "orient_port", "dpr_3_up", "kind_phone", "screens_unknown"]
    assert got["desk1440"] == ["res_1440", "orient_land", "dpr_1", "kind_desktop", "screens_2up"]
    assert got["laptop"] == ["res_1440", "orient_land", "dpr_2", "kind_desktop", "screens_1"]
    assert got["tablet"] == ["res_1080", "orient_port", "dpr_2", "kind_tablet", "screens_unknown"]
    assert got["id"][1] and got["id"][2], "one id per browser, kept"
    for k in ("tv4k", "phone", "desk1440", "laptop", "tablet"):
        assert all(w in got["words"] for w in got[k]), k
        assert all(T.event_allowed("client_screen:" + w) for w in got[k]), k



def test_each_screen_counts_once_per_window_and_its_id_never_leaves():
    from custom_components.padspan_ha.const import DATA_SETTINGS
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}})
    a, b = "0123456789abcdef", "fedcba9876543210"
    assert T.note_screen(hass, a) and not T.note_screen(hass, a) and T.note_screen(hass, b)
    assert not T.note_screen(hass, "not-an-id") and not T.note_screen(hass, "ABCDEF0123456789")
    for _ in (a, b):
        T.bump(hass, "client_screen_seen")
    counters = T._take_counters(hass)
    assert counters == {"client_screen_seen": 2}
    assert a not in json.dumps(counters) and b not in json.dumps(counters)
    assert T.note_screen(hass, a), "a new window counts it again"


def test_a_screen_s_words_count_once_and_a_failed_send_does_not_count_it_twice():
    from custom_components.padspan_ha.const import DATA_SETTINGS
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}})
    a = "0123456789abcdef"
    assert T.note_screen(hass, a, "client_screen:res_4k") and not T.note_screen(hass, a, "client_screen:res_4k")
    assert T.note_screen(hass, a), "client_screen_seen is its own count"
    T.bump(hass, "client_screen_seen")
    taken = T._take_windows(hass)
    T._give_back_windows(hass, taken)          # the send failed
    assert not T.note_screen(hass, a), "given back with its count: not counted again"
    T.reset_windows(hass)
    assert T.note_screen(hass, a), "opting in starts the screens afresh"


def test_the_websocket_counts_a_screen_only_when_it_is_new():
    src = (Path(T.__file__).parent / "ws_telemetry.py").read_text(encoding="utf-8")
    assert 'vol.Optional("screen"): vol.All(str, vol.Length(max=32))' in src
    assert 'note_screen(hass, str(msg.get("screen") or ""), event) and bump(hass, event)' in src


# ── how much of the day the busiest single screen showed PadSpan ────────────
# (env.top_screen, 2026-11-22: the owner's bar is one display at 90% or better)

_HEARTBEAT = r"""
const sent = [];
const store = { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, x) { this.v[k] = x; } };
globalThis.document = { visibilityState: "visible" };
globalThis.window = { localStorage: store, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
  screen: { width: 1920, height: 1080 }, matchMedia: () => ({ matches: false }), navigator: {} };
const realTimeout = setTimeout;
globalThis.setTimeout = (fn) => realTimeout(fn, 0);      // the first tick, and the frame count's end, now
globalThis.setInterval = () => 0;
globalThis.requestAnimationFrame = (cb) => setImmediate(() => cb(performance.now()));
import(process.argv[1]).then(m => {
  m.startClientPerf({ root: { host: { isConnected: true }, querySelectorAll: () => [] },
    viewClass: () => "atlas", enabled: () => true, send: (name, extra) => sent.push([name, extra || null]) });
  realTimeout(() => console.log(JSON.stringify(sent)), 300);
});
"""


def test_the_heartbeat_carries_the_screen_s_id():
    if _NODE is None:
        pytest.skip("node is not installed")
    url = (_WWW / "client_perf.js").resolve().as_uri()
    res = subprocess.run([_NODE, "-e", _HEARTBEAT, url], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    sent = json.loads(res.stdout)
    seen = [e for n, e in sent if n == "client_screen_seen"]
    fps = [e for n, e in sent if n.startswith("client_fps:atlas:")]
    assert len(seen) == 1 and len(fps) == 1, sent
    assert fps[0] == seen[0] and len(fps[0]["screen"]) == 16


def _house(tz="UTC"):
    from custom_components.padspan_ha.const import DATA_SETTINGS
    tasks = []
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}},
                           config=SimpleNamespace(time_zone=tz), async_create_task=tasks.append, tasks=tasks)


def _ts(text, tz):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.fromisoformat(text).replace(tzinfo=ZoneInfo(tz)).timestamp()


def test_each_screen_s_minutes_are_its_own_and_a_beat_under_50_s_is_not_one():
    h = _house()
    a, b = "0123456789abcdef", "fedcba9876543210"
    t0 = _ts("2026-11-24T12:00:00", "UTC")
    assert T.note_screen_minute(h, a, t0) and T.note_screen_minute(h, a, t0 + 60)
    assert not T.note_screen_minute(h, a, t0 + 60 + 30), "a second window in the same browser"
    assert T.note_screen_minute(h, a, t0 + 60 + 50)
    assert T.note_screen_minute(h, b, t0 + 1), "another screen's beat is its own"
    assert not T.note_screen_minute(h, "not-an-id", t0) and not T.note_screen_minute(h, "ABCDEF0123456789", t0)
    assert h.data[DOMAIN][T._DATA_SCREEN_MIN] == {a: [3, 3], b: [1, 1]}


def test_07_to_23_is_home_assistant_s_time_zone_across_midnight():
    a = "0123456789abcdef"
    # Vancouver (seven hours behind UTC): 06:59 and 23:00 local are out, 07:00 and
    # 22:59 in, though by UTC's clock 22:59 and 23:00 are the next morning.
    h = _house("America/Vancouver")
    for when in ("2026-11-24T06:59:00", "2026-11-24T07:00:00", "2026-11-24T22:59:00", "2026-11-24T23:00:00"):
        assert T.note_screen_minute(h, a, _ts(when, "America/Vancouver"))
    assert h.data[DOMAIN][T._DATA_SCREEN_MIN][a] == [4, 2]
    # Tokyo (UTC+9): 07:30 local is 22:30 UTC the day before, and in the window.
    h = _house("Asia/Tokyo")
    assert T.note_screen_minute(h, a, _ts("2026-11-25T07:30:00", "Asia/Tokyo"))
    assert h.data[DOMAIN][T._DATA_SCREEN_MIN][a] == [1, 1]
    # No time zone Home Assistant can name: UTC.
    h = _house(None)
    assert T.note_screen_minute(h, a, _ts("2026-11-24T06:30:00", "UTC"))
    assert h.data[DOMAIN][T._DATA_SCREEN_MIN][a] == [1, 0]


def test_the_window_s_07_to_23_minutes_cross_midnight_and_a_change_of_clocks():
    from zoneinfo import ZoneInfo
    van = ZoneInfo("America/Vancouver")
    # 22:00 to 08:00 the next morning: 22-23 and 07-08.
    assert T.minutes_7_23(_ts("2026-11-24T22:00:00", "America/Vancouver"),
                          _ts("2026-11-25T08:00:00", "America/Vancouver"), van) == 120
    # Over a night the clocks went back (Los Angeles, 1 November 2026): 49 hours,
    # two whole 16-hour days.
    la = ZoneInfo("America/Los_Angeles")
    s, e = _ts("2026-10-31T00:00:00", "America/Los_Angeles"), _ts("2026-11-02T00:00:00", "America/Los_Angeles")
    assert (e - s) / 3600 == 49 and T.minutes_7_23(s, e, la) == 2 * 16 * 60
    assert T.minutes_7_23(e, s, van) == 0


def test_only_the_busiest_screen_goes_capped_at_the_window():
    from zoneinfo import ZoneInfo
    utc = ZoneInfo("UTC")
    start = _ts("2026-11-24T00:00:00", "UTC")
    end = start + 24 * 3600
    top = T.top_screen({"0123456789abcdef": [1300, 950], "fedcba9876543210": [400, 400]}, start, end, utc)
    assert top == {"min": 1300, "window_min": 1440, "min_7_23": 950, "window_min_7_23": 960}
    # Two windows in one browser, beating out of step, can't make a screen more than the window.
    assert T.top_screen({"0123456789abcdef": [2000, 1500]}, start, end, utc) == {
        "min": 1440, "window_min": 1440, "min_7_23": 960, "window_min_7_23": 960}
    assert T.top_screen({}, start, end, utc) == {"min": 0, "window_min": 1440, "min_7_23": 0, "window_min_7_23": 960}
    assert T.top_screen({}, None, end, utc) is None


def test_the_minutes_survive_a_restart_and_go_with_the_window():
    import asyncio

    class _Store:
        data = None

        async def async_load(self):
            return self.data

        async def async_save(self, data):
            self.data = json.loads(json.dumps(data))

    st = _Store()
    a = "0123456789abcdef"
    h = _house()
    h.data[DOMAIN][T._DATA_COUNTERS_STORE] = st
    start = h.data[DOMAIN][T._DATA_WINDOW_START] = _ts("2026-11-24T00:00:00", "UTC")
    for i in range(3):
        T.note_screen_minute(h, a, start + 3600 + 60 * i)
    T._persist_counters(h, now=True)
    while h.tasks:
        asyncio.run(h.tasks.pop(0))
    assert st.data["screen_min"] == {a: [3, 0]} and st.data["window_start"] == start
    # Home Assistant restarts: the new run's minutes go on top, and the window starts where it did.
    h2 = _house()
    h2.data[DOMAIN][T._DATA_COUNTERS_STORE] = st
    T.note_screen_minute(h2, a, start + 9 * 3600)
    asyncio.run(T.async_restore_counters(h2))
    assert h2.data[DOMAIN][T._DATA_SCREEN_MIN] == {a: [4, 1]}
    assert h2.data[DOMAIN][T._DATA_WINDOW_START] == start
    # A saved file's bad id or count adds nothing.
    assert T._merge_screen_min({}, {"not-an-id": [5, 5], a: [1, -1], "1111111111111111": [True, 0]}) == {}
    # The report is taken: the ids are forgotten; a failed send gives them back with their start.
    taken = T._take_windows(h2)
    assert h2.data[DOMAIN][T._DATA_SCREEN_MIN] == {} and h2.data[DOMAIN][T._DATA_WINDOW_START] > start
    T._give_back_windows(h2, taken)
    assert h2.data[DOMAIN][T._DATA_SCREEN_MIN] == {a: [4, 1]} and h2.data[DOMAIN][T._DATA_WINDOW_START] == start
    T._take_windows(h2)
    while h2.tasks:
        asyncio.run(h2.tasks.pop(0))
    assert "screen_min" not in st.data and a not in json.dumps(st.data)
    # Opting in starts afresh.
    T.note_screen_minute(h2, a, start + 10 * 3600)
    T.reset_windows(h2)
    assert h2.data[DOMAIN][T._DATA_SCREEN_MIN] == {}
    while h2.tasks:
        asyncio.run(h2.tasks.pop(0))


def test_the_websocket_tallies_a_heartbeat_with_its_screen_only_while_the_report_is_on():
    import asyncio
    from custom_components.padspan_ha import ws_telemetry
    from custom_components.padspan_ha.const import DATA_SETTINGS
    h = _house()
    sent = []
    conn = SimpleNamespace(send_result=lambda i, r: sent.append(r))
    a = "0123456789abcdef"
    asyncio.run(ws_telemetry.ws_telemetry_event(h, conn, {"id": 1, "event": "client_fps:atlas:45up", "screen": a}))
    asyncio.run(ws_telemetry.ws_telemetry_event(h, conn, {"id": 2, "event": "client_fps:atlas:45up"}))
    assert sent == [{"counted": True}, {"counted": True}]
    assert h.data[DOMAIN][T._DATA_SCREEN_MIN][a][0] == 1, "the one with its id"
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    h.data[DOMAIN][T._DATA_SCREEN_BEAT] = {}
    asyncio.run(ws_telemetry.ws_telemetry_event(h, conn, {"id": 3, "event": "client_fps:atlas:45up", "screen": a}))
    assert sent[-1] == {"counted": False} and h.data[DOMAIN][T._DATA_SCREEN_MIN][a][0] == 1


_ROOT = Path(__file__).resolve().parents[1]


def test_the_summary_counts_houses_with_one_screen_up_90_and_falls_back_to_summed(tmp_path):
    import os
    import sys
    from datetime import date
    script = _ROOT / "server" / "telemetry_summary.py"
    if not script.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    day = date.today().isoformat()

    def rep(iid, top=None, fps=None):
        env = {"scanners": 2}
        if top is not None:
            env["top_screen"] = dict(zip(T.TOP_SCREEN_KEYS, top))
        return {"install_id": iid, "version": "0.38.292", "day": day, "env": env,
                "usage": {"client_fps:atlas:45up": fps} if fps else {}}

    own = "dddddddd-1111-4111-8111-111111111111"
    rows = [rep("aaaaaaaa-1111-4111-8111-111111111111", (1350, 1440, 900, 960)),   # one wall: up all day
            rep("bbbbbbbb-1111-4111-8111-111111111111", (500, 1440, 880, 960)),    # up from 7 to 11 only
            rep("cccccccc-1111-4111-8111-111111111111", (20, 30, 20, 30)),          # just opted in: too short
            rep(own, (1440, 1440, 960, 960)),                                        # the owner's own house
            rep("eeeeeeee-1111-4111-8111-111111111111", fps=1400),                  # older: three screens summed
            rep("ffffffff-1111-4111-8111-111111111111", fps=300)]
    d = tmp_path / "r"
    d.mkdir()
    (d / f"{day}.jsonl").write_text("".join(json.dumps({"recv_day": day, "report": r}) + "\n" for r in rows),
                                    encoding="utf-8")

    def run(*extra):
        out = subprocess.run([sys.executable, str(script), str(d), *extra], capture_output=True, text=True,
                             encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=60)
        assert out.returncode == 0, out.stderr
        s = out.stdout[out.stdout.index("One screen up all day"):]
        return s[:s.index("\n\n")]

    s = run("--exclude-install-id", own)
    assert "houses with one screen up 90%+, whole day        1  / 2  (1 with a window too short to tell)" in s, s
    assert "houses with one screen up 90%+, 07:00-23:00      2  / 2  (1 with a window too short to tell)" in s, s
    assert "older builds, summed: 90%+, whole day            1  / 2" in s, s
    assert "older builds, summed: 90%+, 07:00-23:00          1  / 2" in s, s
    assert "left out: 1 of 1 excluded install ids" in s, s
    s = run()
    assert "houses with one screen up 90%+, whole day        2  / 3" in s and "left out" not in s, s


def test_stats_php_counts_one_screen_up_by_the_names_the_report_uses():
    php = _ROOT / "server" / "stats.php"
    if not php.is_file():
        pytest.skip("no server/ in this tree")
    src = php.read_text(encoding="utf-8")
    assert "$e['top_screen']" in src and "'screen_up' => $screen_up" in src
    for k in T.TOP_SCREEN_KEYS:
        assert f"'{k}'" in src, k
    assert "padspan-own-installs" in src and "'client_fps:'" in src
