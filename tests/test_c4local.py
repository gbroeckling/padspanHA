# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""OS 2 Local for Control4 from inside PadSpan (the owner, 2026-11-25): c4local_install.py and views/c4local.js.

The specialty add-on c4local is a separate integration (domain control4). PadSpan installs it only
from its one release URL, refuses anything that is not the product, backs up what was there and
puts it back on Undo, never restarts Home Assistant by itself, answers administrators only, and
installs only for PadSpan Pro or the c4local add-on. The licence card shows it in a Specialty part
of its own, and no sale ever halves it.
"""
from __future__ import annotations

import ast
import asyncio
import io
import json
import re
import shutil
import subprocess
import sys
import types
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import c4local_install as C
from custom_components.padspan_ha import licence

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _PKG / "www" / "padspan-ha"
PRODUCT = {"domain": "control4", "name": "OS 2 Local for Control4", "version": "1.0.0", "requirements": ["pyControl4==1.5.0"]}


def _zip(files: dict[str, bytes | str] | None = None, *, manifest: dict | None = PRODUCT, link: str | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if manifest is not None:
            zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("__init__.py", "DOMAIN = 'control4'\n")
        zf.writestr("translations/en.json", "{}")
        for name, data in (files or {}).items():
            zf.writestr(name, data)
        if link:
            info = zipfile.ZipInfo(link)
            info.external_attr = 0o120777 << 16
            zf.writestr(info, "/etc/passwd")
    return buf.getvalue()


def _run(coro):
    return asyncio.run(coro)


# ── The zip ──────────────────────────────────────────────────────────────────

def test_the_products_zip_is_taken() -> None:
    assert C.check_zip(_zip())["version"] == "1.0.0"
    # Its first releases' manifest says the name it had before the owner's rename: still the product.
    assert C.check_zip(_zip(manifest={**PRODUCT, "name": "Control4 OS 2 Local"}))["name"] == "Control4 OS 2 Local"
    assert C.is_product({**PRODUCT, "name": "Control4 OS 2 Local"}) and not C.is_product({**PRODUCT, "name": "OS 2 Local"})
    assert C.PRODUCT_NAMES == ("OS 2 Local for Control4", "Control4 OS 2 Local") and C.is_product(PRODUCT)


BAD = {
    "01-not_a_zip": (lambda: b"not a zip at all", "not_a_zip"),
    "02-not_a_zip": (lambda: b"PK\x03\x04" + b"\x00" * 64, "not_a_zip"),
    "03-too_big": (lambda: b"PK\x03\x04" + b"\x00" * (C.MAX_ZIP + 1), "too_big"),
    "04-not_the_product": (lambda: _zip(manifest=None), "not_the_product"),
    "05-not_the_product": (lambda: _zip(manifest={**PRODUCT, "domain": "control4_other"}), "not_the_product"),
    "06-not_the_product": (lambda: _zip(manifest={**PRODUCT, "name": "Control4"}), "not_the_product"),            # the built-in's own manifest
    "07-not_the_product": (lambda: _zip(manifest={**PRODUCT, "version": 1}), "not_the_product"),
    "08-not_the_product": (lambda: _zip({"../../configuration.yaml": "x"}), "not_the_product"),
    "09-not_the_product": (lambda: _zip({"/etc/x": "x"}), "not_the_product"),
    "10-not_the_product": (lambda: _zip({"a\\..\\..\\b": "x"}), "not_the_product"),
    "11-not_the_product": (lambda: _zip({"C:/x": "x"}), "not_the_product"),
    "12-not_the_product": (lambda: _zip(link="evil"), "not_the_product"),
    "13-not_the_product": (lambda: _zip({f"f{i}.py": "" for i in range(C.MAX_FILES)}), "not_the_product"),
    "14-too_big": (lambda: _zip({"big.bin": b"\x00" * (C.MAX_UNPACKED + 1)}), "too_big"),
}


@pytest.mark.parametrize("case", sorted(BAD))
def test_anything_that_is_not_the_product_is_refused(case) -> None:
    make, code = BAD[case]
    data = make()
    with pytest.raises(C.C4LocalError) as err:
        C.check_zip(data)
    assert err.value.code == code


def test_a_zip_with_the_integration_in_a_folder_is_not_the_release() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("control4/manifest.json", json.dumps(PRODUCT))
        zf.writestr("control4/__init__.py", "")
    with pytest.raises(C.C4LocalError):
        C.check_zip(buf.getvalue())


# ── The one URL ──────────────────────────────────────────────────────────────

def test_only_the_release_url_and_githubs_own_redirects() -> None:
    # The product's public repo (the owner, 2026-11-25: os2-local-for-control4, not control4-os2-local).
    assert C.PROJECT_URL == "https://github.com/gbroeckling/os2-local-for-control4"
    assert C.ZIP_URL == "https://github.com/gbroeckling/os2-local-for-control4/releases/latest/download/control4.zip"
    assert C._TAG_RE.match(TAG) and C._TAG_RE.match(TAG).group(1) == "1.0.0"
    assert not C._TAG_RE.match(TAG.replace("os2-local-for-control4", "control4-os2-local")), "only the product's repo"
    assert C._HOSTS == ("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
    src = (_PKG / "c4local_install.py").read_text(encoding="utf-8")
    # No command takes anything but its type: no URL, path or file comes from a caller.
    for schema in re.findall(r"@websocket_api\.websocket_command\((\{.*?\})\)", src):
        assert schema.count(":") == 1, schema
    assert src.count("session.get(") == 2 and "session.head(" not in src and "session.post(" not in src
    assert "session.get(url, allow_redirects=False" in src and "session.get(ZIP_URL, allow_redirects=False" in src
    assert C._hop(C.ZIP_URL, "/gbroeckling/os2-local-for-control4/releases/download/v1.0.0/control4.zip").startswith("https://github.com/")
    assert C._hop(C.ZIP_URL, "https://objects.githubusercontent.com/x").startswith("https://objects.")
    for bad in ("http://github.com/x", "https://evil.example/control4.zip", "https://github.com.evil.example/x",
                "https://objects.githubusercontent.com.evil/x", "ftp://github.com/x"):
        with pytest.raises(C.C4LocalError):
            C._hop(C.ZIP_URL, bad)


class _Body:
    def __init__(self, data: bytes, size: int = 65536) -> None:
        self._chunks = [data[i:i + size] for i in range(0, len(data), size)] or [b""]

    async def iter_chunked(self, _n):
        for c in self._chunks:
            yield c


class _Resp:
    def __init__(self, status: int, location: str = "", data: bytes = b"", length: int | None = None) -> None:
        self.status = status
        self.headers = {"Location": location} if location else {}
        self.content = _Body(data)
        self.content_length = len(data) if length is None else length

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Session:
    """GitHub as a script: each URL's answer; every request is kept."""

    def __init__(self, answers: dict[str, _Resp]) -> None:
        self.answers, self.asked = answers, []

    def get(self, url, **kw):
        self.asked.append(("GET", url, kw.get("allow_redirects")))
        return self.answers[url]

    def head(self, url, **kw):
        self.asked.append(("HEAD", url, kw.get("allow_redirects")))
        return self.answers[url]


