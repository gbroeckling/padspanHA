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


def test_the_panel_keeps_every_key_model_get_sends() -> None:
    """The panel's copy of the model must not be a whitelist.

    `panel.js _getModel` used to enumerate the keys it kept. It dropped one
    three separate times — origin forwarding, the migration marker, then
    `light_positions_m` and `floor_elevations` — and each time the symptom
    appeared somewhere unrelated (every correctly placed light rendering as
    unplaced). A whitelist there can only fail in one direction and only
    silently, so it is now a spread of the whole response over defaults.

    This asserts on the SHAPE, not on a key list: any key the backend's
    `send_result` payload names must reach `state.model` without the panel
    having to know it exists. It parses both sides.
    """
    from pathlib import Path

    src = _model_get_source()
    # Keys the backend actually emits: the top-level entries of the dict
    # handed to send_result. Match `"key": ` at the payload's indentation.
    m = re.search(r'connection\.send_result\(\s*msg\["id"\],\s*\{(.*?)\n\s*\}\s*,?\s*\)', src, re.S)
    assert m, "could not find model_get's send_result payload"
    backend_keys = set(re.findall(r'^\s{8}"([a-z_]+)"\s*:', m.group(1), re.M))
    assert len(backend_keys) >= 8, backend_keys

    panel = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
             / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    g = panel[panel.index("async _getModel(){"):]
    g = g[:g.index("this.state._modelLoaded = true;")]

    # The structural property: the response is spread wholesale.
    assert re.search(r"this\.state\.model\s*=\s*\{\s*\.\.\.defaults\s*,\s*\.\.\.", g), (
        "_getModel is enumerating keys again instead of spreading the response — "
        "the next backend field will be silently dropped")
    # And no key the backend sends is being explicitly re-read off `res`
    # one at a time, which is how a whitelist creeps back in.
    picked = set(re.findall(r"res\?\.([a-z_]+)", g))
    assert not picked, f"_getModel picks keys by hand again: {sorted(picked)}"
