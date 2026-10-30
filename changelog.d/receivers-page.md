# A Receivers page: every Bluetooth receiver in one table

### New
- **Receivers, a new screen in the menu's Setup group, in every mode.** One row for each Bluetooth receiver PadSpan hears from: its room, its floor, whether it is on a floor plan, its height, its signal adjustment, its status, how many devices it hears right now, and when it was last heard. Until now these were spread over Mapping, Calibration, Settings, Health and Bluetooth. In Basic mode it is in the main list, beside Calibration: every home has receivers, and a silent one is the commonest reason a room is wrong.
- **Height and signal adjustment can be changed right in the table.** They are the same values as Calibration → Tune, Mapping → Edit → Radios and Settings → Tracking → Receivers, saved the same way: change one in any place and the others show the new number. Nothing new is stored.
- **Status uses the top bar dot's rules:** Online, Silent (not heard for over 10 minutes, with how long), or Hearing less (far fewer devices than usual while the others are normal). Problem rows are marked; tick **Problems only** to see just those. Click a column heading to sort by it.
- **Place or Move** opens Mapping with that receiver selected (in Basic, the floor plan setup's Place scanners step), to put it where it is mounted. Positions and calibration are never changed from this page.
- In Sample mode the demo house's receivers are shown read-only, with a note. On a phone each receiver is a card.
- Mapping → Edit → Radios, Settings → Tracking → Receivers, Health's Scanner Health and Bluetooth → Receivers keep their controls and gain an **All receivers** link to the new page.

### Opt-in report
- Opening the page is counted like every other screen (`tab:receivers`), and a height or signal adjustment saved from its table is counted once per save (`receivers_page_edit`). Never which receiver or the value.