TAG = "https://github.com/gbroeckling/os2-local-for-control4/releases/download/v1.0.0/control4.zip"
STORE = "https://objects.githubusercontent.com/github-production-release-asset/1/control4.zip?sig=x"


@pytest.fixture
def web(monkeypatch):
    aio = types.ModuleType("aiohttp")
    aio.ClientError = type("ClientError", (Exception,), {})
    aio.ClientTimeout = lambda **kw: kw
    monkeypatch.setitem(sys.modules, "aiohttp", aio)
    holder = SimpleNamespace(session=None)
    from homeassistant.helpers import aiohttp_client
    monkeypatch.setattr(aiohttp_client, "async_get_clientsession", lambda hass: holder.session, raising=False)
    return holder


def test_the_download_follows_github_and_says_the_version(web) -> None:
    data = _zip()
    web.session = _Session({C.ZIP_URL: _Resp(302, TAG), TAG: _Resp(302, STORE), STORE: _Resp(200, data=data)})
    version, got = _run(C.async_download(SimpleNamespace()))
    assert (version, got) == ("1.0.0", data)
    assert [a[1] for a in web.session.asked] == [C.ZIP_URL, TAG, STORE] and all(a[2] is False for a in web.session.asked)


def test_a_redirect_elsewhere_is_never_followed(web) -> None:
    web.session = _Session({C.ZIP_URL: _Resp(302, "https://evil.example/control4.zip")})
    with pytest.raises(C.C4LocalError) as err:
        _run(C.async_download(SimpleNamespace()))
    assert err.value.code == "download_failed" and len(web.session.asked) == 1


@pytest.mark.parametrize("resp, code", [
    (_Resp(200, data=b"x", length=C.MAX_ZIP + 1), "too_big"),     # said too big: not read
    (_Resp(200, data=b"x" * (C.MAX_ZIP + 2), length=0), "too_big"),  # said nothing, sent too much: stopped
    (_Resp(404), "no_release"),
    (_Resp(500), "download_failed"),
])
def test_a_download_too_big_or_missing_is_refused(web, resp, code) -> None:
    web.session = _Session({C.ZIP_URL: resp})
    with pytest.raises(C.C4LocalError) as err:
        _run(C.async_download(SimpleNamespace()))
    assert err.value.code == code


