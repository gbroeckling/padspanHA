# No floor plan? Ways to get one, a phone's room scan among them

### Added
- **Mapping → Upload has "No floor plan? Ways to get one".** Five ways, each with its steps, in the order they are worth trying: a drawing you already have, a room scan from an iPhone or iPad, your robot vacuum's map, your own sketch photographed, and a blank floor. Nothing changes for a picture uploaded the usual way: it is still taken for a proper, to-scale plan.
- **A room scan from an iPhone or iPad Pro becomes a floor plan.** Scan the floor with any app that uses Apple's RoomPlan, share the scan as a USDZ file (or RoomPlan JSON), and pick it in PadSpan. The plan is drawn from the scan's walls, doors and windows, turned so the walls run straight, and to scale: nothing to measure. The ceiling heights and room names in the scan are kept with the plan. Rooms are still drawn on it by hand in this version.
- **A walk-through for the person holding the phone.** "Guide me step by step" shows the scan one step a screen, with big buttons: the right phone, the app, getting the house ready, scanning, saving the file, and giving it to PadSpan. It opens straight from a link, `/padspan-ha?view=maps&guide=scan`, so it can be sent to someone else's phone.
- **A blank floor for a house with no picture at all.** Type the floor's width and depth; PadSpan makes an empty floor of that size with a line every metre, to scale, and opens it for drawing rooms.
- **"This is my own sketch, not to scale"** on the upload. For a sketch, the scale screen takes a length each way and gives each direction its own scale, so both come out right. On any plan, two lengths that disagree now offer "This picture isn't to scale", which does the same. A proper plan's two lengths are averaged as before unless you say so.

### Changed
- **Measuring a plan's scale asks for the longest wall you can.** A doorway is too short to trust: a small slip there puts the whole plan out.

### Usage report (opt-in)
- **Which way to a plan people open**, whether a scan or a blank floor was made or refused, and whether a plan was said to be a sketch. Words only: never the file, a size, a name or a picture.
