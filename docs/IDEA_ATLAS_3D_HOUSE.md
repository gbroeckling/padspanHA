# Idea: Live Aboard — the 3D house and furniture (possible future add-on)

**Live Aboard** is the working name (Garry, 2026-09-30; it replaced "Sims Soup", which used
Electronic Arts' trademark) for this possible future add-on: the Sims-style 3D Atlas, furniture,
beacons and people from photos, and the shared library. Check the name before anything public or paid.

Planned 2026-09-30. Revised the same day: **clean-room, photo-to-furniture, and a shared library.**
Status: **being built on the `live-aboard` branch, normally off.** Step 1 (the switch and the empty
store) and the P0 prototype are done; P1 has started. The thirteen choices, decided, are at the end.

Where the idea came from: a r/homeassistant post (1wtyklm, 2026-09-30) showing a hand-built
three.js model of one house, walls cutting away like The Sims. That was an idea, not code, and
nothing from it is used. The point here is different: a 3D house for **every** PadSpan install,
built from the map people already drew, with no modelling.

## Ground rules for this feature (Garry, 2026-09-30)

1. **All PadSpan code, written here.** No other project's application code is ported, copied or
   adapted, for furniture or anything else. Sessions building this do not open other furniture
   or room-planner repos for reference. Libraries used as dependencies are allowed (three.js,
   below), the same way PadSpan depends on Home Assistant.
2. **It stands on its own.** It runs on any customer's Home Assistant with nothing of Garry's in
   the loop: no OpenClaw, no PadSpan-hosted AI, no homelab service. The only PadSpan server it
   ever talks to is the optional shared library (below), and it works fully without it.
3. **Customers never pay for Garry's AI, and Garry never pays for theirs.** The photo step runs
   on whatever AI the customer has already set up in Home Assistant.

## What it is

A **3D view of the house you already mapped**, next to the flat Atlas. The floors are stacked at
their real heights. The walls stand up, and the ones facing you cut away so you can see in. Every
light glows in its real colour, and doors swing open with their sensors. You tap and hold things
exactly as you do on the Atlas.

**Furniture is optional.** A new **Furnish** tab in Mapping lets people add a bed, sofa, lamp or TV
three ways: **from a photo** of their own furniture, **from the shared library** of pieces other
PadSpan users made, or **by hand** with a few sliders. Any piece can **be a device**: a floor lamp
that is `light.lounge_lamp` glows when that light is on, and tapping it switches it.

## Principles

1. **Nothing to redraw.** Floors, rooms, walls, doors and windows, lights and sensors all come
   from the existing map. A house that works in the Atlas works in 3D on day one.
2. **The flat Atlas stays exactly as it is.** 3D is a separate view, never a replacement. The flat
   drawing stays byte-identical whether 3D is on or off, and Overview stays SVG. (This follows
   the roadmap's own call: "Stays pure-SVG, no WebGL, as scoped",
   `BEST_IN_CLASS_ROADMAP.md:395-407`.)
3. **Everything is reversible.** The feature is off by default and sits in its own storage file.
   It never writes to the map, the rooms, the walls or the light positions. See "Undoing it".
4. **Nothing extra on Home Assistant.** It all runs in the browser. The exceptions: the photo step
   (one AI Task call per photo, only when the person presses the button) and the optional people
   layer, which reads the same live snapshot Overview already uses, no more often.
5. **Wall tablets fall back quietly.** No WebGL, a slow GPU, or any error means the flat Atlas,
   never a blank panel.

## Where it lives

| Place | What's there |
|---|---|
| **Atlas** (sidebar, and Mapping → Atlas) | A **Map / 3D** switch beside the zoom buttons (`lights_map.js:3259-3290`), and in the rail for the edge-to-edge layout (`lights_map.js:3601`). Each screen remembers its choice, so the wall PC can open in 3D. |
| **Mapping → Furnish** (new tab after Atlas, `maps.js:109-111`) | The furniture editor: the 3D house and a plan view side by side; **From a photo**, **Library** and **Build** buttons; drag and turn; fit checks; colours; "This is a device…"; then Save, Discard and Undo. |
| **Settings → UI Structure → Atlas → 3D house** | Shown only in Pro and Bright Pro. The master switch (off by default). Once on: Quality (Auto / Low / High), Show people (off), the AI Task for photos (none), Shared library (off), and Remove all furniture (admin only; takes a backup first). See "Normally off". |
| Overview, Traceback | Unchanged. |

## Normally off: the switch (Garry, 2026-09-30)

One master switch, **`atlas_3d_enabled`, default off**, in Settings → UI Structure → Atlas →
3D house. It copies two existing patterns: Automorph (`lights_automorph_enabled: False`,
`settings_store.py:113`, "off = today's rendering exactly") and the Atlas sidebar itself
(`lights_panel_enabled`, `panel.py:126`). Off is the state every install is in until Garry flips
the default, which is one line in `DEFAULT_SETTINGS` plus a release note, and not before the
phases have shipped and the load report shows tablets cope.

What "off" means, layer by layer:

| Layer | Off (the default) | On |
|---|---|---|
| Atlas, both hosts | No Map / 3D switch is drawn; the stage is the SVG exactly as today. The 3D module is not even imported. | The switch appears; each screen remembers its choice. |
| Mapping | No Furnish tab, hidden the way Basic mode hides tabs (`maps.js:109-116`). | Furnish after Atlas. |
| Settings | The master switch and one line saying what it adds. | The sub-switches appear below it. |
| The store | Registered (so backup, restore and factory reset know it) but never written. A file that exists (a downgrade, or switched off later) is read and kept, never shown. | Read and written. |
| Websocket | Every `house3d_*` command answers "the 3D house is off" and touches nothing, except `house3d_get`, which still returns the data so backups can be labelled. | Normal. |
| Network | No AI Task call and no library call, ever. | Only with the matching sub-switch on. |
| Telemetry | No house3d, furnish, photo or library events, and no `env.house3d`. The report is the same as today's. | The events listed below. |
| Home Assistant load | Nothing: no timer, no snapshot read, no import. | Only the people layer (itself off) reads the snapshot. |

**Pro and Bright Pro only** (Garry, 2026-09-30). Below the Pro tier (`tierAtLeast(tier, "pro")` in
`views/editions.js`), every layer above is as if off, whatever the switch says. The setting is kept,
so a lapsed licence hides Live Aboard and a renewed one brings it back as it was.

**Sub-switches**, each off by default and only visible once the master is on:

| Key | Default | What it turns on |
|---|---|---|
| `atlas_3d_people` | off | the people layer |
| `atlas_3d_ai_task_entity` | none | the photo step (none selected = the button explains what is needed) |
| `atlas_3d_library` | off | the shared library (on still needs the terms accepted before the first share) |
| `atlas_3d_quality` | auto | Low / High |

**Ship dark, on its own branch.** All Live Aboard work lives on the `live-aboard` branch (Garry,
2026-09-30: "keep this a separate branch for now"); main and every public release stay free of it
until Garry says it ships. A phase is installed on the home HA straight from the branch, behind
the master switch, which Garry turns on in his own Settings. The branch merges main regularly so
it never drifts.

**Enforced by tests:**

- `test_atlas_3d_off_is_byte_identical` copies
  `test_perimeter_automorph_off_is_byte_identical_to_the_legacy_trace`
  (`tests/test_lights_renderer.py:1995`): the flat drawing is identical with the feature absent,
  off, and on but not selected.
- Off means no import: with the flag off, the map card never loads the 3D module (the harness
  records module loads).
- Off means no writes: every `house3d_*` command with the flag off leaves the store's bytes unchanged.
- Off means no network: with the switches off, no `ai_task` service call and no request to the
  library URL, under mocks.
- Off means no telemetry: with the flag off the frontend fires none of the events, and
  `build_payload` carries no `house3d` keys.

## What the 3D view shows: ties to what's already there

| PadSpan today | In 3D |
|---|---|
| Floors: `level`, `floor_to_floor_m` (default 2.8), `base_elevation_m`, 3D Stack alignment | Slabs at their real heights. The floor chips choose the top floor, and floors above it are hidden, as in The Sims. |
| Rooms: polygons in metres, room colours (`room_meta`) | Floor tiles in the room's colour, with names on the floor. |
| Walls: `rf_barriers_m` with a material | Wall panels at the floor's height. Glass reads as a window, "open" as a gap. |
| Doors, windows, locks linked to sensors (`linked_entity_id`, `invert_state`) | Door leaves swing with the sensor, windows show open or closed, and an unlocked lock flashes. This reuses the Atlas's own door logic (`doorInvertOf`, `barrierNoReading`). |
| Lights: `light_positions_m` (x, y, floor, shape, colour, size, rotation) | The fixture drawn by its shape (ceiling puck, pendant, strip, tube, fan, spot, LED), glowing in its live colour and brightness. |
| Motion and air tiles, the Motion · Air colours | A room-floor pulse in the same colours, with the same timing (`MOTION_COLOR_STOPS`). |
| Temperature, humidity, air readouts | Floating readouts, read-only as on the Atlas. |
| Emergency lighting button | Unchanged: it is HTML above the stage. The devices phase also outlines the emergency lights in 3D while a test runs. |
| Outdoor weather (`atlas_weather.js`) | The same decision (`decideAtlasWeather`, the same settings), drawn as rain or snow falling outside the walls. A snowfall warning puts snow on decks and roofs. |
| Showcase styles (19 themes) | Atmosphere phase: each theme's colours become 3D lighting and material presets. Automorph stays 2D-only. |
| Tracked people, phones and tags (Overview's live snapshot) | Optional **people layer**, off by default: soft markers at their positions. |
| Sweet Home 3D import (`sh3d_import.py`, rooms only today) | Import phase: also reads its doors and windows, and its furniture as **size and kind only**, mapped onto PadSpan's own builders (never its models). |

**Taps and holds are identical.** A 3D pick resolves to an entity id and calls the same actions
the Atlas uses (`_useApi` at `lights_panel.js:666-690`, `previewApi` at `maps.js:8686-8703`,
`createHoldTracker`). Tap toggles. Hold opens controls. Hold and drag dims. A room name opens the
room sheet, a floor badge the floor sheet, a door the barrier card, and a motion sensor its
activity calendar. The hover HUD and press ring are SVG-only and get 3D equivalents.

## Furniture: PadSpan's own builders

Every piece is a **recipe**, plain data, drawn by a **builder**, PadSpan code. The look is
deliberately simple and Sims-like: boxes, rounded boxes, cylinders and bevels, not scanned meshes.
That keeps wall tablets fast and makes every piece describable by a handful of numbers.

- **Starter builders (8):** sofa, bed, table, chair, desk, dresser/cabinet, TV + media unit,
  lamp (floor and table). Then rug, shelf, wardrobe, plant, and the device pieces (washer, dryer,
  robot vacuum dock, mower dock, car and charger, radiator, fan, speaker) one at a time.
- **Each builder takes parameters, never a model.** For a sofa: seats (1–4), arms (none / slim /
  wide / rolled), back height, seat depth, leg style (none / block / tapered / metal), cushion
  count, and two colours. A bed: size, headboard style and height, footboard yes/no, frame or
  platform. And so on, each list short enough to fit one screen of sliders.
- **Anything unrecognised is a box.** If no builder fits, the piece is a coloured box of the
  right size, still movable, still bindable to a device. Nothing is ever refused.
- **Units:** builders work in metres, like the rest of PadSpan. No conversion layer.
- **Placing:** drag and turn in 15° steps, in 3D or on the plan. Snaps to walls at any angle.
- **Fit checks,** PadSpan's own, against PadSpan's walls and doors: into a wall, overlapping
  another piece, in a door's swing, blocking a wardrobe front or a bed side, tall in front of a
  window. Warnings, never blocks.
- **Materials:** simple procedural finishes (wood grain, fabric weave, metal, gloss) generated in
  code. No texture files, so nothing third-party and nothing extra to download.
- **As a device:** "This is a device…" binds a piece to an entity. A lamp glows with its light,
  a TV lights with its media player, a fan spins. A piece bound to a light that is also placed
  on the map replaces that light's marker **in 3D only**; the light's stored position is not
  touched.
- **Renames:** a binding keeps both the entity id and the entity-registry id and re-resolves on
  rename (the WLED looks already do this, `wled_exact.py:107-115`). A deleted entity shows the
  piece as unlinked. A piece is never deleted on its own.
- **Rooms:** a piece stores its floor and x/y, never a room name. Rooms are keyed by name and can
  be renamed or deleted, so a piece's room is worked out when it's read.

## From a photo

The same pattern as quey: the photo identifies the thing, a vision model reads it into plain
data, and PadSpan's own builder draws it. The photo fills in settings. It never becomes the model.

1. **Take or pick a photo** in Furnish → From a photo. The screen suggests getting a tape
   measure, a door frame or a standard chair in the shot for scale.
2. **Home Assistant's AI Task reads it.** PadSpan calls `ai_task.generate_data` with the image
   as an attachment, a fixed prompt, and a **`structure`** for the answer. That is Home
   Assistant's own field list, not a JSON Schema: each field has a selector (text, number with
   min/max, select with fixed options, boolean), so the answer is flat fields and every closed
   list below is a select. It holds the kind (from the
   builder list, or "other"), that builder's parameters, two or three colours, and rough
   width / depth / height with a confidence, plus the library details sheet (category,
   rooms, style, material, features and a suggested title). The customer chooses which AI Task entity to use
   in Settings; it can be a local model. PadSpan ships the prompt and schema, nothing else.
3. **PadSpan checks the answer** against the schema and clamps every number to the builder's
   range. A bad or empty answer falls back to "Build" with the kind pre-picked, or a box.
4. **One real measurement.** One photo can't give true size (quey hit the same wall with key cut
   depths), so the person types one number (usually the width) or drags the piece's edge on the
   plan. The other sizes scale from the photo's proportions.
