# Changelog

All notable changes to PadSpan HA are documented here.

---

## 0.36.6 — The usage report can tell a key that never works from a key nobody added (2026-08-20)

### Identity health
- **`rpas_seen` / `rpas_resolved` was never a resolution metric**, and reading it as one is a mistake already made once against real data. `count_rpas()` counts every structurally-resolvable address on the air — every rotating device in radio range, so overwhelmingly other people's phones, watches and passing cars. The ratio measures what fraction of your neighbours belong to you, and a low one is the ordinary result in a normal home. Both fields stay, because how crowded the air is bears on history size and CPU, but they are now labelled as describing the *environment* and the comment says what they are not.
- **`irks_silent` — the failure the report could not see.** Of the identities an install actually registered, how many resolved nothing at all in the window. A key that is present and never matches used to look exactly like a key nobody added: both were a zero.
- **`has_any_identity`.** Without it every zero above is unreadable, because "none configured" and "none working" are the same number and completely different bugs.
- **`irks_by_source` / `irks_resolving_by_source`.** Identities arrive by five doors — `private_ble_device`, `bluetooth_bond`, `mobile_app`, `companion_sensor`, and PadSpan's own list — and nothing said which of them carries the load or which of them works. Labels come from a fixed vocabulary, so an unknown source is bucketed as `other` rather than travelling as itself. Counts and fixed labels only; device names never leave the resolver.
- A preview reads the identity window without resetting it, as with every other window; only a send consumes.

### Tests — 988 to 992
- The breakdown, confirmed as cover by mutation: counting every key as silent fails 2, passing an unknown source label through fails 1, asserting an identity exists when none does fails 1, lumping all sources together fails 2. Two of the new tests also assert that a house with named devices puts none of those names in the payload.

---

## 0.36.5 — A scanner's name is not part of another scanner's, and the report can now tell these apart (2026-08-20)

### Identity
- **A shared name prefix no longer moves several scanners at once.** Reported by p976dtrsg2-droid: with proxies named `btproxy`, `btproxy_livingroom` and `btproxy_kitchen`, assigning an area to one moved others with it. Radios were matched to their HA device by a two-way substring test against every device name, taking the first hit out of an unordered registry — so `btproxy` answered for all three, and which won could change between restarts. Three copies of that rule: `snapshot_builder`, which is the one that produced the reported behaviour because it sets both `device_id` *and* the displayed area for every radio, and twice in `ws_radios`. The Overview prefers `device_id` over a name when calling `radio_area_set`, which looks like the safe path, but the `device_id` had been chosen by the same rule and was already wrong.
- **Containment is not identity.** Resolution now lives in one place, `RadioDeviceIndex`: a MAC from the source against the device's connections, then the whole name compared as a slug so "Living Room Hub" still matches `living_room_hub`, then containment *only* where it names exactly one device — which keeps installs working where the names are related without being equal, and stops a shared prefix claiming three scanners. Anything ambiguous resolves to no device at all. A scanner with no area is a visible gap someone can fix; a scanner holding another scanner's area is a wrong answer that looks right.
- **The refusal says why.** `radio_area_set` reports the colliding names back, and the Overview shows the server's message instead of "Failed to update. Check HA logs." A refusal nobody can read is just a failure.

### The usage report can now tell two geometry faults apart
- **Which signal tripped**, split across `geometry_fault_iso` / `_scale` / `_origin`. A lumped fault count says something is wrong and nothing about what, which sends this straight back to asking people for screenshots.
- **`anchor_is_affine` and `maps_affine`.** A trimmed Point-Aligned map and a trimmed ordinary one fail differently and are indistinguishable from a fault count. The anchor's kind is the discriminator, and it is currently the open question on #62.
- **`stack_desync`** — Point-Aligned maps whose matrix and whose decomposed fields no longer describe the same footprint. Nothing could see this before: such a map draws correctly through its matrix while every stored number disagrees. It is the exposure metric for #64 step 3, which is known and not yet fixed.
- **`radios_ambiguous` / `radios_unresolved` / `radios_matched_partial`.** The naming collision above had to be noticed, troubleshot and written up by a user before it was visible at all. Counts by outcome only — never which radios, never their names.

### ESPresense
- **The ingestion has tests for the first time.** It was already wired at startup, toggled from Manage, torn down on unload and feeding the snapshot; what it did not have was a single test over 370 lines of parsing against a wire format with three traps it documents about itself — the scanner identity living only in the topic path, rssi and distance arriving as JSON strings, and bare-hex MACs. Each is a silent wrong answer rather than a crash.
- **The README says how it actually works.** It claimed PadSpan works with existing ESPresense scanners without mentioning that they arrive over MQTT, need HA's MQTT integration, and are off until switched on. All true, none of it stated.

### Tests — 933 to 988
- The scanner resolver, the ESPresense callbacks and `stack_desync`, each confirmed as cover by mutation rather than by going green. Reinstating the original substring rule fails 9 of the resolver's tests.

---

## 0.36.4 — Two placements that were read from fields nothing was using (2026-08-19)

### Geometry
- **The metre anchor reads the transform, not the fields it ignores.** 0.36.0 fixed the write side of the trim skew: `_recrop_stack` re-derives a map's stack when the picture is cropped, and its raw-affine branch rewrites `_m` and returns, correctly leaving `scale`/`scale_x_adj` behind because `stack_world_xform` ignores them entirely whenever `_m` is present. The read side kept its own copy of the old derivation — in `find_metre_anchor`, again in `map_geometry_faults`, and once more in the JS twin — so on a trimmed Point-Aligned map all three measured a footprint the renderer never draws, out of the values the trim had deliberately abandoned. All three now go through one shared `world_footprint()` that transforms the image corners and takes the two edge lengths, so it cannot describe a branch that is not in force. Correct under rotation by construction rather than by luck: the old form ignored rotation and survived only because rotation preserves length.
- **A fresh Point Align was never affected**, which is why this went unseen. The solver writes the affine *and* an AR-aware decomposition of the same matrix, so `scale * scale_x_adj` already equals the affine's x span exactly, including under shear. Checked against identity, anisotropic, sheared and rotated matrices: old and new agree to the last digit before a trim, and a map that was never Point-Aligned trims clean under both. The error is a pure function of the crop, `iso_error = |fh - fw| / fw`, zero for a square trim and growing with how one-sided it is.
- **Change Master clears the solved matrix it was resetting around.** Both of its stack writes are built with `Object.assign`, which spreads the old stack first, and neither override named `_m` or `_m_ar` — so a solved matrix survived a reset that zeroed every other placement field, and since `makeStackXform` prefers it, none of the reset reached the renderer. The map went on drawing at its old placement while its stored values claimed the origin at scale 1. Not an edge case: the wizard refuses to run unless the new master is already aligned to the current one, so the map being reset is exactly the map most likely to carry a matrix. Measured worst corner 0.2610 world units from where the fields claimed, centre invariant because the affine is centre-based, so it presented as the map rotating about itself.

### Known, not fixed
- **The Change Master relink (step 3) still mis-places maps that carry a solved matrix.** It composes their new placement from `x_offset`/`scale`/`rotation`, which are not the fields in force for such a map, then writes the result back into those same ignored fields — so the map does not move at all and is left behind when the world frame shifts. Those are the old master's alignment targets, so they are the likeliest to hold one. Clearing `_m` there too is unsafe: a map trimmed after being Point Aligned holds a correct matrix beside stale decomposed fields, and composing from the stale ones would overwrite the right answer. It needs the composition done on the matrix. Tracked in #64.
- **Neither of these is claimed as closing #62.** Whether the trim path is behind the report there depends on that install's main floor carrying `_m`, which is not established — Point Align writes the matrix to the target map, not the reference. Waiting on the answer rather than guessing.

### Tests — 928 to 933
- `test_point_align_anchor.py` drives the real `_recrop_stack` rather than a hand-built stack, so the reported 42% is derived from the trim fractions instead of tuned to match the report. Two of the five fail on revert with the original error. The JS halves of both fixes were checked by running the real transforms under node and comparing numbers, since there is no `package.json` and CI runs no JS.

---

## 0.36.3 — Phantom devices, a solver that claimed certainty it did not have, and the tests that found both (2026-08-19)

