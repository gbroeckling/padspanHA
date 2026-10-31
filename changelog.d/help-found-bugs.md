# Five small fixes found while rewriting the help

### Fixed
- **Manage → Events no longer shows a room log that never filled.** Its "Room Transitions" list read a session log nothing has written since Follow moved onto the saved movement history, so it always said "No events recorded yet". In its place is a line and an "Open History" button that opens History → Movement, where the saved room changes are. The help says so.
- **Health → Live Discovery counts the sample house's receivers.** In Sample mode "Radios" read 0. Live was already right.
- **Diagnostics lists your devices again.** It counted the sections of the live data as if they were devices, so the report said something like "0 devices" and listed none. It now counts and lists the devices that have a name or a room and were seen in the last 24 hours. The help now says the report names them, so look it over before you send it.
- **Bluetooth → Scanners' RSSI offset takes −20 to +20 dB, like Settings → Tracking → Receivers and the Receivers page.** It took −30 to +30. An offset you already saved outside that range is shown as it is and isn't changed unless you type a new one.
- **Compare Maps no longer stops when a shown plan has rooms but no placement.** It showed nothing at all. The placed plans are compared, and the others are named underneath as not placed yet.
