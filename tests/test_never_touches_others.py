"""PadSpan never changes another integration's devices, entities or config entries.

Issue #57: someone installed PadSpan, disabled it, and their eight Private BLE
Device entries were gone. The cause was a mislabelled button (it said "stop
tracking", it deleted the Private BLE entry), fixed in 0.19.x — but nothing
stopped the next change from doing the same thing quietly.

This scans the source for every call that can change Home Assistant's
registries or config entries, or call a service, and fails on any call that is
not listed in ALLOWED below with the reason it is safe. Each entry names the
function it lives in and, where the safety depends on a check in that
function (only PadSpan's own platform, only its own domain), a GUARD string
that must still be in the function — delete the check and the test fails.

Entries marked OTHER are the audited places that do act on another
integration's objects. Every one is a button the user presses, for that one
object; none runs on its own, on unload or on removal. The deletes are
admin-only and confirmed twice by name; the two any user can press (assign a
radio's area, turn on a phone's BLE Transmitter) say so below. Adding to that
list needs the owner's sign-off.

The frontend gets the same treatment for HA's own config/* calls.
"""
from __future__ import annotations

import ast
import functools
import pathlib
import re

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_WWW = _CC / "www"

_REGISTRY_MODULES = {"area_registry", "device_registry", "entity_registry",
                     "floor_registry", "label_registry"}
# Registry / config-entry methods that only read.
_READ_PREFIXES = ("async_get", "async_list", "async_entries", "async_is",
                  "async_loaded_entries", "async_has_entries", "async_domains",
                  "async_entry_for")
# Service domains PadSpan must never call: they reach the registries, config
# entries or HA itself.
_FORBIDDEN_SERVICE_DOMAINS = {"homeassistant", "config", "recorder", "hassio"}

OWN, OTHER = "own", "OTHER"

# (file, function, call) -> (kind, guard, reason)
ALLOWED: dict[tuple[str, str, str], tuple[str, str | None, str]] = {
    # ── PadSpan's own config entry ───────────────────────────────────────────
    ("__init__.py", "async_setup_entry", "config_entries.async_forward_entry_setups"):
        (OWN, "async_forward_entry_setups(entry", "sets up PadSpan's own platforms for its own entry"),
    ("__init__.py", "async_unload_entry", "config_entries.async_unload_platforms"):
        (OWN, "async_unload_platforms(entry", "unloads PadSpan's own platforms; nothing else"),
    ("websocket.py", "ws_integration_reload", "config_entries.async_reload"):
        (OWN, "async_entries(DOMAIN)", "Reload button: reloads PadSpan's own entry only"),
    ("bright_import.py", "async_import._reload", "config_entries.async_reload"):
        (OWN, "async_entries(DOMAIN)", "after a Bright import, reloads PadSpan's own entry only"),
    # ── PadSpan's own entities ───────────────────────────────────────────────
    ("ws_settings.py", "ws_settings_set", "registry.async_update_entity"):
        (OWN, "_entry.platform != DOMAIN",
         "entity on/off settings: enables/disables only entities whose platform is padspan_ha"),
    ("ws_subzones.py", "ws_subzone_remove", "registry.async_remove"):
        (OWN, "async_get_entity_id(platform, DOMAIN",
         "removing a sub-zone removes the sub-zone's own padspan_ha entities"),
    # ── Services: change a light/switch state or send a message, nothing else
    ("emergency_test.py", "_switch", "services.async_call"):
        (OWN, "domain not in _SWITCHABLE", "Emergency test: turn_on/off of lights/switches the user picked"),
    ("presence_coordinator.py", "_run_automations", "services.async_call"):
        (OWN, '("light", "switch", "scene", "script")',
         "PadSpan arrive/depart rules: turn_on/off of the entity the user set in the rule"),
    ("presence_coordinator.py", "async_send_follow_notify", "services.async_call"):
        (OWN, None, "follow alerts: sends a notification through the notify service the user chose"),
    ("vacation_mode.py", "_async_tick", "services.async_call"):
        (OWN, 'service = "turn_on" if want_on else "turn_off"',
         "Vacation Mode (off by default): turn_on/off of the user's lights"),
    ("wled_exact.py", "_plain_call", "services.async_call"):
        (OWN, '"light"', "light.turn_on/off for a WLED light the user has PadSpan run"),
    ("ws_companion.py", "ws_companion_follow", "services.async_call"):
        (OWN, '"command_ble_transmitter"',
         "Track a phone: asks the Companion App (via notify) to turn its BLE transmitter on"),
    ("ws_house3d_photo.py", "ask", "services.async_call"):
        (OWN, '"ai_task", "generate_data"', "Live Aboard photo: asks the user's AI Task entity to read a photo"),
    # ── OTHER: acts on another integration's object, only on a button press ──
    ("ws_companion.py", "ws_companion_follow", "registry.async_update_entity"):
        (OTHER, "_is_ble_transmitter(ent_entry) and ent_entry.disabled_by is not None",
         "Track a phone (any user): re-enables a disabled mobile_app BLE Transmitter sensor, "
         "nothing else (_is_ble_transmitter refuses other entities). Never disables."),
    ("ws_follow.py", "ws_entity_delete", "registry.async_remove"):
        (OTHER, None,
         "Manage > HA Entities 'Delete' (admin; another integration's entity is confirmed twice, "
         "naming it and its integration): removes the one entity the user picked"),
    ("ws_follow.py", "ws_area_delete", "registry.async_delete"):
        (OTHER, None,
         "Manage > Areas 'Delete' (admin, confirmed twice by name): deletes the one HA area the user picked"),
    ("ws_radios.py", "ws_radio_area_set", "registry.async_update_device"):
        (OTHER, None, "Overview radios list (any user, no admin check: non-admins use it today): "
                      "assigns a radio (ESPHome/Shelly/... device) to a room = its HA area"),
    ("ws_irk.py", "ws_private_ble_add_irk._try_create_entry", "config_entries.flow.async_init"):
        (OTHER, '"private_ble_device"', "Add IRK: starts HA's own Private BLE Device add flow for the IRK the user typed"),
    ("ws_irk.py", "ws_private_ble_add_irk._try_create_entry", "config_entries.flow.async_configure"):
        (OTHER, "flow_id, user_input", "Add IRK: submits the IRK to that flow"),
    ("ws_irk.py", "ws_private_ble_add_irk._try_create_entry._abort_flow", "config_entries.flow.async_abort"):
        (OTHER, "if flow_id", "Add IRK: aborts only the flow it started when a format is refused"),
    ("ws_irk.py", "ws_private_ble_add_irk", "config_entries.async_update_entry"):
        (OTHER, 'created.get("result")', "Add IRK: titles the entry it just created with the name the user gave"),
    ("ws_irk.py", "ws_private_ble_delete_irk", "config_entries.async_remove"):
        (OTHER, 'entry.domain != "private_ble_device"',
         "'Delete from HA' + two-step confirm (issue #57): removes the one Private BLE entry picked"),
}

