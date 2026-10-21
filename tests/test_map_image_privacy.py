"""Floor plans are served to logged-in users only.

Up to 0.38.142 the map images sat under www/padspan_ha/maps, and HA serves
www/ at /local/ without a login: on an install reachable from the internet a
home's floor plan was open to anyone with the URL (raised in the HACS review
of PadSpan Bright, hacs/default#10634). They now live under
<config>/padspan_ha/maps and leave only through map_image_view.py, behind
HA's auth, with a per-user signed link for the panel's <img> tags.

Held here:
  * the move out of www/ — never overwrites, never leaves half a file, never
    loses one, and tidies the old folders only when they are empty
  * the view — logged-in only, looks maps up by id, 404 for anything else
  * the signed links — reused (or every pin save re-downloads every image),
    renewed before they expire, per user, and never written into the map
    objects that Diagnostics and the Maps backup save whole
  * upload and replace are admin-only, like delete already was
"""

from __future__ import annotations

import asyncio
import inspect
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import map_image_view as miv
from custom_components.padspan_ha import maps_store as MS
from custom_components.padspan_ha import ws_maps as WM
from custom_components.padspan_ha.const import DATA_MAPS, DOMAIN


def _hass(tmp_path: Path) -> MagicMock:
    hass = MagicMock()
    hass.config.path = lambda *parts: str(tmp_path.joinpath(*parts))
    hass.data = {}

    async def _exec(fn, *args):
        return fn(*args)

    hass.async_add_executor_job = _exec
    return hass


def _store(tmp_path: Path, maps: list[dict]) -> MS.MapsStore:
    st = MS.MapsStore.__new__(MS.MapsStore)
    st.hass = _hass(tmp_path)
    st.maps_dir = MS.maps_dir_for(st.hass)
    st.maps_dir.mkdir(parents=True, exist_ok=True)
    st.data = {"maps": maps}
    return st


def _map(map_id: str = "a1b2", updated: str = "2026-10-19T08:00:00+00:00") -> dict:
    return {"id": map_id, "updated": updated,
            "image": {"filename": f"{map_id}.png", "sha256": "f00d" * 16}}


class _Conn:
    def __init__(self, token: str = "tok-1") -> None:
        self.refresh_token_id = token
        self.results: list = []
        self.errors: list = []

    def send_result(self, mid, data) -> None:
        self.results.append(data)

    def send_error(self, mid, code, message="") -> None:
        self.errors.append((code, message))


# ── where the images live ─────────────────────────────────────────────────────

def test_images_live_outside_www(tmp_path):
    hass = _hass(tmp_path)
    assert MS.maps_dir_for(hass) == tmp_path / "padspan_ha" / "maps"
    assert "www" not in MS.maps_dir_for(hass).parts
    assert MS.legacy_maps_dir_for(hass) == tmp_path / "www" / "padspan_ha" / "maps"


# ── the move out of www/ ──────────────────────────────────────────────────────

def _legacy(tmp_path: Path) -> tuple[Path, Path]:
    old = tmp_path / "www" / "padspan_ha" / "maps"
    old.mkdir(parents=True)
    return old, tmp_path / "padspan_ha" / "maps"


def test_the_move_carries_every_image_and_tidies_the_old_folders(tmp_path):
    old, new = _legacy(tmp_path)
    (old / "a.png").write_bytes(b"A")
    (old / "b.jpg").write_bytes(b"B")
    (tmp_path / "www" / "keep.txt").write_text("someone else's file")

    assert MS._move_legacy_images(old, new) == (2, 0)
    assert (new / "a.png").read_bytes() == b"A"
    assert (new / "b.jpg").read_bytes() == b"B"
    assert not old.exists() and not old.parent.exists(), "empty legacy folders stay behind"
    # www/ itself, and anything else in it, is never touched.
    assert (tmp_path / "www" / "keep.txt").read_text() == "someone else's file"


def test_the_move_never_overwrites(tmp_path):
    old, new = _legacy(tmp_path)
    new.mkdir(parents=True)
    (old / "a.png").write_bytes(b"old")
    (new / "a.png").write_bytes(b"new")

    assert MS._move_legacy_images(old, new) == (0, 1)
    assert (new / "a.png").read_bytes() == b"new"
    assert (old / "a.png").read_bytes() == b"old", "the old copy is kept, not deleted"


