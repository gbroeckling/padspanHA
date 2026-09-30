# Idea: the 3D house (a Sims-style Atlas) and furniture

Planned 2026-09-30. Status: **plan only — nothing built yet.** Four decisions for Garry are at the end.

Inspiration: u/spongebob_za's "I built a 3D Sims style dashboard of my whole house"
(r/homeassistant, 1wtyklm, 2026-09-30): a hand-built three.js model of one house, walls
cutting away like The Sims, lights you tap, appliances that move. That build was made by hand
for one house. The idea here is to make it for **every** PadSpan house, from the map people
already drew, with no modelling.

## What it is

A **3D view of the house you already mapped**, next to the flat Atlas. The floors are stacked at
their real heights. The walls stand up, and the ones facing you cut away so you can see in. Every
light glows in its real colour, and doors swing open with their sensors. You tap and hold things
exactly as you do on the Atlas.

**Furniture is optional.** A new **Furnish** tab in Mapping lets people drop in beds, sofas,
lamps and a TV from a catalogue, drag and turn them, and check they fit. Any piece can **be a
device**: a floor lamp that is `light.lounge_lamp` glows when that light is on, and tapping it
switches it.

## Principles

1. **Nothing to redraw.** Floors, rooms, walls, doors and windows, lights and sensors all come
   from the existing map. A house that works in the Atlas works in 3D on day one.
2. **The flat Atlas stays exactly as it is.** 3D is a separate view, never a replacement. The flat
   drawing stays byte-identical whether 3D is on or off, and Overview stays SVG. (This follows
   the roadmap's own call: "Stays pure-SVG, no WebGL, as scoped",
   `BEST_IN_CLASS_ROADMAP.md:395-407`.)
3. **Everything is reversible.** The feature is off by default and sits in its own storage file.
   It never writes to the map, the rooms, the walls or the light positions. See "Undoing it".
4. **Nothing extra on Home Assistant.** It all runs in the browser. The one exception, the
   optional people layer, reads the same live snapshot Overview already uses, no more often.
5. **Wall tablets fall back quietly.** No WebGL, a slow GPU, or any error means the flat Atlas,
   never a blank panel.

## Where it lives

