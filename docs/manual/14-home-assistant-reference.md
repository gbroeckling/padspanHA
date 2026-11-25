# 14. Home Assistant: entities, services, events, Assist

[Contents](README.md)

Everything PadSpan gives Home Assistant to use in automations, scripts, dashboards and Assist. The
tables are made from PadSpan's code by `scripts/build_manual_reference.py`, and a test fails when
they and the code disagree, so they describe the version they ship with.

## How entities are named

PadSpan makes entities only for devices you have **named** in PadSpan (a label on a Bluetooth
address, a phone or watch named through its key, or an iBeacon). The thousands of unnamed devices a
house hears get none.

Each named device is a Home Assistant device with PadSpan's name for it. Its entities take their ids
from that name the way Home Assistant always does: lower case, with spaces and marks as `_`. A tag
named "Car keys" gets `device_tracker.car_keys`, `sensor.car_keys_area` and
`sensor.car_keys_distance`. If an id is already taken, Home Assistant adds `_2`. You can rename an
entity in Home Assistant; PadSpan follows it by its unique id, not its name.

Which kinds of entity PadSpan makes is set in **Manage → HA Entities → Entity Publishing Controls**:
the tracker, the area sensor, the distance sensor and the per-receiver distance sensors are on unless
you untick them; the occupancy sensor and sub-zones are off unless you tick them. An unticked kind is
disabled in Home Assistant's entity registry, and ticked again it comes back. PadSpan must reload
before a newly ticked kind appears for devices it already has.

"In HA's history" in the tables says whether Home Assistant's database keeps that attribute. The
ones that change with every poll (about every 5 seconds), such as `rssi` and `age_s`, are left out
of the database to keep it small. They are still on the entity, so automations and templates can
read them.

`<device>` stands for the device's id part, `<receiver>` for the receiver as PadSpan names it, and
`<sub-zone>` for the sub-zone's name.

## Entities

<!-- generated:entities (scripts/build_manual_reference.py) -->
### `device_tracker.<device>`

| | |
|---|---|
| Platform | `device_tracker` |
| Unique id | `padspan_ha__<id>__tracker` |
| State | The room it is in, by its Home Assistant name (`Kitchen`). `not_home` once it has gone unheard for the away timeout. Before it has a room: Home Assistant's own `unknown`. |
| There | For each device you named in PadSpan: a Bluetooth address, a phone or watch named through its key (IRK), or an iBeacon. Attach it to a person in Home Assistant's Settings → People. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `address` | The Bluetooth address it was last heard on. | yes |
| `padspan_id` | PadSpan's own id for the device, the same across address changes. | yes |
| `rssi` | Its smoothed signal strength in dBm at the receiver that hears it best. Empty while away. | no |
| `age_s` | Seconds since it was last heard. | no |
| `user_label` | The name you gave it in PadSpan. | yes |
| `home` | `true` while it has been heard within the away timeout. | yes |
| `last_room` | The last room it was placed in. It stays once the state is `not_home`. | yes |
| `guest_session` | Only while it is a guest tag lent to someone: the stay's id. | yes |
| `guest_name` | Only while lent: the guest's name. | yes |
| `guest_since` | Only while lent: when the stay started (UTC). | yes |
| `guest_until` | Only while lent: when the stay is planned to end (UTC), or empty. | yes |
| `guest_off_limits` | Only while lent: the rooms the guest was asked to keep out of. | yes |
| `guest_in_off_limits` | Only while lent: `true` while the tag is in one of those rooms. | yes |
| `source_type` | Home Assistant's own. `bluetooth_le`. | yes |
| `latitude`, `longitude`, `gps_accuracy` | Home Assistant's own. Only when the house has a GPS origin set (it is off unless set): the device's position turned into latitude and longitude, so Home Assistant's map can draw it. | yes |

### `sensor.<device>_area`

