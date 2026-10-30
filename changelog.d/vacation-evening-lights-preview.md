# Vacation Mode: evening lights, a limit on lights at once, and a preview

### New
- **Evening lights.** In Vacation Mode's Options you can tick up to 10 lights, like a porch or hall light, to stay on from dark until your bedtime (about 11 pm if no bedtime is set, give or take 20 minutes each night). Dark follows the after-dark offset and needs Home Assistant's sun times. If one is turned off during the evening, it comes back on within 5 minutes, like the routine's lights. After bedtime they follow the routine again, and one you turn on by hand then is left alone.
- **Most lights on at once.** An option to cap how many lights the routine has on at the same time. Lights it already has on stay on, and the others wait their turn. Evening lights and lights turned on by hand don't count, and the cap never turns those off.
- **Preview.** "Show the next 24 hours" in Vacation Mode's Options lists which lights it would turn on and when, using your current options. It works before you turn Vacation Mode on, and it doesn't switch or save anything.
- All three are off until you set them, and Vacation Mode works exactly as before until then. `binary_sensor.padspan_vacation_mode` now also shows `max_lights_at_once` and `anchor_lights`.

### Opt-in report
- The Vacation Mode section says yes or no for whether the light cap and evening lights are set. It never includes which lights.
- New counts: the cap holding a light off (once a day), an evening light turned on (once a day), and the preview opened, counted separately when it had nothing to show.