def test_the_update_check_reads_only_the_redirect(web) -> None:
    web.session = _Session({C.ZIP_URL: _Resp(302, TAG.replace("v1.0.0", "v1.2.3"))})
    assert _run(C.async_latest(SimpleNamespace())) == "1.2.3"
    assert web.session.asked == [("GET", C.ZIP_URL, False)], "the redirect is read, never followed"
    assert C.newer("1.2.3", "1.0.0") and not C.newer("1.0.0", "1.0.0") and not C.newer("1.0.9", "1.0.10")
    assert C.newer("1.0.0", None) and not C.newer(None, "1.0.0")


# ── Back up, install, undo ───────────────────────────────────────────────────

def _folder(root: Path, manifest: dict, extra: str = "") -> Path:
    d = root / "custom_components" / "control4"
    d.mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (d / "__init__.py").write_text(extra, encoding="utf-8")
    return d


def _backups(root: Path) -> list[str]:
    d = root / "padspan_ha" / "control4_backups"
    return sorted(p.name for p in d.iterdir()) if d.is_dir() else []


def test_install_backs_up_what_was_there_and_undo_puts_it_back(tmp_path) -> None:
    other = {"domain": "control4", "name": "Control4 (a fork)", "version": "0.3"}
    _folder(tmp_path, other, "# the fork\n")
    out = C.install_files(str(tmp_path), _zip(), "20261125T120000Z")
    target = tmp_path / "custom_components" / "control4"
    assert out == {"version": "1.0.0", "backup": "control4-20261125T120000Z"}
    assert json.loads((target / "manifest.json").read_text())["name"] == "OS 2 Local for Control4"
    assert (target / "translations" / "en.json").is_file()
    back = tmp_path / "padspan_ha" / "control4_backups" / "control4-20261125T120000Z"
    assert (back / "__init__.py").read_text() == "# the fork\n"
    # Nothing beside it in custom_components: a second control4 there would be loaded by Home Assistant.
    assert sorted(p.name for p in (tmp_path / "custom_components").iterdir()) == ["control4"]
    assert not (tmp_path / "padspan_ha" / "control4_staging").exists()
    assert C.disk_state(str(tmp_path))["undo"] == {"what": "restore", "name": "Control4 (a fork)", "version": "0.3"}
    assert C.undo_files(str(tmp_path), "20261125T130000Z") == {"what": "restore", "version": "0.3"}
    assert (target / "__init__.py").read_text() == "# the fork\n" and _backups(tmp_path) == []
    # The fork is back and it isn't the product: Undo leaves it alone.
    with pytest.raises(C.C4LocalError) as err:
        C.undo_files(str(tmp_path), "20261125T140000Z")
    assert err.value.code == "not_ours" and (target / "__init__.py").read_text() == "# the fork\n"


def test_on_a_house_with_nothing_there_undo_removes_it_and_the_built_in_comes_back(tmp_path) -> None:
    assert C.install_files(str(tmp_path), _zip(), "20261125T120000Z")["backup"] is None
    assert C.disk_state(str(tmp_path)) == {"disk": {"name": "OS 2 Local for Control4", "version": "1.0.0", "ours": True},
                                           "undo": {"what": "remove"}, "local": False}
    assert C.undo_files(str(tmp_path), "20261125T130000Z") == {"what": "remove", "version": None}
    assert not (tmp_path / "custom_components" / "control4").exists() and _backups(tmp_path) == []
    with pytest.raises(C.C4LocalError) as err:
        C.undo_files(str(tmp_path), "20261125T140000Z")
    assert err.value.code == "nothing"


def test_an_update_keeps_the_version_before_and_undo_goes_back_one_step(tmp_path) -> None:
    C.install_files(str(tmp_path), _zip(), "20261125T120000Z")
    C.install_files(str(tmp_path), _zip(manifest={**PRODUCT, "version": "1.1.0"}), "20261126T120000Z")
    assert _backups(tmp_path) == ["control4-20261126T120000Z"]
    assert C.disk_state(str(tmp_path))["undo"]["version"] == "1.0.0"
    C.undo_files(str(tmp_path), "20261126T130000Z")
    assert C.disk_state(str(tmp_path))["disk"]["version"] == "1.0.0"
    C.undo_files(str(tmp_path), "20261126T140000Z")
    assert C.disk_state(str(tmp_path))["disk"] is None


