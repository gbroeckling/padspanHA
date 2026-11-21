# Dialogs keep the keyboard

### Fixed
- **A dialog keeps the keyboard while it is open.** The panel's dialogs (a device's or a room's details, Rename, the release notes, Point Align) and the Atlas's cards and sheets did not take the keyboard: Tab went on through the page behind them, and on closing the focus fell back to the top of the page. They now take it when they open, Tab stays inside them, and when they close the focus goes back to what you pressed to open them.
- **The focus stays put when a view refreshes.** A view drawn again every few seconds replaced the button or field that had the focus, so the keyboard lost its place. The focus now goes to the same control in the new drawing.
