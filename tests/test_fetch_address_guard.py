"""The two addresses PadSpan fetches because the owner typed them: a robot
vacuum's (Valetudo, vacuum_import_preview and its link) and the ESPresense
Companion's (espresense_companion_import).

Both live on the home's network, so private addresses stay allowed. Never
fetched: this machine itself (loopback, "localhost"), link-local (where a
cloud server's metadata answers), multicast and the empty address, judged on
every address the name resolves to; a redirect is not followed; a query in
the address cannot take the path PadSpan adds.
"""

from __future__ import annotations

import asyncio
import socket
import sys
from types import ModuleType, SimpleNamespace

import pytest

from custom_components.padspan_ha import util
from custom_components.padspan_ha import vacuum_import as vi
from custom_components.padspan_ha import ws_devices as WD
from custom_components.padspan_ha import ws_vacuum as wsv
from custom_components.padspan_ha.const import DATA_MODEL, DATA_SETTINGS, DOMAIN
from tests.test_settings_refusals import changed_nothing, send

REFUSED = [
    "http://127.0.0.1:1/", "http://127.5.5.5/x", "http://localhost:8267", "http://LOCALHOST./",
    "http://robot.localhost/", "http://[::1]/", "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/", "http://[fe80::1]/", "http://0.0.0.0/", "http://[::]/",
    "http://224.0.0.1/", "http://[ff02::1]/",
]
ALLOWED = ["http://192.168.1.50", "http://10.0.0.5:8267", "https://172.16.3.4/", "http://[fd00::5]/",
           "http://172.31.255.1/"]


def _hass(names: dict[str, list[str]] | None = None) -> SimpleNamespace:
    """A Home Assistant whose loop resolves `names`; any other name is not found."""
    asked: list[str] = []

    async def getaddrinfo(host, port, type=0):  # noqa: A002 — asyncio's own name
        asked.append(host)
        if host not in (names or {}):
            raise socket.gaierror(socket.EAI_NONAME, "not found")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in names[host]]

    async def _exec(fn, *a):
        return fn(*a)
    return SimpleNamespace(loop=SimpleNamespace(getaddrinfo=getaddrinfo), asked=asked, data={DOMAIN: {}},
                           async_add_executor_job=_exec, states=SimpleNamespace(get=lambda eid: None))


def _check(h, url):
    asyncio.run(util.async_check_address(h, url, "the robot"))


@pytest.mark.parametrize("url", REFUSED)
def test_this_machine_link_local_multicast_and_empty_addresses_are_refused_without_a_lookup(url):
    h = _hass()
    with pytest.raises(util.AddressRefused, match="PadSpan does not fetch from"):
        _check(h, url)
    assert h.asked == []


@pytest.mark.parametrize("ip", ["127.0.0.1", "169.254.169.254", "::1", "fe80::1", "0.0.0.0", "224.0.0.9"])
def test_a_name_is_judged_by_every_address_it_resolves_to(ip):
    h = _hass({"robot.lan": ["192.168.1.50", ip]})
    with pytest.raises(util.AddressRefused, match=r"robot\.lan: it leads to"):
        _check(h, "http://robot.lan/")
    assert h.asked == ["robot.lan"]


@pytest.mark.parametrize("url", ALLOWED)
def test_the_homes_own_private_addresses_are_fetched(url):
    _check(_hass(), url)


def test_a_name_on_the_home_network_is_fetched_and_one_not_found_is_said_so():
    _check(_hass({"valetudo.lan": ["192.168.1.77"]}), "http://valetudo.lan/")
    with pytest.raises(util.AddressRefused, match="could not find nowhere.lan"):
        _check(_hass(), "http://nowhere.lan/")


@pytest.mark.parametrize("url", ["ftp://192.168.1.50/", "file:///etc/passwd", "http:///x", "robot.lan"])
def test_only_http_and_https_with_a_host(url):
    with pytest.raises(util.AddressRefused, match="http:// or https://"):
        _check(_hass(), url)


@pytest.mark.parametrize(("typed", "url"), [
    ("http://192.168.1.50/?x=", "http://192.168.1.50/api/v2/robot/state/map"),
    ("http://192.168.1.50/#a", "http://192.168.1.50/api/v2/robot/state/map"),
    ("http://192.168.1.50/?x=/api/v2/robot/state/map", "http://192.168.1.50/api/v2/robot/state/map"),
    ("http://user:pw@robot.lan:81/", "http://user:pw@robot.lan:81/api/v2/robot/state/map"),
    ("http://192.168.1.50/api/v2/robot/state/map", "http://192.168.1.50/api/v2/robot/state/map"),
    ("http://192.168.1.50/sub/", "http://192.168.1.50/sub/api/v2/robot/state/map"),
])
def test_a_query_in_the_robots_address_cannot_take_the_maps_path(typed, url):
    assert vi.valetudo_map_url(typed) == url


# ── the fetches themselves ────────────────────────────────────────────────────

