# 6. Phones and watches

[Contents](README.md)

Your receivers hear your phone straight away. What they can't tell on their own is whose phone it
is. One step per phone fixes that, and then PadSpan puts it in a room by name.

| | What it needs | Then in PadSpan |
|---|---|---|
| Android phone | The Companion app's **BLE Transmitter**, switched on | **Track Your Phone → Track this phone** |
| iPhone | Its key (the IRK) in Home Assistant's **Private BLE Device**. You get the key once, from a Mac or an irk-capture ESP32 | **Track** in **Who's where now**, or a name in **All objects** |
| Apple Watch | Its own key, the same way as an iPhone | The same |

## Why a phone needs a step

A beacon or a simple key tag keeps one Bluetooth address, so a receiver knows it every time. Phones
don't. They send from a random address and change it every few minutes, so nobody can follow them
around a shop. To Home Assistant, your phone looks like a string of new devices. There are two ways
round it:

- **The phone says who it is.** The Android Companion app can send a beacon with an ID that never
  changes.
- **You hold its key.** Every iPhone and Apple Watch has an Identity Resolving Key (IRK) that turns
  its changing addresses back into one device.

## Android

1. Install the Home Assistant Companion app and sign in.
2. In the app, open **Settings → Companion app → Manage sensors → BLE Transmitter** and switch it on.
   Most of the app's sensors start off.
3. In the same place, set **Transmit power** to **High** and **Advertise mode** to **Low latency**.
   The app starts on its weakest settings, and receivers barely hear it. High costs some battery;
   the app can also send only on your home Wi-Fi.
4. If the phone drops off after a while, take the Companion app out of Android's battery
   optimisation, or Android stops it.
5. In PadSpan's Overview, open **Track Your Phone**. Your Companion-app phones are listed. Choose
   **Track this phone** (in Basic mode, **Track**).

PadSpan takes the name of the phone's Home Assistant device, follows it, and asks the app to start
sending. What the button says:

- **Setup**: the transmitter isn't on in the app yet.
- **Enable & Track**: the sensor is switched off in Home Assistant. The button switches it on there;
  then restart Home Assistant and turn the transmitter on in the app.

While the phone's transmitter is still on a weak setting, its row says so: "Sends too weakly for
receivers to hear it well", with what to change. The phone shows in its room within seconds of a
receiver hearing it.

## iPhone

The iPhone app has no BLE Transmitter, so an iPhone is recognised by its key. You get the key once,
in one of two ways.

**On a Mac** signed in to the same iCloud account: open Keychain Access, find the iPhone's Bluetooth
entry and copy its Remote IRK. Home Assistant's Private BLE Device page has the steps, and how to
tell which entry is the iPhone.

**With an irk-capture ESP32**: irk-capture is an ESPHome package for a spare ESP32. In PadSpan, open
**Bluetooth → IRK Manager** and choose **I have an IRK Capture ESP32**. It takes you through one
device at a time: type its name and whose it is, pair the iPhone with the ESP32 in the iPhone's
**Settings → Bluetooth**, then **Find the key** and **Save**. Afterwards remove the pairing from the
iPhone, and before the next device give the ESP32 a new Bluetooth identity (its
**Refresh BLE Identity** button in Home Assistant), so the last device doesn't connect to it again.
That ESP32 can't be a receiver at the same time.

Then give the key to Home Assistant, in either place:

- **In Home Assistant**: **Settings → Devices & services → Add integration → Private BLE Device**,
  and paste it.
- **In PadSpan**: **Settings → Tracking → Phones and guest tags → Phone Tracking (Private BLE)**.
  Type a name, paste the key and choose **Add IRK**. PadSpan listens for up to 30 seconds
  (**Scanning for device...**) to check the key matches a phone your receivers hear, then adds the
  Private BLE Device entry to Home Assistant for you. **Detailed Setup Guide** has the steps for each
  kind of device. **Auto-Detect IRKs** finds keys of devices paired with the Home Assistant machine's
  own Bluetooth.

