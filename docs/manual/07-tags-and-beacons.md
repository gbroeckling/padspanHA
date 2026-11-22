# 7. Tags, beacons, AirTags and guest tags

[Contents](README.md)

To know which room your keys, a dog or a guest is in, Home Assistant has to recognise their tag
every time a receiver hears it. A plain beacon with a fixed ID does that. The best-known tags are
built not to: an AirTag keeps changing its Bluetooth address so that nobody can follow it.

## Which tag works

| Tag | What it sends | Room by room? |
|---|---|---|
| A beacon with a fixed iBeacon ID (Feasycom, Blue Charm, Minew and others) | The same ID every time; many let you set how often | Yes. Buy this kind. |
| Anything with one fixed address (cheap key finders, Shelly BLU and other BTHome devices, Xiaomi thermometers, RuuviTag, simple watches) | The same Bluetooth address every time | Yes, if it sends every few seconds. A sensor that only sends on an event won't hold a room. |
| Tile | Older ones keep one address; newer ones are reported to change it | Maybe. Test yours, and don't buy one for this. |
| AirTag and other Find My tags | A new address about every 15 minutes near the owner's iPhone | Not reliably. PadSpan can keep a named one going while it stays in range (experimental, below). |
| Samsung SmartTag, Google Find Hub tags | A new ID every 15 to 17 minutes | No. |
| A phone or smartwatch | A changing address, but a key or its own beacon names it | Yes, after one step per device: [chapter 6](06-phones-and-watches.md). |

A beacon sends the same ID (a UUID, major and minor) every time, so it is recognised even if its
address changes. The other side of that: anyone with a Bluetooth scanner can recognise that ID too.
That is no worry for the dog, but think about it for something you carry around town.

## What to look for

- **For keys**: a small beacon with a hole for the key ring, a coin cell you can replace, and an
  interval you can set. IP66 or better if it lives in a pocket.
- **For a collar**: waterproof (IPX7 or IP67), light enough for the animal, and a battery cover that
  is screwed or sealed (a swallowed coin cell can hurt a pet).
- **For guests**: a few key-ring beacons kept in a drawer. Multi-packs can ship with one shared ID,
  so give each its own minor in the maker's app.

**How often it sends.** Around once a second is a good start. PadSpan doesn't use a reading older
than about 15 seconds to place a tag, so one that sends only now and then won't hold its room. A
faster interval costs battery: the makers' figures for a coin cell run from under a year at 0.1
seconds to several years at one second.

## Test a tag before you rely on it

Makers rarely say what a tag sends, so look for yourself.

1. Keep the tag's phone nearby, if it has one, with the tag set up in its app. A Find My tag away
   from its owner can keep one address for a whole day and fool you.
2. Open Home Assistant's Bluetooth advertisement monitor, or nRF Connect on an Android phone.
3. Hold the tag next to a receiver to pick it out by its signal. Write down its address (and, for a
   beacon, its UUID, major and minor).
4. Look again after an hour, and again after a day.

The same address or the same beacon ID: it can be recognised. Gone while its phone is connected:
it stops sending during a connection, so disconnect it from its app or choose another. A new
address each time and no fixed ID: nothing can recognise it.

## Name it in PadSpan

1. Hold the tag next to a receiver.
2. Open **Follow** and **Choose a tag to follow**. The list starts with the strongest signal, so
   your tag is near the top, marked **[Unidentified]**.
3. Pick it and choose **Name this tag**. Keep the name short, such as "Keys".

Or, on the Overview's **Objects** card (Advanced mode), open **All objects**, choose **Tag** on its
row, type a name and choose **Save label**. Near a busy street that list is long: change
**All statuses** to **Identified**, or search.

The name is what gives the tag its Home Assistant entities. For a tag named Keys:

- `device_tracker.keys`: the room, `not_home` once it hasn't been heard for the **Away timeout**
  (five minutes by default), or `unknown` while it has no room.
- `sensor.keys_area`: the room, and distance sensors.

Every entity and attribute is in [chapter 14](14-home-assistant-reference.md).

**Things nobody carries.** Keys on the hall table, a tag on a bag: by default they go `not_home` like
anything else when they go unheard. **Settings → Tracking → Rooms and timing → Home/Away Timeout →
Things keep their room** keeps their last room for up to 48 hours instead.

**A named tag is not a person.** PadSpan's people count leaves out keys, beacons, boxes and
vehicles, so keys at home don't make an empty house look occupied.

**What it can't do**: ring a tag, or read its battery. A tag with a flat battery looks the same as
one that left the house.

Follow has **Movement Alerts** for a tag too ([chapter 13](13-alerts.md)), and **Traceback** keeps
its history.

## A first automation: keys left behind

When you leave and your keys don't. The person needs a tracker that knows they've left, such as the
Companion app's:

