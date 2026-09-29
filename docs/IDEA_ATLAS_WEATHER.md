# Idea: Atlas outdoor weather (rain and snow outside the floor boundary)

Specced 2026-09-29 in a Claude mobile session (engram #1385, topic `atlas/outdoor-weather`).
Rebuilt here from that session's resume prompt and prototype, because the mobile session
could not push. Prototype: `docs/IDEA_ATLAS_WEATHER_PROTOTYPE.html`
(live copy: https://claude.ai/artifact/DvwoRU4KTKYoJYGBqR5um4). The prototype is a mock,
not Atlas code, but its overlay, mask generator and tile code are meant to be ported.

## What it is

Subtle rain or snow drawn **everywhere outside the floor boundary** in the Atlas (the iso
map): the whole view except the floor plates. It never falls over a room. On the wall panel
it shows at a glance what the weather is doing outside.

## Garry's decisions (final)

1. **Area:** everything not inside a floor plate (slab tops and sides of every floor). Not a band.
2. **Editions:** Pro animates it. Free gets **no animation**, only the same weather as a still
   texture (frozen layers, no ripples, no motion of any kind).
3. A **master on/off** setting in both editions. Off = emit nothing.
4. **Trigger:** the rain sensor.
5. The rain sensor alone **only ever shows LIGHT rain**. It turns HEAVY only with outside
   confirmation: a rainfall warning, or the weather entity reporting `pouring`. Snow turns
   heavy only on a snowfall warning (HA has no heavy-snow condition).
6. Most clients are **not in Canada**, so every source needs a fallback.
7. Keep it **subtle**.

## Decision rules

| Input | Result |
|---|---|
| Setting off | Nothing rendered, whatever the sensors say |
| Rain sensor set, reading dry | Off (2.5 s fade-out) |
| No rain sensor set | Wet = weather condition in {rainy, pouring, snowy, snowy-rainy, hail, lightning-rainy} |
| Wet, alone | Light rain |
| Wet + rainfall warning, or condition `pouring` | Heavy rain |
| Wet + condition snowy / snowy-rainy, or ≤ 1 °C | Light snow |
| Wet + snowfall warning | Heavy snow + edge rim (the warning forces snow) |

## Sources and fallbacks

- **Rain sensor:** most installs have none. Optional.
- **Weather entity:** nearly every install has one, because onboarding creates Met.no
  `weather.forecast_home`. Default to the first `weather.*` found. It is the fallback trigger
  and the rain-vs-snow source.
- **Warnings** (optional, auto-detect):
  - Core integrations: Environment Canada (`env_canada`), MeteoAlarm (EU), DWD + NINA (DE),
    Météo-France.
  - USA: core NWS has **no** alerts; only the custom `weatheralerts` / `nws_alerts` integrations.
  - UK, Australia: nothing standard.
  - Match rain / rainfall / snow / snowfall in the alert text, case-insensitive.
  - With no warning source, `pouring` is the only heavy-rain signal.

## Settings (Atlas, both editions)

Follow the `overview_show_outdoor` pattern (settings_store.py, overview.js).

- `atlas_weather_enabled`: master on/off.
- `atlas_weather_rain_entity`: optional; a binary_sensor, or numeric where > 0 = wet.
- `atlas_weather_condition_entity`: default = first `weather.*`.
- `atlas_weather_warning_entity`: optional; auto-detect from the list above.
- `atlas_weather_strength`: 0.5×–1.5× opacity, default 1.

## The look

- **Light rain:** one sparse, short, slow, faint layer (max ~11% white), near-vertical (3°),
  ~4 ripples at a time. Reads as drizzle.
- **Heavy rain:** dense far sheet + mid layer + long near streaks (up to ~24%), all faster,
  17° wind, ~20 ripples, faint cool haze at the edges.
- **Streaks:** 1 px, gradient from 0 up to the max, no drop heads.
- **Ripples (Pro only):** faint 2:1 iso ellipses on the ground outside, repositioned on each
  `animationiteration`.
- **Snow:** soft baked-blur flakes, slow fall, gentle sideways sway. 2 layers light, 4 heavy.
  On a snowfall warning a pale rim builds along the OUTSIDE of the plate edges over ~8 s.
- A 3 px feathered gap at every wall.
- Intensity changes never change animation speed (that jumps). Heavier = extra layers fading
  in; wind angle eases over 6 s.
- Colour comes from each Showcase theme's `washStops` colour (`#fff` for Classic, `#dceeff`
  for Cinematic Glass).

## How to build it

1. An **HTML overlay above the Atlas SVG**, not inside it. Atlas rebuilds its SVG string every
   poll (iso_lights.js ~L2892); the overlay keeps animating through rebuilds.
2. Clip it with CSS `mask-image`: an SVG data URI with the same viewBox as the map. It **must
   be an ALPHA mask**: an inner SVG `<mask>` leaving the image opaque everywhere and
   transparent over the slab tops and sides of every floor (feMorphology dilate 2 px, then
   feGaussianBlur 2 px). A plain black-and-white image does **not** clip, because both
   colours are opaque; this broke the first prototype. Don't rely on `mask-mode:luminance`
   (older wall-tablet WebViews). Regenerate the mask only when geometry or viewBox changes.
3. Particles are repeating tile images, generated once from a seed and animated with
   `transform` only (compositor-friendly; **no requestAnimationFrame loop**). Each layer sits
   at `top:-tileH` and loops `translateY(tileH)`, which is seamless. A tilt wrapper rotates
   the whole field for wind.
4. The Free edition and `prefers-reduced-motion` share one class: `animation:none`, ripples
   hidden.
5. **Showcase byte-identical contract** (iso_lights.js ~L93): with the feature off, the SVG
   output must not change. The overlay lives outside the SVG, so this is easy.

## Where in the code

- `custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js`: Showcase renderer ~L2588
  (`opts.showcase`, `SHOWCASE_THEMES`); outdoor sentinel `__outside__` ~L2113–2170.
- Licence check: the same way Placement / Automorph / Showcase do it. It decides animate vs still.

## Tasks, in order

1. Port the prototype's overlay + mask generator into the Atlas (Classic), rain first, with the
   Pro/Free animate-vs-still switch from day one.
2. Light vs heavy rain with the rules above, including the fallbacks.
3. Snow + rim, the warning boost, and warning-source auto-detect.
4. Settings (all 5 keys) + per-theme colour.
5. Test on the wall panel and a phone; CHANGELOG + ATLAS_GUIDE.md entry.
6. Save progress and decisions to engram (padspanha).

## Open questions for Garry

- Scale light rain with rain rate when the sensor is numeric? (Current answer: no, the sensor
  only ever means light.)
- Does rain fall over outdoor-gear plates (shed, driveway)?