### Identity
- **An unknown address age is not an age of zero.** `update_address_memory` coerced a missing age to `0.0` and then compared it with the previous poll's, so a missing reading looked like a fall from whatever came before — the exact evidence the rule exists to demand, manufactured out of its absence. It marked a rotating device's abandoned address *durable*, which splits one phone into several objects: issue #63 inverted. An unknown age now carries the last known one forward and decides nothing.

### The spatial solver
- **A fit cannot be more certain than the measurements it is made of.** The position's standard error multiplied the geometric conditioning *by* the residual, so ranges that merely agreed drove the uncertainty to zero and the geometry never got a say. Three receivers in a line with exact ranges to a point two hundred metres away — a geometry that fixes the position only up to reflection across that line, so the solve cannot know which side of the receivers the device is on — reported **0.0 m** and published it. The residual may now raise the uncertainty above what the radios can deliver but never lower it below.
- **The "this solve is not determined" diagnostic is visible.** It was written and then overwritten two statements later, so the gate could fire on every poll of every device and never appear anywhere.

### Repairs and permissions
- **Rebuilding a map's alignment is an administrator action**, like the sibling repair that goes the other way. It writes the map store and saves it.
- **The repair dialog names the signal that actually fired.** A fault trips on any of three, and only two were explained, so a scale-only fault quoted a placement error that is inside its own tolerance — a number that reads as nonsense to someone being asked to approve a permanent change.

### Housekeeping
- A removed object is no longer reported as failing forever: the failure list is per-object state and was not cleared on eviction.

### Tests — 865 to 928
- **Poll-level harness.** The defects of the last three releases all got through because the helper was correct and the *caller* was wrong. These drive a real update cycle, and were verified by reverting this week's fix and watching them fail with the original error.
- **Per-object state lifecycle.** Every one of the coordinator's ~forty per-object dicts is classified, and adding one without classifying it fails the suite. It immediately found floor evidence surviving a device's absence.
- **The building footprint**, which shipped in 0.36.1 with no tests, on the check that decides whether a position is published at all.
- **Beacon durability at real advertising rates**, which established that the rule works only within a band of intervals — a beacon advertising once a second can never satisfy it, and a real two-beacon pack is merged into one object. Recorded rather than fixed; the fix changes device identity and belongs in a change of its own.

---

## 0.36.2 — A device that is outside and heard by nothing no longer stops the poll (2026-08-19)

### Fixed — a whole-install outage introduced by 0.36.1
- **The outside rule's diagnostic formatted a reading that was not taken.** 0.36.1 moved the verdict to a trailing window, which made "outside, and heard by nothing this poll" a normal state for the first time — and the debug line still formatted *this* poll's strongest reading, which is `None` in exactly that state. The `TypeError` escaped the per-object loop, the coordinator never assigned its data, and **every entity in the install froze at its last value**: maps stopped updating and a vehicle that had left was still drawn where it last was. The line now reports the value the decision was actually made from, and says `silent` when nothing was heard.

### One object's failure is one object's failure
- **The per-object pipeline is isolated.** Whatever a single device's state does, the other objects still get their poll: the failure is recorded against that object, it is emitted unrefined rather than dropped, and its traceback is logged once instead of every ten seconds. A house full of working sensors must not go dark because one tag is in a shape the solver did not expect. `PadSpan: N of M objects failed this poll` is the new early warning, and it should read zero.

### A device that comes back is not placed by where it used to be
- The re-entry reset cleared the vote window, the confirmed room and the coverage history, but not `_floor_evidence` or `_device_floor` — so a device that left and returned was still judged on the floor it was on before it went. Both are now cleared with the rest. Found by a test, not by a report.

### The coverage window is a duration, not a poll count
- `presence_poll_interval_s` is a user setting (1–60 s, default 5), so a fixed count of six polls meant 30 s on a default install and **a full minute** on one polling every 10 s. How long a device has been unheard is a fact about the device, not about how often this install happens to look. The window is now 30 s everywhere and the poll count is derived from the install's own rate.

### Tests
- **A poll-level harness.** Every significant defect of the last three releases got through because the helper was correct and the *caller* was wrong — issue #62, issue #63, and the crash above. These tests drive a real coordinator through a real `_async_update_data`, so the caller is exercised too. Verified by reverting the fix and watching them fail with the original `TypeError`.
- **Per-object state has one lifecycle, and a test enforces it.** The coordinator keeps per-object state in forty-odd dicts, each of which must be cleared on eviction and, if it describes a location, on return from an absence. Adding a dict without classifying it now fails the suite, so the question is forced at the point it is cheapest to answer.

---

## 0.36.1 — The outside rule reads a window, and the solver says when it did not find a point (2026-08-19)

- **The outside rule cannot be decided by one poll's thinnest evidence.** The rule reads the strongest scanner still inside the silence grace. When the scanner that hears a device best goes quiet that value does not degrade — it drops to the next best, which can be 25–30 dB lower, and crosses the floor in a single poll. Scanners are shared, so *every* device whose best hearer went quiet flipped in the same poll: the symptom was a whole house going outside at once rather than one device drifting. The verdict now comes from a trailing window, so going outside must survive sustained evidence while coming back inside stays immediate.
- **The solver reports whether the geometry determined a point.** A least-squares solve returns a point whether or not the receivers constrain one; when they all lie in roughly the same direction the residual surface is flat and the estimate slides out into a field. That flatness is measurable — it is the covariance of the fit — so the estimator now reports its own uncertainty, and an estimate that is not determined falls back to the seed rather than being fenced in by a bounding box.
- **The building footprint is the union of the rooms**, not a box drawn around them. A box can prove a point is outside the building and can never prove it is inside: the missing corner of an L, the yard between two wings and the driveway are all inside the box and inside no room.
- `scripts/release.py` reconfigures its console to UTF-8, so the Bright pass no longer exits red on the machine releases are cut from.

**Known issue:** this release introduced the outage fixed in 0.36.2. Upgrade past it.

---

## 0.36.0 — Trimming a map no longer skews the fabric, and an install can report a broken placement itself (2026-08-19)