def test_a_failed_unpack_puts_back_what_was_there(tmp_path, monkeypatch) -> None:
    _folder(tmp_path, PRODUCT, "# 1.0.0\n")
    real = shutil.move

    def move(src, dst):
        if "control4_staging" in str(src):
            raise OSError("disk full")
        return real(src, dst)
    monkeypatch.setattr(C.shutil, "move", move)
    with pytest.raises(OSError):
        C.install_files(str(tmp_path), _zip(manifest={**PRODUCT, "version": "2.0.0"}), "20261125T120000Z")
    assert (tmp_path / "custom_components" / "control4" / "__init__.py").read_text() == "# 1.0.0\n"
    assert _backups(tmp_path) == []


def test_a_bad_zip_changes_nothing_on_disk(tmp_path) -> None:
    _folder(tmp_path, PRODUCT, "# 1.0.0\n")
    with pytest.raises(C.C4LocalError):
        C.install_files(str(tmp_path), _zip({"../x": "y"}), "20261125T120000Z")
    assert (tmp_path / "custom_components" / "control4" / "__init__.py").read_text() == "# 1.0.0\n"
    assert _backups(tmp_path) == [] and not (tmp_path / "padspan_ha" / "control4_staging").exists()


# ── Home Assistant: status, gates, admin, no restart ─────────────────────────

class _Hass:
    def __init__(self, root: Path, entries=(), flows=()) -> None:
        self.config = SimpleNamespace(config_dir=str(root))
        self.data = {}
        self.config_entries = SimpleNamespace(async_entries=lambda d: list(entries) if d == "control4" else [],
                                              flow=SimpleNamespace(async_progress_by_handler=lambda d: list(flows)))

    async def async_add_executor_job(self, fn, *a):
        return fn(*a)


class _Conn:
    def __init__(self) -> None:
        self.results, self.errors = [], []

    def send_result(self, mid, payload=None):
        self.results.append(payload)

    def send_error(self, mid, code, message, **kw):
        self.errors.append((code, message))


@pytest.fixture
def ha(monkeypatch, tmp_path):
    """A Home Assistant with a Control4 entry that failed and its OS 2 controller; the licence answer settable; the
    product published (c4local on sale: out of licence.NOT_ON_SALE, as it will be flipped)."""
    monkeypatch.setattr(licence, "NOT_ON_SALE", ())
    allowed = SimpleNamespace(on=True)
    monkeypatch.setattr(licence, "hass_addon_allowed", lambda hass, name: allowed.on and name == "c4local")
    dev = SimpleNamespace(manufacturer="Control4", sw_version="2.10.6", config_entries={"e1"})
    other = SimpleNamespace(manufacturer="Control4", sw_version="3.3.1", config_entries={"e9"})
    from homeassistant.helpers import device_registry
    monkeypatch.setattr(device_registry, "async_get", lambda hass: SimpleNamespace(devices={"a": dev, "b": other}), raising=False)
    running = SimpleNamespace(value=None)
    loader = types.ModuleType("homeassistant.loader")

    async def custom(hass):
        return {"control4": running.value} if running.value else {}
    loader.async_get_custom_components = custom
    monkeypatch.setitem(sys.modules, "homeassistant.loader", loader)
    entry = SimpleNamespace(entry_id="e1", title="Control4 HC-800", state=SimpleNamespace(value="setup_retry"))
    return SimpleNamespace(hass=_Hass(tmp_path, [entry]), allowed=allowed, running=running, root=tmp_path)


def test_the_status_says_what_home_assistant_has(ha) -> None:
    st = _run(C.async_status(ha.hass))
    assert st["failed"] is True and st["os2"] == ["2.10.6"] and st["entries"] == [{"title": "Control4 HC-800", "state": "setup_retry"}]
    assert st["disk"] is None and st["running"] is None and st["restart_needed"] is False and st["allowed"] is True
    C.install_files(str(ha.root), _zip(), "20261125T120000Z")
    st = _run(C.async_status(ha.hass))
    assert st["disk"]["ours"] and st["restart_needed"] is True, "on disk, not loaded yet"
    ha.running.value = SimpleNamespace(name="OS 2 Local for Control4", version="1.0.0")
    assert _run(C.async_status(ha.hass))["restart_needed"] is False, "loaded since the restart"
    C.undo_files(str(ha.root), "20261125T130000Z")
    assert _run(C.async_status(ha.hass))["restart_needed"] is True, "removed, still loaded"