def test_an_identical_leftover_in_www_is_removed(tmp_path):
    """A move cut short after the copy leaves the same picture in both places:
    the public copy goes, as nothing would be lost."""
    old, new = _legacy(tmp_path)
    new.mkdir(parents=True)
    (old / "a.png").write_bytes(b"same")
    (new / "a.png").write_bytes(b"same")

    assert MS._move_legacy_images(old, new) == (1, 0)
    assert (new / "a.png").read_bytes() == b"same"
    assert not old.exists()


def test_the_move_leaves_non_images_and_keeps_their_folder(tmp_path):
    old, new = _legacy(tmp_path)
    (old / "a.png").write_bytes(b"A")
    (old / "notes.txt").write_text("not ours to move")

    assert MS._move_legacy_images(old, new) == (1, 0)
    assert (old / "notes.txt").is_file()


def test_no_legacy_folder_is_a_no_op(tmp_path):
    assert MS._move_legacy_images(tmp_path / "www" / "padspan_ha" / "maps",
                                  tmp_path / "padspan_ha" / "maps") == (0, 0)
    assert not (tmp_path / "padspan_ha").exists()


def test_a_failed_move_keeps_the_image(tmp_path, monkeypatch):
    old, new = _legacy(tmp_path)
    (old / "a.png").write_bytes(b"A")

    def _no(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(MS.os, "rename", _no)
    monkeypatch.setattr(MS.shutil, "copy2", _no)
    assert MS._move_legacy_images(old, new) == (0, 1)
    assert (old / "a.png").read_bytes() == b"A"
    assert list(new.iterdir()) == [], "a failed copy left a file behind"


def test_across_disks_the_copy_lands_whole_or_not_at_all(tmp_path, monkeypatch):
    old, new = _legacy(tmp_path)
    (old / "a.png").write_bytes(b"A" * 1000)

    def _cross_device(*a, **k):
        raise OSError(18, "Invalid cross-device link")

    monkeypatch.setattr(MS.os, "rename", _cross_device)
    assert MS._move_legacy_images(old, new) == (1, 0)
    assert (new / "a.png").read_bytes() == b"A" * 1000
    assert not (new / "a.png.part").exists()
    assert not (old / "a.png").exists()


def test_a_copy_cut_short_leaves_no_partial_file(tmp_path, monkeypatch):
    old, new = _legacy(tmp_path)
    (old / "a.png").write_bytes(b"A" * 1000)

    def _cross_device(*a, **k):
        raise OSError(18, "Invalid cross-device link")

    def _half_copy(src, dst, *a, **k):
        Path(dst).write_bytes(b"A" * 10)
        raise OSError("disk full")

    monkeypatch.setattr(MS.os, "rename", _cross_device)
    monkeypatch.setattr(MS.shutil, "copy2", _half_copy)
    assert MS._move_legacy_images(old, new) == (0, 1)
    assert list(new.iterdir()) == [], "half a picture was left where the next start would trust it"
    assert (old / "a.png").read_bytes() == b"A" * 1000


async def test_startup_runs_the_move(tmp_path):
    from unittest.mock import AsyncMock

    old, new = _legacy(tmp_path)
    (old / "a1b2.png").write_bytes(b"A")
    st = MS.MapsStore.__new__(MS.MapsStore)
    st.hass = _hass(tmp_path)
    st.maps_dir = MS.maps_dir_for(st.hass)
    st.store = AsyncMock()
    st.store.async_load = AsyncMock(return_value={"maps": [_map()]})
    st.data = {"maps": []}

    await st.async_setup()
    assert (new / "a1b2.png").read_bytes() == b"A"
    assert not old.exists()


async def test_a_move_that_fails_outright_still_loads_the_maps(tmp_path, monkeypatch):
    """A www/ folder that can't be listed (PermissionError from iterdir) used
    to abort setup, and with it every map."""
    from unittest.mock import AsyncMock

    old, new = _legacy(tmp_path)
    (old / "a1b2.png").write_bytes(b"A")

    def _denied(*a, **k):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(MS, "_move_legacy_images", _denied)
    st = MS.MapsStore.__new__(MS.MapsStore)
    st.hass = _hass(tmp_path)
    st.maps_dir = MS.maps_dir_for(st.hass)
    st.store = AsyncMock()
    st.store.async_load = AsyncMock(return_value={"maps": [_map()]})
    st.data = {"maps": []}

    await st.async_setup()
    assert [m["id"] for m in st.list_maps()] == ["a1b2"]
    assert (st.legacy_moved, st.legacy_left) == (0, 1)
    assert (old / "a1b2.png").exists()


# ── the versioned path ────────────────────────────────────────────────────────

def test_the_path_is_versioned_on_the_picture():
    m = _map()
    assert miv.image_path(m) == "/api/padspan_ha/maps/image/a1b2?v=20261019T0800000"
    # No `updated`: the image's own hash versions it.
    m.pop("updated")
    assert miv.image_path(m) == "/api/padspan_ha/maps/image/a1b2?v=" + ("f00d" * 4)
    # A trim rewrites the PNG in place and bumps `updated`: a new address,
    # so a browser cannot show the pre-edit picture (issue #62).
    assert miv.image_path(_map(updated="a")) != miv.image_path(_map(updated="b"))


def test_no_image_no_path():
    assert miv.image_path({"id": "x", "image": {}}) is None
    assert miv.image_path({"id": "x"}) is None
    assert miv.image_path({"image": {"filename": "x.png"}}) is None


# ── signed links ──────────────────────────────────────────────────────────────

def test_a_link_is_reused_so_a_pin_save_does_not_reload_every_image(tmp_path):
    hass = _hass(tmp_path)
    first = miv.signed_image_urls(hass, [_map()], "tok-1")
    again = miv.signed_image_urls(hass, [_map()], "tok-1")
    assert first == again and "authSig=" in first["a1b2"]
    assert first["a1b2"].startswith("/api/padspan_ha/maps/image/a1b2?v=")


def test_a_link_is_renewed_before_it_expires(tmp_path, monkeypatch):
    hass = _hass(tmp_path)
    clock = [1_000_000.0]
    monkeypatch.setattr(miv.time, "time", lambda: clock[0])
    first = miv.signed_image_urls(hass, [_map()], "tok-1")["a1b2"]
    clock[0] += 11 * 3600
    assert miv.signed_image_urls(hass, [_map()], "tok-1")["a1b2"] == first
    clock[0] += 2 * 3600
    assert miv.signed_image_urls(hass, [_map()], "tok-1")["a1b2"] != first
    # Signed for 24 h, handed out for 12, asked for by the panel every 10
    # minutes: the oldest link a panel can hold still has over 11 h to live.
    assert miv.SIGN_TTL.total_seconds() - miv._REUSE_S - 600 > 11 * 3600


def test_links_are_per_user(tmp_path):
    hass = _hass(tmp_path)
    a = miv.signed_image_urls(hass, [_map()], "tok-1")["a1b2"]
    b = miv.signed_image_urls(hass, [_map()], "tok-2")["a1b2"]
    assert a != b and "tok-1" in a and "tok-2" in b


def test_a_changed_picture_gets_a_new_link(tmp_path):
    hass = _hass(tmp_path)
    a = miv.signed_image_urls(hass, [_map(updated="a")], "tok-1")["a1b2"]
    b = miv.signed_image_urls(hass, [_map(updated="b")], "tok-1")["a1b2"]
    assert a != b


def test_maps_without_a_picture_get_no_link(tmp_path):
    assert miv.signed_image_urls(_hass(tmp_path), [{"id": "x", "image": {}}], "tok-1") == {}


# ── the websocket side ───────────────────────────────────────────────────────

async def test_maps_list_hands_links_beside_the_maps_never_inside(tmp_path):
    st = _store(tmp_path, [_map()])
    hass = st.hass
    hass.data[DOMAIN] = {DATA_MAPS: st}
    conn = _Conn()
    await WM.ws_maps_list(hass, conn, {"id": 1})
    res = conn.results[0]
    assert set(res) == {"maps", "image_urls"}
    assert res["image_urls"]["a1b2"].startswith("/api/padspan_ha/maps/image/a1b2?")
    # Diagnostics and the Maps backup write the map objects out whole.
    for m in res["maps"] + st.data["maps"]:
        assert "authSig" not in repr(m) and "image_url" not in m


async def test_a_signing_failure_still_returns_the_maps(tmp_path, monkeypatch):
    """Pins and rooms must not go blank because the pictures could not be signed."""
    st = _store(tmp_path, [_map()])
    st.hass.data[DOMAIN] = {DATA_MAPS: st}

    def _boom(*a, **k):
        raise RuntimeError("no signing secret")

    monkeypatch.setattr(WM, "signed_image_urls", _boom)
    conn = _Conn()
    await WM.ws_maps_list(st.hass, conn, {"id": 1})
    assert conn.results[0]["maps"] == st.data["maps"] and conn.results[0]["image_urls"] == {}


async def test_maps_image_urls_returns_links_only(tmp_path):
    st = _store(tmp_path, [_map()])
    st.hass.data[DOMAIN] = {DATA_MAPS: st}
    conn = _Conn()
    await WM.ws_maps_image_urls(st.hass, conn, {"id": 1})
    assert set(conn.results[0]) == {"image_urls"}
    assert "a1b2" in conn.results[0]["image_urls"]


def test_maps_image_urls_is_registered():
    src = (Path(WM.__file__).parent / "websocket.py").read_text(encoding="utf-8")
    assert "async_register_command(hass, ws_maps_image_urls)" in src


def _decorators(fn) -> str:
    src = inspect.getsource(inspect.getmodule(fn))
    at = src.index(f"async def {fn.__name__}(")
    return src[src.rindex("@websocket_api.websocket_command(", 0, at):at]


def test_changing_a_floor_plan_image_is_admin_only():
    for fn in (WM.ws_maps_upload, WM.ws_maps_replace_image,
               WM.ws_maps_delete, WM.ws_maps_delete_migrate, WM.ws_maps_revert_extend):
        assert "require_admin" in _decorators(fn), fn.__name__


def test_looking_at_floor_plans_is_not_admin_only():
    # A family member's account or a wall tablet still sees the house.
    for fn in (WM.ws_maps_list, WM.ws_maps_image_urls):
        assert "require_admin" not in _decorators(fn), fn.__name__


# ── the view ──────────────────────────────────────────────────────────────────

class _Refused(Exception):
    pass


class _Unauthorized(_Refused):
    status = 401


class _Forbidden(_Refused):
    status = 403


@pytest.fixture
def fake_web(monkeypatch):
    """A stand-in aiohttp.web: the view's responses and refusals, recorded."""
    web = types.SimpleNamespace(
        Response=lambda status=200: ("Response", status),
        FileResponse=lambda path, headers=None: ("FileResponse", Path(path), headers),
        HTTPUnauthorized=_Unauthorized,
        HTTPForbidden=_Forbidden,
    )
    mod = types.ModuleType("aiohttp")
    mod.web = web
    mod.hdrs = types.SimpleNamespace(AUTHORIZATION="Authorization")
    monkeypatch.setitem(sys.modules, "aiohttp", mod)
    return web


class _Req(dict):
    """What HA's auth middleware leaves on a request: the verdict, and the headers."""

    def __init__(self, authenticated: bool, headers: dict | None = None, query: dict | None = None) -> None:
        super().__init__({"ha_authenticated": authenticated})
        self.headers = headers or {}
        self.query = query or {}


_IN = _Req(True)


async def _status(view, req, map_id):
    try:
        return await view.get(req, map_id)
    except _Refused as err:
        return ("Refused", err.status)


def test_the_view_is_where_core_s_camera_view_puts_its_check():
    # requires_auth would turn a stale link into a counted wrong login; the
    # view checks the middleware's verdict itself instead (see the docstring).
    assert miv.MapImageView.requires_auth is False
    assert miv.MapImageView.url == "/api/padspan_ha/maps/image/{map_id}"


async def test_the_view_serves_a_map_s_own_image(tmp_path, fake_web):
    st = _store(tmp_path, [_map()])
    (st.maps_dir / "a1b2.png").write_bytes(b"A")
    st.hass.data[DOMAIN] = {DATA_MAPS: st}
    kind, path, headers = await miv.MapImageView(st.hass).get(_IN, "a1b2")
    assert kind == "FileResponse" and path == (st.maps_dir / "a1b2.png").resolve()
    assert headers["Cache-Control"].startswith("private")


async def test_no_login_no_image(tmp_path, fake_web):
    st = _store(tmp_path, [_map()])
    (st.maps_dir / "a1b2.png").write_bytes(b"A")
    st.hass.data[DOMAIN] = {DATA_MAPS: st}
    view = miv.MapImageView(st.hass)
    # A stale or missing link: 403, which HA does not count as a wrong login.
    assert await _status(view, _Req(False), "a1b2") == ("Refused", 403)
    # A bad Authorization header is a real login attempt: 401, and counted.
    assert await _status(view, _Req(False, {"Authorization": "Bearer nope"}), "a1b2") == ("Refused", 401)
    # Refused before any lookup: a stranger cannot learn which ids exist.
    assert await _status(view, _Req(False), "nope") == ("Refused", 403)


async def test_the_view_404s_everything_else(tmp_path, fake_web):
    escape = {"id": "evil", "image": {"filename": "../../secrets.yaml"}}
    st = _store(tmp_path, [_map(), _map("gone"), escape])
    (st.maps_dir / "a1b2.png").write_bytes(b"A")
    (tmp_path / "secrets.yaml").write_text("api_key: hunter2")
    st.hass.data[DOMAIN] = {DATA_MAPS: st}
    view = miv.MapImageView(st.hass)
    assert await view.get(_IN, "nope") == ("Response", 404)       # unknown map
    assert await view.get(_IN, "gone") == ("Response", 404)       # map without its file
    assert await view.get(_IN, "evil") == ("Response", 404)       # filename escaping the folder
    assert await view.get(_IN, "../a1b2") == ("Response", 404)    # an id that is a path
    st.hass.data[DOMAIN] = {}
    assert await view.get(_IN, "a1b2") == ("Response", 404)       # stores not loaded yet


def test_the_view_registers_once(tmp_path):
    hass = _hass(tmp_path)
    miv.async_register_map_image_view(hass)
    miv.async_register_map_image_view(hass)   # an integration reload
    assert hass.http.register_view.call_count == 1


def test_a_failing_view_does_not_cost_the_panel(tmp_path, monkeypatch):
    from custom_components.padspan_ha import panel as P

    hass = _hass(tmp_path)
    hass.http.register_view.side_effect = RuntimeError("boom")
    registered: list = []

    def _panel(**kw):
        registered.append(kw["frontend_url_path"])

    import homeassistant.components as comps
    pc = types.SimpleNamespace(async_register_panel=_panel)
    monkeypatch.setattr(comps, "panel_custom", pc, raising=False)
    monkeypatch.setitem(sys.modules, "homeassistant.components.panel_custom", pc)

    async def _static(*a, **k):
        return None

    monkeypatch.setattr(P, "_register_static", _static)
    asyncio.run(P.async_setup_panel(hass))
    assert "padspan-ha" in registered


# ── nothing serves or builds the old public path any more ────────────────────

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


def test_no_code_points_at_the_public_folder():
    offenders = []
    for p in list(_ROOT.rglob("*.py")) + list((_ROOT / "www").rglob("*.js")):
        if "/lib/" in p.as_posix() or "__pycache__" in p.parts:
            continue
        src = p.read_text(encoding="utf-8", errors="replace")
        if "/local/padspan_ha" in src or "www/padspan_ha" in src:
            offenders.append(p.name)
    # maps_store names the legacy folder once, to move images out of it.
    assert offenders == [] or offenders == ["maps_store.py"], offenders
    ms = (_ROOT / "maps_store.py").read_text(encoding="utf-8")
    assert ms.count('config.path("www")') == 1, "maps_store reaches into www/ for more than the move"


async def test_a_stale_link_is_counted_for_the_report_and_a_bad_login_is_not(tmp_path, fake_web, monkeypatch):
    from custom_components.padspan_ha import telemetry

    seen: list = []
    monkeypatch.setattr(telemetry, "bump", lambda hass, event, n=1: seen.append(event))
    st = _store(tmp_path, [_map()])
    st.hass.data[DOMAIN] = {DATA_MAPS: st}
    view = miv.MapImageView(st.hass)
    await _status(view, _Req(False, query={"v": "1", "authSig": "expired"}), "a1b2")   # counted
    await _status(view, _Req(False), "a1b2")            # a stranger with no link: not counted
    await _status(view, _Req(False, {"Authorization": "Bearer nope"}), "a1b2")
    await view.get(_IN, "a1b2")
    assert seen == ["map_image_stale"]


def test_links_are_renewed_by_the_watchdog_which_runs_in_sample_mode_too():
    """The data poll stops in sample mode; the watchdog does not."""
    src = (Path(miv.__file__).parent / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    # The renewal is the watchdog's first step, ahead of anything that returns early.
    watchdog = src[src.index("this._watchdogTimer = setInterval("):][:1500]
    assert "this._renewMapImageUrls()" in watchdog
    poll = src[src.index("async _pollTick(){"):src.index("async _renewMapImageUrls(")]
    assert "_renewMapImageUrls" not in poll
