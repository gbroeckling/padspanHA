# 11. Calibration

[Contents](README.md)

Calibration teaches PadSpan what your house sounds like. You carry your phone or a tag to spots
around the house, and at each spot PadSpan records how strongly every receiver hears it. These
**calibration points** are what it later compares live signals with, to put people in the right
room.

Without calibration, PadSpan places each device from the receivers alone: the room of the receiver
that hears it best, or, with a map, a position worked out from the receivers' places. That is a good
first answer. Calibration makes it better, most of all in doorways and next to the walls between
rooms, where two rooms are hardest to tell apart.

Calibration is free, and it is in the main menu in every mode, with the same tabs in Basic and
Advanced.

## Before you start

- **A floor plan with a scale.** A calibration point is a spot measured in metres, so on a floor
  with no scale it can't be saved. Calibration says **This floor needs a measurement first**, with
  **Measure this floor →**.
- **Rooms and receivers on the map of your house.** Draw the rooms and place the receivers, then
  **Put it on the map** ([chapter 9](09-setup-the-map.md)). Walk a room uses the rooms on the map
  of your house, never the ones drawn only on the picture.
- **Receivers where they really are, at their real height.** Calibration records what each receiver
  hears; a receiver drawn in the wrong place makes every point near it misleading. Guided
  calibration starts with this check.
- **The phone or tag you will carry.** It must be one PadSpan already hears and knows: a phone you
  track, or a named tag ([chapter 4](04-first-room.md)).
- **A second screen helps.** Carry the phone the way you usually do, in a pocket, screen off, and
  press the buttons on another phone, tablet or computer. A phone held in the hand with its screen
  on is heard differently from the same phone in a pocket.

## When to calibrate

- **Once the map is built.** Setup's last step, **Calibrate**, is done at five calibration points or
  a computed model.
- **After you move a receiver.** Calibrate the rooms next to it again: they now hear differently,
  and their old points don't know it.
- **When a room keeps coming out wrong.** Calibration's **Results** names the room PadSpan gets
  wrong most often and how many more points it needs.
- **Every few months.** Furniture moves, and so do receivers. When the newest point is over 90 days
  old, Results suggests walking the house again.

## How many spots

| | |
|---|---|
| **Each floor** | 10 to 20 spots, spread across the floor. More is better. |
| **Each room** | At least 3. A room with fewer is listed first, as needing work. |
| **Where** | In the middle of each room, and more in doorways and near the walls between rooms. |
| **How long at each spot** | **Collection Duration**: 15, 30, 60 or 90 seconds. It starts at 15; 60 is recommended, about one reading a second from each receiver. |
| **Before accuracy can be worked out** | 4 points or more. |

Walk a room needs no spots: one 90-second walk covers a whole room.

## Two ways to calibrate

| | Walk a room | Guided calibration |
|---|---|---|
| **What you do** | Walk slowly round each room for 90 seconds | Stand still at a spot, collect, move to the next |
| **Time** | About 2 minutes a room | About a minute a spot at the recommended 60 s |
| **On a new install** | Off: turn it on first | On |
| **From Setup** | **Start →**, where it is on | **Point by point**, or **Start →** where Walk a room is off |

Both feed the same calibration, and you can use both: walk the rooms, then add spots by hand where a
room still reads oddly.

## Walk a room

Walk a room calibrates a whole room in one 90-second walk.

**On by default.** A new install has it on. An install from before this default has it turned on once
by the update that brings it, unless a walk was saved there (then it was on, and someone turned it off, so it
stays off). To turn it off or on again, in Advanced open
**Settings → Tracking → Positioning and calibration → Walk a Room (Calibration)** and use **Add a
"Walk a room" tab to Calibration**. Where it is off, Setup's Calibrate step has **Open that
setting**, which takes you there in either mode. While it is on, Calibration has a **Walk a room**
tab. It needs Live mode.

**Walk a room:**

1. On the **Beacon and floor** tab, pick the phone or tag you will carry (**Beacon Device**) and the
   **Floor**. Walk a room says **Setup required** until you have.
2. On **Walk a room**, choose the room in **Choose a room…** and choose **Start walking**.
3. Walk slowly for 90 seconds: along the walls, into each corner, then through the middle. Stay in
   the room until the ring is full. **Cancel & discard** stops early.