| | |
|---|---|
| Platform | `sensor` |
| Unique id | `padspan_ha__<id>__area` |
| State | The room it is in, by its Home Assistant name. `not_home` once away, `unknown` while it has no room. |
| There | For each named device, like the tracker. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `kind` | `ble` (a Bluetooth address), `private_ble` (a phone or watch named through its key) or `ibeacon`. | yes |
| `address` | The Bluetooth address it was last heard on. | yes |
| `padspan_id` | PadSpan's own id for the device, the same across address changes. | yes |
| `rssi` | Its smoothed signal strength in dBm at the receiver that hears it best. Empty while away. | no |
| `age_s` | Seconds since it was last heard. | no |
| `sources` | The receivers hearing it now. Empty while away. | no |
| `home` | `true` while it has been heard within the away timeout. | yes |
| `last_room` | The last room it was placed in. It stays once the state is `not_home`. | yes |
| `room_confidence` | 0 to 1: how much of the recent room vote agrees on this room. | no |
| `rssi_margin_confidence` | 0 to 1: how far the winning room's signal is ahead of the next room's. | no |
| `room_unsure` | Only with **Mark a room as unsure when the signal is thin** on, and only while unsure: `few_scanners` (fewer than 3 receivers hear it) or `far_fingerprint` (no calibration point matches it well). The room is the one it had. | no |
| `ibeacon_uuid` | An iBeacon's UUID. | yes |
| `ibeacon_major` | An iBeacon's major number. | yes |
| `ibeacon_minor` | An iBeacon's minor number. | yes |
| `num_addresses` | For a device whose address changes: how many addresses PadSpan has seen it use. | yes |
| `all_addresses` | For a device whose address changes: the first five of those addresses. | yes |
| `room_reason` | Only with **Why This Room (Sensor Attribute)** on: why it is in this room. `votes_won`, `votes_needed` and `vote_window` (the room vote), `gate_active` (a jump to another room is held back until more polls agree), `current_room_bias` (the room was kept although another read slightly stronger), `source` (which step chose the room), `positioning` (that step's note), `top_room_scores` (the three best rooms) and `room_held` (shown through a short gap). | no |

### `sensor.<device>_distance`

| | |
|---|---|
| Platform | `sensor` |
| Unique id | `padspan_ha__<id>__distance` |
| Unit | m |
| State | Its estimated distance in metres from the receiver that hears it best. Empty while away. |
| There | For each named device, like the tracker. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `rssi` | Its smoothed signal strength in dBm. | no |
| `tx_power` | The transmit power the device advertises, if it does. | yes |
| `age_s` | Seconds since it was last heard. | no |
| `room` | The room it is in. | yes |

### `sensor.<device>_distance_<receiver>`

| | |
|---|---|
| Platform | `sensor` |
| Unique id | `padspan_ha__<id>__dist__<receiver>` |
| Unit | m |
| State | Its estimated distance in metres from that one receiver. Empty while away or while that receiver does not hear it. |
| There | One for each named device and receiver, made the first time that receiver hears it. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `scanner` | The receiver. | yes |
| `rssi` | Its signal strength in dBm at that receiver. | no |
| `age_s` | Seconds since it was last heard. | no |
| `room` | The room it is in (decided by all receivers, not this one alone). | yes |

### `sensor.padspan_occupancy_occupancy`

| | |
|---|---|
| Platform | `sensor` |
| Unique id | `padspan_ha__occupancy_estimate` |
| State | How many people PadSpan thinks are in the house, worked out every 30 seconds. |
| There | Only with `sensor.padspan_occupancy_occupancy` ticked in Manage → HA Entities → Entity Publishing Controls (off unless ticked), after PadSpan reloads. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `minimum` | The fewest people the evidence allows. | yes |
| `maximum` | The most people the evidence allows. | yes |
| `confidence` | How sure the estimate is. | no |
| `known` | People placed by their own named devices. | yes |
| `unknown` | People counted from phones nobody named and from sensors. | yes |
| `people` | Each known person: `name`, `room` and `kind`. | yes |
| `rooms` | Each room's evidence: `people`, `phones`, `occupancy` and `motion`. | no |

### `sensor.padspan_<sub-zone>_who`

| | |
|---|---|
| Platform | `sensor` |
| Unique id | `padspan_ha__subzone__<sub-zone id>__who` |
| State | The names of the named devices in the sub-zone, separated by commas, or `none`. |
| There | For each sub-zone (a bed, a couch, a desk drawn in Mapping → Edit → Sub-zones), with sub-zones switched on in Manage → HA Entities → Entity Publishing Controls. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `people` | The names of the named devices in it. | yes |
| `count` | How many. | yes |
| `room` | The room it was drawn in. | yes |
| `floor_id` | Its floor. | yes |
| `subzone_id` | PadSpan's id for the sub-zone. | yes |

### `binary_sensor.padspan_<sub-zone>_occupied`

| | |
|---|---|
| Platform | `binary_sensor` |
| Unique id | `padspan_ha__subzone__<sub-zone id>__occupied` |
| Device class | `occupancy` |
| State | `on` while any named device is in the sub-zone. |
| There | With the sub-zone's `who` sensor. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `people` | The names of the named devices in it. | yes |
| `count` | How many. | yes |
| `room` | The room it was drawn in. | yes |
| `floor_id` | Its floor. | yes |
| `subzone_id` | PadSpan's id for the sub-zone. | yes |

### `binary_sensor.padspan_vacation_mode`

| | |
|---|---|
| Platform | `binary_sensor` |
| Unique id | `<entry id>_vacation_mode` |
| State | `on` while Vacation Mode runs. |
| There | Always. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `since` | When this vacation started (UTC). Empty while off. | yes |
| `routine` | Which routine it switches lights by: `own` (learned for this trip), `resumed` (the last trip's, turned back on within three weeks), `standin` (the last one learned, while this trip's is not built yet) or `none`. Empty while off. | yes |
| `source` | Where each day's routine comes from: `last_week` (the same day last week) or `month` (that weekday's average over the last month). | yes |
| `paused_someone_home` | `true` while it waits because someone is home. | yes |
| `ends` | When the trip ends by itself (UTC), or empty. | yes |
| `intensity` | 5 to 100: how much of the usual lighting it switches. | yes |
| `after_dark_only` | `true` when lights go on only after sunset. | yes |
| `pause_when_home` | `true` when it waits while anyone is home. | yes |
| `bedtime` | The time lights go off (HH:MM), or empty. | yes |
| `max_on_minutes` | The longest a light it turned on stays on, or empty. | yes |
| `max_lights_at_once` | The most lights on at once, or empty. | yes |
| `anchor_lights` | Lights held on through the evening, or empty. | yes |
| `last_off` | When it was last turned off (UTC). | yes |
| `last_off_by` | Who or what turned it off last: the person's name, or `end_date` or `reset`. | yes |