# Frontend: (file, HA endpoint) -> (kind, reason)
ALLOWED_JS: dict[tuple[str, str], tuple[str, str]] = {
    # Door relay builder (Devices): creates padspanha_* helpers/scripts/
    # automations and one template entity, records them, and its Remove
    # deletes exactly what it recorded.
    ("www/padspan-ha/views/devices.js", "input_boolean/create"): (OWN, "door builder helper, padspanha_*"),
    ("www/padspan-ha/views/devices.js", "input_boolean/delete"): (OWN, "removes the recorded helper only"),
    ("www/padspan-ha/views/devices.js", "config/script/config"): (OWN, "padspanha_* scripts it made / removes"),
    ("www/padspan-ha/views/devices.js", "config/automation/config"): (OWN, "padspanha_* automations it made / removes"),
    ("www/padspan-ha/views/devices.js", "config/config_entries/flow"): (OWN, "creates the door's template entity"),
    ("www/padspan-ha/views/devices.js", "config/config_entries/entry"): (OWN, "deletes the recorded template entry only"),
    # OTHER, button press only.
    ("www/padspan-ha/views/lights_map.js", "config/entity_registry/update"):
        (OTHER, "'Assign room' picker: sets the area of the light the user picked"),
    ("www/padspan-ha/views/overview.js", "config/entity_registry/update"):
        (OTHER, "'Enable & Track': re-enables a phone's disabled BLE Transmitter entity (disabled_by: null)"),
}