- **Trimming a map no longer skews the fabric (#62).** A map's placement was stored twice — metric in the model, world in the map's stack — and a crop re-derived only one of them. The two metres-per-world-unit figures then disagreed, and rooms drew correct across and wrong down by exactly the map's aspect error.
- **An install can report a skewed map itself**, without the owner having to notice and screenshot it: a read-only check reports a map whose stored geometry no longer agrees with itself, surfaced in Health and in the Rooms placements table.
- **Rooms can repair a stale map alignment, and warns before you touch anything.** Which *side* is stale decides the repair. For a trimmed map the transform is the trustworthy half and the stack is stale, so the existing "Fix alignment" would overwrite the one good copy — a new "Rebuild alignment" goes the other way and leaves the stored placement untouched. It is refused unless the map is actually in that state, so it cannot flatten a deliberate hand alignment.
- **2025 panel chrome, as a selectable skin.**
- **Mapping sub-tabs work again** — `setMapsTab` threw before it rendered.

---

## 0.35.0 — Stable: PadSpan Bright's foundations, the Bluetooth view restyled, IRKs told the truth, and an opt-in usage report (2026-08-18)

The first stable since 0.34.4. Everything below shipped and was verified as pre-releases 0.34.5–0.34.11 on a live install before this promotion.

### The tier model and PadSpan Bright's foundations (not yet a separate download)
- One owner of "what may this install do" (`licence.py`): `free < bright < pro`, `effective tier = max(shipped floor, key tier)`. The floor is a build constant, never fetched — a lighting map never waits on a licence server. **A key with no tier field resolves to `pro`**, so no existing customer is demoted.
- Light placement now gates at `bright` rather than `pro`: a PadSpan Bright Pro key or a PadSpan Pro key both unlock it.
- **Mapping → Lights is never hidden.** Below the `bright` tier it shows the free lighting map — rooms, floors, one marker per light in its room, click to switch — with placement, shapes, sizes, WLED, Showcase and Fit room withheld from the *drawing only*. Nothing stored is touched; enter a key and every placement returns exactly as it was.
- An importer for anyone who maps a house in PadSpan Bright and later installs PadSpan HA (Health → Import from PadSpan Bright): backs up first, refuses a non-empty house, never merges.

### The Bluetooth view, restyled
- One visual language across all five sub-tabs: a four-bar signal meter and tabular dBm everywhere signal is shown, one chip vocabulary, one row treatment, key/value detail panes, empty states that explain themselves. Same screens, same controls, same data — the view had four ways to draw "signal" and three greys doing one job.

### Private BLE (IRK)
- **`irk_add` refuses what cannot work.** A value that is really an iBeacon UUID on the air is rejected and the beacon named — the Companion App shows that UUID on the very screen people look for the key, and pasting it produced "0 resolved" forever with no explanation. A key that resolves nothing is refused unless you save it unverified (the phone is away).
- A fingerprint bridge is an inference, not an identity: a bridged object is no longer marked identified, and a stale bridge expires instead of being resurrected from history indefinitely.

### Help improve PadSpan (opt-in, off by default)
- Settings → Update Check & Privacy → **Help improve PadSpan**. Once a day, counts, versions and flags only — never addresses, keys, device / room / floor names, coordinates, or timestamps finer than the day. **Preview what would be sent** shows the exact report; the code refuses to send anything identifier-shaped; the event vocabulary is a closed list; opting in is an administrator action. PadSpan is developed against one house — this is how features that only exist in yours get seen.

---

## 0.34.11 — The usage report describes a house, not an empty one (2026-08-18)

### Fixed
- **A report sent while nothing had built a snapshot said "0 scanners, 0 objects" about a full house.** Half the report — scanners, objects, resolver health — is read from the live snapshot, which is built on demand and cached; a send ten minutes after a restart, with nobody looking at the panel, found no cache and reported zeros. Caught on the very first real send. `send_now` and Preview now build one first (the builder serves its own cache, so it costs nothing when the panel is open).

---

## 0.34.10 — The usage report counts what it says it counts (2026-08-18)

### Added — usage report coverage
- Every name in the report's event vocabulary now has a real call site: calibration point added, capture started, forensics query, Showcase turned on, backup created / restored, factory reset, Bright import, wall removed, IRK validate — each counted only after the action succeeded. A test asserts the vocabulary can never carry a dead name again.
- **IRK resolution stats.** `usage.irk_resolved` ticks once per NEW rotating address a registered key resolves; `usage.irk_unresolved_rpa` once per NEW rotating address that matches no key; `health.irk_devices_resolving` is how many registered keys resolved anything since the last report — the answer to "does the IRK path work anywhere", which nothing could see before. Counts only: canonical ids never leave the resolver.

---

## 0.34.9 — Help improve PadSpan: an opt-in usage report (2026-08-18)

PadSpan is developed against one house; features that only exist in yours never get seen. This release adds a way to change that — **off by default, opt-in, counts only**.

### Added
- **Settings → Update Check & Privacy → Help improve PadSpan.** Opt in and once a day PadSpan POSTs a ~2 KB JSON report to `padspan.traks.ca`: version / edition / tier / HA / Python; how many scanners (by kind and state), floors, rooms, placed lights, walls, maps, calibration points, IRKs, followed devices, objects (by kind), which related integrations are installed; which feature switches are on; how many times each tab and tool was used since the last report; health flags (crypto ok, BLE callback alive, coverage floor active, rotating addresses seen / resolved, outside attribution firing, positioned objects); WARNING/ERROR log lines by module. **Never** MAC addresses, keys, device / room / floor / entity names, coordinates, or timestamps finer than the day.
- **Preview what would be sent** shows the exact JSON before or after opting in; **Send a report now**; **New anonymous ID** replaces the random install id (the only thing that persists between reports).
- `telemetry.assert_shareable` walks every value before a send and refuses the whole report if anything identifier-shaped is in it — the belt over the design's braces. `tests/test_telemetry.py` builds a report from a house full of names, MACs, UUIDs, keys and coordinates and proves none of them are in it, and that the gate refuses each shape.
- Events are an allow-listed vocabulary (`telemetry.EVENTS` + `tab:<view>[/<sub>]`); anything else is dropped. Nothing is counted and nothing leaves the box while the switch is off — including the panel's tab events.
- Reviewed adversarially before shipping (three lenses, every finding verified against the code); the twelve real ones are in: the event vocabulary is a closed list mirroring the panel's tabs (asserted by test), opting in is an administrator action, the usage and error windows start at opt-in, at most one report per UTC day is persisted across restarts, counters are consumed only after the server accepted the report, uptime is a coarse bucket, MAC/IPv6/entity-id shapes in any notation are refused, and the README lists every field.
- `server/telemetry.php` (the receiver: append-only JSONL per day, no IP stored, same shape checks re-applied) and `server/telemetry_summary.py` (installs by version, environment distributions, features on, usage, health, and WARNING/ERROR by module across the fleet — the fix list). Data lives on the developer's server, never in the repository.

---

## 0.34.8 — IRKs: refuse what cannot work; a bridge is not an identity (2026-08-18)

Found by asking "has an IRK ever resolved here?" and checking. The resolver's AES matches the Bluetooth SIG sample data and is wired into ingest — it had simply never been given a real key.

### Fixed — Private BLE
- **`irk_add` refuses a value that is really a beacon UUID**, and names the beacon: the Companion App shows the iBeacon UUID on the very screen people look for the IRK, and a UUID pasted as a key resolves nothing, forever, with "0 resolved" the only symptom. Checked against every iBeacon on the air and every `*_ble_transmitter` sensor's `id`. No override — waiting will not make a UUID resolve an address.
- **A key is saved only if it resolves a rotating address on the air right now**, or if the person explicitly saves it unverified (the phone is away). The old flow validated, said "Saving anyway…", and saved. Both add forms and "Test only" now say why a key will never match when that can be said.
- **A fingerprint bridge is an inference, not an identity.** A bridged object no longer takes `identified` from a device link found under one of its addresses, and a cached bridge that is not current expires like any unidentified object — at once if its address is on the air under a real identity (an iBeacon group owns it). On the live install a CP27 beacon that had once been wrongly bridged had been resurrected from object history for 20 hours as "Private BLE: 1 device tracked".
- `tests/test_irk_add_refuses_what_cannot_work.py` — including the resolver against the SIG sample vector, which nothing had pinned before.

---

## 0.34.7 — The Bluetooth view, restyled (2026-08-17)

Same screens, same controls, same data — one visual language instead of several. Nothing about how the view works changed.

### Changed — Bluetooth
- **One vocabulary, defined once.** The view had four ways to draw "signal", three greys doing one job, two badge systems and around ninety inline colour strings, so the same idea looked different depending on which sub-tab you were on. `styles.css` gains a single `#bluetooth`-scoped block — stat, segmented tabs, chip (seven tones), a four-bar signal meter, row, panel, key/value grid, empty state, notice, note, micro-button tones — and `views/bluetooth.js` speaks it: `sigEl` / `chip` / `emptyState` / `btAgo` are defined once at the top of the file and used by every sub-tab.
- **Signal reads the same everywhere.** A four-bar meter and a tabular dBm reading, in the advertisement rows, the per-scanner device table and the detail pane alike — it used to be a coloured pill in one place and a percentage bar in another.
- **Rows say what they are.** Each advertisement leads with the scanner that heard it and the device's name, with the address and enrichment beneath; each scanner row carries its identity, how much it is trusted (a filled track, not just a number) and its own controls in a quiet cluster below a divider.
- **Empty states explain themselves** rather than stating the obvious, and the numbers are tabular so columns of dBm line up.
- Selection is a class with an accent rail, not a style string appended at runtime; the graph's embedded `<style>` no longer duplicates colours the stylesheet owns; the runtime colour writes go through the tokens.

### Fixed
- **200 advertisement rows collapsed to 18px each** when the list was given a scroll height: a flex column shrinks its children to fit by default. Items in a scrolling flex column are now `flex:0 0 auto`. Found by looking at the live install, not by the suite.

---

## 0.34.6 — The Lights tab at free tier (2026-08-17)

### Changed
- **Mapping → Lights is always there** (outside Basic mode). Below the `bright` tier it shows the free lighting map — rooms, floors, one marker per light, a hex switches the light — with the build tools (Transform, drag, the inspector, the unsaved-work bar) withheld and one line saying what a key adds. It used to hide without a key, which would have left PadSpan Bright's free program with no lights map anywhere until the sidebar panel was found and enabled. Verified on the live install by flipping the tier override to free and back: the free view drew, and every placement, shape and mode came straight back.

---

## 0.34.5 — PadSpan Bright: the tier model, the free lighting gate, the generated edition, the importer (2026-08-17)

Four programs from two dials — the EDITION (which build was downloaded: full or bright) and the TIER (what the key says: free < bright < pro). PadSpan HA and PadSpan Pro are unchanged for everyone running them today. Plan: `docs/padspan-bright-plan.md`.

### Added — licence and editions
- **`licence.py` — one owner of "what may this install do".** `effective tier = max(shipped floor, key tier)`; the floor is a build constant, never fetched, so a lighting map never waits on the licence server. **A key with no tier field resolves to `pro`** — every key issued so far is a Pro key, and the demotion guard test pins that. `license_tier_override` (Settings → Edition & tier, dev-only) can only lower the tier, so the free experience can be looked at without a free install.
- **`views/editions.js` — every navigable surface classified once** (`lighting` / `presence`); a Bright build renders the lighting surfaces (Mapping, Health, Settings) and a reveal switch shows the rest. `tests/test_editions_map.py` asserts the map is total against `panel.js`, so a new tab that is not classified fails the suite instead of leaking into the lighting product.
- **Light placement gates at `bright`**, not `pro`: a PadSpan Bright Pro key or a PadSpan Pro key, one ladder, one comparison. Forensics stays `pro`.

### Added — the free lighting gate
- Below `bright` the shared lights pipeline draws rooms, floors and one default marker per light at its room centre; placements, fixture shapes, sizes/rotations, the W-series/WLED distinction, Showcase, Fit room and Hide untouched are withheld **from the drawing only**. A read-time override in `views/lights_map.js`, applied for both hosts (the Lights sidebar and Mapping → Lights). `tests/test_lights_free_gate.py` renders the real card under node at free/bright/pro/garbage tiers and asserts the stored model comes out byte-identical — a lapsed key never touches a placement.

### Added — the generated edition
- **`scripts/bright_build.py`** derives PadSpan Bright from the tree being released: copy, four string renames (`padspan-lights`, `padspan_ha`, `padspan-ha`, `PadSpan HA`), two directory renames, `EDITION = "bright"` stamped, manifest/hacs.json/README named, then `verify()` greps the output for every old name and `build()` proves `git status` did not move. The renamed suite runs inside the generated tree (750/750 first time). A Bright build forwards no entity platforms and wears a lamp in the sidebar. `release.py` runs the pass after the full release is out; `BRIGHT_PUBLISH = False` until the listing goes live; `--no-bright` skips it. `tests/test_bright_build.py`.

### Added — the importer
- **Health → "Import from PadSpan Bright"**, shown only when `.storage/padspan_bright.*` exist and the house has not been imported. Back up first (the ordinary Backup/Restore snapshot; no snapshot, no import), **refuse a non-empty target** and say exactly what is there, never merge; then file-to-file through HA's Store for fabric, model, maps and settings, the map images, a receipt stamped into settings, and a config-entry reload so every store re-reads its file through its own setup path. Bright's own data is left in place. `bright_import.py`, `ws_bright_import.py`, `tests/test_bright_import.py`.

---

## 0.34.4 — Outside, by the site's coverage envelope; auto-calibration writes fingerprints (2026-08-17)

### Added — positioning
- **Outside attribution.** A device on the property but not in the building is heard by every indoor scanner faintly, and the strongest of several faint readings is a perimeter room — a parked vehicle lived in a closet. What is always true of an outside device on a covered site is that no scanner hears it well, and the site now measures that about itself: the **coverage floor** is the low tail of the strongest reading over its indoor calibration fingerprints (modelled from scanner geometry until it has enough; inactive on a site with no outdoors). Below it: the indoor solve does not run; if an outdoor scanner hears the device, that scanner's area is the room; otherwise the nearest scanner's room stands and `outside: true` says what it is worth. 4 dB hysteresis; the two numbers that decided it are in diagnostics and the map tooltip; the capture header records the floor. Plan and options: `docs/outside-attribution-plan.md`.

### Fixed — calibration data
- **Auto-calibration wrote one scanner's reading, not a fingerprint.** One Kalman value per scanner every ten minutes — including scanners only decaying toward silence — so every auto point failed the sample gate and was kept as its single strongest reading, flagged undersampled: 406 on the reference house, fifty of them "−95 dBm from one scanner = Bedroom Closet". k-NN matched them on any faint reading. Raw samples now accumulate per scanner and a point is written when at least two scanners each have enough (the rule the live k-NN query applies to itself). A migration drops the one-scanner auto points — made by us, no location information; points a person recorded are untouched.
- One outdoor-floor vocabulary (`const.OUTDOOR_FLOOR_NAMES`), read by the storey ranking and the outside rule alike.

---

## 0.34.3 — Identity, walls and lights in the fabric; websocket.py split (2026-08-17)

### Fixed — identity (the "closet beacon" flips)
- **Four CP27 beacons were one object.** MAC Rotation Bridging linked a "new RPA" to a cached identified one on a matching advertisement fingerprint without checking that the old address had *stopped*; `48:87:2D:…` is a public OUI the RPA heuristic false-positives on, all four share one fingerprint, so live beacons were chained together — and once bridged they were excluded from iBeacon grouping, so the pack/rotator split never got its turn. The merged object's vector alternated between two closets; what looked like a room-vote flip was two beacons taking turns. A bridge now requires the address bridged *from* to be silent (>5 s or gone), and an advertiser that names its own identity (iBeacon) is never fingerprint-bridged.
- **Same-label dedup merged on a name.** A live beacon that inherited "MaschineBOX" through its MAC was folded into a stale cached ghost wearing the same label (the ghost's frozen RSSI won), so the live object vanished from the list every poll. Two objects merge only when they share an address, and the freshest one is primary.
- **A pinned room decides the floor** exactly as a voted one does; **entity trackers** get a floor too. One rule, one site, after every way the room can be set.
- **Basement Warp drew nothing**: 127 calibration points had no floor. Save time now resolves a blank floor from the room's fabric floor; a one-off migration gives stored floorless points their room's floor, else the floor of the plan they were placed on.

### Fixed — structure (fabric only)
- **Lights** have one write path — metres — and the Pro gate and appearance validation live on it. The per-photo `lights` list (and the gate that guarded only it) is gone; the shape vocabulary is the renderer's, in one place (`const.LIGHT_SHAPE_KINDS`).
- **Walls have an identity**: every barrier carries an id (migration gives stored ones theirs, cuts their `map_id`); set/remove by id; the per-photo `rf_barriers` list is no longer accepted or created. The Edit tab still *draws* a wall on the photo — it goes through the map's metre transform into the fabric the moment it is finished, and the walls shown there are the fabric's projected back. The 2D radio map and distortion grid take walls from the fabric in the world frame. Per-map `radioMapSVG`/`distortionMapSVG` are gone.
- **Library thumbnails** show the fabric's rooms and scanners projected onto the picture.
- **RPA resolution cache bounded** (4096); the room-scoring `_sigma` knob removed end to end (never ran).

### Changed — code structure
- **`websocket.py` split by subject**: 11,942 lines → registration + twenty modules (`ws_*.py`, `snapshot_builder.py`, `ws_common.py`). Every name is re-exported from `websocket.py`; the panel sees one API. Layout in the module docstring.

---

## 0.34.2 — The map is drawn from the fabric, storey by storey (2026-08-17)

### Fixed — Overview / Pure Live
- **Heat and Warp overlays drew nothing.** They sized their grid from the corners of the *photographs* at a level, through a per-photo pixel transform that indoor plans no longer carry — so the extent was empty and both returned `""` with a clean console. They now take a *storey* the overview resolves from the fabric (rooms, scanners with vertical offset, barriers, calibration points — all in metres) and size the grid from the storey's rooms. Storeys share one colour scale computed from the model, so a badly covered floor cannot look green by being scaled to itself. The render harness now asserts both overlays draw.
- **The storey loop iterated photographs.** A floor with rooms but no picture drew nothing, and neither did anything on it. The loop is now the fabric's storeys. Walls are drawn once per storey (per photo drew every wall twice on a floor traced from two pictures); scanners come from `scanner_positions_m` (a radio placed in metres but never pinned on a picture had no marker); a scanner's "Area" is the room polygon that contains it.
- **Pure Live labels were giant again — at every zoom, and after every poll.** Its zoom counter-scale *overwrote* each marker's transform with `scale(1/zoom)`, discarding the annotation scale the overview had baked in. The overview now publishes the scale on the svg root (`data-ann-k`) with an anchor on every annotation (`data-ann`), and Pure Live composes `k / zoom` with it. The scale is one number substituted when the svg is composed, so it no longer depends on what was drawn before what; it measures the container's content box, not its padded width; a width change rebuilds the svg in place wherever it is hosted.
- **Dotted circles floating around the map.** Confidence rings and the outside-the-building ring were drawn *outside* the scaled marker group — and in one branch with no marker at all. Inside the group now, along with the floor badges and the legend row.
- **A floor beside the ground floor was placed a storey up.** `floor_base_elevations_m` read the running sum after it had already advanced, so "Outside" came out level with the bedrooms (5.6 m on the live install). Same-storey floors share the storey's base.

### Fixed — positioning
- **An object is on the floor of its room.** The room is the vote's answer; the solvers' per-poll floor was a second, undefended one — as evidence thinned, spatial (sticky) and k-NN (raw) took turns supplying it, and the *floor* flipped upper↔main every few polls on a beacon whose *room* never left the closet. Measured: 26 floor-change events in a 55-frame capture, all but three on objects whose room did not change. The solver's floor stands only for an object whose room the fabric cannot place — and a *pinned* room decides the floor exactly as a voted one does (pins are applied last, and used to leave the solver's floor in place). Verified on the live snapshot after deploy: every tracked BLE/iBeacon object's floor equals its room's floor.
- **k-NN needs two live scanners.** One reading against several hundred fingerprints matches whichever stored point has that scanner at about that level — on a real house routinely an *outdoor* point. Seventeen of twenty-two floor flips in a ten-minute capture were this.
- **A thin poll holds the last position** for the same window the RSSI stage holds a silent source, instead of handing the object to whatever k-NN said from one faint reading.
- Learned floor attenuation was tried in floor selection against the same capture, made it worse (7 → 24 events), and is not shipped.

### Removed
- **Client-side positioning in the overview** — a fingerprint match and an RSSI-weighted centroid of scanner *screen* positions that filled in behind the server. Two more opinions on where a beacon is, in a spot no other view agreed with. The server places things; the map draws (server position, else room centroid, else nothing).
- **`room_sigma_m` and the "Gaussian room scoring" it configured** — described in the pipeline docstring, the settings card, the QA formula panel and the capture header; never what ran. Removed end to end.
- Per-photo iso heatmap, its legacy calibration variant, the module-level global colour range, and the overview's copy of hidden-map sync.

### Fixed — resource
- The RPA resolution cache is bounded (4096); expired entries are evicted once it is full. Every address heard was cached and never evicted — ~1,800 a poll on a real house.

### Docs
- `03_MAPPING_SUITE.md`: storeys and overlays from the fabric; the annotation contract. `09_HARD_WON_RULES.md`: two views drawing one thing share a contract, not a guess; when something "no longer works", check what it is still reading.

---

## 0.34.1 — Positioning stops acting on evidence it does not have (2026-08-17)

Measured on a live three-storey house before and after, same method: **floor flips per minute 9.7 → 4.9**, and the "gap" polls where the heard scanner count collapsed to 4 are gone (minimum now 10). Groups of beacons sliding off position together for three or four polls — the thing that made the whole map look flakey — was one root cause seen from three angles.

### Fixed — positioning
- **Anchors dropped after one missed poll.** The spatial solve discarded a scanner the first poll it went quiet, while the Kalman stage a few lines above was deliberately holding that scanner's last real value through the silence grace window. Two stages in one function contradicting each other. BLE advertisements miss polls constantly, and every device loses the *same* scanner on the *same* poll — so they all re-solved from the same reduced anchor set and moved as a group, in whichever part of the house that scanner anchors. A source now leaves the solve when it starts *decaying*, not when it merely misses.
- **Position had no plausibility gate.** RSSI has a Kalman covariance and a silence grace; rooms have to win a vote window; the α-β position filter accepted half of any residual unconditionally, and fed it into velocity, so one bad measurement gave the dot momentum in the wrong direction on the next poll. A step implying more than 5 m/s is now treated as a bad measurement — the filter coasts on its prediction, and believes the new position only after three consecutive polls agree (a beacon switched off and carried really does teleport).
- **Floor selection had no sense of how much it had heard.** It was recomputed from scratch each poll and compared on equal terms whether fifteen scanners had reported or two. A floor change now needs the device to have heard a fair share of what it *usually* hears, and to beat the incumbent by a real margin. An earlier version of this used an absolute quorum of three, which was unreachable — floor selection only runs once three scanners have reported. Fixed to be relative to each device's own norm.
- **Cross-floor scanners solved position.** A scanner one storey away hears a device through the slab; its reading says something about which floor and almost nothing about where on it. Two garage scanners at −74 dBm were dragging a device its own closet scanner heard at −63 down a storey and outside every room — while the room vote, which never used them that way, stayed correct. On-floor scanners now solve position whenever there are enough to solve at all; cross-floor readings are the fallback for a thinly covered floor.
- **The metre anchor's Python half.** `fabric_truth.find_metre_anchor` computed both axis scales and returned only x (issue #62's other side — the side that *writes* committed geometry and `map_transforms`). Both axes now.
- **"Excluded scanner" had four implementations**, and the two used by the live snapshot and by advertisement ingestion omitted `excluded_scanners` entirely — a receiver the user had masked because it physically moved went on placing objects. One rule in `presence_rules`, with a guard against a fifth copy.
- **A calibration point on an unmeasured map was saved with no position.** It counted toward every total and was ignored by every learner. Refused at save time now, with a message that says what to do.

