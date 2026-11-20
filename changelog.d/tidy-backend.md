# A safety backup before calibration points are cleared

### Changed
- **Clearing calibration points takes a safety backup first.** Clear All (Calibration) and a map's Clear (Settings) now take the automatic backup before any point is removed, so the points can be brought back from Manage → Backup & Restore. If the backup can't be made, nothing is removed and the reply says so.
- **A phone's key stays with administrators.** Settings sent to someone who is not an administrator carry each saved phone's name and no key. Testing a key and looking for keys are for administrators, as saving and removing one already were.
- **Traceback and movement history have a largest request.** One request returns at most 4,000 Traceback frames or 200 movement-history entries, which is the most the panel asks for.
- **The integration's icon and logo are served as two single files**, at the addresses they always had.
- **The README's privacy section now covers the shared furniture library and the AI reads**: what each sends, and when.