@functools.lru_cache(maxsize=None)
def _scan_py():
    """([(file, function, call, line, function_source)] for every write call,
    [calls to a forbidden service domain])."""
    hits, forbidden = [], []
    for path in sorted(_CC.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src)
        rel = path.relative_to(_CC).as_posix()

        mods: set[str] = set()  # names bound to an HA registry module
        for n in ast.walk(tree):
            if isinstance(n, ast.ImportFrom) and (n.module or "").startswith("homeassistant.helpers"):
                for a in n.names:
                    if a.name in _REGISTRY_MODULES:
                        mods.add(a.asname or a.name)
            elif isinstance(n, ast.Import):
                for a in n.names:
                    if a.name.rsplit(".", 1)[-1] in _REGISTRY_MODULES and a.name.startswith("homeassistant"):
                        mods.add(a.asname or a.name)

        def is_reg_get(node) -> bool:
            # <registry module>.async_get(hass)
            return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "async_get"
                    and isinstance(node.func.value, ast.Name) and node.func.value.id in mods)

        def visit(fn, outer_vars: set[str], prefix: str = ""):
            qual = prefix + fn.name
            vars_ = set(outer_vars)
            for n in ast.walk(fn):
                if isinstance(n, ast.Assign) and is_reg_get(n.value):
                    vars_.update(t.id for t in n.targets if isinstance(t, ast.Name))
            fsrc = ast.get_source_segment(src, fn) or ""
            for n in _own_nodes(fn):
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    visit(n, vars_, qual + ".")
                    continue
                if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)):
                    continue
                meth, recv = n.func.attr, n.func.value
                rtxt = ast.unparse(recv)
                call = None
                if (isinstance(recv, ast.Name) and recv.id in (vars_ | mods)) or is_reg_get(recv):
                    if meth.startswith("async_") and not meth.startswith(_READ_PREFIXES):
                        call = f"registry.{meth}"
                elif rtxt.endswith(".config_entries.flow"):
                    call = f"config_entries.flow.{meth}"
                elif isinstance(recv, ast.Attribute) and recv.attr == "config_entries":
                    if not meth.startswith(_READ_PREFIXES):
                        call = f"config_entries.{meth}"
                elif isinstance(recv, ast.Attribute) and recv.attr == "services" and meth == "async_call":
                    dom = n.args[0].value if n.args and isinstance(n.args[0], ast.Constant) else None
                    call = "services.async_call"
                    if dom in _FORBIDDEN_SERVICE_DOMAINS:
                        forbidden.append(f"{rel}:{n.lineno} {qual}() calls {dom}.*")
                if call:
                    hits.append((rel, qual, call, n.lineno, fsrc))

        for top in _own_nodes(tree):
            if isinstance(top, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(top, set())
    return tuple(hits), tuple(forbidden)


def _own_nodes(node):
    """Every node under `node` (class bodies included), not descending into
    nested functions: they are yielded themselves, so the caller can
    attribute calls to them."""
    stack = list(ast.iter_child_nodes(node))
    while stack:
        n = stack.pop()
        yield n
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            stack.extend(ast.iter_child_nodes(n))


_JS_WRITE = re.compile(
    r"""(config/[a-z_]+_registry/(?:update|remove|delete|create)"""
    r"""|config/config_entries/(?:flow|entry|disable|update)"""
    r"""|config/(?:automation|script|scene)/config"""
    r"""|input_[a-z]+/(?:create|update|delete)"""
    r"""|services/(?:homeassistant|config|recorder)/[a-z_]+)""")


def _scan_js():
    hits = {}
    for path in sorted(_WWW.rglob("*.js")):
        rel = path.relative_to(_CC).as_posix()
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for m in _JS_WRITE.finditer(line):
                hits.setdefault((rel, m.group(1)), []).append(i)
    return hits


def test_every_registry_or_config_entry_write_is_audited():
    unknown = sorted({(f, fn, c, ln) for f, fn, c, ln, _ in _scan_py()[0] if (f, fn, c) not in ALLOWED})
    assert not unknown, (
        "New call that can change HA's registries, config entries or call a service. "
        "Check it only touches PadSpan's own objects, then add it to ALLOWED with why:\n"
        + "\n".join(f"  {f}:{ln} {fn}() {c}" for f, fn, c, ln in unknown))


def test_never_calls_services_that_change_ha_itself():
    assert not _scan_py()[1], (
        "homeassistant.*/config.*/recorder.*/hassio.* reach the registries, config entries "
        "or HA itself:\n  " + "\n  ".join(_scan_py()[1]))


def test_guards_that_keep_writes_on_padspan_objects_are_still_there():
    missing = []
    for f, fn, c, ln, fsrc in _scan_py()[0]:
        entry = ALLOWED.get((f, fn, c))
        if entry and entry[1] and entry[1] not in fsrc:
            missing.append(f"  {f}:{ln} {fn}() {c}: guard {entry[1]!r} is gone")
    assert not missing, "A check that kept a write on PadSpan's own objects was removed:\n" + "\n".join(missing)


def test_allowlist_has_no_stale_entries():
    seen = {(f, fn, c) for f, fn, c, _, _ in _scan_py()[0]}
    stale = sorted(set(ALLOWED) - seen)
    assert not stale, f"ALLOWED lists calls that no longer exist (remove them): {stale}"


def test_unload_and_removal_never_touch_registries_or_other_integrations():
    for f, fn, c, ln, _ in _scan_py()[0]:
        if f == "__init__.py" and fn in ("async_unload_entry", "async_remove_entry"):
            assert c == "config_entries.async_unload_platforms", (
                f"{f}:{ln} {fn}() now calls {c} — unload/removal may only unload PadSpan's own platforms")


def test_other_integration_writes_are_only_user_buttons():
    # Nothing acting on another integration's objects may run from setup,
    # the coordinator, a timer or teardown — only from a websocket command.
    for (f, fn, c), (kind, _g, _r) in ALLOWED.items():
        if kind == OTHER:
            assert fn.split(".")[0].startswith("ws_"), (
                f"{f} {fn}() {c} is not inside a user-pressed websocket command")


def test_frontend_writes_to_ha_config_are_audited():
    hits = _scan_js()
    unknown = sorted(k for k in hits if k not in ALLOWED_JS)
    assert not unknown, (
        "Frontend now calls an HA config endpoint that writes. Audit it and add to ALLOWED_JS:\n"
        + "\n".join(f"  {f}:{hits[(f, e)]} {e}" for f, e in unknown))
    stale = sorted(set(ALLOWED_JS) - set(hits))
    assert not stale, f"ALLOWED_JS lists endpoints no longer called: {stale}"
