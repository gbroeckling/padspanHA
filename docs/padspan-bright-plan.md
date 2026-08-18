# PadSpan Bright — build plan

**Written** 2026-08-14 · **Against** gbroeckling/padspanHA at v0.32.31 · **Resume** Thursday 2026-08-20
**Report (same content, formatted):** https://claude.ai/code/artifact/05fbbdb9-2ef4-48c5-9cb2-1310e2f6e0a6
**Status: PLANNED. No code written. Nothing in this document has been implemented.**

---

## 1. What this is

Ship a lighting-only edition of PadSpan as its own HACS listing, without ever
working on more than one product.

Garry's four constraints, in his words:

1. A separate HACS storefront for the lighting side.
2. The simplicity of a skin change for now (not a runtime rebuild).
3. The paid version is PadSpan Bright Pro, at 30% less than PadSpan Pro.
4. "I don't ever want to think about any version other than padspan pro, and
   the rest just flows seamlessly."

Plus, from the follow-ups:

5. Four distinct programs, guided by flags in the code; only PadSpanHA needs no key.
6. The free level is driven by an auto-inserted key, so every flag reads from
   the licence system with no separate "unlicensed" code path.

All six are compatible. They are two dials, not six features.

---

## 2. The model — four programs, two dials

The two dials are **edition** (which build was downloaded) and **tier** (what
the key says). Everything else falls out of crossing them.

| Program            | Edition | Key         | Price      | What it is |
|--------------------|---------|-------------|------------|------------|
| PadSpan HA         | full    | *none*      | Free       | The only keyless program. Everything free in the full product; lighting at basic level. |
| PadSpan Pro        | full    | `pro`       | Full       | Everything, everywhere. Never missing a feature. |
| PadSpan Bright     | bright  | auto `free` | Free       | Lighting only, locked: rooms, floors, one default marker per light at its room centre. No placement, no shapes, no WLED. |
| PadSpan Bright Pro | bright  | `bright`    | Pro − 30%  | The whole lighting product: placement, sizing, rotation, shapes, WLED, Showcase, Fit to room. |

Two purchased SKUs (`pro`, `bright`). Four programs. No program is a special
case in the code.

**The composition rule:** the key sets *capability*, the edition sets
*visibility*. A `pro` key typed into a Bright install unlocks every lighting
feature — it simply has nothing else to show. This is deliberate: it means
nobody ever has to answer "which key do I need for which download".

**Tier ladder** (each contains the one below): `free` < `bright` < `pro`.
Because Pro is a strict superset, every gate is one comparison
(`tier_at_least(x)`), never a feature matrix.

---

## 3. The licence mechanism

### 3.1 What exists today (measured, not assumed)

- One key, stored in settings as `forensics_license_key` (legacy name — it
  began as a Forensics-only licence and grew into the general Pro gate).
- `forensics_license_expires`, revalidated daily against `https://traks.ca/license/`
  by `update_check.py:_revalidate_license()`.
- `websocket.py:_pro_expiry_state()` returns `{has_key, active, expires, days_left}`.
  `PRO_GRACE_DAYS = 14`. An unparseable or absent expiry is treated as NOT
  expiring — "a date we cannot read is not evidence that someone stopped paying".
- `websocket.py:_padspan_pro_active()` is the single shared gate.
  **Only 3 call sites in Python.** Frontend reads `pro_active` in **4 places**
  (`views/maps.js` x1, `views/settings.js` x3).
- Existing docstring rule, which must survive unchanged: *the gate governs
  Pro EDITING only. Data a user already created stays readable and exportable
  when a licence lapses.*

### 3.2 What changes

- Licence server returns `tier: "pro" | "bright"` alongside `expires`.
  Stored as `license_tier`.
- `_padspan_pro_active()` becomes a tier resolver; gates become
  `_tier_at_least(hass, "bright")` or `..., "pro")`.
- Frontend `pro_active` boolean becomes the tier string, read in the same 4 places.

### 3.3 The auto-inserted free key — SHIPPED, never FETCHED

The free tier must NOT be fetched from the licence server. A Bright install
that has to reach traks.ca before it draws anything is a lighting map that
goes blank when the internet does — HA boxes sit on isolated VLANs, behind
Pi-holes, and offline for days. It would also contradict the rule already
written into the gate (above).

`release.py` already stamps six files per release. The Bright pass stamps a
seventh value: a `free` key written into `DEFAULT_SETTINGS`, activated on
first setup like any other key.

**The one rule that settles every case:**

    tier = max(SHIPPED_FLOOR, validated_server_tier)

The licence server can only ever RAISE the tier. It can never take a program
below the floor it was built with.

