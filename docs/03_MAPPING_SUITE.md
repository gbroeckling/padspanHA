# Mapping Suite

## The one rule

**The metric fabric is the truth.** Room shapes, scanner positions, RF barriers,
beacon pins and light positions live in **metres**, in the FabricStore
(`.storage/padspan_ha.fabric`). A floor-plan photo is used to *trace* a
building once and to *look at* afterwards. No operational code may derive a
position from a photo, a photo's pixel size, a map's 0–1 fraction space, a map
id, or a per-photo transform.

`tests/test_photo_divorce.py` enforces this and fails the build if a new file
breaks it. Three files remain quarantined (`calibration.js`, `traceback.js`,
`radio_map.js`) and the guard fails if that list goes stale in either
direction — a file that stops offending must be removed from it.

## Stores, and who owns what

| Store | File | Owns |
|---|---|---|
| FabricStore | `padspan_ha.fabric` | room geometry (m), scanner/beacon/light positions (m), RF barriers (m) |
| ModelStore | `padspan_ha.model` | floors, room metadata, adjacency, scanner room/floor assignment, map transforms |
| MapsStore | `padspan_ha.maps` | the photos and their metadata |

The split matters. A handler that edits `mdl.data` directly will silently miss
whatever has since moved to the fabric — that is what made **delete room** do
nothing for months: it cleared `room_meta`, adjacency and the scanner map, and
left `room_geometry_m` intact, so the room kept its shape and went on drawing
and voting. Every write now goes through a store method
(`ModelStore.async_remove_room`, `FabricStore.async_remove_room`, …), never
through the blob.

## Tools

**Rooms** — draw, correct, move, scale, rotate, delete. Deleting removes
geometry, metadata, adjacency and any scanner assigned to it, in one call.

