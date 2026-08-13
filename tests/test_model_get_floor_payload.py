"""model_get must ship every floor field the frontend sorts or edits by.

This repo has now shipped the same bug three times: a value exists in a store,
the UI has a control for it, and the websocket payload silently drops it, so
the control reads blank or the view sorts wrongly (light positions in f63e099,
the settings schema in issue #58).

For floors the fields are:
  level             the key _ordered_floors stacks by — the Floor Heights
                    table derives its "in use" elevations bottom-up, so a
                    view sorting without it lists them in the wrong order
  floor_to_floor_m  edited directly in that table
  base_elevation_m  the split-level / mezzanine override

The elevation fields come from the ModelStore and must overlay the HA floor
registry, which supplies id/name/level.
"""

from __future__ import annotations

import inspect
import re

from custom_components.padspan_ha import websocket as ws

_REQUIRED = ("level", "floor_to_floor_m", "base_elevation_m")


def _model_get_source() -> str:
    return inspect.getsource(ws.ws_model_get)


def test_registry_floors_carry_their_level():
    """The floor dict built from the HA registry must include level."""
    src = _model_get_source()
    m = re.search(r'\{"id": f\.floor_id[^}]*\}', src)
    assert m, "the floor-registry dict literal in ws_model_get moved or changed shape"
    assert '"level"' in m.group(0), (
        "model_get drops the registry floor level; any view that sorts floors "
        "by level then falls back to alphabetical and shows the stack out of order"
    )


def test_stored_elevation_fields_are_overlaid():
    """Every stored floor field the UI edits must be copied onto the payload."""
    src = _model_get_source()
    m = re.search(r"for _k in \(([^)]*)\):", src)
    assert m, "the ModelStore overlay loop in ws_model_get moved or changed shape"
    overlaid = set(re.findall(r'"([a-z_]+)"', m.group(1)))
    missing = [k for k in _REQUIRED if k not in overlaid]
    assert not missing, (
        f"model_get does not overlay stored floor fields {missing} — the "
        "Floor Heights inputs render blank and a saved value never round-trips"
    )


def test_payload_declares_floor_elevations():
    """The derived bases the table displays as 'in use' must be sent."""
    src = _model_get_source()
    assert '"floor_elevations"' in src, (
        "model_get no longer sends derived floor_elevations; the Floor Heights "
        "table cannot show which elevation each floor actually resolves to"
    )