### `binary_sensor.padspan_guest_home`

| | |
|---|---|
| Platform | `binary_sensor` |
| Unique id | `<entry id>_guest_home` |
| State | `on` while a guest's tag is heard in the house. |
| There | From the first time guest tags are switched on. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `guests` | Each guest staying now: `name`, `tag`, `home` (`true` while heard) and `room`. | yes |

### `light.<power team>`

| | |
|---|---|
| Platform | `light` |
| Unique id | `padspan_power_team_<team id>` |
| State | `on` or `off`: the team's power. Turning it on switches the power on, then sends the bulbs their colour once they answer. Colour temperature 2000 to 6500 K, or a colour, and a fade (`transition`) of any length. |
| There | For each power team (a wall dimmer or switch and the smart bulbs it feeds). Effects `Adaptive` (follows the day) and `Sleep`, for a team set to follow the day. |

| Attribute | What it is | In HA's history |
|---|---|---|
| `padspan_power_team` | Always `true`: this light is a PadSpan power team. | yes |
| `team_id` | PadSpan's id for the team. | yes |
| `power` | The switch or dimmer that powers the bulbs, or empty for a team of bulbs only. | yes |
| `bulbs` | The bulbs in the team. | yes |
| `phase` | `off`, `starting` (the bulbs are waking), `ready` or `failed` (some never answered). | yes |
| `missing` | The bulbs that did not answer. | yes |
| `follows_the_day` | `true` while its effect is `Adaptive`. | yes |
| `turns_off` | `power` (off cuts the power) or `bulbs` (off turns the bulbs off and leaves the power on). | yes |
| `waking` | `true` while the light is the team's wake-up: its slow fade, then its brightness and colour. | yes |
| `fading` | `true` while a wake-up's slow fade is still running. | yes |
| `brightness_follows` | `true` while the day leads its brightness (`false` once a brightness was set by hand, or in Sleep). | yes |
| `going_off` | `true` while a bedtime (or Sleep in 30 min) is fading it to Sleep and will turn it off at the end. | yes |
<!-- /generated:entities -->

## Services

<!-- generated:services (scripts/build_manual_reference.py) -->
### `padspan_ha.set_room_tag_map`: Set Room Tag Map

Replace the curated room_tag_map (room name → list of object keys). Persisted across restarts.

| Field | Required | Takes | Default | What it does |
|---|---|---|---|---|
| `room_tag_map` | yes | a mapping |  | Room name → list of PadSpan object keys. Replaces the whole map. |

### `padspan_ha.dump_devices`: Dump Devices