### Fixed — Overview
- **The frame never saw the drawing.** `_isoBB`, which the svg frame is fitted to, was grown *below* the fabric early-return in `iso()` — so on every install with a fabric it stayed empty and the frame silently fell back to a fixed 880-unit heuristic around a ~500-unit building. That was the blank sides, and it is why five attempts to fit the drawing more tightly *inside* `fabricFrame` changed nothing visible.
- `max-height:${vh}px` capped the rendered width to about `vw` px regardless of the panel. Removed; the map fills its width and scrolls.
- Labels and markers are counter-scaled per group by designed-vs-actual pixels per unit, so a wider frame does not mean bigger words.

### Fixed — panel
- `_getModel` spread the whole `model_get` response instead of whitelisting keys. The whitelist had dropped a key three separate times (origin forwarding, the migration marker, `light_positions_m`/`floor_elevations`). Guarded so it cannot come back.

### Removed
- `_primaryMapIdForFloor` in `views/maps.js` — one reference, its own definition.

---

## 0.34.0 — RSSI Vector Capture, and a floor model that reaches positioning (2026-08-16)

### Fixed — multi-floor positioning

- **The floor list never reached the positioning code.** `ModelStore.data["floors"]` is the sole input to `floor_stack_index()` and `floor_base_elevations_m()`, and nothing ever wrote it. The panel looked right because it reads the HA floor registry live *for display* — but positioning found the single synthetic `main` entry the store is created with and ran **every multi-floor install as one storey**. Cross-floor RF paths all fell back to a flat one-slab penalty, so a basement scanner and an upstairs scanner were penalised identically and floor selection had nothing left to discriminate with. Measured on a three-storey house: 2,886,899 confirmed cross-floor room changes, split 1,093,120 / 1,062,985 between the two directions — a near-perfect symmetry, which is oscillation and not movement. Floors are now synced from the registry each poll, and any learned cross-floor attenuation gathered before this is suspect.
- **Two floors on the same storey were a slab apart.** `floor_stack_index()` returned enumerate() positions, so "Outside" and "Main" — both at ground level — came out one apart, and every outdoor scanner was charged 10 dB of concrete it never saw through. Indices are assigned per distinct storey now, and floors sharing a storey also share a base elevation instead of inventing 2.8 m of building between them.
- **Floors with no `level` set stacked in creation order.** HA's registry leaves `level` null on most installs, so an alphabetical registry stacked a house wrongly. Ordering now falls back to what a floor id means (`basement`, `ground`, `upper`, `attic`, and outdoors at ground) before it falls back to stored order.

