# Floor names instead of ids, and a few wrong words on screen

### Fixed
- **Floors go by their names.** Mapping's Library and Layout showed the outside floor's internal id; it now reads Outside. If Home Assistant also has a floor called Outside, the outside plan's own heading or button reads Outside (Exp.), so the two can be told apart. Monitor → Zones and the layout tables in Health showed floor ids too; they now show Home Assistant's floor names.
- **The 3D Isometric Preview names the right floors.** On homes with no floor levels set in Home Assistant, the legend could swap floors (Upper called Outside, Outside called Upper), and so could the floor slider's label. Both now take the name from each plan's own floor. A long plan name stops short of the floor name, with the whole name when you hover over it.
- **The phone's top bar says History, Events and Diagnostics** rather than the screens' internal ids.
- **Settings → Tracking says "saved layout".** A leftover old word for it is gone from the device height and GPS Bridge text and from the layout source list. Nothing changes in how they work.
- **Headings said once.** Health's "Problems found", and Basic's Usage report and Guest tags cards, each had the same heading twice in a row.
- **Manage → Events no longer shows a debug line** when no notification service is found.
- **Manage only says "switch to Live" in Sample.** Data and HA Entities said it while already in Live.
- **Example names are neutral.** Door Openers, Bluetooth's device name box and a Training diagram used names and rooms from one particular house.