Returns all tracked BLE devices with current room, RSSI, age, and smoothing state. Equivalent to Bermuda BLE Trilateration dump_devices service. Supports response data for use in templates, scripts, and automations. Also creates a persistent notification.

| Field | Required | Takes | Default | What it does |
|---|---|---|---|---|
| `notify` | no | true or false | true | Create a persistent notification summary in HA (default true). |

### `padspan_ha.wled_on`: WLED on with its look

Turns WLED lights on with the look PadSpan remembered for them (every part, colour, white, effect and brightness), exactly and with no flash. A light PadSpan doesn't run is turned on by Home Assistant as usual.

Target: `light` entities of the `wled` integration.

| Field | Required | Takes | Default | What it does |
|---|---|---|---|---|
| `brightness_pct` | no | number, 1 to 100 % |  | Brightness in percent. Leave empty for the remembered brightness. |
| `transition` | no | number, 0 to 300 s |  | Fade time in seconds. Leave empty for the remembered fade. |

### `padspan_ha.wled_off`: WLED off

Turns WLED lights off the way PadSpan does: only the light as a whole goes off, so its remembered look is there the next time it comes on.

Target: `light` entities of the `wled` integration.

| Field | Required | Takes | Default | What it does |
|---|---|---|---|---|
| `transition` | no | number, 0 to 300 s |  | Fade time in seconds. Leave empty for the remembered fade. |

### `padspan_ha.reload_screens`: Reload screens

Loads the open PadSpan pages again (wall tablets, TVs, desktops), so new code reaches a screen nobody is standing at. Needs Settings → Atlas → Open screens switched on.

| Field | Required | Takes | Default | What it does |
|---|---|---|---|---|
| `screens` | no | text |  | Names or ids of the screens to reload (Settings → Atlas → Open screens). Leave empty for every screen. |

### `padspan_ha.announce`: Announce on screens

Shows a message big over the open PadSpan pages for a few seconds, with a chime, and reads it aloud if asked. Needs Settings → Atlas → Open screens switched on.

| Field | Required | Takes | Default | What it does |
|---|---|---|---|---|
| `message` | yes | text |  | What to show (up to 300 characters). |
| `title` | no | text |  | A short line above the message. |
| `screens` | no | text |  | Names or ids of the screens to show it on. Leave empty for every screen. |
| `seconds` | no | number, 3 to 300 s | 15 | How long it stays up. |
| `chime` | no | true or false | true | Play a short chime first. |
| `speak` | no | true or false | false | Read the message aloud with the screen's own browser voice. |
<!-- /generated:services -->

`padspan_ha.dump_devices` can return its list to the caller: in a script, give the action a
`response_variable` and read `devices` (each device's data, by PadSpan's key), `count`, `version` and
`timestamp` from it. With `notify: false` it only returns the list.

`padspan_ha.set_room_tag_map` stores a list of which PadSpan objects belong in each room. PadSpan
compares it with what it hears now and shows the missing ones. Most homes never need it.

## Events

Each one can trigger an automation (**Event** trigger, with the event type below). They fire only for
devices you have named.

<!-- generated:events (scripts/build_manual_reference.py) -->
### `padspan_device_arrived`

A named device is heard again after being away (not on the first poll after Home Assistant starts).

| Data | What it is |
|---|---|
| `device_key` | PadSpan's key for the device. |
| `label` | Its name. |
| `room` | The room it arrived in, if known. |

### `padspan_device_departed`

A named device has gone unheard for the away timeout.

| Data | What it is |
|---|---|
| `device_key` | PadSpan's key for the device. |
| `label` | Its name. |

### `padspan_room_change`

A followed device moves to another room, with **Room-change tag events** on (Settings → Tracking → Home Assistant and integrations → HA Tags Integration; off unless switched on). At most one every 30 seconds per device: a move inside that time is sent when it ends, if the device is still elsewhere.

| Data | What it is |
|---|---|
| `object_key` | PadSpan's key for the device. |
| `label` | Its name. |
| `from_room` | The room it left. |
| `to_room` | The room it is in now. |
| `tag_id` | The Home Assistant tag id sent with it (`padspan_…`). |
| `timestamp` | When, in seconds since 1970 (UTC). |

### `padspan_nfc_identify_result`

With **NFC tap-to-identify** on: after a phone scans an NFC tag, whether PadSpan named the strongest unnamed Bluetooth signal in that phone's room.