4. PadSpan shows what it heard, and how different the room sounds from the closest other room:
   - **Stands out from …**: good.
   - **Somewhat like …**: fine, but a second walk can help.
   - **Reads much like …**: the two may be hard to tell apart; walk closer to the walls and
     corners.
5. Choose **Save this walk?** to keep it, or **Discard**. Nothing is saved until you choose.
6. PadSpan tests itself again and shows the score before and after: **Fingerprints got more rooms
   right**, **About the same as before**, or **Fingerprints got fewer rooms right** (walk the room
   again, or remove the walk).
7. **Walk another room**.

Each room keeps one walk: a new walk of a room replaces that room's earlier walk only. **Remove the
walk of …** takes out just that room's walk points; your other calibration points are never
touched. Turning the setting off hides the tab, and saved walks stay in use.

## Guided calibration

**🧭 Guided calibration** takes you through the steps in order. Open it from **Results**, from the
button at the top of any other Calibration tab, or from Setup's Calibrate step.

1. **Check receiver positions.** Optional, but worth a look: drag any receiver marker that isn't
   where the real receiver is mounted. Click a marker to set its **Height above floor (m)** and
   **Save height**. Nothing is collected here. **Skip — positions look fine** moves on.
2. **Choose your device.** Pick the phone or tag you will carry (**Beacon Device**), the **Floor**
   you are calibrating, and the **Collection Duration**. The later steps stay locked until a device
   and a floor with a scale are chosen.
3. **Walk your home.** A blue crosshair on the plan marks the **Next Target**. Walk there, stand
   still, and choose **I'm Here — Collect**. Stand still for the whole time. The coverage map fills
   in as you go (covered, partly covered, not yet covered), and picks the next spot. **Skip — I'll
   collect points later** moves on.
4. **Compute your model.** Choose **Compute Model**. **Est. Accuracy** is how far off PadSpan's
   guess was, on average, when tested.
5. **Finish.** How many points this floor and the whole house have. **+ Calibrate another floor**
   goes back to step 2 for the next floor; **Done** closes the guide.

**✕ Exit guide → full tabs** leaves at any time and keeps every point you saved.

### Picking the spots yourself: Pin & Listen

On the **Pin & Listen** tab, tap the plan where you are standing, choose **Start Collecting**, and
stand still until the time is up. Then **Save Point** keeps it, or **Discard**. **Stop & Discard**
cancels a collection. **Roam** is the same collecting with PadSpan picking the spot, as in guided
step 3.

If the screen says **Beacon not currently detected by any radio**, the phone or tag isn't being
heard: check its Bluetooth is on and it is near a receiver.

## Beacon Tune

**Beacon Tune** (experimental) is for Bluetooth beacons that stay in one place: a tag on a shelf, a
key finder by the door, a fixed iBeacon. You mark where each one really is, and PadSpan keeps
learning from it while it sits there.

1. Pick the floor, choose the beacon in **select beacon to add** (devices you have named or follow)
   and choose **Add to map**.
2. Drag it to where the beacon really is, and choose **Save**.
3. Leave the beacon where it is for the 60-second capture that follows. It is saved as a calibration
   point.

A beacon you place is pinned: PadSpan shows it in its pinned room instead of working its room out.
A device PadSpan knows moves (a phone with its key, a tag you follow) is never pinned; it gets the
one capture, then goes back to live tracking.

With **Auto-Cal: ON** (the default), a pinned beacon that sits still adds a fresh calibration point
now and then, at most once every 10 minutes and 50 points a beacon; they are marked [auto] on the
Model tab.

Moving a beacon starts another capture. Moving the same beacon three times in a few minutes asks
about a "hard relocation": **OK** deletes that beacon's earlier Beacon Tune points. Choose OK only if
the old spots were wrong.

## Reading Results

Calibration opens on **Results**. It only reads your calibration; each button takes you to the tab
that does the work.

**How accurate it is now**

- **rooms right**: the share of test spots PadSpan put in the right room.
- **typical distance off**: how far off it usually was, in metres (green under 2 m).

Both come from a strict test on spots it hasn't seen: PadSpan hides a spot, and every point within
1.5 m of it, then checks where it would have put someone standing there. The line under them gives
the test both ways PadSpan can place someone (from your calibration points, and from where the
receivers are) and says which did better. Before that test has run, you see **estimated distance
off** instead, which reads better than real life. With fewer than 4 points there is nothing to work
out yet.

