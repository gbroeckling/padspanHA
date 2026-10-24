# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""New installs and deaf proxies (0.38.165).

  1. A brand-new install starts with the iPhone setup steps on; every
     install from before keeps what it had (off by default), whatever its
     settings file looks like.
  2. A new install's time to its first room and first calibration point,
     as buckets, once, in the opt-in report; never for an older install.
  3. A proxy that suddenly hears far fewer advertisements than it usually
     does: no alarm on normal noise or an emptied room, a drop seen, and
     cleared on recovery; nothing in a healthy house's snapshot.
"""
from __future__ import annotations

import asyncio
import random
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from custom_components.padspan_ha import onboarding as onb
from custom_components.padspan_ha import proxy_health as ph
from custom_components.padspan_ha import settings_store as ss
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_telemetry import _hass as _report_hass

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_VIEWS = _CC / "www" / "padspan-ha" / "views"


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


async def _exec(fn, *a):
    return fn(*a)


def _load(loaded, storage: Path | None):
    saved: dict = {}
    store = ss.SettingsStore.__new__(ss.SettingsStore)
    if storage is not None:
        store.hass = SimpleNamespace(config=SimpleNamespace(path=lambda *p: str(storage.parent.joinpath(*p))),
                                     async_add_executor_job=_exec)
    store.store = SimpleNamespace(async_load=AsyncMock(return_value=loaded),
                                  async_save=AsyncMock(side_effect=lambda d: saved.update(d)))
    data = _run(store.async_load())
    return data, saved


# ═══ 1. the iPhone guide: on for new installs only ═══════════════════════════

def test_the_default_itself_is_unchanged():
    assert ss.DEFAULT_SETTINGS["iphone_irk_guide"] is False
    assert ss.DEFAULT_SETTINGS["onboarding"] == {}


def test_a_brand_new_install_gets_the_guide_and_is_measured(tmp_path):
    storage = tmp_path / ".storage"
    storage.mkdir()
    (storage / "core.config_entries").write_text("{}")      # HA's own files are not PadSpan's
    before = time.time()
    data, saved = _load(None, storage)
    assert data["iphone_irk_guide"] is True
    assert before <= data["onboarding"]["setup_ts"] <= time.time() + 1
    assert saved["iphone_irk_guide"] is True and saved["onboarding"] == data["onboarding"]
    # The next start reads that file back: an existing install from then on.
    again, _ = _load(dict(saved), storage)
    assert again["onboarding"] == data["onboarding"] and again["iphone_irk_guide"] is True


def test_no_storage_folder_yet_is_a_new_install(tmp_path):
    data, _ = _load(None, tmp_path / ".storage")
    assert data["iphone_irk_guide"] is True


def test_an_existing_install_keeps_what_it_has(tmp_path):
    storage = tmp_path / ".storage"
    storage.mkdir()
    for loaded in ({"data_mode": "live"}, {"iphone_irk_guide": False}, {}):
        data, _ = _load(dict(loaded), storage)
        assert data["iphone_irk_guide"] is False and data["onboarding"] == {}, loaded
    data, _ = _load({"iphone_irk_guide": True}, storage)
    assert data["iphone_irk_guide"] is True and data["onboarding"] == {}


def test_a_lost_settings_file_beside_other_padspan_files_is_not_new(tmp_path):
    storage = tmp_path / ".storage"
    storage.mkdir()
    for other in ("padspan_ha.calibration", "padspan_ha.settings.corrupt.1729000000"):
        (storage / other).write_text("{}")
        data, _ = _load(None, storage)
        assert data["iphone_irk_guide"] is False and data["onboarding"] == {}, other
        (storage / other).unlink()


def test_unsure_is_not_new():
    # No hass (the older tests' harness), or a scan that fails.
    data, _ = _load(None, None)
    assert data["iphone_irk_guide"] is False and data["onboarding"] == {}
    store = ss.SettingsStore.__new__(ss.SettingsStore)
    store.hass = SimpleNamespace(config=SimpleNamespace(path=lambda *p: "x"),
                                 async_add_executor_job=AsyncMock(side_effect=OSError("io")))
    assert _run(store._first_run()) is False


# ═══ 2. time to the first room ═══════════════════════════════════════════════

def test_buckets():
    assert [onb.bucket(s) for s in (0, 899, 900, 3599, 3600, 21599, 21600, 86399, 86400, 604799, 604800)] == [
        "lt15m", "lt15m", "lt1h", "lt1h", "lt6h", "lt6h", "lt1d", "lt1d", "lt7d", "lt7d", "gt7d"]
    assert set(onb.BUCKET_WORDS) == {"lt15m", "lt1h", "lt6h", "lt1d", "lt7d", "gt7d"}


def _measured_hass(ob, objects, points=None, followed=None):
    st = SimpleNamespace(data={"onboarding": ob, "followed_addrs": followed or []})

    async def _set(**kw):
        st.data.update(kw)
    st.async_set = _set
    tasks = []
    h = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st,
                                       "calibration": SimpleNamespace(data={"points": points or []})}},
                        async_create_task=lambda c: tasks.append(c))
    return h, st, {"objects": {"list": objects}}, tasks


def test_the_first_room_is_a_known_device_in_a_room():
    t0 = time.time() - 1800
    h, st, snap, tasks = _measured_hass({"setup_ts": t0}, [
        {"address": "AA", "room": "Kitchen"},                  # a stranger: not counted
        {"address": "BB", "identified": True, "room": ""},     # known, no room yet
    ])
    onb.note_snapshot(h, snap)
    assert "first_room" not in st.data["onboarding"] and not tasks
    snap["objects"]["list"].append({"address": "CC", "user_label": "Keys", "room": "Hall"})
    onb.note_snapshot(h, snap)
    assert st.data["onboarding"]["first_room"] == "lt1h" and len(tasks) == 1
    _run(tasks[0])
    # Recorded once: later rooms change nothing.
    onb.note_snapshot(h, snap)
    assert len(tasks) == 1 and st.data["onboarding"]["first_room"] == "lt1h"


def test_a_followed_device_counts_and_the_first_calibration_point_too():
    h, st, snap, tasks = _measured_hass({"setup_ts": time.time() - 100}, [{"address": "aa:bb", "room": "Den"}],
                                        points=[{"room": "Den"}], followed=["AA:BB"])
    onb.note_snapshot(h, snap)
    assert len(tasks) == 1
    _run(tasks[0])
    assert st.data["onboarding"]["first_room"] == "lt15m" and st.data["onboarding"]["first_calib"] == "lt15m"


def test_an_install_from_before_is_never_measured():
    h, st, snap, tasks = _measured_hass({}, [{"identified": True, "room": "Den"}], points=[{"room": "Den"}])
    onb.note_snapshot(h, snap)
    assert st.data["onboarding"] == {} and not tasks


def test_the_report_carries_each_bucket_once_until_accepted():
    h = _report_hass()
    settings = h.data[DOMAIN][DATA_SETTINGS]
    settings.data["onboarding"] = {"setup_ts": 1.0, "first_room": "lt1h"}
    usage = T.build_payload(h)["usage"]
    assert usage.get("first_room:lt1h") == 1 and not any(k.startswith("first_calib") for k in usage)
    T.assert_shareable(T.build_payload(h))
    assert set(onb.report_events(settings.data)) <= T.ONBOARDING_EVENTS
    _run(onb.async_mark_reported(h, ["first_room:lt1h"]))
    assert "first_room:lt1h" not in T.build_payload(h)["usage"]
    settings.data["onboarding"]["first_calib"] = "lt1d"
    usage = T.build_payload(h)["usage"]
    assert usage.get("first_calib:lt1d") == 1 and "first_room:lt1h" not in usage
    # An older install's report is as before.
    settings.data["onboarding"] = {}
    assert not any(k in T.ONBOARDING_EVENTS for k in T.build_payload(h)["usage"])


def test_an_accepted_send_marks_them_sent():
    src = (_CC / "telemetry.py").read_text(encoding="utf-8")
    send = src[src.index("async def send_now"):src.index("def reset_windows")]
    assert send.index("async_mark_reported") > send.index("telemetry_last_day=_today()")


# ═══ 3. a proxy that goes deaf ═══════════════════════════════════════════════

_ADDRS = [f"dev{i}" for i in range(12)]


def _minute(h: ph.AdvertRateHealth, t: float, rates: dict[str, float], addrs=_ADDRS) -> list[str]:
    """One minute in which each scanner hears every address `rate` times."""
    for src, rate in rates.items():
        for a in addrs:
            for _ in range(max(0, round(rate))):
                h.note(src, a)
    return h.tick(t)


def _house(minutes, rate_fn, seed=1):
    rnd = random.Random(seed)
    h = ph.AdvertRateHealth()
    h.tick(0.0)
    fired: list[tuple[int, str]] = []
    lows: list[set] = []
    for m in range(1, minutes + 1):
        for src in _minute(h, m * 60.0, {s: r * rnd.uniform(0.6, 1.4) for s, r in rate_fn(m).items()}):
            fired.append((m, src))
        lows.append(h.low_sources())
    return fired, lows


def test_normal_noise_never_fires():
    fired, lows = _house(600, lambda m: {"a": 20, "b": 8, "c": 30})
    assert not fired and not any(lows)


def test_an_emptied_room_is_not_a_deaf_radio():
    # Fewer devices around "a" (its rate per address unchanged) — not a drop.
    h = ph.AdvertRateHealth()
    h.tick(0.0)
    for m in range(1, 200):
        addrs = _ADDRS if m < 60 else _ADDRS[:3]
        h.note("x", "y")    # a scanner with too few addresses is never judged
        assert not _minute(h, m * 60.0, {"a": 20, "b": 10}, addrs=addrs)
    assert not h.low_sources()


def test_a_drop_fires_after_ten_minutes_and_clears_on_recovery():
    fired, lows = _house(200, lambda m: {"a": 20 * (0.09 if 100 <= m < 150 else 1), "b": 10, "c": 15})
    assert fired == [(109, "a")]
    assert all("a" not in s for s in lows[:108]) and all(s == {"a"} for s in lows[108:150])
    assert not lows[155]          # three minutes back over 60% of usual


def test_a_house_wide_quiet_spell_is_no_ones_fault():
    fired, _ = _house(200, lambda m: {s: r * (0.09 if 100 <= m < 150 else 1) for s, r in {"a": 20, "b": 10}.items()})
    assert not fired


def test_a_single_scanner_house_never_fires_and_warm_up_is_respected():
    fired, _ = _house(200, lambda m: {"a": 20 * (0.05 if m > 100 else 1)})
    assert not fired
    fired, _ = _house(80, lambda m: {"a": 20 * (0.05 if m > 15 else 1), "b": 10})
    assert all(m >= ph.WARMUP_MIN + ph.LOW_MINUTES for m, _ in fired), "judged before its baseline was learned"


def test_a_gap_between_snapshots_is_not_judged():
    h = ph.AdvertRateHealth()
    h.tick(0.0)
    for _ in range(3):
        h.note("a", "x")
    assert h.tick(1000.0) == [] and not h._sc


def test_a_healthy_house_snapshot_is_unchanged():
    src = (_CC / "bluetooth_live.py").read_text(encoding="utf-8")
    assert 'if _radio_src in _rate_low:\n                            radios[-1]["adv_rate_low"] = True' in src
    assert "self.rate_health.note(src, addr)" in src and "if _age <= 2.0" in src
    assert 'bump(self.hass, "proxy_rate_drop", len(started))' in src


def test_the_report_has_a_bucket_never_the_number():
    h = _report_hass()
    for n, word in ((1, "1"), (3, "2_5"), (9, "gt5")):
        h.data[DOMAIN]["telemetry_counters"] = {"proxy_rate_drop": n}
        usage = T.build_payload(h)["usage"]
        assert usage == {f"proxy_rate_drops:{word}": 1}, usage
        assert set(usage) <= T.PROXY_DROP_EVENTS
    h.data[DOMAIN]["telemetry_counters"] = {}
    assert not any(k.startswith("proxy_rate") for k in T.build_payload(h)["usage"])


def test_the_health_view_note_is_drawn_only_for_a_drop():
    src = (_VIEWS / "health.js").read_text(encoding="utf-8")
    assert "r.adv_rate_low === true" in src
    note = src[src.index("// ── A proxy that suddenly hears much less"):src.index("// ── PadSpan Bright → PadSpan HA import")]
    assert "if (deaf.length)" in note
