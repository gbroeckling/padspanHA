# 4. Your first room in 15 minutes

[Contents](README.md)

From a fresh install to "Alex's phone is in the Kitchen", with no floor plan. Then, if you want it,
your house on a map. Everything on this page is free.

Before you start you need Home Assistant 2024.8 or newer, at least one Bluetooth receiver, and an
area in Home Assistant for each room (**Settings → Areas, labels & zones**). See
[chapter 2](02-requirements.md).

## 1. Install PadSpan

On Home Assistant 2026.11 or newer:

1. Open **Settings → Marketplace** and search for **PadSpan**.
2. Open **PadSpan HA** and choose **Install**.
3. The setup dialog opens straight away, with nothing to fill in. Choose **Submit**.
4. Open **PadSpan HA** in the sidebar.

On older versions, install it with HACS and restart Home Assistant first. Both ways are in
[chapter 3](03-install-update-uninstall.md). The other new sidebar entry, **Atlas**, is the map of
your lights; leave it for later.

### The sample house

Until PadSpan hears its first receiver, it shows a sample house with every feature set up, and a
yellow banner says so. A new install switches to your own house by itself as soon as it hears a
receiver. If you are looking at the sample house and want your own, choose **Back to my house**.

## 2. Give every receiver its room

PadSpan puts each device in the room whose receiver hears it best, and a receiver's room is the Home
Assistant area of its device. A receiver with no area gives no room, however well it hears you: a
phone right next to it lands in the next receiver's room. So this comes first.

The quickest place is the Overview's **Who's where now** card. Each receiver with no area has its
own row there, with a list of your rooms:

1. Check the room in the list. When the receiver's name points to a room ("esp32-kitchen"), that
   room is already chosen, and the row says **Chosen from its name; change it if it's wrong.**
2. Choose **Set room**. The row says **Room set: Kitchen.**

This gives the receiver's device that area in Home Assistant, the same as setting it there. You can
also:

- set the area on the device in Home Assistant: **Settings → Devices & services → Devices**, open
  the receiver, edit its area;
- in PadSpan, on the Overview's **Bluetooth radios** card (Advanced mode), choose **View radios
  list**, then **Assign** beside the receiver (or **Change**, if it has an area already).