def test_install_and_the_update_check_need_pro_or_the_add_on_and_undo_never_does(ha, monkeypatch) -> None:
    pressed = []

    async def install(hass):
        pressed.append("install")
        return {"version": "1.0.0", "backup": None}

    async def latest(hass):
        pressed.append("check")
        return "1.0.0"

    async def undo(hass):
        pressed.append("undo")
        return {"what": "remove", "version": None}
    monkeypatch.setattr(C, "async_install", install)
    monkeypatch.setattr(C, "async_latest", latest)
    monkeypatch.setattr(C, "async_undo", undo)
    ha.allowed.on = False
    for cmd in (C.ws_c4local_install, C.ws_c4local_check):
        conn = _Conn()
        _run(cmd(ha.hass, conn, {"id": 1}))
        assert conn.errors == [("addon_required", C.NEED_ADDON)] and not conn.results
    assert pressed == [], "nothing downloaded or asked without the licence"
    conn = _Conn()
    _run(C.ws_c4local_undo(ha.hass, conn, {"id": 1}))
    assert pressed == ["undo"] and conn.results[0]["ok"], "taking it out is never locked behind the licence"
    ha.allowed.on = True
    conn = _Conn()
    _run(C.ws_c4local_install(ha.hass, conn, {"id": 1}))
    assert pressed[-1] == "install" and conn.results[0]["ok"] and conn.results[0]["restart_needed"] is True
    # The rule the gate uses: Pro, or a key that carries c4local.
    monkeypatch.undo()
    key = {"forensics_license_key": "PSPAN-C4LO-CALL-0001", "license_tier": "free", "license_addons": ["c4local"]}
    assert licence.addon_allowed(key, True, "c4local") and not licence.addon_allowed({**key, "license_addons": ["audio"]}, True, "c4local")
    assert licence.addon_allowed({"forensics_license_key": "PSPAN-PRO0", "license_tier": "pro"}, True, "c4local")
    assert not licence.addon_on_sale("c4local") and "c4local" in licence.ADDONS


def test_before_it_is_published_nothing_installs_or_asks_github_even_on_pro(ha, monkeypatch) -> None:
    """The owner (2026-11-25): nothing about c4local is offered, to anyone, Pro included, until the product is
    published (c4local on sale, licence.NOT_ON_SALE). Install and the update check refuse before the licence is even
    read; Undo still runs; the status says it."""
    pressed = []

    async def nope(hass):
        pressed.append("github")
        raise AssertionError("asked GitHub")

    async def undo(hass):
        pressed.append("undo")
        return {"what": "remove", "version": None}
    monkeypatch.setattr(C, "async_install", nope)
    monkeypatch.setattr(C, "async_latest", nope)
    monkeypatch.setattr(C, "async_undo", undo)
    monkeypatch.setattr(licence, "NOT_ON_SALE", ("c4local",))
    assert ha.allowed.on is True, "allowed (Pro): still refused"
    for cmd in (C.ws_c4local_install, C.ws_c4local_check):
        conn = _Conn()
        _run(cmd(ha.hass, conn, {"id": 1}))
        assert conn.errors == [("not_published", C.NOT_PUBLISHED)] and not conn.results, cmd.__name__
    assert pressed == []
    conn = _Conn()
    _run(C.ws_c4local_undo(ha.hass, conn, {"id": 1}))
    assert pressed == ["undo"] and conn.results[0]["ok"], "taking it out is never locked"
    assert _run(C.async_status(ha.hass))["published"] is False
    monkeypatch.setattr(licence, "NOT_ON_SALE", ())
    assert _run(C.async_status(ha.hass))["published"] is True and C.published()
    # As it ships: not published.
    monkeypatch.undo()
    assert C.published() is False and "c4local" in licence.NOT_ON_SALE


@pytest.mark.parametrize("how", ["module", "package", "option", "option_in_data"])
def test_a_local_control4_of_the_houses_own_counts_as_having_it(ha, how) -> None:
    """A custom control4 that is not the product with a local login of its own (a local_token module, or an entry
    with director_password: the owner's house runs exactly this) is local_other: Install refuses to go over it."""
    folder = _folder(ha.root, {"domain": "control4", "name": "Control4", "version": "2026.7.4.1"})
    st = _run(C.async_status(ha.hass))
    assert st["local_other"] is False, "another integration alone is not a local login"
    if how == "module":
        (folder / "local_token.py").write_text("# local jwt\n", encoding="utf-8")
    elif how == "package":
        (folder / "local_token").mkdir()
    else:
        e = ha.hass.config_entries.async_entries("control4")[0]
        setattr(e, "options" if how == "option" else "data", {"director_password": "x"})
    st = _run(C.async_status(ha.hass))
    assert st["local_other"] is True and not st["disk"]["ours"]
    conn = _Conn()
    _run(C.ws_c4local_install(ha.hass, conn, {"id": 1}))
    assert conn.errors == [("local_other", C.LOCAL_OTHER)] and not conn.results
    assert (folder / "manifest.json").is_file(), "left as it was"


