# Guest tags

Lend a tag to a guest (a house-sitter, a visiting relative, a cleaner, a contractor) and PadSpan follows it room by room while they have it. When they give it back, the tag goes back in the drawer for the next guest, and the stay's report is kept for as long as you choose.

Guest tags are off until you turn them on. Off, nothing is tracked or kept and the Guests tab is not there.

## Turn it on

**Settings → Presence → Guest tags → Use tags as guest tags.** Here you also choose how long a finished stay's report is kept: not at all, 7, 30 (the default) or 90 days. Only an administrator can turn guest tags on, lend a tag or end a stay.

## Make a tag a guest tag

A guest tag is a device PadSpan already knows by a name you gave it. Name a spare tag first (**Follow** or **Devices → Rename**), for example "Guest tag 1". Then in **Guests**, pick it under **Use as a guest tag** and press **Add**.

What works best is a tag with a steady identity: an iBeacon, a Find My tag, or a phone set up with Private BLE Device. A cheap tag whose address changes can still work once PadSpan has tied its addresses together.

The tag keeps its own name. The guest's name belongs to the stay, so `device_tracker.guest_tag_1` stays the same entity from one guest to the next, and your automations keep working.

## Lend it

On the tag, press **Lend to a guest**:

- **Who has it:** the guest's name.
- **Until (optional):** the stay ends by itself then, and you are told.
- **Rooms they shouldn't go into:** you are told when they have been in one for half a minute (passing a doorway does not count).
- **Tell me when they arrive / leave.**
- **Staying here (a house-sitter):** counts as someone home for Vacation Mode's **Pause while someone is home**.
- **Send notices to:** a phone or another notify target, or a Home Assistant notification.
- **Quiet hours:** no arrive or leave notices then. Off-limits notices still come.

Tell your guest the tag is tracked while they have it.

## While they stay

**Guests → Staying now** shows where they are (or that the tag is not heard), since when, until when, and the time spent in each room so far. **Change** edits the stay. **Traceback** opens the tag's history for the stay.

On the Overview, the Atlas and Live Aboard, the tag shows the guest's name with a **Guest** badge.

When the tag stops being heard, the notice says so, and says the last room. A tag with a flat battery looks the same as one that left the house.

## When they give it back

Press **Tag returned**. The stay ends, the tag goes back in the drawer, and the stay moves to **Past stays** with its report: first in, last out, the times they went out and came back, the time in each room, off-limits visits and the notices sent. **Forget** deletes a stay at once, name and all.

Forgot to end a stay? After two days without the tag being heard, PadSpan asks whether the stay is over. After a week unheard, the stay ends by itself.

## For your own automations

- `binary_sensor.padspan_guest_home` is on while a guest's tag is heard in the house. Its `guests` attribute lists who, with which tag and room. The entity appears the first time guest tags are turned on.
- The guest tag's own `device_tracker` gains `guest_name`, `guest_since`, `guest_until`, `guest_off_limits` and `guest_in_off_limits` while it is lent.
- The `padspan_ha_guest` event fires with `type` set to `started`, `arrived`, `left`, `off_limits`, `reminder` or `ended`, plus `guest`, `tag` and `room`.
- While a tag is lent, its Follow alerts stay quiet so you are not told twice. The stay sends its own.

## Privacy

- Guests' names stay in your Home Assistant. They are not in the usage report or in a PadSpan backup.
- A finished stay is deleted after the days you set.
- A factory reset deletes all guest tags and stays.