| Case | Result |
|---|---|
| PadSpan HA (no floor key, none purchased) | tier absent → read as `free` |
| Bright, never purchased | shipped `free` floor. Works offline forever; the listing does something on install. |
| Server unreachable | keep last validated tier. A paying customer with a dead connection keeps what they paid for. |
| Expired past grace, or revoked | fall back to the floor. Degraded, never broken; every placement still on disk. |
| Settings file hand-edited | clamped to floor on read. No worse than today — the key already sits in settings. |

**Consequence to accept before the first Bright build:** the floor is shipped
per-edition, not granted per-install. Every copy built carries its own floor
and never asks permission. If you later want free Bright to become a
time-limited trial, you cannot — those builds are already out there.
**Decide what free includes before the first Bright build, not after.**

**Do not use the free key as an install counter.** Tying a licence lookup to
startup is how you get a product that needs the network to boot.
`update_check.py` already pings padspan.traks.ca daily and is opt-out. Count
there. Licensing for capability, telemetry for counting.

---

## 4. The generated edition

### 4.1 Why the rename is cheap (measured)

| Measurement | Count |
|---|---|
| Uses of the `DOMAIN` constant in Python | 362 |
| Hardcoded `padspan_ha` strings in Python | 176 (124 of them websocket command names) |
| `padspan_ha/` command strings in the frontend | 194 |
| `padspan_ha_static` in the frontend | 3 |
| Hyphenated `padspan-ha` in Python | 12 |
| **Of those strings, how many appear inside a URL or external endpoint** | **0** |

That last number is the one that matters. Nothing named `padspan_ha` is also
a web address — the update check is `padspan.traks.ca` and the licence check
is `product=padspan`. So the rename is two whole-word replacements over a
copied tree:

- `padspan_ha` → `padspan_bright` — catches the domain, all 16 storage keys,
  every websocket command on both sides, and `/padspan_ha_static`
- `padspan-ha` → `padspan-bright` — the panel url_path, the `padspan-ha-app`
  web component, the `www/padspan-ha` asset folder

...plus renaming two directories.

### 4.2 The release pass

`python scripts/release.py X.Y.Z` — unchanged command, both editions out.

1. Full edition releases exactly as it does now (version stamped in six files,
   zip built, validated, committed, tagged, GitHub release published).
2. Tree copied to a temp dir. `EDITION = "bright"` set in `build_info.py`.
   The `free` floor key stamped.
3. The two string replacements + two directory renames.
4. manifest.json retitled: name "PadSpan Bright", domain `padspan_bright`,
   documentation and issue_tracker pointing at the MAIN repo.
5. Zip built and validated by the same code path.
6. Force-push the generated tree to `gbroeckling/padspanBright`, tag, publish
   release with zip attached. **Issues disabled on that repo.**

### 4.3 HACS trap — already documented in release.py's own header

HACS validates from the **git tree**, not the zip. It walks `custom_components/`
for the first directory, then looks for `manifest.json` inside it. The
generated repo MUST contain a real `custom_components/padspan_bright/manifest.json`
committed in the tree. A Bright repo holding only a zip asset fails validation
with "No manifest.json file found".

hacs.json must keep `content_in_root: false`, `zip_release: true`, and
`filename` matching the asset name.

---

## 5. Why the skin is safe here

`manifest.json` declares `"dependencies": []`. Bluetooth, MQTT, Tag, frontend,
http, panel_custom and websocket_api are all **after_dependencies**, which are
soft — "set up after, if present", not "required".

So a Bright install on a machine with no Bluetooth hardware sets up perfectly
happily even though the BLE code is still present and running. That is what
makes "skin for now" a real option rather than a compromise: the cost is CPU
the user never sees, and it can be converted to a genuine runtime cut later
without changing a single thing they do see.

---

## 6. What Bright hides

**Keeps:** Mapping (floors, rooms, the fabric, the Lights tab), the Lights
sidebar panel, a trimmed Settings, a trimmed Health for install problems.

**Drops:** Overview, Pure Live, Follow, Devices, Bluetooth, Presence, Monitor,
Training, Calibration, Traceback, Forensics, Occupancy, QA, Sandbox.

**And the entity platforms with them** — every sensor published today describes
where something is. Bright exposes no entities. It is a panel, and is worth
describing as one in its README.

---

## 7. What makes it flow without you

The failure mode for a derived edition is not the build. It is the day a tab
is added, Bright is forgotten, and a presence feature quietly appears in the
lighting product three releases later.

- **Every navigable surface gets a class** — `lighting` or `presence` — in one dict.
  Bright renders only `lighting`.
- **A test asserts the map is TOTAL.** It reads the nav registration and fails
  if any tab lacks a classification. Add a tab, forget to classify it, the
  suite goes red before it is ever pushed.