### Fixed — four views that parsed and then threw

Each rendered blank with a clean console, because `panel.js` loads views with `.catch(console.warn)`:

- **2D Map Mode was dead entirely** — `liveSnap` and `helpBtn` were locals of `overview.js` that did not survive the extraction into `plan_viewer.js`.
- **Clicking an occupied room did nothing** — `_showRoomDetail` called `fmtAgo`, a local of `_showObjectDetail`. It is a shared helper now.
- **Floor heatmap legends threw** — `floorHeatmapSVG` read `_wpRssis`, a local of a different function.

`tests/test_frontend_renders.py` now imports every view under a DOM shim and calls its entry points, flushing deferred work. Verified as a real guard: with the `liveSnap` bug reintroduced, `node --check` passes and this fails by name.

### Fixed — the reason none of the above was visible

- **Frontend changes were invisible until a release.** `BUILD_ID` was a hard-coded literal in `build_info.py` and again in `panel.js`, so every asset URL kept the same `?b=` stamp between releases and browsers served cached JavaScript no matter what was on disk or how many times Home Assistant restarted. A new `ASSET_ID` appends a digest of the frontend tree, and `panel.js` reads the stamp off its own module URL so every view inherits it.

### Fixed — mapping

- **Delete room did nothing visible.** It cleared `room_meta`, adjacency and the scanner map — all ModelStore fields — and left `room_geometry_m` alone, which is where the shape lives. The room kept drawing and kept being a room the pipeline could choose. Removal is now one store call covering all four.
- **Floor slabs were the bounding rectangle of a floor's rooms**, 1.7–2.5× the real floor area on a house with a stairwell void or one outlying room. Each slab is the union of its room footprints now.
- **The 3D stack was sheared.** Every floor was drawn centred on its own bounding box, so storeys that overlap correctly in the fabric were pushed apart on screen — walls met at different angles per floor and set-back floors read as boxes in the wrong place. One building, one origin. Scale and centring also come from the projected shape now rather than the bounding diamond, which a building never fills.

