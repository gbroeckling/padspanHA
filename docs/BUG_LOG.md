# Bug log

A running record of bugs found and fixed. Each one has what people saw, why it
happened, the commit and release that fixed it, and how the fix shows up in
the opt-in report (Settings → Presence → Help improve PadSpan), so a fix can
be checked in houses the tests cannot see. Newest first. Started 2026-10-12.

Status: **fixed** (in a release), **committed** (on main or a branch, not yet
released), **watching** (fixed; confirming from the field).

| # | Area | What people saw | Cause | Fix | Release | Field signal | Status |
|---|---|---|---|---|---|---|---|
| 28 | Calibration | Scanner at a whole-metre height/position could not be saved again ("Saved N, failed 1") | Schema declared plain `float`; the browser sends 2.0 back as 2 | f7773235 | 0.38.112 | — | committed |
| 27 | Phone wizard | Overview's phone Unfollow always showed Error; when it worked elsewhere the phone stayed labelled via its IRK | Schema refused the extra `device_name`; unfollow left the IRK canonical_id label | 0223c974 | 0.38.112 | — | committed |
| 26 | Tag events | `padspan_room_change` never fired for followed BLE/IRK devices | Followed list holds addresses; compared against the object key | 16066183 | 0.38.112 | — | committed |
| 25 | Alerts | Every restart sent "moved from unknown to X" per followed device | First room confirmation (old room None) treated as a move | cdbcb4fa | 0.38.112 | `follow_alert_sent` | committed |
| 24 | Alerts | Room-change alerts never rate-limited (a tag on a boundary alerted every flip) | Cooldown read under `key`, written under `key:room` | 7b997d0b | 0.38.112 | `follow_alert_sent` | committed |
| 23 | Traceback | No playback history for any time no PadSpan panel was open | Frames were recorded from the panel's snapshot request | 59f0089a | 0.38.112 | — | committed |
| 21 | Backup | A restore reset every Lost & Found "last seen" | The Lost & Found store was never in a backup; a restore also wouldn't have reloaded it (its data is `records`) | 088b5303 | 0.38.111 | — | fixed |
| 20 | Settings | Linger time could be set and did nothing | The linger logic was removed in 0.20.16 for a fixed 120 s grace; the card stayed | 3816e7af | 0.38.111 | — | fixed |
| 19 | Alerts | A phone-only alert didn't appear in Manage's saved list | The list filtered on email | 7a56aeae | 0.38.110 | — | fixed |
| 18 | Alerts | Room-change alerts to a phone picked without an email never went out | Room-change path required an email; arrive/depart didn't | 5a8b69af | 0.38.110 | `follow_alert_sent/_failed` (0.38.111) | watching |
| 17 | Presence | Arrive/leave alerts and `padspan_device_arrived/departed` never fired for tagged devices; every arrive alert fired on each restart | "Present" was any key in the poll result, and the object history keeps tagged devices there forever; no startup baseline | 4337b3d6 | 0.38.110 | `tagged_arrived/_departed` (0.38.111) | watching |
| 16 | MQTT | A label with `#` or `+` stopped MQTT publishing for every device after it | Wildcards in the topic made the publish raise inside a whole-loop `try` | ed98e8e4 | 0.38.109 | `mqtt_publish_failed` (0.38.111) | watching |
| 15 | Phone wizard | A phone named like "Garry's Pixel 8" was listed twice | Title-cased slug compared with the lowercase name | e1f27764 | 0.38.109 | — | fixed |
| 14 | Devices | An iBeacon and a plain address of the same HA device stayed two devices | Matched on `"id"`; the entries are keyed `"device_id"` | 36078bbd | 0.38.109 | `merged_by_device_n` (0.38.111) | watching |
| 13 | Phone wizard | "Turn on BLE Transmitter" always failed | Used the app's device id as the notify service name; the app names it after the phone | d3e15bda | 0.38.109 | `companion_tx_sent/_no_service/_failed` (0.38.111) | watching |
| 12 | Alerts | Alerts to a phone picked in the list went nowhere; Test said it worked | Every `notify.*` was sent as an entity via `send_message`, which drops a missing entity silently | d0c522b2 | 0.38.108 | `follow_alert_sent/_failed` (0.38.111) | watching |
| 11 | Log | Opening the alert service list wrote a warning to HA's log | Normal result logged at WARNING | d0c522b2 | 0.38.108 | `errors` (ws_notify) | fixed |
| 10 | Bermuda | Slow snapshot builds | Missing saved tags each walked every HA state, every build | da0e82e3 | 0.38.108 | `saved_tags_missing_n`, `snap_ha_ms` | watching |
| 9 | Bermuda | Slow snapshot builds (1.4–18 s on a third of installs) | A dead tags × Bluetooth-devices walk per build (compared a key the entries never had) | f13ef188 | 0.38.108 | `snap_*_ms`, `ha_states_n`, `bermuda_*` | watching — the 18 s cause is not yet proven |
| 8 | Beacon Tune | Pinned beacons missing from Calibration → Matrix | Snapshot never carried the pin fields the coordinator set | d32c5d0f | 0.38.107 | — | fixed |
| 7 | Overview | A pinned beacon drawn where the solver put it, not at its pin | Overview ignored `anchor_true_*` (also not carried, #8) | d32c5d0f | 0.38.107 | — | fixed |
| 6 | Beacon Tune | Placing or moving a beacon was never saved (since 0.30.0) | Save loop had an empty body after the photo-write removal | d32c5d0f | 0.38.107 | `beacon_tune_saved/_refused/_failed` | watching |
| 5 | Monitor | Diag Export froze the browser near a busy street | Whole live snapshot stringified on every Monitor redraw | 392e45e5 | 0.38.106 | `diag_export_built` | watching |
| 4 | Settings | BLE timeout said 900 s default; cache ignored it | UI default text wrong; cache pruned at a fixed 4 h | 392e45e5 | 0.38.106 | `ble_addrs_n` | watching |
| 3 | Lost & Found | File grew without end and was rewritten every poll | Recorded every passing stranger; IDs changed every build (#2) | 392e45e5 | 0.38.106 | `lostfound_n`, `lost_and_found_pruned` | watching |
| 2 | Devices | Unidentified devices got a new internal ID every build past ~1,000 | Random IDs from a cache that held ~1,000 devices | 392e45e5 | 0.38.106 | — | fixed |
| 1 | Presence (#91) | HA CPU 3.6% → 13.9% near a busy street | Every object, including thousands not heard for hours, smoothed every poll | 392e45e5 | 0.38.106 | `loop_ms`, `smoothed_n`, `background_n`, `cpu_pc` | watching |

## Open leads

- **IRK phone alerts stop after the first MAC rotation** (audit, reproduced): Follow saves the alert under the phone's current rotating address; lookups try the object key, then the current address.
- **A tagged device that comes home is reported in the room it left from** (audit): history replay keeps it "present", so the re-entry reset never clears its old votes.
- **Restore doesn't reload Forensics, the device registry or object history in memory** (audit, reproduced): their next save writes the old data back over the restored file.
- **A restored Traceback is lost at the next restart** (audit, reproduced): restore writes the legacy file; history lives in daily segment files.
- **Factory reset leaves Traceback history on disk** (audit, reproduced) — it returns after a reload; registry labels and Lost & Found also survive a reset.
- **Auto-Offset and the Beacon Signal Profiles toggles do nothing** (audit): settings the UI shows as affecting positioning, read by nothing in the backend.
- Minor: Sandbox feature rows call a missing `navigate`; Suspend/Resume toast success when the coordinator isn't ready.

### Earlier leads

- **Bermuda builds of 1.4–18 s** (#9, #10): the per-phase timings (0.38.108+) will say which phase. Baseline installs: b222e30f, f6e4e364, eb3e9ecf, eee7d648, 300fbac3.
- **IRKs silent on 12 of 22 installs:** looks like phones away or wrong keys, not the resolver (both sources resolve elsewhere). Not a bug yet.
