# Licence and update checks: simpler

### Changed
- **Each licence check is one request again.** 0.38.259 sent a hash of Home Assistant's instance ID and, while the licence server didn't read it, asked a second time with the ID. Now the ID goes once, in the body of the request with the key (never in the web address). The licence server keeps only a hash of it, as before.
- **The update and licence checks run once a day.** 0.38.259 added a timer that looked every hour whether a day had passed. The first check after Home Assistant starts still waits a random while, and a restart doesn't check again within 20 hours.
