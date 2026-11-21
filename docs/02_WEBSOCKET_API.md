# Websocket API

This page used to list PadSpan's WebSocket commands. That list was out of date: most of the commands it named no longer exist, and receiver positions are stored in metres, not as 0–1 fractions of the picture.

The panel talks to the integration over about 265 WebSocket commands (`padspan_ha/…`). They are internal: they change from release to release with the panel, and they are not documented or kept stable for other code. Don't build on them.

## What to use from your own automations, scripts and dashboards

These are Home Assistant's own entities, services and events, and they are kept stable.

**Entities**, for every device you name in PadSpan:

- `device_tracker.<name>`: its state is the room, or `not_home` once it hasn't been heard for the away timeout. Link it to a person under Home Assistant's Settings → People.
- `sensor.<name>_area`: the room. Its `last_room` attribute is the room it was last seen in.
- `sensor.<name>_distance` (metres to the nearest scanner) and `sensor.<name>_distance_<scanner>` (metres to each scanner that hears it).

Also `binary_sensor.padspan_vacation_mode` (on while Vacation Mode runs), `binary_sensor.padspan_guest_home` (once guest tags are on) and `binary_sensor.padspan_<sub-zone>_occupied` (one per sub-zone, when sub-zones are on).

**Events:** `padspan_device_arrived` and `padspan_device_departed` when a named device arrives or leaves, `padspan_room_change` when a followed device changes room, `padspan_ha_guest` for guest tags and `padspan_ha_vacation_mode` when Vacation Mode switches.

**Services** (Developer tools → Actions):

- `padspan_ha.dump_devices`: every tracked device with its room, signal and age, as response data for templates and scripts.
- `padspan_ha.set_room_tag_map`: replace the curated room map (room name → list of device keys), kept across restarts.
- `padspan_ha.wled_on` / `padspan_ha.wled_off`: switch WLED lights PadSpan runs on and off with their remembered look.

[What can Home Assistant do once it knows the room?](https://padspan.traks.ca/guides/room-presence-automations/) has eight automations to paste in, and Training → Full Manual → HA Entities & Automations in the panel lists the rest.
