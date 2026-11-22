# 13. Alerts and notifications

[Contents](README.md)

Everything PadSpan tells you about, in one place: what it watches, where the message goes, and how
to turn it on or off.

| What | Where it shows | Turn it on |
|---|---|---|
| A device changes room, arrives home or leaves | Your phone or email | Follow → **Movement Alerts** |
| A leak, smoke, gas or carbon monoxide alarm | A red banner on every PadSpan screen; the room rings red on the Atlas | Always on |
| The same alarm, and when it clears | Your Follow alert targets (your phone or email) | On by default: **Settings → Atlas → Atlas — Mapped Light Control → Notify when a leak, smoke, gas or CO alarm goes off** |
| A door left open, or a window open in the rain | The room rings amber on the Atlas; a banner on a wall screen | **Settings → Atlas → Atlas — Mapped Light Control → Alert pulse** |
| Vacation Mode ends or is turned off | A Home Assistant notification, and your Follow alert targets | Always, while Vacation Mode is used |
| A guest arrives, leaves, or goes into a room they shouldn't | Your phone, or a Home Assistant notification | When you lend a guest tag |
| PadSpan couldn't confirm a save | Home Assistant's **Settings → Repairs** | Always on |
| A new stable version | A Home Assistant notification | On by default; see [chapter 3](03-install-update-uninstall.md) |
| Claude's reads pass your monthly limit | A Home Assistant notification | **Settings → AI** (off unless you set it) |

PadSpan sends to your phone or email through Home Assistant's own **notify** services. For a
phone, that is the Home Assistant Companion app. For email, a mail integration such as SMTP. Set
them up in Home Assistant first, under **Settings → Devices & services**.

## Movement alerts (Follow)

Tell you when a device moves from room to room, arrives home, or leaves.

1. Open **Follow** and pick the device under **Choose a tag to follow**.
2. Under the device's card, find **Movement Alerts**.
3. Choose where alerts go:
   - **Your phone**: pick it under **Notify service** (the Companion app's notify target). No email
     is needed.
   - **Email**: type the address under **Email address**, and leave **Notify service** on
     **Auto-detect**, or pick your mail service.
4. Tick what you want to hear about. In Basic: **Alert me when … moves**, **… arrives home**,
   **… leaves**. In Advanced: **Alert on every room change for "…"**, **Alert when "…" arrives
   home**, **Alert when "…" leaves**, and **Only alert for these rooms (unchecked = all):** to watch
   only some rooms (an alert then comes when the device goes into one of them).
5. Choose **Save**. Nothing is active until you save it; the card then shows **Active**.
6. **Send Test** sends one now, to exactly where alerts go, and says plainly if it couldn't reach
   your phone or mail service.

What the messages say:

- **PadSpan: Alex's phone moved**: "Alex's phone moved from Kitchen to Hall".
- **PadSpan: Alex's phone arrived**: "Alex's phone arrived (Kitchen)".
- When it leaves: "Alex's phone left".

Some rules:

- **At most one room-change alert a minute for each device.** A move inside that minute isn't lost:
  when the minute is up, one alert says where it went, from the room last reported.
- **Arrive and leave** use the same away timeout as the Away badge, 5 minutes unless you change it
  in **Settings → Tracking → Rooms and timing → Home/Away Timeout**.
- **No alert after a restart.** A device's first room after Home Assistant starts isn't a move.
- **A guest tag that is lent** sends its stay's notices instead (below), not these.

**Manage → Events** has the same alerts for every device in one place: **Saved Alerts** lists each
one, with a delete button, and **Configure Alerts** sets up room-change alerts for any tracked
device, with **Test Notification**.

Arrive, leave and room changes also fire Home Assistant events (`padspan_device_arrived`,
`padspan_device_departed`, `padspan_room_change`), for your own automations: see
[chapter 14](14-home-assistant-reference.md).

**No alert arrives?** Use **Send Test** first: it says what went wrong. If no notify service is
listed at all, add the Companion app (for a phone) or a mail integration in Home Assistant. More in
[chapter 26](26-troubleshooting.md).

## Leak, smoke, gas and CO alarms: the emergency latch

PadSpan watches every Home Assistant binary sensor of the kinds **moisture** (a water leak),
**smoke**, **gas** and **carbon monoxide**, placed on the Atlas or not.

The moment one reports an alarm:

- **The alarm latches.** It stays alarming in PadSpan for **2 days, or until someone resets it**,
  even if the sensor itself goes quiet again. A short burst of wet is still a real leak.
- **A red banner** (🚨 and how many are active) shows on every PadSpan screen, not just the Atlas,
  with each alarm's name and a **Reset** button. On a phone it is a small 🚨 pill in the top bar.
- **On the Atlas**, the sensor's room rings red. The sensor says what it found (**WET**, **SMOKE**,
  **GAS**, **CO**), and **ALARM** while latched.

**Reset** asks once more (**Yes** / **No**), so a stray tap can't dismiss a real alarm. Resetting
only clears PadSpan's memory of the alarm; it never touches the sensor's real state. A sensor that
is still alarming stays red on the Atlas, and the banner comes back the next time it goes into
alarm.

While the sample house is showing, the banner still shows your own house's alarms, with **Back to my
house** in place of Reset.

### The notification