5. **Preview, adjust, place.** The piece appears in the room with its sliders open. Nothing is
   stored until Save.

**What happens to the photo:** it goes from the browser to Home Assistant, from Home Assistant to
the AI Task the customer chose, and is then discarded. PadSpan never stores it and never sends it
to a PadSpan server. Only the recipe is kept.

**Without AI Task** (older Home Assistant, or none set up): the button explains what's needed and
offers Library and Build instead. `hacs.json` stays at `2024.1.0`; the photo button is simply
unavailable below Home Assistant 2025.8, the release that added `structure` and `attachments` to
`ai_task.generate_data` (checked against Home Assistant's source: 2025.7.0 has neither).

## Beacons, scanners and people from photos (Garry, 2026-09-30)

The same photo step works for the things PadSpan already tracks, so the 3D house (and, if wanted,
the flat Atlas) shows what they actually look like instead of a generic dot.

**Beacons and scanners.** Photograph a tag, keyring beacon, phone, Pixel Tag or AirTag, or a
scanner node (ESP32 proxy box). The AI Task reads it into a small **device recipe**: form
(puck, card, fob, phone, box, board), colours, rough size, and whether it has an antenna. A
**beacon** is drawn at its live tracked position and moves with it. A **scanner** is drawn at
its stored position (`scanner_positions_m`, with its `z_m`). The binding is by the same ids
PadSpan already tracks them by, re-resolved the way light and WLED bindings are.

- On the **flat Atlas**, the existing beacon overlay (`lights_show_beacons`, off by default) can
  use a small icon rendered from the recipe instead of the plain marker. With that overlay off,
  the flat Atlas stays byte-identical.
- Device recipes are ordinary library pieces: a "white puck tag" or "black ESP32 box" is useful to
  everyone, and says nothing about where it lives or who carries it.

**People.** Photograph a person and PadSpan makes a **Sims-style figure**, not a likeness:
height, build, hair style and colour, top and bottom colours, glasses or hat. The figure is
linked to a Home Assistant `person` and walks with their tracked beacon or phone in the people
layer.

- **People are never shared.** Figure recipes are kept out of the library, out of telemetry
  (counts only) and out of any server call. They live only in this install's file and backups.
- **The photo is handled like furniture photos:** used for one AI Task call, then discarded.
  Because a cloud AI Task means the photo leaves the house, the people screen says which AI Task
  will read it and recommends a local one.
- **Consent of the person in the photo.** The screen asks the person taking it to confirm the
  person photographed agrees, and the figure can always be built by hand with sliders instead of
  a photo. Deleting the `person` or the figure deletes the recipe.
- **Children:** the people screen suggests the slider builder for children rather than a photo.
- People figures appear only when the people layer is on (off by default).

## The shared furniture library

Every piece people make goes into a **common library** any PadSpan install can browse and place.
It follows the existing `popular_presets` pattern (`server/popular_presets.php`, `telemetry.py`),
at `padspan.traks.ca/api/furniture_library.php`.

**What is shared: the recipe and its details sheet, and nothing else.**

| Shared | Never shared |
|---|---|
| kind, builder parameters, colours, width / depth / height, the PadSpan version | the photo |
| the **details sheet** (below): category, rooms, style, materials, colour family, size class, features, and the optional library title, brand and model | where it sits: floor, x/y, rotation, room |
| a random **submission id** made by that install (for withdrawal, below) | the device binding (entity ids) |
| | the name or label the piece has **in the house** (separate from its library title) |
| | **any people figure**, ever |
| | the install id, IP address, user agent, or any other request header |

The recipe is a few numbers from a closed list, and the details sheet is mostly closed lists too.
Neither says who made the piece or what their home looks like. The server checks both again on
receipt and drops unknown keys, as `telemetry.php` does.

### The details sheet (Garry, 2026-09-30)

Every piece that goes into the library carries a filled-out details sheet, so other people can
**find, sort and filter** it. The AI Task fills it in from the photo in the same call that
reads the recipe (it is part of the `structure`), so for most pieces the person only checks it
and taps Save. For pieces made with Build, the builder's own settings fill most of it.

**Required before a piece can be shared** (closed lists; the screen won't save a library piece
with one missing):

| Field | Values (closed list, extended by PadSpan releases only) | Filled from |
|---|---|---|
| Category | seating, sleeping, tables, storage, lighting, media, decor, outdoor, appliance, kids, pets, office, bath, kitchen, device (beacon / scanner), other | builder |
| Kind | the builder's kind (sofa, sectional, armchair, bed, bunk bed, crib…), or "other" | builder |
| Rooms it suits | one or more of: living, bedroom, kids' room, kitchen, dining, office, bathroom, hallway, garage, patio, any | AI, editable |
| Style | modern, mid-century, traditional, rustic, industrial, Scandinavian, farmhouse, minimalist, boho, coastal, glam, retro, other | AI, editable |
| Main material | wood, fabric, leather, metal, glass, plastic, stone, rattan/wicker, mixed | AI, editable |
| Colour family | from the recipe's main colour, mapped to one of 14 names (white, cream, beige, brown, black, grey, red, orange, yellow, green, teal, blue, purple, pink) | computed |
| Size class | small / medium / large / extra large, **per kind** (a large lamp isn't a large sofa) | computed from dimensions |
| Dimensions | width, depth, height in metres (shown in the viewer's units) | recipe |

**Filled in when they apply** (still closed lists, mostly booleans and counts):

- **Seats / sleeps** (seating, beds): 1–8, and bed size (twin, double, queen, king, crib, bunk).
- **Features:** has arms, reclines, sectional/modular, sofa bed, storage inside, drawers (count),
  doors (count), shelves (count), on wheels, foldable, adjustable height, wall-mounted.
- **Light pieces:** fixture type (floor, table, desk, pendant, wall, strip), number of shades.
- **Device pieces (beacons and scanners):** form (puck, card, fob, phone, box, board), antenna
  yes/no.
- **Outdoor-rated:** yes/no.

**Optional short text** (the only free text in the library):

| Field | Limits |
|---|---|
| **Library title** | 3–60 characters. Suggested by the AI ("Three-seat grey sofa, slim arms"), editable. This is **not** the piece's name in the house, which is never shared. |
| **Brand** | 2–40 characters, optional. Useful for "anyone got the IKEA one?" searches. |
| **Model** | 1–60 characters, optional. |

Free text is checked on the install **before** sending and again on the server: refused if it
looks like a secret (the same patterns as `tester.php`: a licence key, a long hex string, a JWT,
a token), an email address, a phone number, a street address or a URL, and run through a
word list. A title that fails is replaced with the AI's suggestion rather than blocking the share.

**How people find pieces** (the library screen):

- **Search** across library title, brand, model, kind, style and material.
- **Filter** by category, kind, room, style, material, colour family, size class, seats/sleeps,
  features and outdoor-rated.
- **"Fits here"**: when opened from a spot in the house, the library filters to pieces whose
  footprint fits the free space there (width and depth, with a small margin), using the same
  fit checks as placing.
- **Sort** by most placed, newest, best fit (with "Fits here"), size, or name.
- **Grouping:** near-identical recipes (binned signature, as `popular_presets.php`) show as one
  entry, the medoid, with a count ("placed in 214 houses"). Details for a group are the most
  common value for each field among its members, so one badly labelled copy can't mislabel it.
- **Report:** each entry has "Report this piece" (wrong details, bad title). Reports are counted
  only; three reports from different submission-id prefixes hide the free text until Garry
  checks it. The recipe stays usable.

**Quality flag.** An entry shows a small "details checked" mark once a real person has changed or
confirmed at least one AI-filled field, so AI-only sheets sort below confirmed ones with
everything else equal.

**Editing later.** The person who shared a piece can fix its details from their own house
(matched by their submission id); the server keeps only the latest sheet. Copies already placed
in other houses keep whatever details they had.

**Terms of use.** The first time someone opens Furnish, one screen explains the library in
plain words and asks them to accept its terms before they make furniture:

- Pieces you make are added to the shared PadSpan furniture library for everyone to use.
- Only the piece's shape, sizes, colours and its details sheet (category, style, materials and
  the like, plus an optional title, brand and model) are shared. Never your photo, your floor
  plan, where the piece sits, what device it's linked to, or anything that identifies you or
  your home. Don't put personal information in the title.
- By sharing, you give PadSpan (every edition, free and paid) a permanent licence to use, show,
  copy and change each piece and its details, and to let other PadSpan users place it in their
  houses. You keep your own rights. The library gives nobody a licence outside PadSpan.
- You can withdraw your pieces at any time from Settings (below).

Acceptance is stored in settings with the terms version and date. A later terms version asks
again before the next share. **Accepting is a condition of making furniture**, as Garry asked;
browsing the library, the 3D view and "Build" of built-ins stay available without it. The
wording goes past a lawyer before release, especially for EU users (most PadSpan clients are
outside Canada).

**Withdrawal.** Each install keeps its own submission ids locally. Settings → "Withdraw my shared
furniture" sends those ids; the server deletes them and logs only `{submission_id, withdrawn_at}`,
as `tester.php` does. Pieces already copied into other people's houses stay there (placed copies stay
usable inside PadSpan), which the terms say plainly.

**Browsing.** Pieces show as 3D thumbnails rendered in the browser from the recipe, with the
search, filters, sorting and grouping described under the details sheet. Placing a library
piece copies its recipe and details into the house; after that it is theirs to change.

**Offline and outages.** The built-in builders and a starter set of recipes ship with PadSpan.
The library is extra: if the server is unreachable, Furnish says so and everything else works.
Pieces made offline queue their share until the next successful fetch.

**Abuse guard.** Recipes and most details are values from closed lists, so the only thing to
moderate is the short free text (title, brand, model), handled by the checks and the report
button above. Limits per UTC day on new submissions (overall and per submission-id prefix), and
out-of-range values rejected, as `tester.php` does.

## Engine

- **three.js**, MIT, used as a library and bundled with PadSpan (`www/padspan-ha/vendor/three/`),
  never from a CDN. Home Assistant can run offline, and the wall kiosk shouldn't depend on the
  internet. Its licence text goes in `THIRD_PARTY_NOTICES.md`. It is the only third-party code in
  this feature.
- Everything else is PadSpan's: the builders, materials, fit checks, whole-house walls and
  cut-aways, camera (touch orbit, pinch about the midpoint, two-finger pan), picking, the photo
  prompt and schema, and the library.
- **Two quality profiles.** Auto picks one from WebGL support and a short frame-time check.

  | | Tablet (Low) | Desktop (High) |
  |---|---|---|
  | Post-processing | none | ambient occlusion |
  | Shadows | a soft blob under each piece | one 2048 soft sun shadow |
  | Materials | flat colours | procedural finishes |
  | Real lamp lights | glow only; up to 4 nearest real lights | up to 8 |
  | Pixel ratio | 1 | device |
  | Geometry | merged per room | merged per room |

  A bulb switching on or off changes its intensity, never its visibility, so three.js never has
  to rebuild shaders. The view renders only when something changes, and stops when the panel is
  hidden.
- **It has to survive the Atlas.** The Atlas rebuilds its whole card every 5 s
  (`lights_panel.js:167, 692-699`), and it clears the panel before building (`lights_panel.js:696`),
  so a throw would blank it. So:
  - the 3D view is **one long-lived element** moved into each new stage, like the weather overlay
    (`atlas_weather.js:475-481, 636-728`), so the camera and GL context survive every poll;
  - it loads with `import().catch`, its mount runs inside try/catch, and any failure, a lost GL
    context included, shows the flat Atlas and is counted.

## Data (a new file)

One new store, **`padspan_ha.house3d`**. It stays at Home Assistant store version 1 forever;
changes go through its own `schema` field. The only other additions are its settings keys.

```
{"schema": 1,
 "pieces":  {"fur_1a2b3c4d": {"id": "fur_1a2b3c4d",
              "recipe": {"kind": "sofa", "params": {"seats": 3, "arms": "slim", "back_h_m": 0.8,
                         "legs": "tapered", "cushions": 3},
                         "colors": ["#5b6b7a", "#c8b89a"],
                         "width_m": 2.2, "depth_m": 0.9, "height_m": 0.8,
                         "details": {"category": "seating", "rooms": ["living"], "style": "mid-century",
                           "material": "fabric", "color_family": "grey", "size_class": "large",
                           "seats": 3, "features": ["has_arms"], "outdoor": false,
                           "title": "Three-seat grey sofa, slim arms", "brand": "", "model": "",
                           "checked": true}},
              "origin": "photo",                                       # photo | library | build | import
              "label": "Mum's old couch",                              # name in the house, never shared
              "library_id": null, "submission_id": "sub_…",            # shared-library links
              "floor_id": "main", "x_m": 3.412, "y_m": 1.25, "z_m": 0.0, "rotation": 90.0,
              "entity_id": null, "entity_reg_id": null, "updated_at": "…"}},
 "lights":   {"light.lounge": {"z_m": 1.55}},                         # 3D-only mount heights
 "openings": {"<barrier id>": {"hinge": "left", "swing": "in", "sill_m": 0.9, "head_m": 2.1},
              "win_5e6f7a8b": {"kind": "window", "floor_id": "main",   # a window added in 3D,
              "a_m": [2.10, -9.23], "b_m": [3.30, -9.23],               # no sensor: a stretch of
              "sill_m": 0.9, "head_m": 2.1}},                           # wall in fabric metres
 "devices":  {"<beacon or scanner id>": {"recipe": {"kind": "tag", "params": {"form": "puck"},
              "colors": ["#ffffff"], "width_m": 0.04, "depth_m": 0.04, "height_m": 0.01},
              "library_id": null, "submission_id": null},               # drawn at its live/stored position
              "sensor.lounge_temperature": {"z_m": 1.5}},              # a 3D-only height
 "figures":  {"person.garry": {"params": {"height_m": 1.8, "build": "medium", "hair": "short",
              "colors": {"hair": "#3a2a1a", "top": "#224466", "bottom": "#333333"}},
              "origin": "photo"}},                                     # never shared, never sent
 "library":  {"terms_version": 1, "accepted_at": "…", "pending_shares": []}}
```

- The `recipe` object is exactly what the library shares; everything outside it stays home.
- The conventions match PadSpan's: fabric metres, a floor per piece, `z_m` above its own floor
  (as scanners have), `rotation` in degrees (as light pins have).
- `lights`, `openings` and `devices` hold what the 3D view needs but the map doesn't have: a
  light's mount height (the default comes from its shape), a door's hinge and swing (default left
  and in), windows added in 3D (Garry, 2026-09-30), and the height of any other device drawn in 3D.
  Keeping them here means **the map data is never modified.** Scanner heights are the exception:
  the map already has them and presence uses them, so 3D reads them and never overrides them.
- Reading is tolerant. Unknown keys, kinds and parameters are kept. A floor that no longer exists
  is accepted.
- **Websocket commands** (`ws_house3d.py`):

  | Command | Who | Notes |
  |---|---|---|
  | `house3d_get` | any user | |
  | `house3d_piece_set` / `house3d_piece_remove` | same gate as light placement | |
  | `house3d_light_set` / `house3d_opening_set` / `house3d_device_set` | same gate as light placement | heights, windows; the 3D editor saves through these |
  | `house3d_from_photo` | same gate as light placement | runs the AI Task call; returns a recipe, stores nothing |
  | `house3d_terms_accept` | same gate as light placement | |
  | `house3d_library_withdraw` | admin | |
  | `house3d_clear` | admin | takes `_auto_backup(…, [HOUSE3D_STORE_KEY])` first |

- **Settings:** `atlas_3d_enabled` (off), `atlas_3d_quality` (`auto`), `atlas_3d_people` (off),
  `atlas_3d_ai_task_entity` (none), `atlas_3d_library` (off). Unknown settings keys survive a
  downgrade.

**Everywhere it must be registered** (the checklist, so nothing is half-wired):

1. `const.py`: the key and a `DATA_` slot. The Bright build renames it automatically.
2. The store: wrapped with `wrap_store`, with a public `.data`.
3. `__init__.py`: `_ensure_stores`.
4. `ws_common.py`: `_ALL_STORE_KEYS` and `_DATA_KEY_MAP`, which gives backup and restore.
5. `ws_factory_reset.py`: an explicit block that empties it (terms acceptance included).
6. `bright_import.py`: `HOUSE_STORES` (done in step 1, with the cached store dropped after an
   import), plus a count in `target_contents` (P2). Known gap before Live Aboard ships in Bright:
   on an install with no 3D file, the pre-import backup cannot record "no file", so restoring it
   cannot remove a 3D file the import created. Fix it then with an "absent" marker in the backup
   that a restore turns into removing the file. (The importer's general "reload re-reads the
   stores" problem, for the other stores, is separate and older.)
7. `manage.js` `_storeLabel`: "3D house".
8. Settings, with schema entries and validators (the `atlas_weather_*` keys are the pattern).
9. Telemetry, as below.
10. Tests, as in each phase.

## Telemetry (only if the report is on; words from a closed list)

- **Events:**
  - `house3d_opened`
  - `house3d_fallback:{no_webgl, slow_gpu, context_lost, error}`
  - `furnish_opened`, `furnish_terms_accepted`
  - `furniture_placed:{photo, library, build, import}`, `furniture_removed`, `furniture_bound`
  - `photo_read:{ok, no_ai_task, bad_answer, error}`
  - `library_shared`, `library_withdrawn`, `library_unreachable`
- **Under `env.house3d`:** the number of pieces and of bound pieces, as buckets.
- **Errors:** every new view file goes in `UI_ERROR_HELPERS`, so a crash is credited to the right
  module.
- **Load:** the load report shipped in 0.38.91 shows whether the people layer costs Home
  Assistant anything.

The library itself is not telemetry and doesn't depend on the report being on: it has its own
consent (the terms) and its own endpoint, as the tester sign-up does.

## Undoing it

| To undo | How |
|---|---|
| Turn it off | Settings → 3D house off. The Atlas is exactly as today, and a test proves the flat drawing is byte-identical. |
| One edit | The Furnish tab works in a draft with Undo/Redo and Discard, like light placement. Nothing is stored until Save. |
| All furniture | "Remove all furniture" (admin) takes a backup first, then empties the file. Restoring that backup brings it all back. |
| Shared pieces | "Withdraw my shared furniture" deletes this install's submissions from the library. Copies already placed in other houses stay. |
| A downgrade | Older PadSpan versions ignore the file and the settings keys (restore tolerates unknown stores; settings keep unknown keys). Upgrading again brings the furniture back. |
| A backup restore | Backups include the file. Restoring an older backup that has no furniture leaves the current furniture alone (tested). |
| Factory reset | Empties it. Known gap: a factory reset on an older version won't know the file, so the furniture reappears after upgrading. Tolerant floor handling keeps that harmless. |
| Remove PadSpan | Delete `/config/.storage/padspan_ha.house3d`; the bundled files leave with the integration. |
| The code | Each phase is its own release. New files, plus a short list of hooks in existing files (the switch, the tab, the settings rows, the registration lines above), each named in its release notes. Reverting a phase's commits restores the previous release exactly. |

**The invariant, enforced by tests:** the feature never writes fabric, model, maps or light
positions; neither the flat Atlas nor the presence engine reads the new file; and nothing outside
a piece's `recipe` ever leaves the house.

## Phases

Each phase is built on the `live-aboard` branch, installed on the home HA and reviewed before the next one starts.
Sizes compare with the Atlas weather feature (one module plus settings and telemetry, released
as 0.38.91). To keep within weekly usage limits, one phase per week or two, and fix rounds get a
targeted re-check rather than a full re-review unless the fix touched shared code.

| Phase | What | Size | Done when |
|---|---|---|---|
| **P0 Prototype** | A standalone page, not shipped, built from a read-only export of Garry's real house (`model_get`): the whole-house shell with cut-away, live-looking lights, and two builders (sofa, bed) with their sliders. Tried on the wall PC and a phone. | about 1× | Garry says go, or changes the direction. |
| **P1 The 3D view** | The Map / 3D switch; floors, rooms, walls, doors and windows (from sensors, or added in 3D); lights with live glow; Motion · Air tints; readouts; tap, hold and dim; floor chips; touch camera; a compass; sunlight and shadows from the real sun; device heights, adjustable in the 3D editor; quality profiles and fallback; settings; telemetry. | about 3× | The house draws from existing data with no setup. Every Atlas action works in 3D. The flat Atlas is byte-identical. A forced WebGL failure shows the flat Atlas. |
| **P2 Furniture by hand** | The store, its commands and full registration; the Furnish tab; the 8 starter builders and procedural materials; Build with sliders; drag and turn with snapping; fit checks; Undo, Save and Discard; Remove all with a backup. | about 3× | The registration tests pass (backup, restore without furniture, factory reset, Bright import, unknown keys, store version 1). Editing furniture changes no other file. Each builder has a still-picture test across its parameter range. |
| **P3 From a photo** | The AI Task call, prompt and `structure`; answer checking and clamping; the one-measurement step; the no-AI-Task path; the photo never stored (tested). | about 1× | Ten real photos of Garry's furniture each give a sensible recipe on a local and a cloud AI Task. A garbage answer gives a box, never an error. |
| **P4 Shared library** | Terms screen and acceptance; the details sheet (AI-filled in the photo call, required fields enforced, free-text checks on both ends); `furniture_library.php` with shape checks, signatures, limits, withdrawal, reports and owner edits; search, filters, "Fits here" and sorting; thumbnails; queue when offline; the starter recipe set with full details. | about 2× | A share contains only `recipe` keys (tested on both ends). A piece missing a required detail can't be shared. A title with an email, phone, address or URL is refused on both ends. Every filter and sort returns the right pieces on a seeded test library. Withdrawal deletes. Library down means Furnish still works. Terms reviewed. |
| **P5 Devices as furniture** | Binding, with rename re-resolve and unlinked badges; lamps, TV, fan; washer and dryer running; vacuum and mower docks, animated while running (they rarely report where they are); radiators; car and charger; emergency lights outlined during a test. | 1–2×, one device type at a time | Each device type has a live-state test and a still picture. |
| **P6 Beacons, scanners and people** | Device recipes for beacons and scanners at their live and stored positions; the flat-Atlas beacon icons (inside the existing overlay); Sims-style figures with the person link, the consent screen, and the local-AI recommendation; figures kept out of every share (tested). | about 1–2× | A photographed tag moves with its beacon in 3D. A figure walks with its person. A library share and a telemetry report contain no figure data. With the beacon overlay off, the flat Atlas is byte-identical. |
| **P7 Import** | Sweet Home 3D doors and windows, and its furniture as kind and size mapped to PadSpan builders, as candidates you preview and commit into the new file only. | about 1× | A real `.sh3d` imports. Declining the preview writes nothing. |
| **P8 Atmosphere** | Rain and snow in 3D; Showcase themes as 3D presets; the optional people layer. | 1–2× | Each item can be switched off on its own. |

### Added by Garry, 2026-09-30: windows, a compass, the sun and device heights, all in P1

- **Windows.** Today a window can only be marked on a wall that has a sensor. P1 adds windows
  without sensors: drawn on any wall in the 3D view, with sill and head heights, and kept in the
  3D file (`openings`), so the map is untouched. Windows with sensors still show open or closed.
- **The door and window tool: a line drawn on a wall** (Garry, 2026-09-30). In the 3D editor, pick
  Door or Window, then press on a wall and drag along it (or tap its two ends). The line snaps onto
  that one wall (it stops at a corner), shows its length live, and becomes the opening on release,
  never overlapping another. A window is 0.3 m or wider, sill 0.9 m and head 2.1 m by default; a
  door is 0.6 m or wider, from the floor to 2.03 m, with its hinge side and swing. Then drag either
  end to adjust; height sliders; Door/Window switch; Delete; Undo/Redo; nothing is stored until
  Save. It works on every wall, room outlines included, not only the walls drawn in Mapping.
  Picking the tool turns the camera to the top-down view of the current floor, so drawing is
  tracing the plan; it works in the 3D view too. One finger draws while the tool is on; two
  fingers still pan and zoom. Doors and windows with sensors keep coming from the map's own door
  marking and show open or closed; this tool adds the ones without sensors.
- **Compass.** A compass at the top left of the 3D view that you **spin to line north up with what
  you see** (Garry: "a compass at the top left that I can spin"). Drag its needle; the sun,
  shadows and day/night follow live; then Save north or Cancel, so a stray touch on the wall PC
  can't move it. A tap turns the view north-up. It stores the bearing the GPS Bridge already uses
  (`fabric_bearing_deg`), also shown in the 3D house settings. The fabric is y-down (+Y runs down
  the plan), so the 3D view has its own corrected maths in one place (`fabric_compass.js`).
  `geo_bridge.py` assumes y-up and so mirrors positions; that is a main-branch bug, left alone for
  now (Garry's GPS Bridge is off).
- **Sun.** Sunlight from `sun.sun`'s azimuth and elevation (worked out from the home's location if
  `sun.sun` is missing), with shadows on High, night when the sun is down, and light through the
  windows. Moved here from P8.
- **Device heights.** Every device drawn in 3D (lights now, sensor readouts as they arrive) gets a
  height above its floor: a default by its type, adjustable in the 3D editor, with a reset. Kept in
  the 3D file (`lights`, `devices`). Scanner heights stay where PadSpan already keeps them, because
  presence uses them; 3D only reads them. Moved here from P5.

## Build plan: how the work runs

**Who builds it.** A fresh session, working from this doc and the PadSpan repo only. The session
that wrote the first draft of this doc, and one of its research agents, read the
room-from-photos engine on 2026-09-30 (the local copy was deleted the same day). Under the
clean-room rule that session does not write the builders, the fit checks, the cut-away or the
camera. Any session building this refuses to open another furniture or room-planner repository,
and says so if asked.

**Order of work.** The switch and the registration come first, so every later phase ships dark.

1. **The switch and the empty store (start of P1). Built 2026-09-30.** `atlas_3d_enabled` and its
   sub-keys in `settings_store.py` and `ws_settings.py`; `house3d_store.py` (`padspan_ha.house3d`,
   loaded only on first use, never written while off) registered for backup, restore, factory reset
   (which empties it but never creates it) and the Bright import; `ws_house3d.py` with
   `house3d_get` and `house3d_clear` (refused while off; backup first); the backup label;
   `tests/test_house3d_store.py`. Changes nothing visible. Left for later phases, with the code
   they guard: the Bright import's furniture count in `target_contents` (P2), the frontend "off"
   tests (P1), the network and telemetry-event "off" tests (P3, P4).
2. **P0 prototype**, in parallel with step 1: a standalone page, never shipped,
   fed by a read-only `model_get` export of Garry's house. It answers the two questions no amount
   of planning can: how the whole-house cut-away should behave with shared interior walls, and
   what the wall PC and a phone can render. Garry looks at it on both before P1 goes further.
   **Built and approved 2026-09-30** (Garry: "Looks nice, keep going"). The page is in
   `prototypes/live_aboard_p0/`; the house export stays out of the repo.
3. **P1 the 3D view**, behind the switch. Garry turns it on in his own Settings; nobody else sees it.
   **Started 2026-09-30** with three.js r170 bundled (`vendor/three/`, `THIRD_PARTY_NOTICES.md`).
   Built in three parts: A, the view itself (the switch, the house, lights, camera, quality and
   fallback, settings, telemetry, the off tests, the sun and the compass, visible only in Pro and
   Bright Pro); B, the Atlas's actions and live parts (doors and sensors, Motion · Air, readouts,
   tap, hold and dim); C, the 3D editor (the door and window line tool, device heights, saved to
   the 3D file).
4. **P2 furniture by hand.** The builders are written from the parameter lists in "Furniture",
   nothing else, each with a still-picture test across its parameter range.
5. **P3 photos**, then **P4 library** (terms reviewed first), **P5 devices**, **P6 beacons and
   people**, **P7 import**, **P8 atmosphere**, in that order, each behind its sub-switch.

**Per phase.** One build from the branch, installed on the home HA, an independent read-only
review of the diff, fixes, then a targeted re-check of the fixes (a full re-review only when a fix
touched shared code). One phase per week or two. A phase that isn't green stays behind the switch; it
never blocks a stable release of the rest of PadSpan.

**Flipping the default.** Only after P1 and P2 have shipped, the load report shows Raspberry Pi
and tablet installs are not hurt, and Garry says so. It is one line and a release note, and can
be flipped back the same way.

**The first three tasks, concretely:**

1. `settings_store.py`: add the five keys to `DEFAULT_SETTINGS` next to the `atlas_weather_*`
   block (line ~134) with `atlas_3d_enabled: False`; `ws_settings.py`: schema entries beside
   line 354 and the bool loop at line ~805; `tests/test_websocket_settings_schema.py` keeps them
   in sync.
2. `const.py`: `HOUSE3D_STORE_KEY` and `DATA_HOUSE3D`; a `House3dStore` wrapped with
   `wrap_store`; `_ensure_stores` in `__init__.py`; `_ALL_STORE_KEYS` and `_DATA_KEY_MAP` in
   `ws_common.py`; the factory-reset block; `HOUSE_STORES` in `bright_import.py` (with the reload
   test first); `manage.js` `_storeLabel`.
3. `tests/test_house3d_store.py`: the registration tests and the five "off" tests, red before the
   code, green after.

## Risks

- **GPU cost on wall tablets.** This is the top risk. Hence the Low profile, the automatic
  fallback and the frame-time check. P0 is tried on the wall PC and a phone before anything ships.
- **Whole-house walls are new code:** shared walls, interior cut rules, floors.
- **Photo reading varies by model.** A small local model may misjudge kind or proportions. The
  schema, clamping, the one real measurement and the sliders afterwards keep a bad read cheap to
  fix. P3 tests on at least one local and one cloud model.
- **The terms are a legal document.** Draft wording is above; it needs review before P4 ships,
  and a terms version bump re-asks everyone.
- **Library quality.** With few users, the library is small and uneven. The starter recipe set
  (made by Garry from his own furniture in P3) covers day one.
- **Data the map doesn't have.** Lights have no mount height, walls no thickness, doors no hinge
  or swing. They come from defaults by shape, overridable in the new file, never in the map.
- **Bundle size.** three.js adds roughly 180 KB compressed (to a 1.97 MB release zip). No textures.
- **three.js version.** Pin the bundled version and test before bumping it.
- **Scope creep.** Every appliance type is its own small feature. P5 goes one type at a time.
- **The people layer** reads the live snapshot, the most expensive thing PadSpan builds (4–8 s on
  a 2,700-object house). It's off by default and never faster than Overview. The load report
  will show if it hurts.

## Decided (Garry, 2026-09-30)

- Clean-room: no ported application code; three.js as a library only.
- Furniture comes from photos read by the customer's own Home Assistant AI Task, into PadSpan's
  own parametric builders. No OpenClaw or other Garry-run service in the loop.
- Pieces people make go into a shared library, under terms users accept.
- Every library piece carries a filled-out details sheet (mostly closed lists, AI-prefilled,
  required fields enforced) so others can search, sort and filter it.
- Beacons, scanners and people can be photographed too and shown on the map; people figures are
  never shared.

## The thirteen choices, decided (Garry, 2026-09-30, by question rounds)

1. **3D view: Pro and Bright Pro only** (Garry, 2026-09-30: "This goes only in pro and bright pro
   as far as visibility goes"; it replaces "Bright + Pro, Free sees a still picture"). Below the
   Pro tier nothing of Live Aboard is visible, exactly as if it were off. The Free still-picture
   teaser is dropped.
2. **Making furniture:** the same gate as light placement, inside the Pro-only feature.
3. **Browsing the library:** anyone who can see Live Aboard (Pro and Bright Pro).
4. **Name:** **Live Aboard** replaces "Sims Soup". Still a working name; check it before anything public.
5. **Library licence:** a licence grant to PadSpan only, not CC0. Sharers keep their rights;
   PadSpan, every edition, may use, show, copy and change shared pieces and let other PadSpan
   users place them; nobody gets a licence outside PadSpan. The terms above say so; the lawyer
   review covers it.
6. **Terms:** required to make furniture, not to view 3D or browse.
7. **Free text:** title, brand and model as written, and the details sheet must carry the
   structured, filterable fields Garry named: type (the kind), use (the rooms it suits),
   modular/sectional and the other features. They are in the sheet already; this makes them a
   requirement.
8. **Cloud AI for furniture photos:** allowed, with the note saying which AI Task reads the photo.
9. **Size from a photo:** a real measurement is the normal path. The AI's own size is accepted
   only when it reports high confidence, which means a known-size object was in the shot (a door
   frame, a tape measure); otherwise the person types one number or drags an edge before saving.
10. **People figures:** stylised only, never a likeness.
11. **Phase order:** devices before people: P4 library → P5 devices → P6 beacons, scanners and
    people → P7 import → P8 atmosphere.
12. **Default flips on:** after P1 and P2 have shipped and the load report shows Pi and tablet
    installs cope, on Garry's word.
13. **Starter builders:** sofa, bed, table, chair, desk, dresser/cabinet, TV + media unit, lamp.

Assumed, not asked: off by default with all sub-switches off; ships dark; its own storage file
that never touches the map; clean-room code; people figures never shared; a lawyer reviews the
terms before the library ships.

P0, the prototype of Garry's house, was built and approved on 2026-09-30; P1 is under way.
