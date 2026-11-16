# Setup Wizard: rooms you draw are kept

### Fixed
- **A room drawn in the Setup Wizard is saved as you finish it.** It used to wait for Save Layout, a button under the plan and off most screens: draw the rooms, press Next and Finish, and nothing had been saved, so the house ended with a floor plan and no rooms. Now each room is saved when you close its outline, and anything else unsaved (a receiver you placed) is saved when you move to another step, press Back to Setup or Exit setup. Mapping → Edit outside the wizard still waits for Save Layout, with Revert, as before.
- **A click on the plan before a room is chosen says what to do.** It used to do nothing at all.
- **A double-click that closes a room no longer leaves its last corner twice.**

### Changed
- **In the Setup Wizard, press a room's name above the plan to draw it.** The rooms still to draw are buttons there; pressing one starts that room, and a line says what to do next. The room list and Start drawing under the plan work as before.

### Usage report (opt-in)
- **Where setup stops, in more detail.** The report could say a house had a plan and no scale, or a plan and no rooms, but not what was tried. It now counts, as words only: on Mapping → Upload, a picture picked, Upload pressed with none, and whether the upload worked, the picture couldn't be read, was too large or failed; on the scale screen, the first end tapped, both ends down, a length typed and a Save refused; when drawing rooms, a room's name pressed above the plan, the plan clicked with no room chosen, and rooms or receivers the Setup Wizard saved for you. Never the picture, a name, a length or a place.
