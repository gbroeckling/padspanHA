# 5. Receivers: which, how many, where

[Contents](README.md)

A receiver is anything that hears Bluetooth and passes what it hears to Home Assistant: an ESP32
board running ESPHome, a Shelly, the Home Assistant machine's own Bluetooth, an ESPresense node or a
Tasmota device. Other software calls them Bluetooth proxies or scanners. PadSpan reads them all
through Home Assistant, so a receiver you already have works with nothing to add.

## How many

| Receivers | What you get |
|---|---|
| One in the house | Home or away, not rooms. Everything it hears counts as being in its room. |
| One in each room you want told apart | Rooms. Each device goes to the room whose receiver hears it best. An open kitchen and living room count as one room unless each end has its own receiver. |
| Three or more placed on a floor plan | Also positions between the receivers, so a device can be put in a room with no receiver of its own, like a closet or a hall. |

You don't need to buy them all first. Start with what Home Assistant already hears. PadSpan shows a
sample house until it hears the first receiver. Then add receivers where the scores in
[Calibration](11-calibration.md) tell you to (see [Finding the rooms that need one](#finding-the-rooms-that-need-one)).

## Which kind

You can mix them. Different radios hear the same phone at different strengths, so in a mixed house
calibration matters more: it lets PadSpan allow for each receiver on its own.

### ESPHome Bluetooth proxy (an ESP32 board)

The usual choice. Home Assistant finds an ESPHome Bluetooth proxy by itself, and PadSpan uses it as
soon as Home Assistant does.

- **Pick a board with an external antenna**: an ESP32-S3 with a small IPEX (u.FL) connector and a
  2.4 GHz antenna. The antenna matters more than the chip. Boards with only the antenna printed on
  the board give readings too noisy to tell rooms apart: two rooms can be only a few dB apart, and a
  noisy antenna flips that call at random.
- **Wi-Fi is fine.** Ethernet doesn't place devices noticeably better, though it suits a receiver
  that never moves.
- Older ESP32 boards without an external antenna are good enough for home or away, not for rooms.

### Shelly, Gen2 or newer

Shelly Plus, Pro, Gen3 and Gen4 devices on mains power can be receivers. Battery Shellys and Gen1
can't. Shelly BLU buttons and sensors are things a receiver hears, not receivers.

1. In Home Assistant, open **Settings → Devices & services → Shelly**.
2. Choose the cogwheel on the Shelly's entry.
3. Set **Bluetooth scanner mode** to **Auto** (Active and Passive work too) and choose **Submit**.
4. Home Assistant lists the Shelly's scanner as a device of its own, under
   **Settings → Devices & services → Bluetooth**. That device's area is the receiver's room. A
   scanner with no area of its own takes its Shelly's.

Most Shellys sit in a wall box or a fuse box with a small built-in antenna, so they hear less, and
less steadily, than a receiver out in the room. Treat them as a free start: one is enough for home
or away, and whether they are good enough for rooms depends on the house. Shellys can't hold a
Bluetooth connection, which room presence doesn't need.

### Home Assistant's own Bluetooth

The Home Assistant machine's built-in Bluetooth, or a USB Bluetooth adapter, is a receiver once
Home Assistant's Bluetooth integration has it. It counts as one receiver in the room where the
machine is. A machine in a cupboard or a basement hears that corner of the house.

### ESPresense

ESPresense nodes report over MQTT instead of through Home Assistant's Bluetooth.

1. Set up Home Assistant's MQTT integration.
2. In PadSpan, open **Manage → HA Entities → ESPresense MQTT** and tick
   **Enable ESPresense MQTT ingestion**. Your nodes show up as receivers within about ten seconds.
3. If your nodes publish under another topic than `espresense`, type it in **Topic prefix:** and
   choose **Save**.

The card is marked **Experimental**.

### Tasmota (experimental)

An ESP32 running Tasmota with Bluetooth reports over MQTT too.

1. Set up Home Assistant's MQTT integration.
2. In PadSpan, open **Manage → HA Entities → Tasmota BLE** and tick **Read Tasmota BLE over MQTT**.
3. On each Tasmota, type these in its console:
   - `TelePeriod 10`
   - `BLEMaxAge 30`
   - `BLEAddrFilter 1`

Tasmota's own settings are made for an occasional list of devices. Without these, it reports too
slowly for rooms (a reading older than about 15 seconds doesn't count), keeps a device that left on
its list, and never reports phones and tags that change address. PadSpan reads the topics
`tele/+/BLE` and `stat/+/BLE`.

### Passive receivers and Home Assistant 2026.4

Since Home Assistant 2026.4, repeat readings from passive receivers (Shellys and others that only
listen) can be held back. PadSpan fetches them again on a timer: **Settings → Tracking → Receivers
→ Bluetooth refresh interval**, 5 seconds on a new install. If a Shelly hears devices but shows no
signal during calibration, check that interval is 5 seconds, or tick
**Refresh every 5 s for passive proxy scanners** on the same card, which keeps it at 5 seconds even
when the interval is longer. It uses slightly more processor time.

## Where to put them

- Inside the rooms you want told apart, not in halls.
- Nearer the middle of a room than a corner. Not behind large metal things, not inside a cabinet,
  and not against an outside wall.
- Close enough that next-door receivers overlap a little.
- In a large room one receiver is the least; two do noticeably better.
- About head height or higher. Then set the real height (below).

## A receiver's room, place and height

**Room.** A receiver's room is the Home Assistant area of its device. A receiver with no area gives
no room, however well it hears you: a phone right next to it lands in the next receiver's room.
The Overview's **Who's where now** card lists every receiver without one and lets you set it there:
[chapter 4](04-first-room.md#2-give-every-receiver-its-room). Rooms and areas are explained in
[chapter 8](08-rooms-and-floors.md). If you move a receiver to another room, change its area too.

**Place.** For positions between receivers, a receiver also needs a spot on your floor plan:
[chapter 9, step 5](09-setup-the-map.md#step-5-place-receivers-and-set-their-heights). Place it
where it really is.

**Height.** Set its height above its own floor in **Calibration → Tune** (**Height above floor
(m):**, which starts at 2.4 m), in Mapping's receivers step, or in the **Height** column of the
**Receivers** screen. All three are the same value. A height can be set only once the receiver has
a place on a floor plan.

**Signal adjustment.** Some receivers read weaker than others at the same distance.
**Settings → Tracking → Receivers → Receiver signal adjustments** lists each receiver with a box
from −20 to +20 dB, added to every reading from it (positive if it reads weaker than it should).
The figure beside each box is only a suggestion: it is not applied until you type it in and
**Save**. Most homes leave these at 0 and calibrate instead.

## Seeing how your receivers are doing

- **Receivers** (in the menu): every receiver in one table, with its **Room**, **Floor**,
  **On a floor plan**, **Height**, **Signal adjustment**, **Status**, **Devices now** and
  **Last heard**. **Problems only** shows just the ones that need you. **Place** opens Mapping with
  the receiver picked.
- **The status dot** in the top bar: a receiver is **Silent** when nothing has come from it for over
  10 minutes.
- **Health → Hearing less than usual**: shown only when a receiver has heard far fewer Bluetooth
  messages than normal for over 10 minutes while the others are fine. Rooms near it can be wrong.
  Restarting it often helps.
- **Health → Scanner Health**: for each receiver, how often it agrees with the room the others
  point to. The **Reliability** figure is only shown: a low one doesn't make that receiver count for
  less.
- **Health → Scanner → Room Mappings**: every receiver by its Bluetooth address, with its room.

A receiver that is silent: [chapter 26](26-troubleshooting.md#a-receiver-is-silent).

## Finding the rooms that need one

- **Calibration → Model** shows how often PadSpan picks the right room on spots it wasn't
  calibrated on. A room that keeps scoring badly is the first place to add or move a receiver.
- **Calibration → Accuracy by spot** shows which spots go wrong, and to which room.
- **Calibration → Roam** shows where you have calibrated so far and where to stand next.
- **Walk a room**, when it is on, shows a room's score before and after a 90-second walk.

All of these are in [chapter 11](11-calibration.md).

## Next to Bermuda

Already running Bermuda? Keep it. PadSpan reads the same Home Assistant Bluetooth data Bermuda does,
so your ESPHome proxies and Shelly scanners serve both at once.

- **Bermuda stays as it is.** Installing, reloading or removing PadSpan doesn't change Bermuda's
  devices, entities or settings, and a test in PadSpan's code fails if new code tries to.
- **Your Bermuda devices show up** in PadSpan as devices of their own. If you would rather PadSpan
  used only its own readings, tick **Ignore Bermuda** (**Ignore all Bermuda integration data**) in
  **Settings → Tracking → Home Assistant and integrations**.
- **Phones you set up for Bermuda keep working.** An iPhone or Apple Watch in Home Assistant's
  Private BLE Device is recognised by the same key and named as you named it there:
  [chapter 6](06-phones-and-watches.md).
- **With one receiver per room**, PadSpan picks rooms by which receiver hears a device best, as
  Bermuda does: expect rooms about as good, and a calibration walk to correct some calls. With
  three or more receivers on a measured floor plan, it can also place a device between them.

Your automations can stay on Bermuda's sensors until you decide to change them. PadSpan's own
sensors are in [chapter 14](14-home-assistant-reference.md).