### Added
- **RSSI Vector Capture** (Settings → Features, off by default) — record what every scanner heard for every tracked device, poll by poll, alongside the room PadSpan chose, then export the trace and replay the same walk offline against changed settings. Until now a positioning change could only be argued from memory: a room felt stickier, a floor flipped less. A capture makes the input reproducible, so a change can be scored instead of recalled.
  - Session-scoped. Nothing is written until you press Record in Health → Quick actions; a session stops itself at 60 minutes or 25 MB and says which cap it hit.
  - **Mark room** stamps ground truth while you walk, which is what turns a recording into something that can be scored rather than merely replayed.
  - Records **identified or followed devices only** — the same rule the traceback uses. Measured on a real house, that is about 12 devices out of ~1,800 BLE objects per poll; the rest are neighbours' phones heard by one or two scanners, useless to a positioning fixture and not ours to record.
  - Exports as `.jsonl` straight from the browser. `tests/test_capture_replay.py` loads an export as a pytest fixture and scores it two ways: against the answers the pipeline gave when recording (a refactor that moves one answer fails), and against your own room labels (a tuning change becomes a number).
  - Captures are not included in backups, and a factory reset deletes their files as well as their index.

### Fixed
- **Per-device state no longer accumulates for the life of the process** — `_spatial_debug` was written for every object key from four places and cleared from none, so every rotating Bluetooth address that ever passed the house left an entry behind. Invisible on a home install; unbounded on a large one. The guard that should have caught it listed the state dicts by hand, and now discovers them instead, so the next one is caught the first time it is populated.

---

## 0.22.7 — Lights placement (Pro) + private-BLE and map-migrate fixes (2026-08-10)

### Added
- **Lights map placement** (PadSpan Pro) — place your lights on the floor plan from the Mapping view's Lights tab, rendered as a room-polygon view. Saving light placements requires an active Pro license; everything else in Mapping is unaffected.