That is the entire mechanism for "the rest just flows seamlessly": you are
never asked to remember Bright, only to answer one question about the thing
you just built, and only because the test asked.

This is the same shape as the bug fixed on 2026-08-14: the shape chooser
(`LIGHT_SHAPES` in light_codes.js) and the backend whitelist
(`_LIGHT_SHAPE_KINDS` in websocket.py) were two lists, one got updated, and
the failure was silent. That one now has an equality test. This one must not
be able to fail silently either.

---

## 8. The one real cost, and its fix

Separate listings mean separate storage: `.storage/padspan_bright.fabric` is a
different file from `.storage/padspan_ha.fabric`. Someone who maps their whole
house in Bright and then buys full PadSpan would otherwise start again.

**The fix is small because the two editions are the same code — the schemas
are identical and only the key prefix differs.** So the importer is generic:
walk the known store keys, read `padspan_bright.X`, write `padspan_ha.X`, mark
done. Both integrations can be installed side by side while it runs, then
Bright removed.

One button in the full edition's Health tab: "Import from PadSpan Bright",
shown only when those files exist. Roughly a day including tests.

**Build it in the same pass as the edition, not later.** The first person to
hit it will be someone who has already paid twice.

---

## 9. Risk

Not evenly spread. Two of six steps can hurt someone; four fail loudly and locally.

| Step | Risk | How it goes wrong |
|---|---|---|
| 1 · Classification map | Low | A tab vanishes from the full edition. Instantly visible, instantly reverted, touches no data. |
| 2 · Tier in the licence | **Highest** | The only step that can silently harm PAYING customers. A no-tier key resolving low demotes everyone on upgrade, discovered when a control they paid for stops working. Also reaches the licence server, which no test in the repo covers. |
| 3 · Free lighting gate | **High** | Two ways: implemented as a filter on stored data instead of a render-time override, it deletes placements. And Garry runs Pro — the free experience is the one path he can never accidentally notice is broken. |
| 4 · Generated build | Low | Only if the rename runs against the working tree instead of a copy, which would rewrite the actual source. Catastrophic but obvious within seconds. |
| 5 · Importer | Medium | It writes to the real fabric. An import that overwrites rather than refusing a non-empty target eats a house someone spent a weekend building. |
| 6 · The listing | Low | Technically nothing. Publicly irreversible — the name is out once it is out. |

**What already protects this work:** 588 tests; a suite that runs the real
renderer under node; a release script that refuses to publish if the suite is
red; pre-release-always; a live install that gets looked at; and the
soft-degrade rule already in the gate.

**What protects nothing here:** no test touches the licence server. No test
exercises a free tier, because no free install exists. Nothing tests the
Bright edition, because it does not exist. Those three gaps line up exactly
with the two high-risk rows — they are high risk *because* they are the parts
nothing watches.

### Five guards to build FIRST

1. **A demotion test** — assert a key with no tier field resolves to `pro`.
   One test; closes the worst failure in the plan.
2. **A tier override for testing** — a supported way to force the effective
   tier on a dev install, so the free experience can actually be looked at.
   Without it nobody ever sees what free users see.
3. **The renderer must never write** — a test that runs the free gate over a
   model with placements and asserts the stored positions come out
   byte-identical.
4. **Working tree untouched** — after the Bright pass, assert `git status` is
   clean. The rename runs on a copy or it does not run.
5. **Import refuses a non-empty target** — back up first, refuse second,
   merge never.

### Evidence from the day this was written

Fit to room shipped twice before it worked. The synthetic test passed both
times; it was the real house — 43 placed lights, none with an area assigned —
that exposed the first version, and a real measurement in a real room that
exposed the second. **Check each step against real data, not a fixture.**
Every trap in this plan lives in facts about the world, not in the code.

---

## 10. Order of work

1. **The classification map and its test.** Nothing ships. The full edition
   must come out bit-identical — that is the proof the map is inert when
   EDITION is full.
2. **Tier in the licence.** Ship `license_tier: "free"` as the floor, server
   returns `tier`, gate compares against `max(floor, server)`.
   **An existing key with no tier field must resolve to `pro`** — every key
   issued so far predates the field, and getting this backwards silently
   demotes every current customer on the release that ships it.
3. **The free lighting gate.** At free tier the renderer returns the default
   marker for every light, drops the W-series codes, and ignores stored
   positions so each light clusters at its room centre. A read-time override,
   near where Showcase already hooks in. **It must never touch stored data.**
4. **The generated build.** The second pass in release.py, plus a guard that
   greps the output for the old names and fails if it finds any.
