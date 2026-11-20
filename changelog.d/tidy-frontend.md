# Links drawn as text work from the keyboard

### Fixed
- **Links drawn as text work from the keyboard.** A name that opens a device or a receiver, a room in a list, "Hide these tips", "Skip setup", "Open Setup", "Go →", "+ Add Identity", the count badges that filter Devices, and "Cancel" while placing a receiver or a beacon: Tab now reaches each one, Enter or Space does what a click does, and a screen reader says it is a button. They look the same as before.
- **A long session on a map no longer builds up work for the browser.** Mapping → Edit, Mapping → Rooms and Calibration's maps left listeners behind on every redraw (five for each receiver marker in Edit), and every mouse move ran all of them. They are removed now; dragging a receiver and panning a map work as before.
- **A name with a quote or an apostrophe in it stays a name.** Where a name is written into the page's markup, both kinds of quote are escaped as well as the angle brackets and the ampersand. Radio QA's receiver names and the Bluetooth view's raw data show an ampersand or an angle bracket as written.