| Place | What's there |
|---|---|
| **Atlas** (sidebar, and Mapping → Atlas) | A **Map / 3D** switch beside the zoom buttons (`lights_map.js:3259-3290`), and in the rail for the edge-to-edge layout (`lights_map.js:3601`). Each screen remembers its choice, so the wall PC can open in 3D. |
| **Mapping → Furnish** (new tab after Atlas, `maps.js:109-111`) | The furniture editor: the 3D house and a plan view side by side, the catalogue, drag and turn, fit checks, colours, "This is a device…", then Save, Discard and Undo. |
| **Settings → UI Structure → Atlas → 3D house** | On/off (off by default), Quality (Auto / Low / High), Show people, and Remove all furniture (admin only; takes a backup first). |
| Overview, Traceback | Unchanged. |

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
| Emergency lighting button | Unchanged: it is HTML above the stage. Phase 3 also outlines the emergency lights in 3D while a test runs. |
| Outdoor weather (`atlas_weather.js`) | The same decision (`decideAtlasWeather`, the same settings), drawn as rain or snow falling outside the walls. A snowfall warning puts snow on decks and roofs. |
| Showcase styles (19 themes) | Phase 5: each theme's colours become 3D lighting and material presets. Automorph stays 2D-only. |
| Tracked people, phones and tags (Overview's live snapshot) | Optional **people layer**, off by default: soft markers at their positions. |
| Sweet Home 3D import (`sh3d_import.py`, rooms only today) | Phase 4: also imports its furniture, doors and windows as candidates you preview and then commit. |

**Taps and holds are identical.** A 3D pick resolves to an entity id and calls the same actions
the Atlas uses (`_useApi` at `lights_panel.js:666-690`, `previewApi` at `maps.js:8686-8703`,
`createHoldTracker`). Tap toggles. Hold opens controls. Hold and drag dims. A room name opens the
room sheet, a floor badge the floor sheet, a door the barrier card, and a motion sensor its
activity calendar. The hover HUD and press ring are SVG-only and get 3D equivalents.

## Furniture

- **Catalogue:** the 22 builders from room-from-photos (bed, crib, sofa, armchair, lounge chair,
  chair, table in its variants, desk, dresser, nightstand, wardrobe, bookshelf, media console + TV,
  rug, ottoman, box, pet bed, plant stands, floor lamps, plants, art, fireplace), in real sizes
  with their variants. PadSpan adds device pieces in Phase 3: washer, dryer, robot vacuum dock,
  mower dock, car and charger, radiator or heater, fan, speaker.
- **Placing:** drag and turn in 15° steps, in 3D or on the plan. It snaps to walls at any angle,
  where the source snaps only to square walls. The fit checks are ported: into a wall,
  overlapping, in a door's swing, blocking a front or a bed side, tall in front of a window.
  They run against PadSpan's own walls and doors.
- **As a device:** "This is a device…" binds a piece to an entity. A lamp glows with its light,
  a TV lights with its media player, a fan spins. A piece bound to a light that is also placed
  on the map replaces that light's marker **in 3D only**; the light's stored position is not
  touched.
- **Renames:** a binding keeps both the entity id and the entity-registry id and re-resolves on
  rename (the WLED looks already do this, `wled_exact.py:107-115`). A deleted entity shows the
  piece as unlinked. A piece is never deleted on its own.
- **Rooms:** a piece stores its floor and x/y, never a room name. Rooms are keyed by name and can
  be renamed or deleted, so a piece's room is worked out when it's read.

## Engine, and credit

- **three.js**, MIT, bundled with PadSpan (`www/padspan-ha/vendor/three/`), never from a CDN.
  Home Assistant can run offline, and the wall kiosk shouldn't depend on the internet.
- **Ported from room-from-photos** (github.com/SkylarKitchen/skills, `skills/design/room-from-photos`;
  MIT, "Copyright (c) 2026 Skylar Kitchen"):
  - **Nearly as-is:**
    - the 22 builders and their helpers (`part`, `cyl`, `boxUV`, `edgesOf`, `arcLamp`, `topOf`);
    - the 2D geometry and overlap maths;
    - the finishes and materials;
    - `paintGroup` and `lampGlow` (without the mirror);
    - the contact shadows;
    - the catalogue data;
    - its audit, kept as a developer test.
  - **Adapted:**
    - the fit checks, to take a room context;
    - openings, taken from PadSpan;
    - the camera: touch orbit, pinching about the midpoint, and a two-finger pan, none of which
      the source has;
    - the render loop, so it stops while the panel is hidden;
    - state kept in Home Assistant instead of the browser;
    - thumbnails rendered ahead of time;
    - the colour pickers in PadSpan's own UI.
  - **Rewritten:**
    - walls and cut-aways for a whole house (the source is one room): shared walls built once,
      no fake "next room" passage, a rule for interior walls, and grouping by floor;
    - wall snapping at any angle.
  - **Dropped:** photo matching and grading, its plan canvas (the Atlas covers that), its CONFIG
    and options, "Copy for Claude", its debug tools, and the mirror.
- **Units:** the builders stay in inches internally, as tuned. A thin wrapper converts the metre
  spec on the way in and scales each group by 0.0254 on the way out. Light intensity needs the
  matching factor, about 1/1550.
- **Credit, in five places:**
  1. a header on every ported file: "Adapted from room-from-photos by Skylar Kitchen, MIT,
     github.com/SkylarKitchen/skills — see THIRD_PARTY_NOTICES.md";
  2. `THIRD_PARTY_NOTICES.md`, with the full MIT text for three.js and room-from-photos;
  3. a README credits section;
  4. Settings → About;
  5. the release notes.

  The textures are ambientCG CC0 scans. No attribution is required, but they're credited anyway,
  and so is the Reddit post that inspired this. MIT code can go into PadSpan's GPL-3.0 as long
  as the notice travels with it.
- **Two quality profiles.** Auto picks one from WebGL support and a short frame-time check.

  | | Tablet (Low) | Desktop (High) |
  |---|---|---|
  | Post-processing | none | ambient occlusion, as the source |
  | Shadows | contact shadows only | one 2048 soft sun shadow |
  | Materials | standard | the source's physical ones |
  | Window lights | none | area lights |
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
 "pieces":  {"fur_1a2b3c4d": {"id": "fur_1a2b3c4d", "kind": "sofa", "variant": "", "label": "",
              "floor_id": "main", "x_m": 3.412, "y_m": 1.25, "z_m": 0.0, "rotation": 90.0,
              "width_m": 2.2, "depth_m": 0.9, "height_m": 0.8, "colors": {},
              "entity_id": null, "entity_reg_id": null, "source": "user", "updated_at": "…"}},
 "lights":   {"light.lounge": {"z_m": 1.55}},                         # 3D-only mount heights
 "openings": {"<barrier id>": {"hinge": "left", "swing": "in", "sill_m": 0.9, "head_m": 2.1}}}