class _Resp:
    def __init__(self, status, body=b"{}"):
        self.status = status
        self.content = SimpleNamespace(read=self._read)
        self._body = body

    async def _read(self, n=-1):
        return self._body

    async def json(self):
        return {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Session:
    def __init__(self, status):
        self.status = status
        self.gets: list[tuple[str, dict]] = []

    def get(self, url, **kw):
        self.gets.append((url, kw))
        return _Resp(self.status)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def web(monkeypatch):
    """aiohttp and HA's shared session, stood in: every GET recorded."""
    box = SimpleNamespace(status=200, sessions=[])

    def _new(*a, **kw):
        s = _Session(box.status)
        box.sessions.append(s)
        return s
    aio = ModuleType("aiohttp")
    aio.ClientTimeout = lambda **kw: kw
    aio.ClientSession = _new
    aio.ClientError = OSError
    monkeypatch.setitem(sys.modules, "aiohttp", aio)
    monkeypatch.setattr(sys.modules["homeassistant.helpers.aiohttp_client"], "async_get_clientsession",
                        lambda hass: _new(), raising=False)
    box.gets = lambda: [g for s in box.sessions for g in s.gets]
    return box


class _Conn:
    def __init__(self):
        self.result, self.error = None, None

    def send_result(self, _id, r):
        self.result = r

    def send_error(self, _id, code, text):
        self.error = (code, text)


def _preview(h, url):
    vs = vi.VacuumStore.__new__(vi.VacuumStore)
    vs.hass, vs.data, vs.preview, vs.live = h, vi._default_data(), None, None
    h.data[DOMAIN][vi.DATA_VACUUM] = vs
    conn = _Conn()
    asyncio.run(wsv.ws_vacuum_import_preview(h, conn, {"id": 1, "url": url}))
    return conn, vs


@pytest.mark.parametrize("url", ["http://127.0.0.1:1/", "http://169.254.169.254/latest/meta-data/",
                                 "http://localhost/"])
def test_the_vacuum_preview_refuses_in_words_and_fetches_nothing(web, url):
    conn, vs = _preview(_hass(), url)
    assert conn.error[0] == "address_refused" and "PadSpan does not fetch from" in conn.error[1]
    assert web.gets() == [] and vs.preview is None


def test_the_robots_link_is_judged_on_every_read_too(web):
    """A link saved before this check reads the same guarded way."""
    with pytest.raises(util.AddressRefused):
        asyncio.run(vi.fetch_url_json(_hass(), "http://127.0.0.1:1/api/v2/robot/state/map"))
    assert web.gets() == []


def test_the_robot_is_asked_without_following_a_redirect(web):
    web.status = 302
    with pytest.raises(vi.VacuumImportError, match="another address"):
        asyncio.run(vi.fetch_url_json(_hass(), "http://192.168.1.50/api/v2/robot/state/map"))
    [(url, kw)] = web.gets()
    assert url == "http://192.168.1.50/api/v2/robot/state/map" and kw["allow_redirects"] is False


def _companion(h, url):
    h.data[DOMAIN][DATA_SETTINGS] = SimpleNamespace(data={"espresense_companion_url": url})
    h.data[DOMAIN][DATA_MODEL] = SimpleNamespace(data={})
    conn = _Conn()
    asyncio.run(WD.ws_espresense_companion_import(h, conn, {"id": 1}))
    return conn


@pytest.mark.parametrize("url", ["http://127.0.0.1:8267", "http://169.254.169.254", "http://localhost:8267",
                                 "http://[::1]:8267"])
def test_the_companion_import_refuses_in_words_and_fetches_nothing(web, url):
    conn = _companion(_hass(), url)
    assert conn.error[0] == "address_refused" and "ESPresense Companion's own address" in conn.error[1]
    assert web.gets() == []


def test_the_companion_name_that_leads_to_this_machine_is_refused(web):
    conn = _companion(_hass({"companion.lan": ["127.0.0.1"]}), "http://companion.lan:8267")
    assert conn.error[0] == "address_refused" and web.gets() == []


def test_the_companion_is_asked_at_its_own_path_without_following_a_redirect(web):
    web.status = 301
    conn = _companion(_hass(), "http://192.168.1.60:8267/?q=")
    [(url, kw)] = web.gets()
    assert url == "http://192.168.1.60:8267/api/state/config" and kw["allow_redirects"] is False
    assert conn.error[0] == "http_error" and "another address" in conn.error[1]


@pytest.mark.parametrize("typed", ["http://localhost:8267", "http://127.0.0.1:8267", "http://169.254.169.254",
                                   "http://[::1]:8267", "http://0.0.0.0:8267"])
def test_saving_the_companion_as_this_machine_is_refused_and_the_old_one_stays(typed):
    got = send({"espresense_companion_url": typed}, start={"espresense_companion_url": "http://old:1"})
    assert changed_nothing(got) and got["error"][0] == "address_refused"
    assert "Companion's own address on your home network" in got["error"][1]
    assert got["data"]["espresense_companion_url"] == "http://old:1"