**Scanners** — place in metres, set mounting height (`z_m`, measured from that
scanner's own floor, never absolute), mark lost/disabled, resync from HA.

**Barriers** — RF attenuation walls in metres, with a material and a dB value.

**Lights** — placement is a PadSpan Pro feature; shapes and codes render from
the fabric.

**Measure** — the reference distance that anchors a photo to metres. A map with
no reference measurement has no scale, and calibration points captured on it
are stored without a position.

**Floor heights** — level, floor-to-floor, and base elevation per floor. See
below; this is more load-bearing than it looks.

## Floors

The building's floors come from the **HA floor registry**. `ModelStore` keeps a
persisted copy because the positioning side reads it:

- `floor_stack_index()` → the slab number of each floor. The **difference**
  between two floors is how many slabs an RF path crosses, which drives the
  10 dB-per-slab cross-floor penalty.
- `floor_base_elevations_m()` → each floor's walking surface, which sets every
  scanner's absolute height and the device height used for slant correction.

Ordering, in priority: an explicit `level`, then the floor id's conventional
meaning (`basement` −1, `main`/`ground` 0, `upper` 1, `attic` 3, and outdoors at
0), then stored order. Floors sharing a storey share a slab index and a base
elevation — the garden and the ground floor are both at zero.

**Fill in Floor Heights.** With no `floor_to_floor_m` the code substitutes
`DEFAULT_FLOOR_TO_FLOOR_M = 2.8 m` for every storey, and that number reaches
the 3D distance maths.

### The bug this replaced (2026-08-16)

`ModelStore.data["floors"]` was never synced from the HA registry. The panel
looked right because `ws_model_get` reads the registry live *for display* — but
that read was never persisted, so positioning found the single synthetic `main`
entry the store is created with and ran every multi-floor house as one storey.
`_slabs_crossed` then took its "unknown stacking" branch for every cross-floor
path, so a basement scanner and an upstairs scanner were penalised identically.

Measured on a real three-storey install: **2,886,899 confirmed cross-floor room
changes**, split 1,093,120 / 1,062,985 between the two directions. A near-perfect
symmetry is oscillation, not movement.

The coordinator now syncs floors from the registry each poll (idempotent —
it only writes when the set changed) and stored heights always win over the
registry's.

**This was necessary but is not sufficient.** Measured again after the fix, on
the same install: **9.7 floor changes per minute, ~14,000/day** across 43
tracked devices. Correct slab counting restores the cross-floor penalty's
ability to discriminate; it does not by itself stop the flipping. The remaining
work is in floor *selection* — `_best_floor` picks one floor per poll from the
mean of the strongest two signals plus a +4 dB current-floor bonus, with no
hypothesis retained for the runner-up, so a bad pick is self-reinforcing.

`floor_stack_index` returning `{main: 0}` is also why "Cross-Floor Attenuation:
12/12 pairs ready" could report learned per-pair values that nothing could act
on. Treat any learned attenuation gathered before this fix as suspect.

## Overview rendering

`fabricFrame()` in `views/iso_lights.js` projects the fabric into the isometric
view. Two rules it now keeps, both learned the hard way:

- **One building, one origin.** Every floor shares the same metre origin. It
  used to re-centre each floor on its own bounding box, which sheared the stack:
  walls met at different angles on different storeys and set-back floors read as
  boxes in the wrong place.
- **Fit to the drawing, not the box.** Scale and centring come from the
  projected extent of the rooms, not from the bounding diamond of the metre
  bbox. A building never fills its diamond.

The floor slab is the union of the floor's room footprints, not the bounding
rectangle around them — that was 1.7–2.5× the real floor area on a house with a
stairwell void or one outlying room.

### Storeys come from the fabric, and so does everything on them

`views/overview.js` iterates `fabricFrame().levels` — one storey per distinct
height the fabric's rooms occupy. It used to iterate the z-levels the uploaded
photographs were grouped at, so a floor that had rooms but no picture drew
nothing, and neither did anything on it. Per storey the loop draws, from the
fabric only: the rooms (`room_geometry_m`), the walls (`rf_barriers_m`, once per
storey — per photo drew every wall twice on a floor traced from two pictures),
and the scanners (`scanner_positions_m`; a radio placed in metres but never
pinned on a picture had no marker before). A scanner's "Area" in its tooltip is
which room polygon contains it.

The **heat and warp overlays** (`radio_map.js isoStoreyHeatmapSVG` /
`isoStoreyDistortionSVG`) take a *storey* the overview resolves from the fabric
— `{z, rooms, scanners, barriers, calPoints}`, all in metres, scanners carrying
their vertical offset from a device on that storey and how many storeys away
they are — and size their grid from the storey's rooms. They used to take the
photographs at a level plus a per-photo pixel transform and size the grid from
the corners of the pictures; once indoor plans stopped carrying a pixel
transform the extent was empty and both overlays silently drew nothing. Every
storey is coloured on one shared scale (`isoStoreyRssiRange` unioned across
storeys) so a badly covered floor cannot look green by being scaled to itself.

**The server places things; the map draws.** An object is drawn at the server's
`x_m/y_m` on the storey the server put it (`floor_id`, or the floor of its room
when the solver had nothing this poll), else at its room's centroid, else not
at all. The client-side fingerprint match and the RSSI-weighted centroid of
scanner *screen* positions that used to fill in behind the server were two more
opinions on where a beacon is, in a spot no other view agreed with. Gone.

### Annotations read at one size, wherever the map is hosted

Labels, markers, badges and the legend are drawn in svg units and the frame is
fitted to the building, so a tighter frame or a wider panel would scale every
one of them. Each annotation group is scaled about its own anchor by one
factor — designed-px-per-unit (0.84) over actual-px-per-unit, never above 1 —
substituted when the svg is composed (`_finishIso`), so it does not depend on
what was drawn before what. The factor is published on the root as
`data-ann-k` and every group carries `data-ann="x y"`; **that is the contract
Pure Live's zoom composes with** (`_counterScaleSVG` sets `k / zoom` about the
anchor). Overwriting the transform with `scale(1/zoom)` discarded k and brought
the giant labels back the moment the map was zoomed or rebuilt. Rings that
belong to a marker live *inside* its group. A container width change rebuilds
the svg in place, in whichever view holds it.

### Walls

A wall (`rf_barriers_m`) is a fabric object with an **id**, a name, a material,
an attenuation and `points_m`, on a floor. It is placed and edited in metres:
the Rooms tab drags and deletes walls directly; the Edit tab is where you
*draw* one on a photo, and the drawn points go through that map's metre
transform (`mapFracToMetres`, mirroring `ModelStore.map_frac_to_metres`) into
the fabric the moment you finish — the photo is the input surface, never the
record. The walls the Edit tab shows are the fabric's, projected back onto the
picture (`metresToMapFrac`); a map with no metre transform can show or take no
walls, and says so.

There is no per-photo list of walls any more. There used to be (`rf_barriers`
on the map, matched by name, named "Barrier {n}" by list position); positioning
never read it, two floors' "Barrier 1" replaced each other, and the 2D radio
map read walls off the picture. `fabricWorldBarriers()` in `stack_transform.js`
hands the fabric's walls to the 2D floor views in their world frame, next to
the scanner conversion, so a wall and the scanner beside it go through the
same numbers.

## Storage paths

- Photos: `/config/www/padspan_ha/maps/<map_id>.png`
- Map metadata: `.storage/padspan_ha.maps`
- Fabric: `.storage/padspan_ha.fabric`
- Model: `.storage/padspan_ha.model`