| Data | What it is |
|---|---|
| `success` | `true` when it named one. |
| `object_key` | PadSpan's key for the device it named. |
| `label` | The name it gave. |
| `room` | The phone's room. |
| `rssi` | That device's signal strength in dBm. |
| `tag_id` | The NFC tag scanned. |
| `reason` | Why not: `no_candidates`. |

### `padspan_phone_autolinked`

With **Phone auto-link on NFC scan** on: a phone that scanned an NFC tag is now followed by its BLE Transmitter.

| Data | What it is |
|---|---|
| `device_id` | The phone's Home Assistant device id. |
| `device_name` | Its name. |
| `ibeacon_key` | PadSpan's key for its BLE Transmitter. |

### `padspan_ha_guest`

With guest tags on: a stay starts or ends, the guest arrives or leaves, stays in a room they were asked to keep out of, or has not been heard for a while.

| Data | What it is |
|---|---|
| `type` | `started`, `arrived`, `left`, `off_limits`, `reminder` or `ended`. |
| `session` | The stay's id. |
| `guest` | The guest's name. |
| `tag` | The tag's name. |
| `room` | For `arrived`, `left` and `off_limits`: the room. |
| `how` | For `ended`: `manual`, `scheduled` or `stale` (not heard for long enough). |

### `padspan_ha_vacation_mode`

Vacation Mode is turned on or off, or pauses because someone is home.

| Data | What it is |
|---|---|
| `on` | `true` while it runs. |
| `how` | `panel` (switched in PadSpan), `resumed` (turned back on, carrying on the last trip), `end_date`, `reset` (a Factory Reset), `paused_home` or `unpaused`. |
<!-- /generated:events -->

With **Room-change tag events** on, each `padspan_room_change` also comes as Home Assistant's own
**Tag** trigger: PadSpan reports a tag scan with the tag id `padspan_…` for that device. The ids are
listed on that card in Settings → Tracking → Home Assistant and integrations, under HA Tags
Integration. Home Assistant adds each such tag to its Tags list.

## Assist: "which room is Alex in?"

Home Assistant's own Assist answers "where is Alex?" for a person, and a person takes the room from a
PadSpan tracker only when no other tracker on that person says more: a phone's GPS or a router's
"home" wins. For an answer that always names the room, PadSpan adds its own intent. It does nothing
until you add sentences for it. Save this as `config/custom_sentences/en/padspan.yaml` and restart
Home Assistant (or reload it from the Assist debug page):

```yaml
language: "en"
intents:
  PadSpanWhereIs:
    data:
      - sentences:
          - "which room is {padspan_person} in"
          - "what room is {padspan_person} in"
          - "where in the house is {padspan_person}"
lists:
  padspan_person:
    wildcard: true
```

<!-- generated:assist (scripts/build_manual_reference.py) -->
Intent: `PadSpanWhereIs`. Slots: `padspan_person`, `name`.

What it answers, in English:

- "I don't know anyone called <name>."
- "<name> is away."
- "I don't know which room <name> is in right now."
- "<name> is probably in the <room>."
- "<name> is in the <room>."

"probably" when the room's `room_confidence` is under 0.5.
<!-- /generated:assist -->