PadSpan sends a notification when an alarm latches. It is on by default; turn it off or on in
**Settings → Atlas → Atlas — Mapped Light Control → Notify when a leak, smoke, gas or CO alarm goes
off**. It saves as soon as you tick or untick it.

- **One when the alarm goes off**: **PadSpan: Leak alarm**, "Leak alarm: Sink sensor in the
  Kitchen, at 14:05. …". Nothing more while it stays latched, however often the sensor goes off and
  on again.
- **One when it clears**: **PadSpan: Leak alarm cleared** when someone presses Reset, or **PadSpan:
  Leak alarm ended** when the 2 days are over without a reset. If Home Assistant was off at that
  moment, it comes when Home Assistant starts again. Deleting the sensor sends nothing.
- **Where it goes**: to every phone and email address your Follow alerts are set to send to (see
  above), up to five. With no Follow alert target set, it goes where a Follow alert with no target
  goes: a mail notify service first, else the first notify service Home Assistant has. With no
  notify service in Home Assistant at all, nothing is sent; Home Assistant's log says so.
- An alarm that latched before this notification existed, or while it was off, sends nothing when
  it clears.

The notification goes through PadSpan. For an alarm that must reach you even when PadSpan is not
running, also use a Home Assistant automation on the sensor itself.

## Alert pulse (Atlas)

Off until you turn it on: **Settings → Atlas → Atlas — Mapped Light Control → Alert pulse**. It saves
as soon as you tick it.

With it on, the Atlas rings a room in amber when:

- a window or cover (a blind, shade, shutter, awning) is **open while it rains or snows** (from the
  Atlas's own weather; see the [Atlas guide](../ATLAS_GUIDE.md#outdoor-weather));
- a door, window, garage door, gate or cover the Atlas shows has been **left open** for more than 6
  hours.

On a wall screen (`?kiosk=1`), a banner across the top names the worst alert and where it is
("Leak · Laundry", "Window open in the rain · Bedroom"), with how many more, until it clears. The
order, worst first: smoke, gas, CO, a leak, an opening in the rain, a door left open.

## Vacation Mode notices

Vacation Mode (PadSpan Pro) runs your lights while you're away ([Atlas guide](../ATLAS_GUIDE.md)).
It tells you when it stops:

- **PadSpan: Vacation Mode ended**: it reached the end date set for it.
- **PadSpan: Vacation Mode turned off**: someone turned it off. The message says when, who, and from
  which app or browser: "Vacation Mode was turned off Nov 21, 18:40 by Alex from the iPhone app. If
  nobody meant to, turn it back on in Whole House Presets: within 3 weeks it carries on with the
  routine it was using." A Factory Reset says so too.

The notice is a Home Assistant notification, and goes as well to the phones and email addresses
your Follow alerts use (up to five).

`binary_sensor.padspan_vacation_mode` and the `padspan_ha_vacation_mode` event are there for your
own automations.

## Guest notices

When you lend a guest tag (**Guests → Lend to a guest**; guest tags are on in
**Settings → Tracking → Phones and guest tags**), the stay has its own notices:

| Notice | When |
|---|---|
| **PadSpan: Sam arrived** | The tag is heard in the house, if **Tell me when they arrive** is ticked. |
| **PadSpan: Sam left** | The tag is no longer heard, if **Tell me when they leave** is ticked. A low battery can look the same as leaving. |
| **PadSpan: Sam in the Office** | The guest is in a room you set as off-limits (**Rooms they shouldn't go into**) for half a minute. |
| **PadSpan: is Sam's stay over?** | The tag hasn't been heard for two days. |
| **PadSpan: Sam's stay ended** | At the stay's planned end, or after a week without the tag being heard. |

- **Tell me when they arrive** and **Tell me when they leave** start ticked.
- **Send notices to**: a phone or other notify target, or **A Home Assistant notification** (the
  default).
- **Quiet hours**: no arrive or leave notices then. Off-limits notices still come.

Every one of these also fires the `padspan_ha_guest` event. The [Guest tags guide](../GUEST_TAGS_GUIDE.md)
has the rest.

## Repairs

PadSpan raises one kind of Home Assistant repair, under **Settings → Repairs**:

> **PadSpan could not confirm a save (…)**: PadSpan saved its data, but the file on disk does not
> hold what was saved, or could not be read back.

The latest changes may then be only in memory, and lost at the next restart. Check that the disk
Home Assistant runs on isn't full or read-only, and look for the error in Home Assistant's log. The
notice goes away by itself the next time a save is confirmed. It is kept over a restart.

## Other Home Assistant notifications

- **PadSpan HA update available**, once for each new stable version. To turn it off:
  **Settings → Tracking → Privacy, updates and feedback → Update Check**. See
  [chapter 3](03-install-update-uninstall.md).
- **PadSpan: AI credit**, once a month, when Claude's reads by PadSpan pass the share you chose of
  the monthly credit you typed in **Settings → AI** (**Your AI: Warn me**). Off unless you set both.
- **padspan_ha.dump_devices**: the list of named devices, when you call that service yourself.

## Inside the panel only

These show in PadSpan and send nothing:

- **The status dot** in the top bar, amber or red when something needs a look. See
  [chapter 12](12-the-screens.md#health).
- **Health → Problems found**: the checks of your whole setup.
- **Calibration Accuracy Reminders** (**Settings → Tracking → Positioning and calibration**, off by
  default): a reminder in the panel when calibration has gaps or is getting old.
