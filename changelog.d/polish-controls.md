# Tidier floor controls, room list and page titles

### Fixed
- **The floor controls above the Overview and Traceback maps wrap in whole pieces on a phone.** A label ("Gap:", "Spacing:", "L/R:") used to end one line while its slider started the next. Each label now stays with its own slider and value. On Traceback, Save and Reset no longer touch each other or the number before them. Nothing was renamed or moved, and the row on a wide screen is as it was.
- **Settings, on a phone: the room's colour dot stays beside its name.** The dot used to jump above the name, and a name as short as "Bathroom" was broken in the middle of the word, because the name had only a narrow strip of the row. The name now has more of the row on a phone, and when it does run to a second line the dot stays beside the first.
- **Presence: a scanner's name is no longer cut short while there is room in its card.** In a narrow card the two counts ("tagged", "untagged") move to the line below the name instead of squeezing it down to a few letters. A device's name and its RSSI now run on as one line of text, so a device takes two lines where it took three, and the RSSI is no longer cut off beside a long name.
- **Monitor, Health and Forensics: the page title sits where it does on the other pages.** There was about 40 px more empty space round these three titles.