The name is the device's PadSpan name ("Alex"). It also matches a name that starts with it ("Alex's
Phone", "Alex Watch"); with several, it picks the one heard most recently. You don't need to expose
anything to Assist. The intent only reads PadSpan's current room and changes nothing. The answers are
in English. More on what Home Assistant's own sentences do: [Ask Assist where someone
is](../GETTING_STARTED.md#ask-assist-where-someone-is).

## MQTT (experimental)

With **Enable experimental MQTT publishing** ticked (Manage → HA Entities → MQTT Publishing; off
unless ticked) and Home Assistant's MQTT integration set up, PadSpan also publishes each named device
after every poll, retained. Here `<device>` is the name in lower case with spaces as `_`. The topics
may change in a later version.

<!-- generated:mqtt (scripts/build_manual_reference.py) -->
| Topic | Holds |
|---|---|
| `padspan/devices/<device>/state` | JSON: `room`, `rssi`, `age_s`, `home`, `room_confidence` |
| `padspan/devices/<device>/area` | The room, `not_home` or `unknown`, as on the area sensor. |
| `padspan/devices/<device>/distance` | The distance in metres. Not sent while away. |
<!-- /generated:mqtt -->

## Lights follow people

PadSpan can switch room lights itself, with no automation to write. It is free, and off until you
turn it on: Settings → Tracking → Home Assistant and integrations → **Lights follow people**, tick
**Turn room lights on and off as people move**. Until then nothing is switched.

- **When someone comes in**: when a person with a named phone, watch or tag comes into a room you
  have set up, its lights go on. Only on coming in: a light someone turns off later is not turned
  back on, and dusk falling while they sit there does not turn it on either.
- **When the room is empty**: once nobody has been in the room for its off delay (2 minutes unless
  you pick 30 seconds to an hour), its lights go off, once. Only a room someone tracked was in: a
  light turned on in a room nobody tracked has been in is left on. Leaving the house counts as
  leaving the room.
- **A light turned off by hand stays off**: if someone turns the room's lights off while they are
  in it (at the wall, in Home Assistant, or by another automation), PadSpan leaves them off until
  everyone has left the room for a minute and someone comes back. A walk to the doorway and back is
  not leaving.

For each room, under **Add a room…**:

- **Lights**: any lights and switches. A new room starts with the lights of the Home Assistant area
  of the same name. A room is saved once it has a light.
- **Off once empty for**: the off delay.
- **Turn on**: always, only when the sun is down, or only when a light sensor reads below a level
  you set (in lux). A sun or light sensor that can't be read counts as dark.
- **Quiet hours**: a time range in which nothing is turned on (it may run past midnight). Lights
  still go off when the room is empty.
- **Sensors**: motion, occupancy or presence sensors in the room. A room change waits for Room
  Change Delay (Settings → Tracking → Rooms and timing), 20 to 40 seconds, so the light would come
  on late. When PadSpan's latest reading already puts someone in a room and that room's own sensor
  sees movement, the lights go on at once. A new room starts with its area's motion sensors. A
  sensor alone, with no tracked person, turns nothing on.

**People**: everyone you have named counts, except guest tags ([chapter 7](07-tags-and-beacons.md#guest-tags)).
Untick anyone who shouldn't switch lights, and tick a guest tag to let it. A tag that stays put
(keys, a bag) keeps its room lit: untick it.

What each room holds now (who is in it, and whether a light was turned off by hand) shows under
the room. The opt-in usage report counts how often lights were switched and why not, never a room,
a name or a light ([chapter 24](24-privacy.md#the-usage-report-opt-in)).

### Blueprints, for your own automations

Three Home Assistant blueprints do the same with Home Assistant's own automations, from PadSpan's
area sensors. Import one, then make an automation from it under Settings → Automations & scenes →
Blueprints.

- [Room lights follow people](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fgbroeckling%2FpadspanHA%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fpadspan_ha%2Froom_lights_follow_people.yaml): one room's lights on for the
  first person in, off once nobody you chose has been in it for a while.
- [Lights on in whichever room you walk into](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fgbroeckling%2FpadspanHA%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fpadspan_ha%2Flights_on_in_whichever_room.yaml): one
  automation for the whole house, by the area named as the room.
- [Lights off when a room is empty](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fgbroeckling%2FpadspanHA%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fpadspan_ha%2Froom_lights_off_when_empty.yaml): off once no phone and no
  motion sensor has seen anyone for a while.

They are in the repository under `blueprints/automation/padspan_ha/`.

## Three automations

Each one is a whole automation: paste it into a new automation's **Edit in YAML**. The names are
examples; use your own entity ids.

**A light on when Alex walks into the kitchen**, only when PadSpan is fairly sure of the room:

```yaml
alias: Kitchen light for Alex
trigger:
  - platform: state
    entity_id: sensor.alex_phone_area
    to: Kitchen
condition:
  - condition: numeric_state
    entity_id: sensor.alex_phone_area
    attribute: room_confidence
    above: 0.6
action:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
```

The state is the room's name as Home Assistant has it, with its capitals.

**A notice when the car keys leave the house**:

```yaml
alias: Car keys left
trigger:
  - platform: event
    event_type: padspan_device_departed
    event_data:
      label: Car keys
action:
  - action: notify.notify
    data:
      message: "The car keys have left the house."
```

The event comes once the keys have gone unheard for the away timeout (5 minutes unless you changed
it in Settings → Tracking → Rooms and timing → Home/Away Timeout).

**Arm the alarm while Vacation Mode runs**:

```yaml
alias: Alarm with Vacation Mode
trigger:
  - platform: state
    entity_id: binary_sensor.padspan_vacation_mode
    to: "on"
action:
  - action: alarm_control_panel.alarm_arm_away
    target:
      entity_id: alarm_control_panel.house
```

More recipes: [Room presence automations](https://padspan.traks.ca/guides/room-presence-automations/).
