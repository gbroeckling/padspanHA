# Live Aboard: what's next, and what needs Garry's call (2026-10-15)

Written while Garry was away (Oct 15 – early Nov). Everything below was looked at against the
most popular 3D floorplans people use with Home Assistant, mainly
[neonplan3d](https://github.com/Mastershort/neonplan3d/wiki) (~770 stars, in HACS), plus the
[physics-lighting card](https://community.home-assistant.io/t/ready-made-3d-floorplan-for-home-assistant-physics-based-lighting-fully-offline-no-extra-tools/1012715),
[floor3d-card](https://github.com/adizanni/floor3d-card),
[lukevink's 3DHome](https://github.com/lukevink/3DHome) and
[SmartThings Map View](https://www.smartthings.com/map-view).

## Already shipped from that list

| Idea (where it came from) | Version |
|---|---|
| Motion that reads at a glance: only "now" is lit, drop lines to the floor, rooms tinted not flooded | 0.38.126 |
| A hovered raised device drops a line to its spot; Heights spots and height guide | 0.38.126 |
| Explode: floors pulled apart (neonplan3d) | 0.38.127 |
| Heat map with Temps picked (neonplan3d's climate view) | 0.38.127 |
| Window open in the rain alert (neonplan3d) | 0.38.127 |
| The room sheet's own scenes and scripts as ▶ buttons (neonplan3d's room panel) | 0.38.128 |
| Lit windows glowing at night from outside (The Sims) | 0.38.128 |
| Going back to the home view after a while untouched (neonplan3d's kiosk) | already there |

## Needs a decision

1. **Blinds and shades that follow their position.** neonplan3d draws blinds at the cover's real
   position. Live Aboard can drive a door from a cover, but a window can't be linked to one. Doing
   it means a new key in the 3D file (`openings[<id>].blind`: a cover's entity id), the window
   sheet's picker, and `ws_house3d` accepting it. Additive, but it's a stored format, so it's yours
   to say yes to.
2. **Smoke, gas and CO alarms on the map.** The Emergency class is water leaks only
   (`isFloodSensor`: `moisture`). neonplan3d's pulsing alerts cover smoke, gas, CO and alarms too.
   Either a new class (its own glyph, code letter, chip and report bucket) or widen Emergency; the
   leak's "WET" word and water ripples would need a smoke/alarm look of their own.
3. **Floor and wall materials.** Rooms are flat colours. The Sims look is wood, tile and carpet on
   the floors and paint on the walls. That's a big look change and a per-room setting; worth
   trying as a Showcase look first.
4. **Room names under device chips on the flat Atlas** ("Hall" under A02 and a motion ring).
   Widening the name's collision window fixes it but breaks two deliberate rules from the
   2026-09-12 audit (the window is the name's own width; a plain marker at that distance must not
   move a name). Needs a look at Garry's own house before choosing.
5. **A slow orbit while a wall screen is idle** (neonplan3d's kiosk). Costs frames all the time,
   which Live Aboard has avoided so far ("nothing moving, nothing drawn"). Probably no, unless it's
   an opt-in for mains-powered wall PCs.
6. **Perspective-correct centring.** "Whole house" centres the house by its flat extent; the near
   corners draw bigger, so on a phone it can sit a little to one side. A correction pass was tried
   and reverted (it moved the camera's target, which Find and saved views rely on).

## To check on the real house (nothing else can)

- 0.38.126: motion badges and drop lines, the hover line, Heights spots, codes stepping aside.
- 0.38.127: Explode on a real multi-floor house (stairs keep their real height), the heat map, the
  rain alert with a real weather entity.
- 0.38.128: the room sheet's scenes, lit windows at night with real windows on the front walls.
- The opt-in report's `temp_fresh` and `client_dev:lastrep_*` (does the panel see `last_reported`?).