def test_the_product_itself_is_never_local_other(ha) -> None:
    C.install_files(str(ha.root), _zip(), "20261125T120000Z")
    (ha.root / "custom_components" / "control4" / "local_token.py").write_text("", encoding="utf-8")
    ha.hass.config_entries.async_entries("control4")[0].options = {"director_password": "x"}
    st = _run(C.async_status(ha.hass))
    assert st["disk"]["ours"] and st["local_other"] is False


def test_a_refusal_comes_back_with_its_code(ha, web) -> None:
    web.session = _Session({C.ZIP_URL: _Resp(302, TAG), TAG: _Resp(200, data=_zip(manifest={**PRODUCT, "name": "Control4"}))})
    conn = _Conn()
    _run(C.ws_c4local_install(ha.hass, conn, {"id": 1}))
    assert conn.errors and conn.errors[0][0] == "not_the_product" and not (ha.root / "custom_components" / "control4").exists()


def test_the_whole_install_through_the_command(ha, web) -> None:
    web.session = _Session({C.ZIP_URL: _Resp(302, TAG), TAG: _Resp(302, STORE), STORE: _Resp(200, data=_zip())})
    conn = _Conn()
    _run(C.ws_c4local_install(ha.hass, conn, {"id": 1}))
    r = conn.results[0]
    assert r["ok"] and r["version"] == "1.0.0" and r["status"]["disk"]["ours"] and r["status"]["restart_needed"]
    # A release whose zip says another version than its tag is not taken.
    web.session = _Session({C.ZIP_URL: _Resp(302, TAG.replace("v1.0.0", "v9.9.9")), TAG.replace("v1.0.0", "v9.9.9"): _Resp(200, data=_zip())})
    conn = _Conn()
    _run(C.ws_c4local_install(ha.hass, conn, {"id": 1}))
    assert conn.errors[0][0] == "not_the_product"


def test_one_press_at_a_time(ha) -> None:
    async def both():
        lock = C._lock(ha.hass)
        async with lock:
            with pytest.raises(C.C4LocalError) as err:
                await C.async_undo(ha.hass)
            return err.value.code
    assert _run(both()) == "busy"


def _commands() -> dict[str, list[str]]:
    tree = ast.parse((_PKG / "c4local_install.py").read_text(encoding="utf-8"))
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef):
            src = [ast.unparse(d) for d in node.decorator_list]
            m = next((re.search(r"'padspan_ha/([a-z0-9_]+)'", s) for s in src if "websocket_command" in s), None)
            if m:
                out[m.group(1)] = src
    return out


def test_every_command_is_for_administrators_and_registered() -> None:
    cmds = _commands()
    assert set(cmds) == {"c4local_status", "c4local_check", "c4local_install", "c4local_undo"}
    for name, decorators in cmds.items():
        assert "websocket_api.require_admin" in decorators, name
    assert len(C.WS_COMMANDS) == 4
    ws = (_PKG / "websocket.py").read_text(encoding="utf-8")
    assert "from .c4local_install import WS_COMMANDS as _c4local_commands" in ws


def test_home_assistant_is_never_restarted_from_here() -> None:
    src = (_PKG / "c4local_install.py").read_text(encoding="utf-8")
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
    code = re.sub(r'"""(?:.|\n)*?"""', "", code)
    assert "services" not in code and "async_call" not in code and "async_stop" not in code
    js = (_WWW / "views" / "c4local.js").read_text(encoding="utf-8")
    # The one restart: Home Assistant's own service, inside the Restart button's handler, after its confirm.
    assert js.count("callService(") == 1
    fn = js[js.index("function _restart(ctx)"):]
    fn = fn[:fn.index("\n}\n")]
    assert fn.index("if (!confirm(") < fn.index('callService("homeassistant", "restart"')


def test_file_work_runs_in_the_executor() -> None:
    src = (_PKG / "c4local_install.py").read_text(encoding="utf-8")
    for fn in ("check_zip", "install_files", "undo_files", "disk_state"):
        assert f"hass.async_add_executor_job({fn}" in src, fn
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef):
            body = ast.unparse(node)
            for blocking in ("open(", "read_text(", "shutil.", "zipfile.", ".iterdir(", ".mkdir("):
                assert blocking not in body, (node.name, blocking)


# ── The panel ────────────────────────────────────────────────────────────────

def _node(views: Path, now: str | None = None) -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    args = [node, str(_ROOT / "tests" / "js" / "c4local.mjs"), str(views)] + ([now] if now else [])
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, res.stdout[-2000:] + res.stderr[-2000:]
    out = json.loads(lines[-1])
    assert not out["failures"] and res.returncode == 0, out["failures"]
    return out


