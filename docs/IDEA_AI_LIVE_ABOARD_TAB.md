# Plan: an AI tab under Mapping, and AI room corrections

**Status: PLANNED, not started. Nothing here is built.** Booked on Garry's calendar for Wed Nov 11 2026, 13:00 BC.

Garry, Nov 3 2026: "for next build add a ai live board under mapping for these features, and start layout for romm correction from ai plan building as well to correct errors or add data (doors, windows)". Then: "Just make sure the plan is there, don't do the work now, don't have the tokens this week to complete it."

"Ai live board" is read here as an **AI Live Aboard** tab. Confirm that first (see Decisions).

## What exists today (stable 0.38.224)

| Feature | Where it is now | Gates |
|---|---|---|
| Plans tool (Add data via plans): stairs, railings, lights | Mapping → Atlas → Live Aboard → Edit → Plans (`live_aboard_plans.js`, `live_aboard_edit.js` `setPlans`, `live_aboard.js` hands it in) | Pro, Live Aboard on, `ai_plans_enabled`, an AI Task (`atlas_3d_ai_task_entity`), administrator (`ws_plan_ai.py` `_refused`) |
| Stair finder | Furnish → Build ▾ → House → Read stairs off the plans (AI) (`live_aboard_furnish.js`) | The same, plus `ai_stairs_enabled` |
| Rooms and walls from a floor plan picture | Only a COMING SOON row in Settings → AI (`settings.js`) | Not built |
| Last session's undo | Settings → AI (`_planAiLastRow`) | Administrator, master switch on |

Doors, windows and doorways already live in the 3D file: its `openings` section, ids `door_`, `win_` or `doorway_` + 8 hex digits, a stretch of wall in fabric metres (`house3d_store.py`). Edit → Door and Edit → Window draw them by hand.

`plan_ai_write.py` is the one writer from AI finds to the 3D file, and `apply_edit` refuses anything but the 3D file's own sections. `tests/test_plan_ai.py` scans for this. Room shapes have their own writer, `fabric_correct_room` (`ws_fabric.py`), which the plan AI can't reach today.

## Part 1: the AI tab under Mapping (a new way in, no new abilities)

Do this first. It can ship on its own.

- **Tab:** in `maps.js` `tabDefs`, after Furnish, the way `furnishTab` is added. Shown only when not in Basic, Pro, Live Aboard on and `ai_plans_enabled` on. Otherwise there's no tab, and a stale `mapsTab` falls back as Furnish's does.
- **What it opens:** Live Aboard, mounted the way Mapping → Furnish mounts it, going straight to Edit → Plans (Live Aboard already takes a tool asked for on the way in). No AI Task chosen: say so and link Settings → AI.
- **On the tab:** the Plans tool, Read stairs off the plans, the last session and its undo, and which AI will read.
- **Unchanged:** Edit → Plans stays where it is. No new store, writer or websocket command. The same gates, and a smoke, gas, CO or leak alarm still shows over it.
- **Tests:** the tab's gates (each one off hides it), and the existing plan AI suite still passing.

## Part 2: AI room corrections, the first build is the layout

Inside the same tab, one more section beside stairs and railings. The same vetting map, pins and one card per item. No "accept all".

- **Doors and windows, real suggestions.**
  - Add door and window kinds to `plan_ai.py` `KINDS`. Measure a prompt on real plans first, as the stairs and lights prompts were; a poor read stays out.
  - Match each find against `openings`: already there, a correction, or new. Snap to the nearest wall in fabric metres; a find with no wall nearby stays a suggestion and can't be kept.
  - Keep them the way stairs are kept: ghosts from the real builders, pending read off the draft, nothing kept until Save, written by `plan_ai_write.py` with its backup and one undo per session.
- **Room errors, a list only in the first build.**
  - The AI's read of the plan against the rooms: a room the plan shows that the house doesn't have, an outline clearly off, a name that doesn't match.
  - Each card shows a crop of the plan and a button that opens Mapping → Layout on that room, as a light with no placed fixture opens Mapping → Atlas today. **Nothing writes rooms, walls, floors, scale, maps or calibration.**
- **Later, only on Garry's say-so:** keeping a room correction through `fabric_correct_room` with its own backup and undo. Rooms feed positioning and calibration, so a wrong one costs more than a wrong stair, and the panel and changelog promise it never writes them. Change that promise in the same commit if this ever happens.

## Safety bar

Garry, Nov 2026: "I dont need the new features perfect, it has lots of warnings. Just need it safe".

Experimental and off by default. Administrator only. Plans go only to the chosen AI Task or its backup. Nothing is kept until Save. One undo takes a whole session back. An unreadable answer is reported as such, never as "found nothing".

## Decisions to ask first (AskUserQuestion, recommended option first)

1. **Tab name:** AI Live Aboard (recommended, his words as read here), or AI, or Plans.
2. **Doors and windows in the first build:** real suggestions (recommended), or layout only with no AI read yet.
3. **Room corrections in the first build:** list only (recommended), or write rooms too.
4. **Ship:** beta as soon as Part 1 passes review, then Part 2 (recommended), or both together.
5. **Where plan reading runs for Pro (a privacy question, added Nov 9):** in the house as now, so a plan picture never leaves it, or on PadSpan's server, so the reading pipeline and its prompts don't ship in the integration. On the server, a plan picture leaves the house, and an outage stops plan reading.

## How to build it

- A dev session, not a daily marketing run: those are told never to touch `custom_components/`.
- Read `PadspanResearch/plan-ai-design-2026-11.md` first. It's the plan AI's design and isn't in this repo (Windows PC side); `plan_ai.py` cites it. Search Engram for "padspan/working-rules-2026-11".
- Own worktree and branch from `origin/main`. Release note in `changelog.d/`. `python -u scripts/release.py next --no-bright`, and it isn't done until the tag's checks are green.
- Economise: one builder, always model opus, one read-only review of the batch.
- Check it on the wall PC too: it runs Live Aboard 3D, not the flat map. The flat Atlas's drawing must not change.
- Afterwards update `docs/LIVE_ABOARD_GUIDE.md`, the help text and Settings → AI's row. The public guides (for example /guides/floor-plans/) don't describe this yet and needn't until it's out of research.
