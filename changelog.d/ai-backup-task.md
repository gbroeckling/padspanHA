# A backup AI Task

### New
- **A backup AI Task.** Settings → AI has a new Backup AI task picker under the main one. When the main AI Task can't be reached (for example, it runs on a laptop that's out of the house), photo and floor-plan stair reads switch to the backup on their own, so you never have to change the setting by hand. PadSpan only switches when the main one is really away: Home Assistant shows it as unavailable, its server doesn't take a connection within 5 seconds, or the call fails because the server can't be reached. A main AI Task that is just slow, or that gives an answer PadSpan can't use, is never switched. Once the main one has failed, PadSpan skips it for 5 minutes and then tries it again. A read done by the backup says so ("Read by the backup AI task"), and before you send a photo, the photo step says which AI Task will read it and whether the backup, if it reads instead, keeps the photo in the house or sends it to the cloud. There's no backup until you choose one, so nothing changes for anyone who doesn't.

### Opt-in report
- Two new counts: reads done by the backup AI Task because the main one was away, and reads where the backup failed too. The report also says whether a backup AI Task is set (yes only, never which one).
