# What do you want PadSpan for?

### New
- **A new install asks what you want PadSpan for.** On its first run, the Getting started card asks "What do you want PadSpan for?" with four answers to tick: the whole house on one screen, who's in which room, my floor plan and 3D house, and every light in its place. Each opens its own first step: the Atlas (then how to put it on a wall screen), the receivers (then your phone), Mapping with the iPhone or iPad scan offered first, or the Atlas builder's tour. With several, the first ticked opens and the others wait as next steps. Only an administrator is asked, never on a wall screen, and Skip ends it. An install from before is never asked; Settings → Appearance has the same choice for everyone.
- **Two counts in the opt-in usage report.** How many leak, smoke, gas and CO alarms are placed on the map, and the answers to the new question, each only from a house it applies to. Counts and fixed words, never names.

### Changed
- **The licence card says the free version plainly.** "The free version needs no key and doesn't run out. Some features need PadSpan Pro or an add-on, and PadSpan says which where you meet them. Pro includes every add-on." Without a key, it now says what each locked part needs: fixture shapes with their size and angle, WLED's Advanced controls and Fit room need Pro or Advanced smart lighting, and Showcase needs Pro or the Looks pack.
- **A new install's first words welcome you.** The usage report's card starts with what PadSpan does for you, then says it gets better with every release and why the report helps.
- **Consent, said where it matters.** Adding a phone says to add only the phones of people who've agreed, and lending a guest tag says to tell the guest their tag is followed.
- **PadSpan has its category in the Home Assistant Marketplace:** Motion & presence.

### Fixed
- **Guest tags no longer recommend a Find My tag.** Find My, Tile and similar tracker tags change their Bluetooth address, so they aren't followed reliably. A beacon with a fixed address (iBeacon or Eddystone), or a phone with Private BLE, is what works.
