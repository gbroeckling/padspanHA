# Let Claude draw your rooms: your changes kept, every floor reachable

### Fixed
- **Your changes on the rooms list are kept.** Names you type, rooms you untick and "Also add this room to Home Assistant" are now kept with that reading of your plan as you make them. Pressing Back, opening the helper again or reloading the page brings the list back as you left it. Saving, undoing or asking Claude for a new reading starts afresh.
- **A second floor can always be reached.** Once the helper has saved rooms on one floor, Setup, the Mapping wizard and the Plans tool keep offering it while another floor with a plan has no rooms yet. A reading you left part-way can be picked up from there too: Setup's line says "Carry on". The Overview still doesn't bring it up for a house with rooms. A house that got its rooms another way is never offered it.
- **"Place receivers" opens the plan you just saved**, not another floor's plan.
- **Setup keeps the helper's line** under "Draw the rooms" when its next step moves on (for example to floor heights in a house with two floors).
- **After the helper's Undo you can try again** from Setup, the Mapping wizard or the Plans tool. The Overview still won't suggest it again.
- **After an undo in Settings → AI**, opening the helper again starts where you choose the plan, not on the old rooms list.
- **The measurement Claude quotes adds up.** When the length on your plan is a row of shorter lengths, the scale check shows all of them (or how many there are, if they're too many to show), never just the first few beside the whole length.
- **The close-up of the printed measurement fits the screen** and shows the whole measurement Claude quoted. You can scroll along a long one. The answer buttons stay in view.
- **Yes only answers.** On the scale check, "Yes, that's right" and "No" choose your answer. The one button below saves the scale and then has Claude read the plan for its rooms, and says so.
- **Measuring by hand is easier to see.** The plan gets more of the screen, + and − zoom it so the printed numbers can be read, phones say "Tap", and two fingers can pinch to zoom while one finger places the ends.
- **Settings → AI says what the AI tools can save.** The rooms the helper saved are undone there under the helper's name. The automatic backups name it the same way.
- **Smaller fixes:** room names on the small plan picture no longer run into each other. A plan named like its floor is named once. The phone's title bar says "Let Claude draw your rooms". A room called "Hall 2" because another room is already "Hall" says so.