A Shelly's Bluetooth scanner is a device of its own in Home Assistant: give that device the area.
[Shelly as a Bluetooth proxy](https://padspan.traks.ca/guides/shelly-bluetooth-proxy/) shows how.

If Home Assistant has no areas yet, the card says so: add them first, in
**Settings → Areas, labels & zones**.

## 3. See who's where

You don't need a floor plan for this. On the Overview, **Who's where now** lists each room your
receivers cover, the named devices in it, and a count of the other Bluetooth devices heard there.
It keeps itself up to date.

The line at the top says where you stand:

| What it says | What it means |
|---|---|
| "No Bluetooth receivers found yet. Add an ESPHome Bluetooth proxy …" | PadSpan hears no receiver. Add one, or use your Home Assistant machine's own Bluetooth. It shows up within a minute. |
| "… has no Home Assistant area yet, so PadSpan can tell home from away but not rooms." | No receiver has an area. Give each one the area it's in (step 2). |
| "… cover one room, so you get home or away." | All your receivers are in one area. Put one in another room. |
| "One receiver has no Home Assistant area yet, so it gives no room: …" | The others work. Give this one its area. |
| "Your 3 receivers cover 3 rooms. …" | It's working. Each device goes to the room whose receiver hears it best. |

A row called **Heard, no room yet** holds named devices that only a receiver with no area can hear.
Give that receiver its area.

## 4. Name your phone

A device you haven't named gets no entities from PadSpan. Naming one gives it a device tracker whose
state is the room, an area sensor and distance sensors, and PadSpan follows it.

**Android phone**

1. In the Home Assistant Companion app, open
   **Settings → Companion app → Manage sensors → BLE Transmitter** and switch it on. In the same place, set **Transmit power** to **High** and
   **Advertise mode** to **Low latency**: out of the box it sends too weakly to be heard well.
2. In PadSpan's Overview, open the **Track Your Phone** card and choose **Track this phone** beside
   it (in Basic mode the button says **Track**).

PadSpan names the phone, follows it, and asks the app to start sending. If the button says
**Setup**, the sensor isn't on in the app yet; if it says **Enable & Track**, it is switched off in
Home Assistant, and that button switches it on (restart Home Assistant afterwards). In Advanced mode
it then says how it went: **Tracked!**, **Registered — waiting for signal** (walk near a
receiver), or **Registered — enable BLE**.

**iPhone or Apple Watch**

An iPhone changes its Bluetooth address every few minutes, so PadSpan needs its key, the IRK, once.

1. Get the key and add it to Home Assistant's **Private BLE Device** integration. The steps, with an
   irk-capture ESP32 or a Mac, are in [Which room is my phone in?](https://padspan.traks.ca/guides/phone-room-presence/)
   and in PadSpan's own phone wizard (below).
2. Once Home Assistant has it, the phone shows in **Who's where now** with a **Track** button beside
   its name. Choose **Track**. It can take a few minutes to show the first time.

With Enhanced security on, only an administrator sees **Track**.

**A beacon or key tag**

On **Follow**, pick it under **Choose a tag to follow** and choose **Name this tag**. Or, on the
Overview's **Objects** card (Advanced mode), open **All objects**, choose **Tag** on its row, type a
name and choose **Save label**. Near a busy street that list is long: change **All statuses** to
**Identified**, or search by name. [Which Bluetooth tag works?](https://padspan.traks.ca/guides/bluetooth-tags/)
has what to buy.

Once a phone or tag has a name, it is in **Who's where now** by name, and your automations can use
its room: [chapter 14](14-home-assistant-reference.md).

**That's your first room.** The rest of this page is optional.

## 5. Make it a map

A map turns the list of rooms into your house, drawn on the Overview. Calibration needs it. With
three or more receivers placed on it, PadSpan can also place devices between them, even in a room
with no receiver of its own.

Choose **Make it a map** on the **Who's where now** card. It opens **Setup**, the steps in order:

1. **Upload a floor plan**: any picture of the floor, even a photo of a sketch. No picture? **No
   floor plan? Ways to get one** offers a phone's room scan, your own sketch or a blank floor.
2. **Set the scale**: click both ends of a wall you know, type its length and choose **Save the
   scale**. Don't skip it: nothing goes on the map without a scale.
3. **Draw the rooms**: press a room's name above the plan, click each corner, and double-click the
   last one. Each room is saved as you finish it.
4. **Floors and their heights**: only in a house with two indoor floors or more.
5. **Place receivers and set their heights**: in **Live BLE Receivers** beside the plan, choose
   **Add** beside each receiver and drag it to where it is mounted. Or choose **Put my receivers in
   their rooms**: each goes in the middle of its room, to drag into place later.
6. **Track your phone or watch**: done already if you named your phone in step 4 above.
7. **Calibrate**: walk the house with your phone, so PadSpan learns what each spot sounds like.

Each step's button opens the tool for it, with a bar at the top that says which step you are on and
**← Back to Setup**. **Skip for now** moves on; Setup remembers where you were.

**One step is easy to miss.** The floor plan steps run in Mapping's **Setup Wizard**, which ends on
**Finish**. Until you choose **Put it on the map** there, your rooms and receivers are only on the
picture. Once the first room is on the map, your house takes the place of **Who's where now** on the
Overview, so draw every room your receivers cover: a device in a room you haven't drawn may not
show.

Every step is explained in [chapter 9](09-setup-the-map.md).

## 6. Calibrate

The strongest receiver is a good first answer. Calibration makes it better: it records what every
receiver hears at known spots in your house. It needs a floor plan with a scale.

Setup's **Calibrate** step opens one of two ways:

- **Walk a room**, where it is switched on: walk each room for 90 seconds with your phone. It is off
  on a new install. Turn it on in
  **Settings → Tracking → Positioning and calibration → Walk a Room (Calibration)**; Setup has an
  **Open that setting** button.
- **Guided calibration**, point by point: choose your phone and the floor, stand at a spot, mark it
  on the plan and let PadSpan listen. Aim for 10 to 20 spots on each floor, spread out.

The step counts as done at five calibration points. Everything about calibration is in
[chapter 11](11-calibration.md).

## If it doesn't work

- **"Bluetooth feed unavailable"**: restart Home Assistant fully, **Settings → System → Restart**.
  After a first install a reload isn't enough.
- **Uploading a plan, saving the scale or starting the trial is refused**: those need a Home
  Assistant administrator.
- **Mapping has only Library and Upload, or Settings has no tabs**: the mode button at the top
  right has the panel in Basic. Every screen is still in the menu, the ones Basic leaves out under
  **More tools**. Choose the mode button again for Advanced.
- **A phone jumps between rooms**: see [chapter 26](26-troubleshooting.md) and
  [Why does my phone jump between rooms?](https://padspan.traks.ca/guides/room-flapping/)
- **Something else**: [chapter 27](27-getting-help.md).
