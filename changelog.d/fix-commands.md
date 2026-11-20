# A command with something missing says what

### Fixed
- **An action that failed with "Unknown error" now says what is missing.** 22 of PadSpan's commands answered a message that left out something they need (a plan, a device, a height, a width) with an error and no reason: merging or renaming a device, a receiver's height, placing a light, beacon or receiver, a blank floor, Suggest a fit, a plan's scale, a headcount and others. Home Assistant now refuses such a message itself and names what is missing. The panel sends all of these, so nothing changes on screen; a script or tool that calls PadSpan's commands gets the clear answer.
