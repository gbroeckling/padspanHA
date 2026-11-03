"""West Coast Forest as the first look in forested places (Garry, 2026-11-03):
the first time Showcase goes on, never over a look someone has."""
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha.ws_settings import _forested_home
from tests.test_house3d_store import _run
from tests.test_vacation_mode_last_week import _admin_house


@pytest.mark.parametrize("country, lat, lon, want", [
    ("DE", 52.5, 13.4, True),            # Berlin
    ("de ", 52.5, 13.4, True),
    ("SE", 59.3, 18.1, True),
    ("CA", 49.7, -123.2, True),          # Squamish
    ("CA", 48.4, -123.4, True),          # Victoria
    ("US", 47.6, -122.3, True),          # Seattle
    ("US", 45.5, -122.7, True),          # Portland
    ("US", 40.8, -124.2, True),          # Eureka
    ("US", 47.7, -117.4, False),         # Spokane: dry, east of the Cascades
    ("US", 37.8, -122.4, False),         # San Francisco
    ("CA", 43.7, -79.4, False),          # Toronto
    ("AU", -33.9, 151.2, False),
    (None, 49.3, -123.1, True),          # no country set: the map position still says
    (None, None, None, False),
])
def test_what_counts_as_forested(country, lat, lon, want) -> None:
    assert _forested_home(SimpleNamespace(country=country, latitude=lat, longitude=lon)) is want


def _house(country="DE", lat=52.5, lon=13.4, **stored):
    h, st, conn = _admin_house()
    h.config = SimpleNamespace(country=country, latitude=lat, longitude=lon)
    st.data.update(lights_showcase=False, lights_showcase_theme="classic", lights_showcase_seen=False)   # as a new home stores them
    st.data.update(stored)
    return h, st, conn


def _on(h, conn, **kw):
    from custom_components.padspan_ha import ws_settings as WS
    _run(WS.ws_settings_set(h, conn, {"id": 1, "lights_showcase": True, **kw}))


def test_the_first_time_showcase_goes_on_a_forested_home_starts_on_the_forest() -> None:
    h, st, conn = _house()
    _on(h, conn)
    assert st.data["lights_showcase"] is True and st.data["lights_showcase_theme"] == "west_coast_forest"


def test_elsewhere_it_stays_classic() -> None:
    h, st, conn = _house(country="AU", lat=-33.9, lon=151.2)
    _on(h, conn)
    assert st.data["lights_showcase_theme"] == "classic" and st.data["lights_showcase_seen"] is True


def test_a_theme_someone_has_is_never_replaced() -> None:
    h, st, conn = _house(lights_showcase_theme="aurora")
    _on(h, conn)
    assert st.data["lights_showcase_theme"] == "aurora"


def test_a_theme_sent_with_the_switch_wins() -> None:
    h, st, conn = _house()
    _on(h, conn, lights_showcase_theme="classic")
    assert st.data["lights_showcase_theme"] == "classic"


def test_someone_already_on_showcase_keeps_classic_even_after_turning_it_off_and_on() -> None:
    from custom_components.padspan_ha import ws_settings as WS
    h, st, conn = _house(lights_showcase=True)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "lights_showcase": False}))
    _on(h, conn)
    assert st.data["lights_showcase_theme"] == "classic"


def test_going_back_to_classic_stays_classic() -> None:
    from custom_components.padspan_ha import ws_settings as WS
    h, st, conn = _house()
    _on(h, conn)
    _run(WS.ws_settings_set(h, conn, {"id": 2, "lights_showcase_theme": "classic"}))
    _run(WS.ws_settings_set(h, conn, {"id": 3, "lights_showcase": False}))
    _on(h, conn)
    assert st.data["lights_showcase_theme"] == "classic"