The key can be 32 hex characters, base64 (it ends in "="), colon-separated, or start with `irk:`.
Either way, keep the iPhone awake, with Bluetooth on, near a receiver: Home Assistant accepts a key
only once it hears the phone it belongs to. Adding a key needs a Home Assistant administrator.
PadSpan reloads its list of keys every five minutes, so a key added in Home Assistant reaches it
within about five minutes.

Last, name the iPhone in PadSpan: **Who's where now** shows it with a **Track** button beside its
name. Or, on the Overview's **Objects** card (Advanced mode), open **All objects**, choose **Tag** on
its row, type a name and choose **Save label**.

**Check a key** without saving it: in the phone wizard's **I have an iPhone** path, paste it and
choose **Check**. PadSpan says how many of the changing addresses it hears now are this iPhone.

## Apple Watch

An Apple Watch has its own key, separate from its iPhone's. Get it the same two ways: from Keychain
Access, or by pairing the watch with the irk-capture ESP32 from the watch's own Bluetooth settings.
Add it to Private BLE Device as an entry of its own and name the watch in PadSpan the same way.

A watch that keeps one fixed Bluetooth address (some Garmins do) has no key and needs none: name it
like a tag ([chapter 7](07-tags-and-beacons.md)).

## The phone wizard

Setup's phone step, and **Bluetooth → IRK Manager** in Advanced mode, open **Track your phone**,
with three ways in: **I have an Android phone**, **I have an iPhone** and
**I have an IRK Capture ESP32**. Each has the steps above, in the panel.

On an install from before 0.38.165, the Overview's **Track Your Phone** card shows iPhones the
Android steps unless **Settings → Features → iPhone Setup Path** is on. Newer installs start with it
on. **Phone Setup Wizard** on the same tab turns the wizard itself on or off.

## What you get

- **On the screens**: each named phone in its room, and the Overview's **People in building** card
  listing who's home and the room each person is in.
- **In Home Assistant**: a device tracker whose state is the room (or `not_home` once it hasn't been
  heard for five minutes, the default **Away timeout**), an area sensor and distance sensors. Every
  entity is in [chapter 14](14-home-assistant-reference.md).
- **A person's room**: link the tracker to the person under **Settings → People**. If that person
  also has another tracker, such as the Companion app's GPS or a router's, Home Assistant goes by
  that one and shows them as home, not in a room.
- **Alerts** when a phone changes room, arrives or leaves: [chapter 13](13-alerts.md).

Private BLE Device on its own gives home or away and a distance to the nearest receiver, not a room.
PadSpan adds the room.

## Phones you haven't set up

A phone with no key and no beacon is nameless, not invisible. **People in building** counts it as an
**Unknown phone** in its room when two or more receivers hear it, fairly strongly, and what it sends
looks like a phone or a watch. It gets no entities and no name.

- **Yours, or someone's who lives with you**: give it its step above. Then it counts as that person.
- **A visitor's**: nothing to do. It goes when they do.
- **A neighbour's, through the wall**: move the receiver on that wall away from it, or draw that
  wall as a stronger material ([chapter 10](10-walls-and-signal-loss.md)).

## When a phone won't show up

- **"The provided IRK does not match any BLE devices that Home Assistant can see."** (Home
  Assistant's message.) Wake the phone, bring it near a receiver and try again.
- **Invalid IRK format**: copy the whole key.
- **An Android phone is heard only right next to a receiver**: its transmitter is on its weakest
  settings (Android step 3).
- **An Android phone disappears after a while**: battery optimisation stopped the Companion app
  (Android step 4).
- **irk-capture gets no key from a watch**: some watches need a kind of pairing it can't do, and
  some keep a fixed address and have no key (track those like a tag).
- **A phone shows as many devices**, or keeps jumping rooms:
  [chapter 26](26-troubleshooting.md#a-phone-isnt-recognised-or-shows-as-many-devices).