5. **The importer.** Bright → full, one button.
6. **The listing.** Repo, branding, docs, first pre-release. Last, because it
   is the only step anyone else can see.

Steps 1–3 are useful on their own even if the second listing never ships —
they are the tier model, which is wanted regardless. The edition only becomes
real at step 4.

---

## 11. Open decisions (Garry's, not the builder's)

1. **Does a Bright key hide presence, or just not unlock it?** If Bright hides
   the presence tabs outright, a paying Bright customer sees *less* than a free
   PadSpanHA user — defensible as the product promise ("none of the
   complication") but it reads badly the first time someone notices.
   Suggestion: hide by default, with one switch in Settings that reveals them.
2. **What exactly does free include?** Locked in permanently by the shipped
   floor (§3.3). Current assumption: rooms, floors, one default marker per
   light at its room centre; no placement, no shapes, no sizing, no WLED.
3. **SKU naming on the licence server.** Suggest `padspan-pro` and
   `bright-pro` to match what customers see, while the internal tier values
   stay `pro` / `bright` / `free`.

---

## 12. Where things are

- **Source repo:** `C:\Users\Garry\padspanha` (branch `main`)
- **Release:** `PYTHONIOENCODING=utf-8 python scripts/release.py X.Y.Z` — pre-release
  always; `--stable` only on Garry's explicit word
- **Key files:**
  - `custom_components/padspan_ha/websocket.py` — `_pro_expiry_state`, `_padspan_pro_active`, `_LIGHT_SHAPE_KINDS`
  - `custom_components/padspan_ha/settings_store.py` — `DEFAULT_SETTINGS`
  - `custom_components/padspan_ha/panel.py` — panel registration, STATIC_URL
  - `custom_components/padspan_ha/build_info.py` — generated; EDITION would live here
  - `custom_components/padspan_ha/www/padspan-ha/views/light_codes.js` — LIGHT_SHAPES, deriveLightShape
  - `custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js` — the renderer, Showcase, fit-to-room
  - `custom_components/padspan_ha/www/padspan-ha/views/lights_map.js` — shared map card, lightIsTouched
  - `scripts/release.py` — stamping and publishing; HACS notes in its header
  - `tests/test_lights_renderer.py` — 38 tests, runs the real renderer under node

---

## 13. What shipped on 2026-08-14 (context for whoever picks this up)

Released v0.32.27 → v0.32.31, all deployed. Commits `12f353f`, `3fde243`,
`491f8d4`, `64ff979`, `bbff202`.

- Fixed "choosing dotted line fails" — root cause was `_LIGHT_SHAPE_KINDS` in
  websocket.py, a hand-maintained mirror of the frontend list that never got
  `line`. Save succeeded, value silently filtered, shape reverted to Auto.
  A test now asserts the two lists are EQUAL.
- `deriveLightShape` matches substrings, so "spot" matched the "pot" rule —
  every spotlight derived as a recessed downlight. Spot rule now precedes it.
- New shapes: real fan glyph, pendant, sconce, chandelier; triangle relabelled
  Spot/directional; track → the run shape. The run was redesigned from three
  dashes to the linear-luminaire symbol.
- **Showcase mode** on Mapping → Lights (setting `lights_showcase`): light
  pools in each fixture's own rgb_color at its own brightness, screen-blended;
  contact shadows; one upper-left gloss; vignette; room names in tracked caps;
  the code tag moved BELOW the marker, which is what frees the glyph centre
  for fixture detail.
- **Hide untouched** (`lights_hide_untouched`) — moving a light is NOT touching
  it; work means sized, rotated, recoloured or shaped.
- **Fit to room** (`lights_fit_rooms`) — no fixture drawn larger than its room,
  with a margin. Rooms resolved by ray-casting the light's own metres (NOT by
  HA area — none of the 43 placed lights has an area assigned).
- Sidebar reads all three settings, so builder and display agree.
- Marker drag anchor moved to `data-cx`/`data-cy` (parseFloat, not Number —
  `Number(null) === 0` is a real coordinate).

---

## 14. Built (2026-08-17)

Steps 1–5 are in the tree: `licence.py`, `views/editions.js`, the free gate in
`views/lights_map.js`, `scripts/bright_build.py` (+ `bright_README.md`), the
Bright pass in `scripts/release.py` (`BRIGHT_PUBLISH = False`), and
`bright_import.py` / `ws_bright_import.py` with the Health-tab card. Tests:
`test_licence_tiers.py`, `test_editions_map.py`, `test_lights_free_gate.py`,
`test_bright_build.py` (runs the generated tree's own suite), `test_bright_import.py`.
Step 6 — the listing — waits for Garry's word; flipping `BRIGHT_PUBLISH` is that word.
