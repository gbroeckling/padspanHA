# The stable after 0.38.231: lights you tap in the 3D house, power teams, a phone's room scan as a floor plan, steadier rooms, and safer saves

### New
- **This is everything since 0.38.231 in one go,** written as how it works now. The betas' notes under it are the steps along the way; where they differ, this one is right.
- **Lights in the 3D house.** Tap a light in Live Aboard to switch it. Lights show as buttons under where they hang, can be moved in the 3D editor, string lights are drawn, and a room can work as one light switch. Unlocking a lock from the map asks first, white-only bulbs get a warmth slider, and a light's card has a Details link to Home Assistant's own window for it.
- **Power teams.** Smart bulbs on a wall dimmer, or lights that always have power, act as one light that follows the day. Lights found on after a restart are put right.
- **No floor plan? Ways to get one.** Start a blank floor, use a drawing you have, or upload a phone's room scan: its rooms, doors, windows and furniture come with it, and it finds its own place. When a plan is moved, what was placed on it can move with it, and lining up plans can suggest a fit.
- **Let Claude draw your rooms (experimental).** With an AI Task set up, Claude reads a plan and proposes room outlines that you check and keep.
- **Live Aboard** opens on the whole house with labels that follow the zoom, glass walls, a look for each screen, room chips and a room panel, kitchen and bathroom furniture, one-tap room sets, people and cars, covered patios, open decks and an Outside floor, and a ready-made Christmas tree.
- **Keys can keep their room (an option, off unless you turn it on).** Settings → Presence → Home/Away Timeout: things no person carries can stay in their last room for hours. Every device's area sensor and tracker also gain `last_room`, the room it was last seen in.

### Changed
- **Home Assistant 2024.8 or newer.** It said 2024.1, but before 2024.8 the sensors of the devices PadSpan tracks could not be added. Every release from 2024.8 to 2026.11 is now tested on each change.
- **Rooms are steadier.** A device that goes quiet keeps its room instead of drifting to another, possibly on another floor; a device nobody heard no longer "arrives"; a pinned beacon reports its room once; and a room change is never sent twice running. On a real house's four-hour recording, wrong room changes for devices that never moved halved compared with 0.38.231, and repeated room-change events went from 882 to 3.
- **Room tracking never waits.** It stalled for half a minute or more each time a calibration point was added, while a model only the "Learned model" setting uses was retrained; that model now trains in the background, and only when that setting is on. The health pages and the device list next to a busy street are much faster.
- **Lighter Home Assistant database.** Signal readings and other per-poll values are no longer written to Home Assistant's history; rooms, home or away and names still are.
- **A new install starts with Enhanced security on.** A home already set up keeps the switch as it has it.
- **Receivers' agreement in System Critics now means what it says**, and it no longer changes room decisions.

### Fixed
- **Saves are checked.** A save of PadSpan's main files that does not reach the disk is reported in Settings → Repairs instead of passing silently, and the next good save takes the notice down.
- **A saved file PadSpan cannot read is kept,** renamed beside the others and named once in the log, instead of being written over.
- **Junk is refused in words:** a command with something missing, "nan" or "inf", numbers or texts too large to keep, and lists of the wrong kind. A settings save that is refused changes nothing at all.
- **Hidden devices stay hidden, and named devices stay listed** however long they are silent.
- **PadSpan does not fetch from your own machine:** a robot vacuum's or the ESPresense Companion's address must be a device on your network.
- **In the panel,** Escape closes every card and sheet, dialogs keep the keyboard and give it back, and wide tables on a phone scroll inside their own box.