def test_the_card_the_overview_and_the_licence_cards_specialty_part() -> None:
    """As it ships (not published): no card, to anyone, Pro included, nothing asked (tests/js/c4local.mjs)."""
    run = _node(_WWW / "views")
    assert run["out"]["published"] is False and len(run["checks"]) >= 10
    assert any(c.startswith("unpublished, Pro:") for c in run["checks"])
    out = run["out"]
    assert out["c4only"] == {"status": "✓ Your PadSpan add-on key is active.", "specialty": "SpecialtyOS 2 Local for Control4 · for life"}
    assert out["both"]["status"] == "✓ PadSpan add-ons: Audio until 2028-11-25", "never mixed with the feature add-ons"
    assert out["both"]["specialty"] == "SpecialtyOS 2 Local for Control4 · for life"
    assert out["nokey"] == {"specialty": None, "offer": ["audio", "alarm", "wifi", "climate", "timetravel", "vacation", "looks",
                                                         "insights", "lighting"]}, "not on sale: offered nowhere"
    assert out["pro"]["specialty"] is None


@pytest.fixture(scope="module")
def on_sale_copy(tmp_path_factory) -> Path:
    """The panel with c4local put on sale from 2026-12-20 by its date (on_sale_from), the way it will be flipped."""
    out = tmp_path_factory.mktemp("c4local_on_sale") / "padspan-ha"
    shutil.copytree(_WWW, out, ignore=shutil.ignore_patterns("*.png", "*.jpg", "*.webp", "*.glb", "*.mp4"))
    ed = out / "views" / "editions.js"
    src = ed.read_text(encoding="utf-8")
    old = 'on_sale: false, on_sale_from: "", category: "specialty"'
    assert src.count(old) == 1
    ed.write_text(src.replace(old, 'on_sale: false, on_sale_from: "2026-12-20T08:00:00Z", category: "specialty"'), encoding="utf-8")
    return out / "views"


def test_once_published_the_cards_their_presses_a_local_control4_and_no_thanks(on_sale_copy) -> None:
    """The same harness on the copy put on sale (its date come): Settings' card through Install, Update, Undo and the
    restart; a house's own local Control4 said and never offered; the Overview's card, its No thanks the install's
    (settings.c4local_offer_done), never on a wall."""
    run = _node(on_sale_copy, "2026-12-24T12:00:00Z")
    assert run["out"]["published"] is True and len(run["checks"]) >= 45, len(run["checks"])
    for name in ("Overview: No thanks is the install's: saved, and away for this page", "Overview: never on a wall",
                 "a local Control4 of its own, Pro: said, no Install and no offer",
                 "published in the panel's table alone (the backend's word not yet): no card"):
        assert name in run["checks"], name


