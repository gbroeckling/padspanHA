"""The settings command does with every key exactly what is stored.

tests/golden_settings.py sends padspan_ha/settings_set every key its schema
accepts, with values the key is meant to take and values it is not, as an
administrator and as another user; this holds what came of each case (the
error sent, what was written to the settings store, what else was set going)
equal to tests/golden/settings/settings_set.jsonl, one case on each line.

That file is today's behaviour written down, not a statement of what is
right: a case that reads oddly there is how the command behaves now, and the
point of holding it is that restructuring ws_settings.py must not change it
unnoticed. A change on purpose changes the file:

    python -m tests.regen_goldens settings

and its diff shows, one line a case, exactly which cases changed.
"""

from __future__ import annotations

import pytest

from tests import golden_settings as gs
from tests import golden_tools as gt

pytestmark = gt.FULL_EDITION_ONLY


@pytest.fixture(scope="module")
def records() -> list[dict]:
    return gs.run()


def test_every_key_the_command_accepts_has_a_row() -> None:
    """A key added to the command's schema needs a row of values in
    tests/golden_settings.py (VALUES), so what the command does with it is
    written down too."""
    accepted, rows = set(gs.schema_keys()), set(gs.VALUES)
    assert not accepted - rows, (
        f"padspan_ha/settings_set accepts {sorted(accepted - rows)} but tests/golden_settings.py has no "
        "row for it. Add one to VALUES (a value the key is meant to take), then store the new output: "
        "python -m tests.regen_goldens settings")
    assert not rows - accepted, f"rows for keys the command no longer accepts: {sorted(rows - accepted)}"
    assert set(gs.FROM_OTHER_SETTINGS) <= accepted
    assert all(set(message) <= accepted for _n, message, _w, _s in gs.SEVERAL_KEYS)


def test_every_key_is_tried_with_a_value_it_is_meant_to_take_and_one_it_is_not(records) -> None:
    for key in gs.schema_keys():
        mine = [r for r in records if r["key"] == key and r["as"] == "admin" and "from" not in r]
        assert any(not r["case"].startswith("not meant") for r in mine), key
        assert any(r["case"].startswith("not meant") for r in mine), key
    # The rows are worth something only if the values meant to be taken are:
    # none of them is refused by the schema, and none makes the command raise.
    for r in records:
        if not r["case"].startswith("not meant"):
            assert r["schema"] == "accepted" and not r.get("raised"), r


def test_the_command_does_what_is_stored(records) -> None:
    gt.check_whole("settings", "settings_set", records, gs.label, one_per_line=True)