### Fixed
- **IRK table Delete button targets the right entry** — devices with identical names were merged by an internal name-keyed join, so deleting one row could remove a *different* device's config entry. Rows now carry their own entry identity, and renamed devices show their new name immediately instead of after a restart.
- **Adding an IRK no longer leaves phantom config flows** — each failed format attempt now cleans up after itself (they used to accumulate as in-progress flows until restart), and re-adding the same IRK in a different format/byte order is correctly detected as a duplicate instead of creating a second entry.
- **Delete & Migrate now actually moves calibration points** — a wrong field name meant migrated points kept their old on-map positions while being re-owned to the target map. Positions now transform correctly.
- **3D alignment editor: different-aspect maps open undistorted** — the editor sizes its stage to the reference map, which pre-stretched any target with a different aspect ratio and forced users to hand-hunt the X-stretch correction (destroying precise 4-point alignments along the way, part of the issue #56 chain). A never-aligned target is now auto-corrected on selection.

---

## 0.22.6 — Re-anchor hardening (2026-08-09)

### Fixed
- **Re-anchor no longer adopts stray calibration points** — remapping after a re-anchor could claim orphaned points (from deleted maps or other floors) that happened to land inside the map under the chosen pose; a wrong pose would then make the corrective re-anchor impossible. Re-anchor now only ever moves points the map already owns.
- Re-anchor preflight tolerates malformed calibration points, and the origin readout in the Measure panel updates immediately after a successful re-anchor.

---

## 0.22.5 — Map origins are now anchored (2026-08-09)

### Fixed
- **Display edits can no longer redefine world coordinates** — a map's real-world origin and rotation used to be re-derived from presentation state (stack offsets, master flag) whenever a map was re-measured, migrated, or had its image replaced. Moving a map in the 3D alignment editor and then re-measuring could silently shift every calibration pin's world position (the root cause behind issue #56). The world pose is now **write-once**: set when a map is first measured, preserved through re-measures and image replacements, and changed only by the new explicit re-anchor action.
- On upgrade, every existing map transform is frozen exactly as it is — a one-time migration marks the stored pose as anchored without changing a single number, verified against a production dataset (9 maps, 746 calibration points, zero movement).

### Added
- **Re-anchor origin** (Measure panel) — the one sanctioned way to redefine a map's world origin/rotation. Your calibration pins keep their real-world metre positions and their on-map positions re-derive through the new pose. The action refuses (changing nothing) if the requested pose would strand most pins off the map, and rolls back completely if anything fails partway.

---

## 0.22.3 — Calibration & Private BLE fixes (2026-08-04)

### Fixed
- **Calibration pins no longer collapse to the map corner** (issue #56) — re-deriving point positions after a map save used to clamp out-of-range results to (0,0); when the map transform disagreed with stored metre coordinates this silently piled a whole floor's calibration into the upper-left corner. Out-of-range points now keep their existing positions, and a remap that would displace most of a map's points is aborted entirely.
- **3D stack alignment saves no longer touch calibration** — the alignment editor only writes the cosmetic stack transform, which calibration does not depend on; the save was needlessly re-deriving (and potentially corrupting) pin positions.
- **Private BLE devices now show their real names** (issue #57 root cause) — the IRK table displayed the config-entry title, which Home Assistant leaves as the original MAC address forever. It now prefers the device-registry friendly name, so your renamed iPhone shows as "Garry's iPhone", not `AA:BB:…`.

---

## 0.22.0 — Forensics (PadSpan Pro) (2026-08-04)

### Added
- **PadSpan Pro licensing** — Forensics is the first Pro feature ($45 CAD/year). Enabling it asks for a licence key, validated server-side against the traks.ca licence service. The rest of PadSpan remains free and unchanged.
- **Forensics mode** (off by default, opt-in via Settings → Features) — answers "which Bluetooth devices were near my scanners between X and Y?" (issue #55). While enabled and in Live mode, a background sampler records presence *sessions* per address every 60 seconds (a 5-minute silence closes a session), with configurable retention (7–90 days, default 14) and hard caps.
- **Forensics tab** — appears only while the setting is on. Time-window search with two confidence tiers: *Recorded* (actual presence sessions overlapping the window, with dwell time, peak signal, and scanners) and *Possible* (object-history first/last-seen span overlaps the window — lower confidence). CSV export for handing results to investigators.
- **Privacy guardrails** — always-visible privacy notice, explicit confirm before enabling, double-confirm data deletion, stats display, and reliability disclaimers throughout (a BLE address is not a person; rotating MACs mean most phones won't appear consistently; results are leads, not proof). Recordings never leave the Home Assistant instance and are never included in live snapshots.

---

## 0.19.0 — Stable Release (2026-03-24)

Consolidates all v0.18.x fixes into a clean stable release.

### Fixed
- **Version display corrected** — APP_VERSION in panel.js and lights_panel.js was hardcoded at 0.17.1 and never updated. Now all 5 version sources (const.py, build_info.py, manifest.json, panel.js, lights_panel.js) are aligned.
- **UI freeze from wizard crash** — wizard auto-complete and Skip button called `this.actions.settingsSave` before actions was initialized, crashing `_renderCurrentView` and freezing the entire UI. All `this.actions` references now use optional chaining.
- **Wizard only shows on Overview** — no longer blocks navigation to other tabs.
- **Wizard recognizes Beacon Tune calibration** — checks fabric scanner positions, not just Pin & Listen points.
- **k-NN logging flood** — 652 per-cycle warnings downgraded to DEBUG. Was choking the HA event loop and degrading WebSocket responsiveness.
- **Indoor devices misplaced outdoors** — outdoor room score damping now applies to all devices unless already confirmed outdoor.
- **Hidden floors hide objects in 3D overview** — objects on disabled floors no longer render.
- **Private BLE friendly names** on map, follow, and devices views.
- **Map scale save crash** fixed.
- **Occupancy training save crash** fixed.
- **HACS ZIP structure** — verified flat layout matching v0.17.1.

### Documentation
- README rewritten for v0.17+ features
- Getting Started and Floor Plan Setup guides updated
- New screenshots: Calibration Tune, Traceback Playback, Bluetooth Visualization

---

## 0.18.2 — Stable Release (2026-03-24)

Consolidates all v0.17.2–v0.18.1 fixes into a clean stable release. Version string now consistent across all three sources (const.py, manifest.json, build_info.py).

### Includes
- Onboarding wizard: reordered steps, sub-tab routing, Basic mode fix
- Private BLE friendly names on map/follow/devices
- Map scale save, occupancy training save, blocking scandir fixes
- Documentation overhaul (README, Getting Started, Floor Plan Setup)
- New screenshots: Calibration Tune, Traceback Playback, Bluetooth Visualization
- Clean HACS ZIP (flat structure, no __pycache__)

---

## 0.18.1 — Onboarding Wizard Fix (2026-03-24)

### Fixed
- **Wizard step order** — reordered to logical sequence: Upload → Set Scale → Draw Rooms → Place Scanners → Calibrate. All map setup steps now run consecutively before calibration, eliminating unnecessary context-switching between views.
- **Sub-tab routing** — clicking a wizard step now navigates directly to the correct sub-tab (e.g., "Upload Floor Plan" goes to Maps → Upload tab, "Calibrate" goes to Calibration → Pin & Listen tab). Previously all steps landed on the default tab.
- **Basic mode calibration crash** — clicking "Place Scanners" or "Calibrate" in Basic mode now auto-promotes to Advanced mode so the Calibration view is visible. Previously these steps navigated to an invisible view.

---

## 0.18.0 — Stable Release (2026-03-24)

### Documentation
- **README rewritten** for v0.17+ features: Device Registry, positioning fabric, occupancy estimation, onboarding wizard, 2D map mode, measure tool, multi-floor intelligence, experimental features, movement playback, comparison table updated (22 views)
- **Getting Started guide updated** — onboarding wizard steps, Apple device tracking (Private BLE/IRK), occupancy estimation, movement history, troubleshooting for v0.17 fixes
- **Floor Plan Setup guide updated** — measure tool instructions, master map concept, 2D flat map mode, multi-floor alignment workflow
- **Documentation index** added to README linking all guides

### Fixed (from v0.17.2–v0.17.3)
- Private BLE devices show friendly name instead of MAC on map, follow, and devices views
- Map scale save crash (`scale_x_m` undefined)
- Occupancy training save crash (`async_save` → `store.async_save`)
- Blocking `scandir` in factory reset event loop
- Onboarding step click crash (`renderRooms` undefined)

---

## 0.17.3 — Bug Fix (2026-03-24)

### Fixed
- **Private BLE devices show friendly name instead of MAC** — map, follow, and devices views now use the resolved `private_ble_name` (e.g., "Adam's iPhone") when no user label is set, instead of displaying the raw rotating MAC address. Affects overview (2D, 3D, room chips, ISO stack), follow view, and devices list.

---

## 0.17.2 — Bug Fix (2026-03-24)

### Fixed
- **Map scale save crash** — "Save Scale" button referenced `scale_x_m` / `scale_y_m` before they were defined, causing `ReferenceError` and preventing scale saves (maps.js:1944)
- **Occupancy training save crash** — `ws_occupancy_train` called `_st.async_save()` which doesn't exist on `SettingsStore`; corrected to `_st.store.async_save(_st.data)` (websocket.py:8374)
- **Blocking `scandir` in event loop** — factory reset's map-file cleanup used synchronous `iterdir()` / `is_dir()` inside an async handler, triggering HA's blocking-call detector; wrapped in `asyncio.to_thread` (websocket.py:7508)
- **Onboarding step click crash** — `this.actions.renderRooms()` could fail with `TypeError` if `actions` was undefined during panel init; added optional chaining with fallback (panel.js:2414)

---

## 0.17.0 — Stable Release (2026-03-23)

Major release with 78 commits since last stable (v0.15.25). Introduces the Device Registry identity system, positioning fabric decoupling, multi-floor accuracy learning, occupancy estimation, and an onboarding wizard.

### Device Registry (NEW)
- **Stable device identity** — every physical device gets an immutable `padspan_id` (format: `ps_<12 hex chars>`) that survives MAC rotation, iBeacon UUID changes, and firmware updates
- **Identity resolution** — O(1) lookup from any volatile key (MAC, iBeacon, canonical_id) to stable padspan_id
- **Automatic migration** — existing labeled objects in ObjectStore are auto-migrated to DeviceRegistry on first startup
- **Label pipeline** — DeviceRegistry is now the primary label source; ObjectStore is a thin fallback
- **HA entity identity** — sensor and device_tracker entities use padspan_id for stable HA device identity
- **Frontend management** — Devices view has interactive registry: merge duplicates, add identities, relabel, delete, view identity chains
- **7 WS commands** — list, migrate, merge, resolve, label_set, add_identity, delete
- **Health checks** — Device Registry status, Label Pipeline health, dependent store migration progress

### Positioning Fabric (decoupling from maps)
- **Fabric is the authority** — all spatial data (scanner positions, room geometry, RF barriers, beacon positions) stored in real-world metres in the positioning fabric
- **Maps are setup tools only** — floor plan images no longer own positioning data, overview map toggle defaults to off
- **Metre-space coordinates** — all stores use real-world metres with floor_id references
- **Map transforms** — affine transforms convert between map fracs and metres
- **Measure tool** — two-point reference distance calibration with aspect ratio validation

### Multi-Floor Accuracy
- **Floor-transition learning** — adaptive store records floor-to-floor transitions with Welford stats on dwell time
- **Dwell-based velocity gate** — short dwell (<30s) requires unanimous vote; medium dwell (30-120s) needs supermajority for cross-floor; long dwell (>120s) uses normal threshold
- **Learned cross-floor attenuation** — Gaussian scorer applies learned RSSI corrections to cross-floor scanners when adaptive floor detection is enabled
- **Outdoor penalties** — outdoor scanners get 0.30x Gaussian damping; indoor-outdoor transitions require 4x floor stickiness

### Occupancy Estimation
- **Dedicated Occupancy dashboard** — new sidebar view with building summary, per-room breakdown, training controls, and training history
- **Hybrid counting** — identified devices count 1:1, unidentified BLE with dwell >5min count with configurable multiplier (default 1.5x)
- **Training** — enter actual headcount to adjust the multiplier via EMA learning

### Onboarding Wizard
- **Guided first-run setup** — persistent progress bar detects 5 steps: upload floor plan, set scale, place scanners, draw rooms, calibrate
- **Auto-detection** — each step auto-completes when its data is detected
- **Click-to-navigate** — each step links directly to the right view
- **Skip option** — dismisses permanently via settings

### Calibration & Beacon Tune Fixes
- **Room polygons no longer block dragging** — `pointer-events: none` on room polygons in both Tune and Beacon Tune
- **Save-pulse animation** — save button pulses green when there are unsaved changes (dynamically updated after drags)
- **Beacon sync to maps** — fabric beacons are now synced back to maps store for consistent rendering
- **Unique beacon IDs** — prevents drag handler from matching wrong beacon when multiple have empty IDs
- **SVG not rebuilt mid-drag** — `_refreshSVG()` checks `_dragging` flag
- **Watchdog fix** — no longer force-renders on non-live views (was disrupting calibration mid-drag)
- **Out-of-bounds beacons filtered** — beacons outside map coordinate range are skipped instead of clamped to edges

### Distance Traveled
- **Fixed data reading** — was reading `frame.objects` instead of `frame.o` (compact format), producing zero distance for everything
- **Jitter filtering** — steps <0.5m ignored, same-room capped at 3m, time-gap scaling for downsampled views
- **Reliability score** — shows what % of position steps passed the jitter filter
- **Investigate button** — popup showing total steps, good steps, jitter filtered, max step
- **Stationary references** — mark known-fixed devices as references; their phantom distance becomes a BLE accuracy diagnostic
- **BLE Accuracy rating** — Excellent/Good/Fair/Poor based on total phantom distance from reference devices

### Other
- **Donate button** added to README (PayPal)
- **Traceback** — padspan_id recorded on each frame object for stable history
- **Movement history** — padspan_id on room transition records
- **Follow alerts** — padspan_id auto-backfilled on startup
- **`padspan_id` in HA entity attributes** — visible in developer tools on area sensors and device trackers

---

## 0.5.91 — Hardware Guide & Cleanup (2026-03-01)

### Added
- **Scanner Hardware walkthrough** — New Training Hub walkthrough with animated SVGs covering antenna comparison, board recommendations, and why room-level tracking demands better hardware than home/away
- **Scanner Hardware manual section** — Detailed reference in Training Hub manual with tested board recommendations (ESP32-S3 + Ethernet, ESP32-S3 + WiFi, ESP32-C3 — all with external antennas)
- Hardware guidance added to Getting Started guide and README
- `.gitignore` updated to exclude dev artifacts

### Fixed
- `esc is not defined` error in Settings → Scanner Map (`_scannerMap()` function was missing `ctx.helpers.esc`)
- SVG XSS hardening in demo floor plan builder (room/radio/object names now escaped)

### Removed
- 21 legacy doc files (old v0.3.x install notes, placeholders, duplicates)

---

## 0.5.88 — Beta Launch Prep (2026-02-28)

### Added
- **BLE data enrichment** — Objects now show decoded company names (Apple, Samsung, Google, Xiaomi, etc.), device types (Find My, AirPods, Nearby Info), and GATT service names (Battery, Tile, Device Information) as color-coded badges. Search by company or device type in the Objects tab.
- **QA Radio Analysis card** — Per-radio health scoring with activity metrics, cross-scanner overlap comparison, and network info (IP, SSID, WiFi signal)
- **Development disclosure** — README, CONTRIBUTING, and repo topics transparently describe AI-assisted development process
- CI tests — 36 automated tests for maps store, object store, config flow
- GitHub issue templates (bug report + feature request)
- CONTRIBUTING.md with development setup guide
- `connectable` flag captured per BLE advertisement

### Fixed
- **Security** — Escaped all user-controlled strings in overview, maps, and settings SVG innerHTML (XSS prevention)
- **Security** — Admin-only gating on destructive WebSocket handlers (maps delete, area delete, entity delete, calibration clear, integration reload)
- **Security** — Map upload 20MB size limit + path traversal protection on file operations
- **Mobile** — Tooltip overflow on small screens, input minWidth overflow, toolbar wrapping
- **Performance** — Visibility handler and modal ESC listener now properly cleaned up on disconnect (prevents memory leak in long sessions)
- `esc is not defined` error in maps.js 3D Stack view
- Radio Analysis identity section words running together
- Network info only showing for one radio (backend now tries source slug)

### Changed
- Radio health scoring only flags provable issues — "Unhealthy" for hard failures, "Fair" for ambiguous, "Healthy" otherwise
- `binary_sensor.py` proper `async_setup_entry` stub (was causing silent platform failure)
- Config flow exception handling narrowed from `Exception` to `(ValueError, TypeError)`

---

## 0.5.79 — Training Hub & Documentation (2026-02-27)

### Added
- **Training Hub** — Guided walkthroughs for Overview, Follow, Objects, Maps, Settings, and Calibration
- 9 new Manual sections covering all remaining views
- Calibration walkthrough with 4-step animated guide
- Marketing screenshots and launch documentation

---

## 0.5.77 — HACS & Hassfest Validation (2026-02-27)

### Added
- HACS validation CI workflow
- Hassfest validation CI workflow
- Brand icon for HACS store listing

### Fixed
- manifest.json key ordering and removed invalid `icon` key
- services.yaml removed invalid `response` key, added proper `target`
- Added `bluetooth` to `after_dependencies` in manifest

---

## 0.5.75 — Major Feature Release (2026-02-27)

### Presence & Tracking
- **Follow mode** — animated room map, movement timeline, multi-device simultaneous tracking
- **Email alerts** on room change (per-device, 60s rate limit, persistent config)
- **Kalman-filtered RSSI smoothing** replacing simple EMA for smoother room transitions
- **Private BLE address resolution** — iBeacon UUID parsing + IRK support for rotating addresses
- **HA entities** — area sensors, distance sensors, device trackers, binary sensors per tracked device
- **Home/away persistence** — binary sensors survive HA restarts
- **Distance estimation** — log-distance path-loss model with configurable reference power and exponent

### Floor Plans & Maps
- **Floor plan editor** — upload PNG/JPG, draw room boundary polygons over blueprints
- **3D isometric multi-floor visualization** with live object positions and room labels
- **Scanner markers** — drag-and-place with 3-digit radio short IDs
- **Stale radio detection** — auto-detect and flag radios no longer in your BLE network
- **Scanner network info** — WiFi SSID, IP address, connection type

### Calibration
- **Full calibration system** — walk-around fingerprint collection with standalone phone panel
- **k-NN fingerprint matching** + **OLS path-loss model** fitting per scanner
- **Coverage heatmap** with guided next-target suggestions
- **Leave-one-out cross-validation** for model quality scoring
- **3D isometric tune view** with draggable receiver markers

### UI & Experience
- **21 dedicated views** across Basic and Advanced modes
- **Training Hub** with guided walkthroughs
- **Sample mode** — fully functional demo with synthetic data
- **11 languages** — EN, ES, FR, DE, IT, PT, NL, ZH, JA, KO, RU
- **Dark forest-green theme** designed for ambient displays
- **Object tagging** — label BLE devices with friendly names, OUI vendor lookup

### Backend
- **DataUpdateCoordinator** polling live BLE snapshot every 10s
- **WebSocket API** for all frontend communication
- **Persistent stores** for settings, maps, objects, calibration, and alert configs

---

## 0.4.x — Foundation (2026-02)

### Added
- Initial integration scaffold with config flow
- Basic BLE scanning via HA Bluetooth component
- Live snapshot with radios and advertisements
- Objects inventory with deduplication and OUI frequency badges
- Vendor lookup via MACVendors + MACLookup APIs (cached 30 days)
- Packaging for HACS (icons, install path, cache-busting)
