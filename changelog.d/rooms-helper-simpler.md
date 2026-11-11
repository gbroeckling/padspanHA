# Let Claude draw your rooms: simpler, and it says what it does

### Changed
- **One button starts it, with nothing to tick.** The first screen says what will happen, how many times Claude reads your plan (Anthropic charges your Anthropic account for each read), what is sent, and that nothing is saved until you press Save. "Draw my rooms" is the go-ahead. You no longer turn on "AI map-building research" or "Build from plans" in Settings → AI for it, and using it doesn't turn them on (the Plans tool in Live Aboard stays as you had it). When Home Assistant has a suitable Claude that isn't PadSpan's AI yet, the first screen says Start will choose it and keep your earlier AI Task as the backup.
- **Plainer words.** The first screen no longer promises that Claude reads a printed measurement for you, or mentions a paid look again at a room you won't see here. The scale is called the scale throughout.

### Fixed
- **Save works on the first press** when you press it straight from a room's name field. Leaving the field used to redraw the list under your finger, so the press was lost; the same went for the ticks and "Join into one".
- **The close-up of a measurement running down the plan shows the whole line**, so every number Claude quoted can be scrolled to.
- **When the plan you were working on was deleted**, the helper says so at the top, in words for the plans that are left, and Setup no longer says you started measuring it.