```

- The conventions match PadSpan's: fabric metres, a floor per piece, `z_m` above its own floor
  (as scanners have), `rotation` in degrees (as light pins have).
- `lights` and `openings` hold what the 3D view needs but the map doesn't have: a light's mount
  height (the default comes from its shape) and a door's hinge and swing (default left and in).
  Keeping them here means **the map data is never modified.**
- Reading is tolerant. Unknown keys and kinds are kept. A floor that no longer exists is accepted.
- **Websocket commands** (`ws_house3d.py`):

  | Command | Who | Notes |
  |---|---|---|
  | `house3d_get` | any user | |
  | `house3d_piece_set` | same gate as light placement | |
  | `house3d_piece_remove` | same gate as light placement | |
  | `house3d_light_set` / `house3d_opening_set` | same gate as light placement | |
  | `house3d_clear` | admin | takes `_auto_backup(…, [HOUSE3D_STORE_KEY])` first |

- **Settings:** `atlas_3d_enabled` (off), `atlas_3d_quality` (`auto`), `atlas_3d_people` (off).
  Unknown settings keys survive a downgrade.

**Everywhere it must be registered** (the checklist, so nothing is half-wired):

1. `const.py`: the key and a `DATA_` slot. The Bright build renames it automatically.
2. The store: wrapped with `wrap_store`, with a public `.data`.
3. `__init__.py`: `_ensure_stores`.
4. `ws_common.py`: `_ALL_STORE_KEYS` and `_DATA_KEY_MAP`, which gives backup and restore.
5. `ws_factory_reset.py`: an explicit block that empties it.
6. `bright_import.py`: `HOUSE_STORES`, plus a count in `target_contents`. First add a test for
   the suspected existing bug: the "reload re-reads the stores" step appears not to re-read, as
   `async_unload_entry` keeps the stores in memory.
7. `manage.js` `_storeLabel`: "3D house".
8. Settings, with schema entries and validators (the `atlas_weather_*` keys are the pattern).
9. Telemetry, as below.
10. Tests, as in each phase.

## Telemetry (only if the report is on; words from a closed list)

- **Events:**
  - `house3d_opened`
  - `house3d_fallback:{no_webgl, slow_gpu, context_lost, error}`
  - `furnish_opened`
  - `furniture_placed`, `furniture_removed`, `furniture_bound`
  - `sh3d_furniture_imported`
- **Under `env.house3d`:** the number of pieces and of bound pieces, as buckets.
- **Errors:** every new view file goes in `UI_ERROR_HELPERS`, so a crash is credited to the right
  module.
- **Load:** the load report shipped in 0.38.91 shows whether the people layer costs Home
  Assistant anything.

## Undoing it

| To undo | How |
|---|---|
| Turn it off | Settings → 3D house off. The Atlas is exactly as today, and a test proves the flat drawing is byte-identical. |
| One edit | The Furnish tab works in a draft with Undo/Redo and Discard, like light placement. Nothing is stored until Save. |
| All furniture | "Remove all furniture" (admin) takes a backup first, then empties the file. Restoring that backup brings it all back. |
| A downgrade | Older PadSpan versions ignore the file and the settings keys (restore tolerates unknown stores; settings keep unknown keys). Upgrading again brings the furniture back. |
| A backup restore | Backups include the file. Restoring an older backup that has no furniture leaves the current furniture alone (tested). |
| Factory reset | Empties it. Known gap: a factory reset on an older version won't know the file, so the furniture reappears after upgrading. Tolerant floor handling keeps that harmless. |
| Remove PadSpan | Delete `/config/.storage/padspan_ha.house3d`; the bundled files leave with the integration. |
| The code | Each phase is its own release. New files, plus a short list of hooks in existing files (the switch, the tab, the settings rows, the registration lines above), each named in its release notes. Reverting a phase's commits restores the previous release exactly. |

**The invariant, enforced by tests:** the feature never writes fabric, model, maps or light
positions, and neither the flat Atlas nor the presence engine reads the new file.

## Phases

Each phase is a pre-release installed on the home HA and reviewed, with a re-review of every fix
round, before the next one starts. Sizes compare with the Atlas weather feature (one module plus
settings and telemetry, released as 0.38.91).

| Phase | What | Size | Done when |
|---|---|---|---|
| **P0 Prototype** | A standalone page, not shipped, built from a read-only export of Garry's real house (`model_get`), the ported builders, the whole-house shell with cut-away, and a few pieces. Tried on the wall PC and a phone. | about 1× | Garry says go, or changes the direction. |
| **P1 The 3D view** | The Map / 3D switch; floors, rooms, walls, doors and windows; lights with live glow; Motion · Air tints; readouts; tap, hold and dim; floor chips; touch camera; quality profiles and fallback; settings; telemetry. | about 3× | The house draws from existing data with no setup. Every Atlas action works in 3D. The flat Atlas is byte-identical. A forced WebGL failure shows the flat Atlas. |
| **P2 Furniture** | The store, its commands and full registration; the Furnish tab; the 22-piece catalogue; drag and turn with snapping; fit checks against PadSpan walls and doors; colours; Undo, Save and Discard; Remove all with a backup. | about 2× | The registration tests pass (backup, restore without furniture, factory reset, Bright import, unknown keys, store version 1). Editing furniture changes no other file. |
| **P3 Devices as furniture** | Binding, with rename re-resolve and unlinked badges; lamps, TV, fan; washer and dryer running; vacuum and mower docks, animated while running (they rarely report where they are); radiators; car and charger; per-light heights; emergency lights outlined during a test. | 1–2×, one device type at a time | Each device type has a live-state test and a still picture. |
| **P4 Import and share** | Sweet Home 3D furniture, doors and windows (`<pieceOfFurniture>`, `<doorOrWindow>`) as candidates you preview and commit into the new file only; furniture JSON export and import. | about 1× | A real `.sh3d` imports. Declining the preview writes nothing. |
| **P5 Atmosphere** | Rain and snow in 3D; day and night from `sun.sun`; Showcase themes as 3D presets; the CC0 textures on High (about 0.9 MB); the optional people layer. | 1–2× | Each item can be switched off on its own. |

## Risks

- **GPU cost on wall tablets.** This is the top risk. Hence the Low profile, the automatic
  fallback and the frame-time check. P0 is tried on the wall PC and a phone before anything ships.
- **Whole-house walls are new code**, not a port: shared walls, interior cut rules, floors.
- **Data the map doesn't have.** Lights have no mount height, walls no thickness, doors no hinge
  or swing. They come from defaults by shape, overridable in the new file, never in the map.
- **Bundle size.** three.js adds roughly 180 KB compressed (to a 1.97 MB release zip); the
  textures add about 0.9 MB, only in P5.
- **three.js version.** The ported gizmo code expects r162, and later releases may change
  TransformControls. Pin the bundled version and test before bumping it.
- **Scope creep.** Every appliance type is its own small feature. P3 goes one type at a time.
- **The people layer** reads the live snapshot, the most expensive thing PadSpan builds (4–8 s on
  a 2,700-object house). It's off by default and never faster than Overview. The load report
  will show if it hurts.

## Decisions for Garry

1. **Who gets it:** my recommendation is anyone with the Atlas (Bright and Pro), with Free seeing
   a still picture of their own house in 3D beside the 90-day trial offer. The alternative is Pro
   only.
2. **Off by default:** recommended.
3. **The storage file and its shape.** This locks in `padspan_ha.house3d` and the schema above:
   metres, pieces keyed by id, a floor per piece, no room names. Still want to proceed?
4. **People in 3D:** soft markers (recommended) or little figures, and off by default.

Then P0: a prototype of **your** house, to try on the wall PC before any PadSpan code changes.