```yaml
alias: Keys left behind
triggers:
  - trigger: state
    entity_id: person.alex
    to: not_home
    for: "00:06:00"
conditions:
  - condition: not
    conditions:
      - condition: state
        entity_id: device_tracker.keys
        state: not_home
actions:
  - action: notify.mobile_app_alex_phone
    data:
      message: "Your keys are still at home: {{ states('device_tracker.keys') }}"
```

The six minutes outlast the five-minute **Away timeout**, so keys in your pocket have gone
`not_home` by the time it checks. Raise it if you raised the timeout.

## AirTags you already own

- **Home or away**: Find My knows where they are, and some people bring that into Home Assistant by
  other routes. That gives zones, not rooms.
- **In PadSpan (experimental)**: turn on **Settings → Features → MAC Rotation Bridging** (off by
  default) and name the tag. When the tag changes address, PadSpan carries its name, room and
  history over if it is clear which one it is: the same kind of tag, the old address stopped, the
  new one appeared at that moment, heard in the same place. Two tags lying together that change at
  once stay apart, and a tag that changed while out of range comes back as a new device to name
  again. The same switch links other changing devices by what they send, which can now and then
  link the wrong one.
- So it suits a tag that stays home, on a remote or in a bag, not keys you carry out of the house.
- **Not for guests or pets.** A guest carrying your AirTag gets Apple's warning that an AirTag is
  moving with them, and an AirTag away from its owner plays a sound. For a guest, use a beacon.

## Guest tags

Lend a tag to a guest (a house-sitter, a relative, a cleaner, a contractor) and PadSpan follows it
room by room while they have it. When they give it back, the tag goes back in the drawer, and the
stay's report is kept as long as you choose. Guest tags are free, and off until you turn them on.
Only an administrator can turn them on, lend a tag or end a stay.

### Turn it on

**Settings → Tracking → Phones and guest tags → Guest tags → Use tags as guest tags.** Here you
also choose how long a finished stay's report is kept: not at all, 7, 30 (the default) or 90 days.
The **Guests** screen appears in the menu.

### Make a tag a guest tag

Name a spare tag first (above), such as "Guest tag 1". In **Guests**, pick it under
**Use as a guest tag** and choose **Add**.

The tag keeps its own name; the guest's name belongs to the stay. So `device_tracker.guest_tag_1`
stays the same entity from one guest to the next, and your automations keep working.

### Lend it

On the tag, choose **Lend to a guest**:

- **Guest's name**.
- **Until (optional — the stay ends by itself then)**.
- **Rooms they shouldn't go into**: you are told when they've been in one for half a minute.
  Passing a doorway doesn't count.
- **Tell me when they arrive**, **Tell me when they leave**.
- **Staying here (a house-sitter)**: counts as someone home for Vacation Mode.
- **Send notices to**: a phone or another notify target, or **A Home Assistant notification**.
- **Quiet hours**: no arrive or leave notices then. Off-limits notices still come.

Tell your guest the tag is tracked, and lend it only if they agree. A beacon doesn't warn anyone the
way an AirTag does, so the telling is up to you. In many countries, tracking a person without their
consent is against the law.

### While they stay

**Guests → Staying now** shows where they are (or that the tag isn't heard), since when, until when,
and the time in each room so far. **Change** edits the stay. **Traceback** opens the tag's history
for the stay. On the Overview, the Atlas and Live Aboard, the tag shows the guest's name with a
**Guest** badge. While a tag is lent, its own Follow alerts stay quiet; the stay sends its own.

### When they give it back

Choose **Tag returned**. The stay moves to **Past stays** with its report: first in, last out, the
times they went out and came back, the time in each room, off-limits visits and the notices sent.
**Forget** deletes a stay at once, name and all.

Forgot to end one? After two days without the tag being heard, PadSpan asks whether the stay is
over. After a week unheard, it ends by itself.

### For automations

`binary_sensor.padspan_guest_home`, the guest attributes on the tag's tracker and the
`padspan_ha_guest` event are in [chapter 14](14-home-assistant-reference.md). The notices are in
[chapter 13](13-alerts.md).

### Guests' privacy

Guests' names stay in your Home Assistant. They aren't in the usage report or in a PadSpan backup. A
finished stay is deleted after the days you set, and a factory reset deletes all guest tags and
stays.

## When a tag won't show up

- **It isn't in the list at all.** Some tags sleep until they have been paired once or a button
  pressed. Others go quiet while connected to their app.
- **Its name keeps disappearing.** It changes its address: run the test above.
- **It's heard but never gets a room.** Its receivers need areas in Home Assistant:
  **Health → Scanner → Room Mappings** lists each receiver's room.
- **It jumps between rooms**: [chapter 26](26-troubleshooting.md#a-device-shows-the-wrong-room-or-jumps-between-rooms).
  A tag low on a collar has it harder: a pet lying on its tag blocks the signal.
