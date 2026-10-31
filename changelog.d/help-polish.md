# Help loads visibly in German, French and Dutch; Point Align errors in metres

### Changed
- **The first "?" in German, French or Dutch opens at once.** It used to wait up to 2 seconds with nothing on screen while the translated help downloaded. Now the help window opens straight away with "Loading help…" and fills in when the translation arrives (or in English after 2 seconds, as before). If the translation arrives after that, the open help switches to it.
- **Point Align gives its errors in metres.** The preview's residual, each point's chip ("Pt 1: …"), the "high error" tip and the "Aligned" and "Baked" messages read a percentage of the reference picture's width and height, which said nothing you could check. They now say how far, in metres, the points are from where the fit puts them. The rating (Excellent, Fair or Poor) and the colours are the same as before, and a line under the points says, in metres, where Excellent and Fair end for that plan.

### Fixed
- **A translated help that failed to download is tried again.** When the download failed (offline, or the file was missing), the help stayed in English until the page was reloaded. Now a "?" a minute or more later tries again.
- **The Events log page has its own help.** Its "?" opened the help for Manage → Events, the room-change alerts, which is a different page. It now explains the log: screens you opened, live data updates and tagging since the page opened, gone on reload. In German, French and Dutch too.
