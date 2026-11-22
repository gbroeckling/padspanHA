# The PadSpan HA Manual, first chapters

### New
- **One manual for PadSpan**, a chapter per page, in `docs/manual/` on GitHub. Its contents page lists every chapter planned and, for the ones still to come, the guide that covers that ground today. Home Assistant's "Documentation" link for PadSpan now opens it.
- **Install, update, uninstall.** Updating step by step, stable and betas, what PadSpan's own update notice says, and uninstalling step by step, with every file PadSpan leaves in Home Assistant's config folder and how to remove them. Floor plan pictures are in `padspan_ha/maps/` (not in `www/`, which anyone with the address could open).
- **Every entity, attribute, service and event PadSpan gives Home Assistant**, with the Assist intent, the MQTT topics and three automations to paste in. `last_room`, `room_reason`, `padspan_ha.set_room_tag_map` and `padspan_ha.wled_on` / `wled_off` were written down nowhere before.
- **Every setting**: where it is in the panel, its default, what it takes and what it does, including the ones on other screens and the ones the panel never shows.
- **Backups, restore, Factory Reset, and moving to a new Home Assistant machine.** Home Assistant's own backup carries all of PadSpan, and the chapter says which files. A Factory Reset also deletes PadSpan's own backups, so make a Home Assistant backup first.
- **Troubleshooting by symptom**, **getting help** (what each of the three reports holds and leaves out, and what to put in an issue) and a **glossary**.
- **The reference tables are made from the code**, and a test fails when they and the code disagree, so they describe the version they ship with.

### Changed
- **The README's Troubleshooting link opens the troubleshooting chapter.**