def _offer_at(views: Path, now: str) -> str | None:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    run = ("import { install } from " + json.dumps((_ROOT / "tests" / "js" / "dom_shim.mjs").as_uri()) + "; install(globalThis);"
           f"Date.now = () => Date.parse({json.dumps(now)});"
           "const S = await import(" + json.dumps((views / "settings.js").as_uri()) + ");"
           "const el = (tag, attrs = {}, kids = []) => { const n = document.createElement(tag);"
           " for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));"
           " for (const c of [].concat(kids)) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); return n; };"
           "const p = S.specialtyPart(el, { tier: 'free', pro_has_key: false });"
           "const a = p ? p._all().find(n => n.localName === 'a') : null;"
           "console.log(JSON.stringify({ text: a ? a.textContent : null, href: a ? a.getAttribute('href') : null }));")
    r = subprocess.run([node, "--input-type=module", "-e", run], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_on_sale_by_its_date_the_offer_is_the_full_price_even_in_black_friday(on_sale_copy) -> None:
    assert _offer_at(on_sale_copy, "2026-12-20T07:59:59Z") == {"text": None, "href": None}
    got = _offer_at(on_sale_copy, "2026-12-24T12:00:00Z")   # inside the half-price sale (ADDON_HALF_UNTIL is Jan 2)
    assert got == {"text": "OS 2 Local for Control4 $26 CAD, once, for life", "href": "https://padspan.traks.ca/#c4local"}


def test_the_licence_cards_offer_is_counted_once_a_page_and_its_link_each_time(on_sale_copy) -> None:
    """While it is on sale, the Specialty part counts its offer like the add-ons' (addon_offer:licence_card:c4local, once
    per page load) and its link each time (addon_buy:licence_card:c4local); with nothing to send, it just shows."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    run = ("import { install } from " + json.dumps((_ROOT / "tests" / "js" / "dom_shim.mjs").as_uri()) + "; install(globalThis);"
           "Date.now = () => Date.parse('2026-12-24T12:00:00Z');"
           "const S = await import(" + json.dumps((on_sale_copy / "settings.js").as_uri()) + ");"
           "const el = (tag, attrs = {}, kids = []) => { const n = document.createElement(tag);"
           " for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));"
           " for (const c of [].concat(kids)) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); return n; };"
           "const sent = []; const send = (e) => sent.push(e);"
           "S.specialtyPart(el, { tier: 'free', pro_has_key: false });"
           "const p = S.specialtyPart(el, { tier: 'free', pro_has_key: false }, Date.now(), send);"
           "S.specialtyPart(el, { tier: 'free', pro_has_key: false }, Date.now(), send);"
           "const a = p._all().find(n => n.localName === 'a'); a.dispatchEvent(new Event('click')); a.dispatchEvent(new Event('click'));"
           "console.log(JSON.stringify(sent));")
    r = subprocess.run([node, "--input-type=module", "-e", run], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
    assert json.loads(r.stdout.strip().splitlines()[-1]) == ["addon_offer:licence_card:c4local", "addon_buy:licence_card:c4local",
                                                              "addon_buy:licence_card:c4local"]


def test_the_report_counts_it_like_the_other_add_ons() -> None:
    """The usage report and the dashboards (the owner, 2026-11-25): c4local is held, gained, offered and used like the
    add-ons, and is not sold until it is on sale (never everyone's meanwhile: Pro includes it)."""
    from custom_components.padspan_ha import addon_report as A
    from custom_components.padspan_ha import telemetry as T
    assert "c4local" in licence.ADDONS and "c4local" in licence.NOT_ON_SALE and not licence.addon_on_sale("c4local")
    assert T.ADDON_OFFER_PLACES["c4local_card"] == ("c4local",) and "c4local_card" in T.ADDON_BUY_PLACES
    for e in ("addon_offer:c4local_card:c4local", "addon_buy:c4local_card:c4local", "addon_offer:licence_card:c4local",
              "addon_buy:licence_card:c4local", "addon_gained:c4local", "addon_used:c4local"):
        assert e in T.ADDON_EVENTS and T.event_allowed(e), e
    # Its own card counts the offer and the link (views/c4local.js), as the licence card's Specialty part does.
    src = (_WWW / "views" / "c4local.js").read_text(encoding="utf-8")
    assert 'ED.addonOfferSeen(send, "c4local_card", "c4local");' in src and 'send("addon_buy:c4local_card:" + NAME)' in src
    assert src.count("_offer(el, st, now, ctx);") == 2
    # Used: its local override running here, counted only where it may be used (Pro, or a key carrying it).
    key = "PSPAN-AAAA-BBBB-CCCC-DDDD"
    pro = {"forensics_license_key": key, "license_tier": "pro"}
    assert A.used_words(pro, {}, True, c4_local=True) == ["c4local"] and A.used_words(pro, {}, True) == []
    assert A.used_words({}, {}, False, c4_local=True) == [], "not on sale is not everyone's"
    held = {"forensics_license_key": key, "license_tier": "free", "license_addons": ["c4local"], "license_addons_until": {}}
    assert A.used_words(held, {}, True, c4_local=True) == ["c4local"]
    A.check({"licence": "pro_life", "used": ["c4local"], "held": {"c4local": "gt365"}, "market": {}})
    # Never on the sale card, never half off (views/editions.js).
    ed = (_WWW / "views" / "editions.js").read_text(encoding="utf-8")
    picks = re.search(r"const SALE_CARD_PICKS = \[(.*?)\];", ed).group(1)
    assert "c4local" not in picks


def test_no_thanks_is_the_installs_kept_settable_and_through_a_restore() -> None:
    """The Overview card's No thanks (views/c4local.js): settings.c4local_offer_done, off by default, sent by any
    administrator's browser, kept through a restore, a factory reset and a Bright import (trial_state_kept)."""
    from custom_components.padspan_ha import settings_store as ss
    from custom_components.padspan_ha import websocket as ws
    from custom_components.padspan_ha import ws_settings
    assert ss.DEFAULT_SETTINGS["c4local_offer_done"] is False
    assert "c4local_offer_done" in {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    assert "c4local_offer_done" in ws_settings._EVERYONE_KEYS
    assert ss.trial_state_kept({"c4local_offer_done": True}, {"c4local_offer_done": False})["c4local_offer_done"] is True
    assert ss.trial_state_kept({}, {"c4local_offer_done": True})["c4local_offer_done"] is True
    from tests.test_settings_refusals import send
    got = send({"c4local_offer_done": True})
    assert not got["error"] and got["data"]["c4local_offer_done"] is True