**The next best thing to do** is one suggestion, the first that applies:

1. **Measure one distance on a floor plan**: a plan with no scale.
2. **Calibrate the house**: no points yet.
3. **Say how high each receiver is mounted**: they are all at one height.
4. **Give your floors their real heights**: every floor is at the default height.
5. **Work out the accuracy again**: there are points the numbers don't include yet (**Open Model →**,
   then **Compute Model**).
6. **Add calibration points in …**: a drawn room with no points.
7. **Add a few points in …**: the room PadSpan gets wrong most often ("mostly mixing it up with …"),
   or one with only a few points.
8. **Walk the house again**: the newest point is over 90 days old.
9. **Nothing urgent**: look at Accuracy by spot if a room still feels off.

**Room by room** lists the rooms that need work first: no points yet, fewer than 3, or under 70%
right, with the room each is most often **mixed up with**. Rooms that look fine fold away under one
line.

A room can show a higher % than the headline. Each room's figure comes from an older, kinder score
that keeps nearby points in when it tests a spot. Trust the headline.

## The Model tab

- **Compute Model** works the accuracy out again from your points (4 or more). Do it after adding
  points.
- The Summary shows your points, receivers and floors, and **Est. Accuracy** (green under 2 m). It
  is a distance, not a percentage, and it reads better than real life.
- **Per-Room Accuracy**, with the room each is most often **Confused With**.
- **Receiver Coverage**: how strongly each receiver hears your points.
- Every calibration point, each with its own Delete.
- **Export JSON** saves all your points to a file. **Import** reads one back, skipping points you
  already have. **Clear All** deletes every point in the house after one more confirmation. It can't
  be undone: export first.

## Accuracy by spot

**Accuracy by spot** is a table: one row per calibration point, one column per receiver. Each cell
compares how far the point really is from that receiver with how far the receiver's signal says it
is. Hover over a cell for the numbers.

- **Green**: they agree.
- **Blue**: the signal makes the point seem farther away than it is. **Red**: closer.
- **Grey**: that receiver never heard the point.

A column blue or red all the way down usually means that receiver's position or height is off: fix
it on **Tune**. A row off everywhere is usually a point saved in the wrong place: delete it on the
Model tab and collect it again. **Relearn (recompute model)** works the model out again, the same as
Compute Model; it deletes nothing.

It needs each receiver's signal fit, so collect some points and **Compute Model** first. Rooms that
keep flipping in live tracking are a different thing: see **Health → Room mix-ups**
([chapter 12](12-the-screens.md)).

## Signals say this receiver is in another room

Each calibration point holds the room you took it in, and what every receiver heard there. A
receiver hears the spots nearest it best. So when most of the spots a receiver hears best are in one
other room, its Home Assistant area is probably wrong.

Once you have calibration points, Setup's **Place receivers and set their heights** step says so:

> Signals say Kitchen Proxy is in Dining Room, not Kitchen: 4 of the 5 calibration points it hears
> best are there.

- **Use Dining Room** gives the receiver's device that area in Home Assistant, as the Overview's
  **View radios list → Assign** does.
- **Keep Kitchen** leaves it, and the suggestion isn't shown again until the page is loaded again.

PadSpan suggests this only when it is fairly sure: the receiver heard at least 3 points, at least
60% of the 5 it hears best (of all it heard, when fewer) are in that one other room, that room is
one of your Home Assistant areas, and the receiver's own room has at least 2 points of its own. A
receiver marked lost or disabled is left out. A receiver in a room nobody calibrated
can't be told from the next room, so calibrate each room first.

## Tips

- Carry the phone the way you always do. A phone in a pocket and the same phone in your hand sound
  different.
- Moved a receiver? Calibrate the rooms next to it again.
- Stand still for the whole collection.
- More points in doorways and near the walls between rooms.
- A phone still jumping between rooms after calibrating: see [chapter 26](26-troubleshooting.md) and
  [Why does my phone jump between rooms?](https://padspan.traks.ca/guides/room-flapping/)

**For experts:** **Settings → Tracking → Positioning and calibration** has the **Positioning
Algorithm** ("Matched to calibration points", the default, or "Learned model (experimental)"),
**Adaptive Learning**, which learns from rooms PadSpan is already sure of, and **Calibration
Accuracy Reminders**. Every setting there is in [chapter 20](20-settings-reference.md).
