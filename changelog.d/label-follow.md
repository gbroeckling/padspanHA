# A name can follow a device whose address changes, on screen

### New
- **A name can follow a device whose address changes.** A device you named or follow, with no IRK or fixed ID, used to keep its name on the first address, which then aged while the device carried on under a new one as a separate row. Now the name and the row can move to the new address. It happens only when all of this holds: the new address started as the old one stopped, it sends the same name or the same data, from the same maker and of the same kind, at least two receivers hear it where they heard the old one, nothing else fits, and no radio calls the address public.
- **This moves what's on screen, and nothing else.** Calibration, learning, Follow's alerts, Home Assistant and PadSpan's saved ids stay on the address you named the device by, so a wrong link can't mix another device's signal into them. Home Assistant's sensors for that device keep reading its first address.
- **When it's close but not certain, it asks.** One quiet line on the device's row and the new address's: "This looks like Car Keys: same device?" Yes moves the name for that address, and No is remembered. It's not a window, and it doesn't appear on wall screens, or in Basic outside the device's own view.
- **Undo.** "Now on ..." on the device's row has Undo. One click puts the name back on the first address, and that address isn't linked again.
- **A pointer to the certain way.** A named device that keeps changing gets one line pointing to its IRK, once, with Dismiss. With an IRK, a phone or watch is recognised for certain.
- **The usage report (opt-in) counts how this goes:** links made, questions asked, yes, no, undone, and links that proved wrong. Counts only, never a name or an address.

### Changed
- **A followed device keeps its own row every poll.** It no longer merges with another of the same name, with or without a name of yours.

So far this has only been measured on recordings from one house, where very few devices both change their address and send a name. How often it asks or links in other homes will show in the report.
