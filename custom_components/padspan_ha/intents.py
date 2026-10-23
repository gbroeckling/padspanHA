# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
"Which room is Alice in?" for Assist — the PadSpanWhereIs intent.

Assist's own "where is <name>" (HassGetState, name_where) answers for person
entities only, and a person takes a PadSpan tracker's room as its state only
when nothing better is attached: a phone's GPS or a router's "home" wins over
a room (person/entity.py _update_state), so it says "Alice is at home". The
Area sensor answers "what is Alice Area" — "Alice Area is Kitchen" — which
nobody says. This intent reads the room straight from the presence
coordinator.

Registered once, but nothing reaches it until the user adds the sentences in
docs/GETTING_STARTED.md to config/custom_sentences/: no built-in sentence
names PadSpanWhereIs, and no LLM agent is given it as a tool: there is no
llm.py platform (Home Assistant 2026.8 and later), and on earlier versions,
which offered every registered intent, its platforms are this integration's
domain, which no exposed entity has. Read-only: it looks at the coordinator's
data and writes nothing.
"""

from typing import Any

from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .presence_rules import away_timeout_s, is_away

INTENT_WHERE_IS = "PadSpanWhereIs"
# Below this the room is said as a guess ("probably in the Kitchen").
_SURE = 0.5


def _norm(text: Any) -> str:
    s = str(text or "").strip().lower().replace("’", "'")
    s = s.removeprefix("the ")
    return " ".join(s.replace("'s ", " ").removesuffix("'s").split())


def find_device(data: dict[str, Any] | None, name: str) -> dict[str, Any] | None:
    """The labelled device a spoken name means, or None.

    The label itself ("Alice") first, else a label that starts with the name
    ("Alice's Phone", "Alice Watch"). Several matches: the one heard most
    recently, since that is the one with the person.
    """
    want = _norm(name)
    if not want:
        return None
    exact: list[dict[str, Any]] = []
    starts: list[dict[str, Any]] = []
    for obj in (data or {}).values():
        if not isinstance(obj, dict) or not obj.get("user_label"):
            continue
        label = _norm(obj["user_label"])
        if label == want:
            exact.append(obj)
        elif label.startswith(want + " "):
            starts.append(obj)
    found = exact or starts
    if not found:
        return None

    def _age(o: dict[str, Any]) -> float:
        a = o.get("age_s")
        return float(a) if isinstance(a, (int, float)) and not isinstance(a, bool) else 1e12

    return min(found, key=_age)


def where_is_answer(data: dict[str, Any] | None, name: str, timeout_s: float) -> str:
    """The spoken answer for "which room is <name> in"."""
    spoken = str(name or "").strip() or "them"
    obj = find_device(data, name)
    if obj is None:
        return f"I don't know anyone called {spoken}."
    who = str(obj.get("user_label") or spoken)
    if is_away(obj, timeout_s):
        return f"{who} is away."
    room = obj.get("room")
    if not room:
        return f"I don't know which room {who} is in right now."
    conf = obj.get("room_confidence")
    if isinstance(conf, (int, float)) and conf < _SURE:
        return f"{who} is probably in the {room}."
    return f"{who} is in the {room}."


@callback
def async_setup_intents(hass: HomeAssistant) -> None:
    """Register PadSpanWhereIs. Inert until custom sentences name it."""
    import voluptuous as vol  # noqa: PLC0415
    from homeassistant.helpers import intent  # noqa: PLC0415

    class WhereIsHandler(intent.IntentHandler):
        intent_type = INTENT_WHERE_IS
        description = "Says which room a PadSpan-tracked person or device is in"
        # Kept off LLM agents' tools (see above); sentences still reach it.
        platforms = {DOMAIN}
        # The sentences in docs/GETTING_STARTED.md fill padspan_person.
        slot_schema = {vol.Optional("padspan_person"): str, vol.Optional("name"): str}

        async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
            slots = intent_obj.slots or {}
            slot = slots.get("padspan_person") or slots.get("name") or {}
            name = slot.get("value") if isinstance(slot, dict) else slot
            coord = intent_obj.hass.data.get(DOMAIN, {}).get("presence_coordinator")
            data = getattr(coord, "data", None)
            response = intent_obj.create_response()
            response.async_set_speech(
                where_is_answer(data, str(name or ""), away_timeout_s(intent_obj.hass))
            )
            return response

    intent.async_register(hass, WhereIsHandler())
