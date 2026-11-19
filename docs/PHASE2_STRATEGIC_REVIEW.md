# PadSpan — Phase 2 Strategic Review (2026-09-19)

The owner: "It has gotten big and complex, I'm ok with that, but I need
confirmation that I am on the right path, and where the gaps are. Do a
ton of research and build a phase 2 plan for me to review. Really dig
for this one, even outside HA if you need for ideas."

**Companion doc:** [PROJECT_SYNOPSIS.md](PROJECT_SYNOPSIS.md) is the
day-1 (2026-02-04) founding vision. Section 1 below measures the
7.5-month delta between that and what's actually shipped — the most
direct answer to "am I on the right path."

---

## Status: research complete

Built from 8 independent research passes running concurrently against
this same file. That concurrency briefly cost real content (one pass's
in-progress work was overwritten by another mid-session, caught and
restored from git history) and left every pass's added Gaps/Phase-2
items numbered as if it were the only one landing — both cleaned up in
a consolidation pass afterward (renumbered §4/§5 items so nothing
collides, relettered §7's research subsections from a second, colliding
A-J sequence to M-P so every lettered subsection in the document is now
globally unique). No findings were changed or removed in that pass, only
organized. Flagged here rather than silently fixed, per this project's
own rule to say what actually happened.

**Contents:**
1. Where this project actually stands today
2. Are you on the right path? — direct verdict, updated at the bottom
   after §§6-8 landed to cover pricing and product-gap findings too, not
   just architecture
3. External research findings — §A-F: AI-paired solo-dev velocity/debt
   literature; §G: is PadSpan at risk from HA's own direction; §H:
   BMS/RTLS/digital-twin analytics-depth; §I: named comparables for the
   registry fix; §J-L: alarm/alert subsystem architecture
4. Gaps — 4.1-4.13, ranked by leverage
5. Phase 2 plan — 2a through 2r, ordered
6. Outside HA: the BMS/digital-twin category (§M-P live inside §7, not
   here — see below)
7. Monetization & pricing — an independent second lens on "am I on the
   right path," §M-P
8. Outside HA, consumer/luxury tier: digital-twin-of-a-home competitive
   landscape

**On the research method throughout, for calibration:** built from live web
search, direct page fetches, and — for long-standing, stable facts about
named products (GPL terms, WordPress's freemium norm, Fowler's
refactoring catalog) — existing knowledge, since live search on those
would only reconfirm something unlikely to have changed. This session's
live web search ran out of its per-session call budget partway through
(a hard cap, not a topic search coming up empty); a couple of sub-
questions below are marked **unverified live** and reasoned from direct
fetches plus general knowledge instead. Flagged as such rather than
presented as confirmed, per this repo's own rule not to assert without
checking.

---

## 1. Where This Project Actually Stands Today

### Scale (measured 2026-09-19; re-checked same day after Phase 2 work
started and already drifted — 2,022 tests/155 files/1,680 commits as of
this note, not 2,008/154/1,667 below. Living numbers, not an error in
either snapshot; don't chase them further in this doc.)
- **7.5 months old** (first commit 2026-02-04) — 1,667 commits total.
- **~37,300 lines of Python**, **~63,200 lines of JS** across 76 backend
  files and 44 frontend view files. The frontend outweighs the backend
  more than 3:2 — worth noting when reasoning about where complexity
  actually lives (see Gaps).
- **2,008 automated tests** across 154 test files, all currently green.
- **24 releases in the last 14 days** (~1.7/day). This is not a typo —
  it is the real, sustained cadence of this project right now.
- **4 licence variants** live: PadSpan HA (free), PadSpan Pro ($45/yr),
  PadSpan Bright (free), PadSpan Bright Pro ($35/yr, $12 upgrade path
  from Bright to Pro) — two separately-listed HACS repos generated from
  one source tree.

### What day-1 set out to build, vs. what exists now
PROJECT_SYNOPSIS.md (2026-02-04) describes a **BLE room-presence
assistant** — the 4-pane map model (Physical / Radio / Distortion /
Combined), guided calibration, "no MAC-address workflows." That core is
still exactly there and is arguably the most mature, most tested part
of the codebase (positioning, Kalman smoothing, k-NN calibration,
floor-transition learning).

What's been ADDED since, that day-1 never scoped:
- **Atlas** — a full device/lighting map (lights, fans, locks, motion,
  temperature, humidity, air-quality, flood/leak sensors), each placed
  at a real position/shape/size, independent of BLE presence entirely.
- **Automorph + Showcase** — decorative rendering layers for Atlas.
- **Flood alarm latching** — an event-driven, life-safety-adjacent
  alerting subsystem (2-day latch, ISA-18.2-informed reset semantics),
  shipped in the last 24 hours of this session.
- **Locate** — room-graph wayfinding ("which way do I walk to find
  this"), derived from the presence fabric, not from BLE at all in its
  reasoning — it's a navigation feature riding on top of a tracking
  product.
- **Insights / Busy Times** — historical analytics (dwell time, peak
  occupancy, aggregate room-activity heatmaps).
- **PadSpan Bright** — a whole second *product*, not a feature: the
  same codebase with BLE presence stripped out, sold as a standalone
  lighting-map tool.
- Forensics (opt-in presence-session recording), RSSI capture sessions,
  an Install Base admin dashboard, a training/help system with 16
  animated walkthroughs plus a full manual — none of these existed in
  the original scope either.

**The honest read:** this is no longer "a BLE presence integration."
It's a general-purpose *building visualization and control platform*
for Home Assistant, with BLE presence as its most-developed subsystem
and increasingly independent as a value proposition. That's not
necessarily wrong — see Section 2 — but it is a real, measurable shift
from the founding document, and the rest of this report treats that
shift as the central question, not a side note.

### A concrete structural finding (not speculation — counted directly)
Today's flood-sensor feature (one new device class: motion, temp,
humidity, air-quality, lock, door already existed) required edits
across:
- `light_codes.js` (classifier function, border colour, code-series
  letter, shape entry, health-check carve-out)
- `lights_map.js` (domain admission filter, 2 border-colour chains, 2
  state-label branches, hide-untouched exemption, onRowMore exclusion,
  aggregate counts × 2, LIGHT_CLASSES chip)
- `iso_lights.js` (lightClassOf, border chain, 7 separate "which
  lights actually cast light/aura/pool" exclusion chains, the render
  effect itself)
- `maps.js` (the inspector panel's Turn On/Off exclusion — a SEPARATE
  copy of the same exclusion list `lights_map.js` already has one of)
- `const.py` / a Python backend module, twice over across this
  session's own two attempts

That's **~25 distinct edit sites across 4 files** for one device class.
The backend/frontend split for the flood *alarm* feature specifically
(as opposed to just drawing the sensor) needed a 5th file
(`flood_latch.py`) and a settings-schema change in a 6th
(`ws_settings.py`) plus a 7th test file. This pattern is not unique to
flood — the same "N files, each with its own copy of the exclusion
list" shape governs every device class Atlas has (motion, temp,
humidity, air, door, lock, flood). See Gaps §4 for what this actually
costs going forward, not just today.

---

## 2. Are You On The Right Path?

**Short answer: yes, on the fundamentals — with one specific, correctable
architecture debt that is exactly at the age where the research below says it
either gets fixed cheaply or gets expensive.**

The literature on AI-paired high-velocity development (§3) converges on a
single variable that decides whether a fast solo/small-team project stays
sound or hits a wall: **whether shipping speed is backed by a control
system that catches what the human's eyes no longer catch on their own** —
Google's 2025 DORA report states this almost exactly: *AI adoption has a
positive relationship with delivery throughput, but a negative relationship
with delivery **stability**, and the difference between teams that get both
and teams that get only the first is the strength of their automated
testing, version control discipline, and fast feedback loops.* PadSpan
already has the single most load-bearing piece of that control system: 2,008
automated tests, CI-enforced on every push and PR across two Python
versions (`.github/workflows/pytest.yml`), covering a test suite (40,641
lines) that is larger than the Python source it tests (37,300 lines). That
ratio is unusual in a good way — most of the "vibe coding debt" literature
describes projects where tests are thin, decorative, or skipped under
velocity pressure. PadSpan's aren't; they're the majority of the repo by
line count and they stay green.

The project also already does two of the other things the research
identifies as separating 6-month-plus sustainers from wall-hitters (§3E):
written architecture documentation the agent (and the human) can re-read
instead of re-deriving from scratch (`docs/00_REPO_LOGIC_OVERVIEW.md`
through `09_HARD_WON_RULES.md`), and — this is the finding that most
directly answers "am I on the right path" — **evidence of a completed,
closed-loop self-audit.** `docs/AUTOMORPH_CRITIQUE.md` is a genuine
four-lens design review that found 27 real defects, **22 of which were
applied, 3 deliberately deferred behind stated gates (not abandoned),
and 2 explicit no-change/rejected verdicts kept as guardrails** —
followed by an independent adversarial re-review that found 16 *more*
defects in the applied fixes themselves, all of which were also fixed,
reproduction-first. That is, verbatim, the practice Simon Willison names
as the top defense against architecture drift — periodically stepping
back and asking a fresh pass to find what the forward-only building
missed — and it is the single strongest piece of evidence in this repo
that the project is being run with the right instincts, not just at high
speed.

**CORRECTED 2026-09-19, independently cross-checked via a second AI
(codex) then verified by hand:** this section originally said "24 of 27
... applied ... the other 3 are deliberately deferred," copied from
`AUTOMORPH_CRITIQUE.md`'s own top-of-file summary without recounting it
against the file's 27 individual per-finding `**Status:**` lines. Doing
that count directly (`grep -c '^\*\*Status:\*\* Applied/Deferred/No
change'`) gives 22 / 3 / 2 — the critique doc's own headline number is
wrong by 2 (it appears to have folded the 2 "No change" guardrail
verdicts into "applied" rather than reporting them as their own,
third category). Two separate things were wrong here — an earlier
session-memory note that called the critique "unapplied" (also
corrected, in an earlier pass through this section) and this report's
own repetition of the critique doc's own miscounted summary — both are
about "did the self-audit actually get acted on," and the honest answer
is still yes: 22 applied + 3 gated-not-abandoned + 2 deliberately
rejected accounts cleanly for all 27, none silently dropped. The
strength of this as evidence for §2's verdict is unchanged; only the
specific number was wrong.

**The caveat.** Today's own flood-sensor session produced a textbook,
freshly-counted instance of the failure mode §3C and §3F below call
"agentic entropy" / Shotgun Surgery: one new device class required edits
across ~25 sites in 4 separate frontend files, each maintaining its own
copy of a device-class exclusion list. This is not a one-off — it is the
*shape* every device class in Atlas has taken (motion, temp, humidity, air,
door, lock, flood, each hand-threaded through the same four files
separately), and `maps.js` (11,075 lines) and `iso_lights.js` (6,116 lines)
are now large enough that no single read of either file gives an agent (or
the owner) the whole picture in one pass — which is precisely the condition
under which the research says agents produce code that is locally correct
and globally wrong. The "90-Day Reckoning" pattern in §3B describes almost
this exact trajectory: duplicated logic implemented three or four times
independently, each instance individually reasonable, until a routine
feature starts costing multiples of what it used to. PadSpan is not past
that line yet — today's session counted the cost precisely instead of
discovering it via a production bug, which is itself a good sign — but the
device-class pattern is the one structural element in this codebase that
is compounding rather than plateauing, and it should be the first thing
Phase 2 fixes rather than the tenth.

**Where I'd push back on the premise.** The framing "24 releases in 14 days
— is that sustainable?" treats release *cadence* as the risk variable. The
research doesn't support that framing on its own: nothing in §3 ties release
frequency itself to instability; what it ties to instability is the ratio of
**untested, unreviewed surface** to changes shipped. A project releasing
1.7x/day behind 2,008 green tests and a CI gate is categorically different
from a project releasing 1.7x/day on "if it's under 200 lines and the tests
pass, just merge it" (the unofficial rule one engineer described to
researchers in §3B) — because in PadSpan's case the tests are not
decorative. The cadence is not the finding. The scattered device-class
logic is. Don't slow down the release rate to fix this; fix the specific
architectural debt, because the release rate isn't what's carrying the
risk.

One open question this report can't answer from the repo alone, and that
the research (§3D) says matters as much as any structural fix: **is every
diff still being read, or has trust shifted to "tests green → ship"?**
Review-fatigue research is explicit that this shift is gradual and usually
invisible to the person it's happening to. This isn't a finding — there's
no way to verify it from outside the review process — but given the pace,
it's worth the owner answering for himself, honestly, before it becomes a
finding in a future retro.

**Updated after §§6-8 (outside-HA, monetization, and digital-twin-
competitive angles) landed — four separate yes/no questions, not one,
because "am I on the right path" turned out to have four independent
answers once the research was this thorough:**

1. **Is the product-as-built the right thing to be building?** Yes,
   confirmed independently at three market tiers researched (§G, §M
   verdicts) — no HA-ecosystem, BMS, or consumer/luxury competitor
   combines PadSpan's specific bundle, and HA's own roadmap has
   explicitly scoped this territory out of its own core work.
2. **Is the codebase sound underneath that product?** Yes, with one
   correctable architecture debt already identified above (the
   device-class registry) — the test-to-source ratio and the closed-loop
   Automorph critique are real, working evidence of good instincts, not
   just fast ones.
3. **Is the pricing/packaging structure sound?** **No** — this is the one
   place in the whole report where the honest answer isn't "yes, with a
   fix," it's closer to "no, fix this before it costs conversions." §P's
   verdict: 5 price points across 2 products is past where buyers reason
   cleanly, and the architecture itself (BLE is already optional
   infrastructure in both products) undercuts the reason there are two
   products at all. Phase 2l-2m address it directly and it's cheap to
   fix — positioning, not a rebuild.
4. **Is there a product gap bigger than the next device class?** Yes, and
   it's not architectural — §8's verdict is that automated geometry
   acquisition (scan-to-place, not another sensor type) is the single
   most research-validated gap in this entire report, found independently
   at every competitor tier from Samsung to Apple's own dormant RoomPlan
   API.

**Net verdict across the whole report:** the trajectory and the codebase
are sound; the go-to-market packaging is not, and there's a bigger
missing feature than whatever's next on the device-class list. None of
these four answers contradict each other — they're four different axes
(architecture, positioning, pricing, product surface), and Phase 2 below
sequences fixes for all four rather than treating only the architecture
one as "the" finding.

---

## 3. External Research Findings

Organized by theme; each item says explicitly whether it confirms or
challenges PadSpan's current trajectory and why.

### A. High solo/small-team velocity is real, documented, and not inherently a red flag
- A solo developer built a 385,000-line multi-tenant SaaS platform (245k
  app code, 140k tests) in three months using Cursor/Claude Code, following
  a structured methodology of pre-coding domain modeling, staged
  build/audit windows, and **fresh AI review passes that re-examine
  finished work without having written it** — deliberately re-creating a
  second set of eyes. ([dev.to](https://dev.to/alex-zaporozhan/385000-lines-of-code-in-three-months-solo-with-ai-agents-is-that-a-good-result-id-like-to-1m4g))
- Armin Ronacher (Flask's creator) published widely-discussed "Agentic
  Coding Recommendations": write the simplest code the agent can
  understand, prefer explicit/typed code over clever abstraction, and
  maintain an AI-conventions doc the agent reads every session — almost
  exactly what PadSpan's `docs/00-09` series already is.
  ([HN discussion](https://news.ycombinator.com/item?id=44255608))
- Industry productivity claims cluster around 8-12x on routine work,
  2-3x on novel work, for teams doing "level-3 agentic pairing."
  ([digitalapplied.com](https://www.digitalapplied.com/blog/case-study-ai-coding-rollout-100-dev-team-quarterly-data-2026))

**Read on PadSpan:** the raw pace (1667 commits / 7.5 months, 24
releases/14 days) is high but not unprecedented or, by itself, alarming
for 2026-era AI-paired solo development. This **confirms** the cadence
itself isn't the risk variable — consistent with the pushback in §2.

### B. The "vibe coding" technical-debt literature — timelines and numbers
- GitClear's longitudinal analysis (150M lines, 2020-2026) found an
  **8x increase in duplicated code blocks** and code duplication rising
  from 8.3% to 12.3% of shipped code as AI-tool adoption grew.
  ([HackerNoon](https://hackernoon.com/vibe-coding-is-a-technical-debt-factory), [Autonoma](https://getautonoma.com/blog/vibe-coding-technical-debt))
- A widely-cited "90-Day Reckoning" model: Day 30, duplicated logic and
  inconsistent error handling start showing up as debugging sessions that
  run long; Day 60, a feature that should take 2 days takes 2 weeks
  because e.g. "checkout logic spreads across seven files with
  inconsistent state" — **this is structurally the same shape as today's
  flood-sensor finding, one class further along**; Day 90, teams are
  spending 20-30% of sprint capacity tracing bugs back to the original
  rushed implementation, and rewrite-vs-remediate becomes unavoidable.
  ([Autonoma](https://getautonoma.com/blog/vibe-coding-technical-debt))
- Google's 2025 DORA report: 90% of respondents use AI at work, 80%+
  report a productivity increase, but AI adoption has a **measured
  negative relationship with delivery stability** — the report frames
  this as acceleration exposing weaknesses downstream in teams that lack
  automated testing, version control discipline, and fast feedback loops.
  ([Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report))

**Read on PadSpan:** this **challenges** the device-class pattern
specifically (it is inside the Day-30-to-60 window the model describes)
but **confirms** that PadSpan's heavy automated-test investment is the
correct hedge against the DORA-identified stability risk — it's the
variable the report says actually matters, and PadSpan has it on the
Python side. It does not yet have it on the JS side (§4.1).

### C. Why this happens mechanically: "agentic entropy" and architecture drift
- An arXiv paper on "agentic entropy" defines it as disorder that
  accumulates specifically because agents optimize for local, per-file
  correctness while lacking visibility into system-wide invariants —
  producing code that is "locally reasonable and globally arbitrary."
  Its proposed mitigation, "Process-Oriented Explainability," amounts to
  constraining agents to route changes through existing modules rather
  than letting each change quietly re-implement its own copy of shared
  logic. ([arXiv 2604.16323](https://arxiv.org/pdf/2604.16323))
- Anthropic's own engineering guidance on context engineering recommends
  structured persistent memory (a NOTES.md-equivalent), sub-agents with
  clean context windows for deep work, and explicit file organization as
  the signal agents use to infer "where this kind of logic belongs."
  ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))
- A Hacker News thread from a solo developer running a 223k-line codebase
  with four differently-roled AI "team members" (research, architect,
  programmer, reviewer) reported the same mechanism in their own words:
  *"The AI would write clean functions that were globally wrong, quietly
  breaking earlier design decisions and long-range invariants"* — solved,
  in their case, by never letting the implementation-tier agent touch
  architecture decisions, and keeping a dedicated architect role that
  writes interfaces only. ([HN item 46462910](https://news.ycombinator.com/item?id=46462910))

**Read on PadSpan:** this set of sources **confirms**, mechanistically,
exactly why the flood-sensor edit landed in 4 separate files instead of
one: there is no single place in the codebase that declares "here is the
list of device classes and what each one means" for an agent (or a human)
to route a new class through. The fix implied by all three sources is the
same one classical refactoring literature has a name for (§3F).

### D. Review fatigue at high AI-driven velocity
- Practitioner-discourse research on code review after AI adoption
  documents a real, gradual shift: *"everything starts looking correct...
  developers stop asking second-order questions about null inputs or
  concurrency... they trust the pattern."* One account puts AI-driven code
  review time up **91%** even as raw output accelerates (Google's 2025
  DORA data, cited alongside GitClear's numbers).
  ([Augment Code](https://www.augmentcode.com/blog/generating-tech-debt-at-the-speed-of-light), [StackOverflow blog](https://stackoverflow.blog/2026/05/21/coding-agents-are-giving-everyone-decision-fatigue/))
- The Stack Overflow piece documents a concrete team case: one engineer
  produced roughly 7x the code of teammates with AI assistance, and *"the
  other six people on the team were spending the majority of their time
  reviewing her code [rather] than writing code"* — i.e. velocity doesn't
  remove review load, it relocates it, and at solo scale there is no one
  to relocate it to.
- The recommended discipline, repeated across sources: *"if you didn't
  read the diff, you don't approve."* AI-generated PR summaries are for
  triage, not for substituting the read.

**Read on PadSpan:** this **doesn't confirm or challenge** anything
measurable from outside — there's no way to observe from the repo whether
every diff at 1.7 releases/day is genuinely being read start to finish or
whether trust has shifted to "tests green → ship." It's flagged in §2 as
the one open question worth the owner answering honestly for himself, because
every source above says this specific erosion is invisible to the person
experiencing it until a bug exposes it.

### E. What separates 6-month-plus sustainers from people who hit a wall
Synthesizing across sources (Ronacher's recommendations, Willison's
patterns, the 385k-LOC case study, and the HN four-agent-team thread), the
practices that recur among people who've sustained high AI-paired velocity
for 6+ months, versus people who describe hitting a wall around 2-3 months,
are consistently:

1. **A written, agent-readable conventions/architecture doc**, kept
   current, that the agent reads before working rather than re-deriving
   design intent from the diff history.
2. **Tests as the primary gate, not manual review as the primary gate** —
   tests catch "does it work," a human catches "should it exist here,"
   and the two are treated as separate jobs rather than one.
3. **A scheduled, recurring "fresh pass"** — a walkthrough, critique, or
   adversarial re-review done by a context that didn't write the original
   code — done on a cadence, not only reactively after something breaks.
4. **Role/phase separation even when solo**: planning/architecture
   decisions kept separate from implementation execution, so the
   implementation agent is constrained rather than free to also decide
   structure.
5. **Written records of *why*, not just *what*** — design-decision docs
   survive past the commit that made them, so a later change doesn't
   silently contradict an earlier invariant nobody remembers setting.
6. **A named, deliberate point where net-new feature work pauses for a
   remediation pass**, before the debt crosses the point (§3B's Day 60-90)
   where routine work starts taking multiples of its old cost.

**Read on PadSpan:** items 1, 2, and 3 already exist here in real, working
form (the numbered docs series, the 2,008-test CI gate, and the
Automorph critique plus its adversarial re-review). Item 5 exists partially
— `docs/` is unusually rich with dated design-decision records
(`fabric-independence-plan-2026-08-10.md`,
`identity-and-geometry-invariants-2026-08-19.md`, etc.) for a solo project.
Items 4 and 6 are the two genuinely missing pieces: there's no evidence of
a standing architecture-only pass gating new device classes before they're
implemented, and no evidence of a scheduled (as opposed to one-off)
remediation cadence. Both are addressed directly in §5.

### F. The specific, named fix for the specific, counted problem
The flood-sensor finding — one logical change (add a device class)
forcing edits across many files that each hold their own copy of the same
classification logic — has a name in the refactoring literature:
**Shotgun Surgery**, one of the original Fowler/Beck code smells: *"a
single change is made to multiple classes simultaneously... many small
changes across numerous classes."* ([refactoring.guru](https://refactoring.guru/smells/shotgun-surgery))
The canonical fix family is **Replace Conditional with Polymorphism** /
consolidating the scattered per-type branches into one place each type's
behavior is declared once — in a codebase built around a small number of
crosscutting attributes (color, shape, code letter, aggregability, "does
it cast light") rather than inheritance hierarchies, this takes the
concrete shape of a **single device-class registry**: one data table, in
one place, that every consumer (light_codes.js, lights_map.js,
iso_lights.js, maps.js, the Python backend) reads from instead of
maintaining its own list. This is not a novel idea invented for this
report — it is the oldest, most mechanical fix in the refactoring canon
for exactly this smell, and it maps directly onto the concrete files
named in §1.

PadSpan already has a working precedent for "one generator, no second
source to drift" thinking elsewhere in the repo: `scripts/bright_build.py`
derives PadSpan Bright from the PadSpan HA tree at release time by
substitution over a copy, explicitly built so there is "no second source
to forget," with `verify()` grepping the output and `test_bright_build.py`
holding the guarantee in CI. That is the right instinct, already proven
out once in this codebase — it just hasn't been applied yet to the
device-class lists, which are a smaller, purely in-process version of the
same "don't let two copies exist" problem.

### G. Is PadSpan at risk of being obsoleted by Home Assistant's own direction?

This is the angle the original request centered on by name: where HA
core, its architecture repo/RFCs, its public roadmap, and Matter are
officially headed on Areas/Floors, native floor-plan/map visualization,
and device presence — plus a deliberate look outside HA entirely, to
check whether the underlying pattern (signal-based trilateration →
floor-plan visualization → alerting) is solved or commoditized
somewhere else. Every claim below was checked directly (fetched or
searched 2026-09-18), not recalled from training knowledge.

**HA has an open, active proposal to rework its physical-space model —
and it explicitly excludes what PadSpan does.**
[OpenHomeFoundation/roadmap#83](https://github.com/OpenHomeFoundation/roadmap/issues/83)
("Rethink how Home Assistant models physical space," opened 2026-04-07
by maintainer `nielsrowinbik`, still **open**, cited as the
**third-most-upvoted request in the core-functionality category** with
40+ Discord replies) proposes a `Global → Structures → Floors → nested
Areas` hierarchy — multi-building support, areas nested up to 3 levels,
indoor/outdoor flags, hidden areas. Real, credible, currently active
core roadmap. But its own "Notably Absent" scope line is explicit:
**floorplans, room dimensions, and adjacency for radar presence zones
are called out as out of scope.** That's about as direct a sourced
answer to "will HA build what PadSpan builds" as this kind of research
produces — the team looking hardest at physical-space modeling right
now is on record saying that part isn't what they're doing.

**A literal "Floor Plan Entity" was proposed to HA core years ago — and
has sat unresolved, with maintainers pointing it back at community
cards.** [home-assistant/architecture#950](https://github.com/home-assistant/architecture/discussions/950)
(`Lash-L`) proposed exactly PadSpan's Atlas primitive: floor-plan
"rooms" with bounds/background image, plus placeable "Floor Plan
Objects" with x/y coordinates, icons, size, entity links. Collaborator
`allenporter` suggested riding on the existing Image Entity instead;
`gjohansson-ST` and `EnochPrime` both questioned whether this belongs
as an entity at all, closer to "infrastructure." December-2025 comments
note HA's Areas now provide *some* organizational function but
**collaborators explicitly acknowledge they still lack
geographic/positioning features**. Status: **unresolved, neither
accepted nor rejected**, for years running. `home-assistant/architecture#1021`
(the original Floor Registry proposal, `balloob`) independently
confirms the same design stance from the other direction: "A device is
always in an area, and not directly in a floor," and floors
*deliberately* exclude positional coordinates or elevation data — HA's
registry model is organizational/hierarchical by design, not spatial,
the opposite axis from Atlas's real cm-scale position/shape/size.

**The only "map" HA core shipped in 2026 is a protocol topology graph,
not a floor plan**, and it's worth naming precisely so it isn't
mistaken for encroachment: [2026.9's release notes](https://www.home-assistant.io/blog/2026/09/02/release-20269/)
add a "Show map" button to the Matter panel — a node/edge graph of
Thread/Wi-Fi paths, router roles, and signal strength between HA and
each Matter endpoint. It visualizes the mesh, not the building. HA's
older native Map card remains GPS-only, [by its own docs](https://www.home-assistant.io/integrations/map/):
only lat/long-bearing entities render — outdoor device trackers, not
indoor room-level position — with no announced plan to extend it
indoors. Checked directly against the current public roadmap board
([OpenHomeFoundation/roadmap](https://github.com/OpenHomeFoundation/roadmap/issues),
cards #233-#244 as of 2026-09-18): companion-app navigation,
automation/script UX, sleepy-Matter (ICD) device support, a Matter
commissioning-via-BLE-proxy flow, Modbus onboarding — no open card
proposes native floor plans, native indoor presence mapping, or a
native alerting/alarm subsystem. #83 above is the closest thing to
this territory on the entire board, and it explicitly excludes the
floor-plan/positioning half of the ask.

**Matter's own roadmap has zero positioning content, confirmed across
two independent sources.** The Open Home Foundation's own newsletter
coverage of Matter (["It's just a Matter of time"](https://newsletter.openhomefoundation.org/its-just-a-matter-of-time/))
covers Matter 1.4/1.4.1 — energy management, commissioning UX,
multi-hub support, device types expanding down to microwaves and
dishwashers — with **no mention of presence, positioning, location, or
ranging** anywhere. Cross-checked against Matter's shipping version
history: the current version, **Matter 1.6 (released 2026-06-17)**,
added camera support, soil-moisture sensors, NFC commissioning, Joint
Fabric multi-ecosystem sharing, and its own headline feature "Product
Security 1.1" (EU vulnerability-reporting compliance ahead of a
September 2026 deadline). Four consecutive point releases: "add device
categories + tighten security/commissioning," never "add spatial
awareness." UWB-based indoor positioning is real and advancing, but on
FiRa Consortium/IEEE 802.15.4z-4ab's own standards track — a different
body than the CSA (which owns Matter), with no sign of being folded
into Matter. **Matter is not a near-term threat to PadSpan's
positioning core**, on the evidence available.

**The closest HA-ecosystem relative — Bermuda, PadSpan's own named
inspiration (`PROJECT_SYNOPSIS.md`, `docs/07_BERMUDA_DISCOVERY_NOTES.md`)
— still hasn't built what PadSpan already ships.** Checked directly
against [agittins/bermuda](https://github.com/agittins/bermuda)
(canonical repo, 2,000+ stars, 73 forks, actively maintained): Bermuda
does area-level presence and per-scanner distance/RSSI well, is
explicitly HACS-only, and hopes some of it "could find a home in the
core codebase one day" — no core adoption has happened. Its own README
states its mapping ambition in these exact words: **"Triangulate
device positions! Like, on a map. Maybe."** — aspirational, hedged,
unshipped, years into the project's life. Its active
[Discussions board](https://github.com/agittins/bermuda/discussions)
has scanner setup, compatibility, and calibration threads — nothing
about building a visual map on the trilateration data. PadSpan has
already shipped, in production, at far higher fidelity (cm-scale
position, shape, confidence halo, distortion correction, multi-floor)
exactly what Bermuda's own maintainer still frames as a maybe-someday
stretch goal — the single most directly comparable "ahead or behind"
data point this research found, and it says **ahead, by a wide,
citable margin**.

**Outside HA entirely: even leading open-source enterprise IoT tooling
hasn't solved automatic indoor positioning either.** [ThingsBoard](https://thingsboard.io/)
(the most widely used open IoT platform, SCADA-style dashboards) offers
"Image Map," "Trip Map," and "Route Map" widgets plus a "Digital Twin"
entity/relation model. Checked directly against its
[dashboard docs](https://thingsboard.io/docs/user-guide/ui/dashboards/):
the floor-plan analogue is the Image Map widget — a static background
image with devices pinned as points, the same "trace it in an image
editor" pattern as HA's own community `ha-floorplan` card. No
signal-based positioning, no automatic placement, no confidence model.
Professional/enterprise open-source IoT tooling, at the platform level,
has solved "let a human place points on an image" — a strictly easier
and less valuable problem than what PadSpan's BLE trilateration + k-NN
calibration + distortion correction already automates. The pattern
PadSpan draws on is an established, named industry category one level
up — **Real-Time Locating Systems (RTLS)**, used in hospitals and
warehouses per the [RTLS overview](https://en.wikipedia.org/wiki/Real-time_locating_system)
— direct validation that "compute physical position from wireless
signal strength and show it on a screen" is a mature, decades-old,
proven problem category, not speculative. This corroborates this
repo's own prior 2026-09-05 5-agent competitive pass
(`docs/BEST_IN_CLASS_ROADMAP.md`), which found from the commercial-RTLS
angle specifically that PadSpan's traceback/history playback is matched
by commercial RTLS but nothing at the hobbyist tier, and its
multi-floor alignment tooling has "nothing comparable at any tier" —
this new, independently-run pass reinforces that rather than
overturning it, since even ThingsBoard-tier professional tooling sits
behind it.

**Read on PadSpan, and the direct answer to the question as framed:**
PadSpan is not at meaningful risk of being obsoleted by Home
Assistant's own direction, by Matter, or by the broader open-source IoT
ecosystem, on any near-to-medium-term horizon visible from current,
dated, sourced roadmaps. It is filling a gap HA has recently and
explicitly scoped out of its own physical-space work (#83), that its
own architecture repo has redirected away from core for years running
(#950), that its closest spiritual predecessor in the HA ecosystem
(Bermuda) still hasn't built after years of trying, and that even
professional open-source IoT tooling (ThingsBoard) solves more crudely
than PadSpan already does. Being willing to disagree with the premise,
as instructed: this is a genuine, evidence-backed **no** to the
obsolescence-risk question, not a hedge. Two second-order risks this
angle does surface, neither of them "someone else builds this first":
(1) Bermuda owns HA-adjacent BLE-presence mindshare (2,000+ stars) —
if HA core ever *did* fold a BLE presence engine into core, community
gravity favors Bermuda's codebase being the seed, not PadSpan's, which
would leave PadSpan's differentiation resting on the Atlas/visualization/
alerting layer rather than the presence engine itself; worth keeping
that layer independently defensible on its own terms (it already is —
see §F and §A-D above on the code-quality side), not treating BLE
presence as the permanent moat. (2) #83, if it ships, changes the
Area/Floor data shape PadSpan's floor/room picker reads from
(`Structures` above `Floors`, `Areas` nestable 2-3 levels deep) — not a
threat, but a dependency worth tracking rather than being surprised by;
add it to whatever mechanism already watches upstream HA changes for
this project (the same pattern `docs/ROADMAP.md`'s mmWave entry already
uses for a different upstream-dependency question).

### H. Analytics depth: what BMS/RTLS/digital-twin platforms offer beyond dwell-time, and whether it's buildable solo

A separate research pass asked a narrower question directly: what do
commercial BMS, RTLS, and digital-twin platforms sell as their *next tier*
beyond the historical dwell-time/occupancy analytics PadSpan already ships
(Insights / Busy Times) — anomaly detection, predictive maintenance,
occupancy-driven HVAC optimization, cross-device correlation — and is any
of it realistically buildable by a solo developer with AI assistance at
residential scale, or does it require data-science scale PadSpan can't
reach. Full sourced writeup, ~20 citations:
[research/analytics-depth-phase2.md](research/analytics-depth-phase2.md).

**The evidence splits cleanly into three buckets, not one yes/no:**

- **Buildable now, real ROI:** statistical baseline-deviation flagging on
  data PadSpan already computes — comparing a room's dwell time/occupancy
  against that same room's own rolling history. This is the exact pattern
  Flo by Moen / Phyn use for residential leak detection (learned
  per-fixture flow/pressure baseline, deviation triggers the alert, no
  fleet ML involved), and it matches what ecobee's own production
  thermostats do: published research training a random-forest occupancy
  model **per individual home**, not a fleet, found it "relatively
  efficient to train for individual devices" and as accurate as heavier
  models. No ML library, no fleet data, no new device-class plumbing
  needed — it's a statistics layer on tables that already exist.
- **Buildable, conditional value:** explainable cross-device correlation
  via association-rule mining ("motion in Kitchen predicts Kettle on
  within 3 minutes, seen on 84% of mornings") — cheap to compute nightly,
  fully explainable, no black box, reuses stored history. Real caveat:
  only pays off in homes with enough distinct device classes wired into
  one install to generate discoverable patterns — worth checking against
  actual Install Base device-class diversity before building it, not
  assumed.
- **A real trap — do not chase or market this:** true predictive
  maintenance (equipment-failure signatures — "this compressor fails in
  14 days") and enterprise Fault Detection and Diagnostics (FDD) fault-mode
  libraries. On any given day 40% of commercial AHUs run with an active
  fault, and the FDD industry exists to rank hundreds of named fault types
  against that reality — built by fleet operators (ABB, Siemens, Uptake,
  IBM Maximo) from thousands of instrumented, *actually failing* identical
  units. A single-home, no-telemetry, GPLv3 HACS integration has no path
  to that kind of data, by design, ever. Borrowing "predictive
  maintenance" language from BMS vendors would promise PadSpan users a
  capability the product structurally cannot deliver at N=1 furnace.

**Confirms a finding already in §F, from a completely different
direction:** both anomaly detection and cross-device correlation are
inherently per-device-class concerns — the exact dimension currently
hand-threaded separately through `light_codes.js`, `lights_map.js`,
`iso_lights.js`, and `maps.js`. This research thread arrived at "build a
device-class registry first" independently, from BMS/RTLS literature
rather than from refactoring literature — a second, unrelated line of
evidence for Phase 2a below, not a coincidence.

**PadSpan-specific opportunity, not just a caution:** PadSpan's BLE
presence fabric is already the one input commercial occupancy-driven HVAC
vendors pay the most to acquire — BrainBox AI, 75F, and Siemens DVO report
15–28% documented energy savings, with occupancy-awareness adding a
further **+8.6%** on top of a 25% base AI-control saving in one published
case study — and it's already richer than what most residential
thermostats get natively (one sensor per zone vs. PadSpan's trilaterated,
room-level graph). A *passive* occupancy-aware HVAC hint ("Living Room
empty 6h, zone still heating" — not closed-loop control) would ride on
infrastructure PadSpan already shipped, not request new capability.

**Bottom line for this angle:** analytics-depth is not uniformly a good
Phase 2 investment or uniformly a trap. The buildable slice (baseline
deviation, association-rule correlation, occupancy-aware HVAC hints) rides
on data and infrastructure PadSpan already has, and matches what actually
ships successfully at residential scale today (Nest, Ecobee, Flo, Phyn —
all baseline/heuristic, none fleet-ML). The unbuildable slice (predictive
maintenance, enterprise FDD) is specifically the BMS-vendor language the
original question borrowed, and the evidence says clearly it requires a
scale of data PadSpan's architecture cannot reach, independent of
developer skill or AI assistance.

### I. Named comparables for §3F — does any real product already solve
"many typed things on one canvas" the way the registry fix proposes?
§3F names the smell (Fowler's Shotgun Surgery) and the canonical CS fix;
these are working systems that actually ship that fix, spanning
mapping/GIS, the HA ecosystem specifically, a cross-vendor smart-home
standard, and — per the brief to look outside HA too — a non-HA visual
editor and the game-engine answer to type explosion.

**Exact scale, grepped directly rather than re-estimated:** the identical
seven-way membership chain — `isFan || isMotion || isTemp || isAir ||
isHumidity || isLock || isFlood` — appears **three separate times inside
`iso_lights.js` alone** (lines 2768, 2790, 2795), plus independent copies
again in `lights_map.js` and `maps.js`. Shotgun Surgery in its most
literal form: not just "many files," the *same line* hand-retyped
repeatedly inside one file.

- **QGIS** separates "what kind of data is this" from "how do I draw
  it" into two registries — `QgsProviderRegistry` for data-source types,
  `QgsRendererRegistry`/`QgsSymbolLayerRegistry` for geometry-type
  styling — each populated by one registration call per type; every
  existing tool (attribute table, styling panel, export) queries the
  registry instead of enumerating known types.
  ([QgsRendererRegistry](https://qgis.org/pyqgis/master/core/QgsRendererRegistry.html),
  [QgsProviderRegistry](https://api.qgis.org/api/classQgsProviderRegistry.html))
  The closest 1:1 analogue to Atlas: PadSpan needs QGIS's *metadata*
  registry, not a renderer registry — `iso_lights.js`'s draw code can
  stay one function.
- **Home Assistant's own `device_class` system** is the same ecosystem
  solving the identical problem at real scale — `sensor/const.py`
  (current `dev` branch) maps class-specific behavior into flat dicts
  keyed by the enum, e.g. `DEVICE_CLASS_UNITS: dict[SensorDeviceClass,
  set[...]] = {SensorDeviceClass.TEMPERATURE: set(UnitOfTemperature),
  SensorDeviceClass.ENERGY: {UnitOfEnergy.WATT_HOUR, ...}, ...}`
  ([source](https://github.com/home-assistant/core/blob/dev/homeassistant/components/sensor/const.py)) —
  table lookups, no per-consumer if/else chains. Honest counterweight
  from the same source ecosystem: an HA architecture discussion on
  adding one new binary_sensor device class documents real friction even
  with this registry in place — "it's extremely difficult to override"
  some properties, and one new class still needs coordinated changes
  across core, frontend, and docs
  ([discussion #696](https://github.com/home-assistant/architecture/discussions/696)).
  A registry retires the *rendering/filtering* duplication; it doesn't,
  and shouldn't try to, make inventing a genuinely new concept free.
- **`ha-floorplan`** (the actively-maintained HACS card mapping
  arbitrary HA entities onto an SVG floorplan — the single closest
  community project to Atlas in spirit) maps entities to SVG elements by
  id, with entity groups, state→CSS-class mappings, and templates all
  defined in user-authored YAML, and **no per-domain exclusion-list code
  in the card itself at all**
  ([README](https://github.com/pkozul/ha-floorplan/blob/master/README.md)).
  The most humbling comparable in this pass, not the most flattering
  one: a same-ecosystem peer of comparable scope never produced this
  problem — real evidence the ~25-site cost was avoidable from day one,
  not an inherent tax of "visualize many device types."
- **Matter** (the current cross-vendor smart-home standard — Alexa,
  Google Home, and Apple all implement it) defines a device type as a
  bundle of *clusters* (on/off, level-control, boolean-state…) plus
  semantic tags, so a generic client renders a device correctly by
  asking "does this have cluster X," never "is this specifically a
  flood sensor"
  ([device data model](https://developers.home.google.com/matter/primer/device-data-model)).
  The most directly transferable idea for naming the registry's fields:
  after *capabilities* (`castsLight`, `hasAuraPool`), not class identity.
- **Outside HA entirely, as instructed:** an ECS (entity-component-
  system, the standard game-engine answer to type explosion) makes
  behavior come from which components an entity holds, queried
  generically, never from concrete type
  ([overview](https://en.wikipedia.org/wiki/Entity_component_system)) —
  correct *mental model*, wrong *weight*: a full ECS runtime would be
  over-engineering for ~7-12 device classes in a UI codebase. Figma's
  plugin API similarly keys node behavior off a `type` property
  consumers switch on
  ([node types](https://developers.figma.com/docs/plugins/api/nodes)) —
  closer to PadSpan's actual scale, but still a heavier per-type-file
  contract than a flat capability table needs. Grafana's `PanelPlugin` +
  `FieldConfig`/`DisplayProcessor` system
  ([PanelPlugin.ts](https://github.com/grafana/grafana/blob/master/packages/grafana-data/src/panel/PanelPlugin.ts))
  is the real production-scale version of this idea, cited here as a
  weight *ceiling*: it exists because Grafana ships third-party,
  out-of-tree panel types. PadSpan's device classes are first-party and
  in-tree — building Grafana's version of this would solve a problem
  PadSpan doesn't have.

**Net finding for §3F/Phase 2a:** every comparable that stayed
maintainable at a similar or larger scale (QGIS, HA core, ha-floorplan)
used the same shape already proposed — one flat table, one entry per
type, consumed generically — never a plugin loader or a component
runtime. That confirms Phase 2a's registry is right-sized, not
under-scoped, and confirms (via `ha-floorplan` specifically) this is a
self-inflicted, not inherent, cost. Nothing found here changes Phase
2a's shape; it corroborates it with the exact category of comparable
the founding question named by example (QGIS layer types, Leaflet/
Mapbox custom-layer patterns, big HACS Lovelace-card projects, non-HA
visual editors and game-engine ECS).

---

### J. Alarm/Alert Subsystem Architecture — Deep Dive (restored)

Scope of this pass: given that flood is PadSpan's first bespoke alarm
subsystem (built from scratch this session, see §1), and the founding
worry is "five different bespoke alarm subsystems that don't share
code," this section researched how mature systems — inside and
deliberately outside the HA/smart-home world — architect alarm/alert
handling as a *general* subsystem, not a per-hazard-type build.

**Home Assistant's own `alert` integration** ([docs](https://www.home-assistant.io/integrations/alert/))
is HA core's existing, generic answer to exactly this problem: watch
any entity for a target state, fire repeating notifications
(`repeat:` a list of minute intervals), support `can_acknowledge`
(silences the repeat without touching the underlying entity),
`skip_first`, and a `done_message` sent once the source returns to
normal. It is hazard-agnostic by construction — nothing in it knows or
cares whether the watched entity is a flood sensor, a door, or a
freezer temperature. PadSpan's flood feature does not use it, or
anything shaped like it; `flood_latch.py` is a bespoke module built
around one `device_class` string. This is the single most concrete
confirmation available that PadSpan skipped past an existing generic
building block straight to a hazard-specific one — worth knowing even
though `alert` alone would not have been sufficient (see below).

**`alarm_control_panel`** ([docs](https://www.home-assistant.io/integrations/alarm_control_panel/),
[architecture discussion](https://github.com/home-assistant/architecture/issues/54))
is HA core's real state machine for intrusion: `disarmed`,
`armed_home/away/night/vacation/custom_bypass`, `arming`, `pending`,
`triggered`, each with defined entry/exit-delay semantics. The
community's **Alarmo** ([github.com/nielsfaber/alarmo](https://github.com/nielsfaber/alarmo),
[guide](https://smarthomescene.com/guides/alarmo-make-your-own-alarm-system-in-home-assistant/))
builds a full multi-area, multi-user, per-sensor-bypass security
product entirely on top of that one generic FSM — sensors are
*enrolled* into the alarm as a role ("this entity participates in
armed_away's perimeter"), completely decoupled from whatever
`device_class` or rendering treatment that entity gets elsewhere in
HA. That decoupling — *capability/role is a separate axis from
physical device_class* — is the architectural lesson most directly
transferable to Atlas's exclusion-list problem (see §L below), not
just to alarms.

**Matter's Smoke CO Alarm cluster** (device type `0x0076`,
[matter-survey.org](https://matter-survey.org/device-types/118),
[Sensereo MSC-1](https://sensereo.com/msc-1/)) is the current (2026)
cross-vendor standard for exactly one PadSpan-relevant hazard class. It
models smoke and CO as two *independently tracked* alarms sharing one
attribute *shape* (state enum, battery-alert, test-in-progress,
end-of-service, interconnect-alarm attributes) rather than one flag or
two unrelated mechanisms — i.e. the standards body's answer to "does
smoke share code with CO" is "same template, separate instances," which
is the shape this report recommends PadSpan move flood toward before a
second hazard type arrives.

**Flo by Moen and Phyn** are the closest deployed commercial analogs to
PadSpan's flood feature specifically — a residential water-shutoff
alarm engine, in production, at scale. Flo's documented severity model
([Moen Solutions](https://solutions.moen.com/Smart_Sump_Pump_Monitor/Sump_Pump_Monitor:_Tips/Managing_Alerts))
is three tiers — **Critical / Warning / Informative** — with severity
*driving behavior*, not just color: a Critical alert triggers
auto-shutoff and notifies **even if the user disabled notifications**;
Warning/Informative respect user prefs. FloSense
([explainer](https://solutions.moen.com/Flo_Smart_Water_Monitor_and_Shutoff/Alerts,_Notifications,_and_Settings/FloSense,_explained))
adds anomaly detection on usage patterns on top of the binary
leak-sensor case — a plausible future direction, not an urgent gap.
Both Flo (native `flo` HA integration, plus a maintained fork
[ajplotkin/moen_flo](https://github.com/ajplotkin/moen_flo) after
Moen's SSO migration broke the original) and Phyn
([community thread](https://community.home-assistant.io/t/phyn-integration-water-leak-detector/316197))
integrate into HA the same way everything else does — one more bespoke
custom component each. There is **no emerging water-alarm standard**
the way Matter did for smoke/CO; if PadSpan wants a richer flood
severity model it has to invent one, not inherit one. Flo's 3-tier
model is the best available off-the-shelf reference to crib from.

**ISA-18.2** (process-industry alarm management,
[ISA explainer PDF](https://www.isa.org/getmedia/55b4210e-6cb2-4de4-89f8-2b5b6b46d954/PAS-Understanding-ISA-18-2.pdf),
[instrumentationtools summary](https://instrumentationtools.com/isa-18-2-alarm-management-in-process-plants/))
and its UK-guidance counterpart **EEMUA 191**
([EEMUA](https://www.eemua.org/products/publications/print/eemua-publication-191),
[Wikipedia](https://en.wikipedia.org/wiki/Alarm_management)) define a
richer state machine than PadSpan's flood latch has: an alarm's
lifecycle is genuinely **three independent axes**, not one flag —
active/normal, acknowledged/unacknowledged, and
shelved/suppressed/out-of-service (administratively silenced). An
acknowledged alarm stays visible until the condition itself clears;
acknowledging never auto-resets a still-active condition. EEMUA also
publishes hard numeric benchmarks worth borrowing as a discipline, not
just a citation: **≤1 alarm/10 min is "manageable" steady-state,
>10 alarms/10 min is a declared "flood"**
([benchmark source](https://industrydigits.com/resources/alarm-load-scorer/)).
PadSpan's flood latch has no rate limiting at all today — nothing
would stop a chattering sensor from generating unlimited alarm-history
entries once a unified history exists.

**NFPA 72** (fire alarm code) independently arrives at the same
three-verb split, but for physical panels: **Acknowledge** (silence the
local buzzer, log that a human saw it, no other effect), **Silence**
(also cut the building horns/strobes), and **Reset** (clear the latch —
correctly documented as *not* implying the event was false, and only
appropriate after the cause is actually gone) —
[facpmanuals](https://facpmanuals.com/blog/alarm-vs-trouble-vs-supervisory),
[48fireprotection](https://www.48fireprotection.com/silence-fire-alarm-panel-dilemma/).
PadSpan's flood alarm today has exactly **one** affordance —
`async_reset_latch` — that conflates all three: there is no
acknowledge-without-clearing action, and no silence-without-resetting
action. Somebody who sees the alert and wants to say "I know, working
on it" currently has no move except to make the alarm disappear
entirely.

**PagerDuty / Opsgenie / Prometheus Alertmanager** — deliberately
researched *outside* home automation, as instructed, because this is
where "alarm engine as reusable software infrastructure" is most
mature. The transferable ideas:
- **Alert vs. Incident are two different objects**
  ([PagerDuty docs](https://support.pagerduty.com/main/docs/incidents)):
  a raw signal (alert) is distinct from the tracked, human-facing thing
  it routes into (incident). Severity lives on the alert; priority on
  the incident. PadSpan has neither distinction today — one
  `binary_sensor` state change *is* the alarm, with nothing in between
  a generic history UI could show across hazard types.
- **Acknowledge halts escalation without resolving**
  ([escalation-policy docs](https://support.pagerduty.com/main/docs/escalation-policies)) —
  a third, independent lineage (software incident response, not
  life-safety code or process industry) converging on the identical
  ack≠resolve split NFPA 72 and ISA-18.2 already landed on. Three
  unrelated fields agreeing this precisely is a strong signal this is
  a near-universal correct decomposition, not something to reinvent
  from scratch.
- **Escalation policies are declarative, reusable objects** — an
  ordered rule list plus timeout, defined once and attached to N alert
  sources, rather than written per alert type.
- **Alertmanager's grouping/routing/inhibition**
  ([docs](https://prometheus.io/docs/alerting/latest/alertmanager/),
  [routing-tree guide](https://www.bigiron.cc/guides/alertmanager-routing-trees-grouping-inhibition-and-silences)):
  route by label (e.g. severity) to different receivers, and
  **inhibit** a lower-severity alert when a related higher-severity one
  is already firing. Directly relevant the day PadSpan has two
  simultaneous alarm types (e.g. a leak *and* a door left open) and
  doesn't want to spam a family member, whose existing rule elsewhere in this
  project is "plain language, taps only" — an alert flood to her is a
  concrete, already-flagged failure mode, not hypothetical.

### K. Alarm/alert angle — explicit confirm/challenge callouts

- **CONFIRMS** the premise: `alarm_control_panel` + Alarmo are an
  existence proof, inside HA's own component model, that a generic FSM
  plus declarative per-entity enrollment scales to a real multi-zone,
  multi-user security product — this is not a theoretical architecture,
  it is shipping.
- **CONFIRMS**: the ack/silence/reset three-way split is not something
  PadSpan needs to invent — NFPA 72 (life-safety code), ISA-18.2
  (industrial process standard), and PagerDuty/Opsgenie (software
  incident tooling) are three independent lineages that converged on
  materially the same decomposition. That convergence is the strongest
  single piece of evidence in this whole research pass.
- **CHALLENGES the scale, not the direction**: every industrial
  reference above (ISA-18.2's full 7-state machine, EEMUA's flood
  benchmarking discipline) assumes a staffed console and a real risk of
  alarm floods at volume. PadSpan is a single-operator residential
  product currently optimizing for 1.7 releases/day feature velocity —
  adopting the *full* ISA-18.2 state machine (including shelved,
  suppressed, out-of-service as separate first-class states) would be
  over-engineering relative to actual usage. Flo's simpler 3-tier
  severity model, with severity gating behavior, is the right *scale*
  reference; ISA-18.2/EEMUA are the right *shape* references
  (independent axes, don't conflate ack/reset) to borrow from without
  importing all seven states.
- **CHALLENGES harder, and this is the one genuine surprise of the
  pass**: none of the commercial products actually researched — Ring,
  SimpliSafe, ADT, Flo, Phyn, Nest Protect — are architected as a
  *general* alarm engine a third party extends per new hazard type.
  Each is a closed product built around one hazard type (or one tightly
  bundled hardware line). The pattern PadSpan should build toward is
  structurally closer to PagerDuty/Alertmanager (software
  incident-management infrastructure) than to anything an actual
  smart-home vendor ships. Put plainly: **no home-automation product on
  the market today has already solved "N heterogeneous hazard types on
  one shared alarm engine."** Building one is not catching up to Ring
  or ADT — it's ahead of the category. That cuts both ways: it's a real
  gap in the market PadSpan is positioned to fill (multi-hazard Atlas,
  not single-hazard like every competitor researched), but it also
  means there is no proven reference implementation to copy wholesale —
  this is genuine, unde-risked product design, not a "well-trodden path
  everyone else already validated."

### L. Verdict on this angle (alarm/alert angle)

**On the core question — should there be a generic alarm engine —
the evidence strongly confirms the owner's instinct.** Every serious
reference model researched (life-safety code, industrial standard,
software incident tooling, and HA's own core `alert`/`alarm_control_panel`
domains) independently separates *hazard type* from *alarm state
machine* from *severity/escalation policy*. `flood_latch.py` is
currently **not** built that way — it is hazard-specific top to
bottom, with no generic `AlarmRecord`/`AlarmLatch` object underneath a
future smoke, CO, or intrusion alarm could reuse. Building a second
bespoke alarm subsystem the same way flood was built would repeat, and
likely worsen, the exact ~25-edit-sites cost already measured for a
*much* simpler feature (rendering one device class) in §1 — alarms
carry more surface per hazard (trigger, acknowledge, reset, notify,
escalate, history) than pure rendering does, so the per-hazard
multiplication is worse, not better, if left unfixed.

**But don't over-scope the fix.** The right-sized target is closer to
Flo's 3-tier severity model wearing ISA-18.2/NFPA-72's independent-axes
shape than to the full industrial 7-state machine: one `AlarmRecord`
concept — `{hazard_type, entity_id, severity (critical/warning/info),
triggered_at, acknowledged_at | None, cleared_at | None, expires_at}` —
with one Python module and one JS mirror, distinct **acknowledge**
(stop the noise, don't clear) and **reset** actions (today only reset
exists), and one shared alarm-history list instead of one bespoke
banner per hazard. Flood should be refactored into the *first caller*
of that engine, not thrown away — it already ships and is tested; this
is a generalization pass, not a rewrite. The Phase 2 plan below (§5.1)
sizes this as concrete, buildable work, and the timing argument is
simple: it's far cheaper to make flood the first caller of a shared
engine now, with one hazard type in play, than to do it later with two
or three already hand-built the bespoke way.


## 4. Gaps

Ranked by leverage — highest-cost-if-ignored first.

**4.1 — Device-class Shotgun Surgery (the counted finding).** ~25 edit
sites across 4 frontend files for one new device class, growing with every
class added, no single source of truth for "what device classes exist and
what each one means." This is the one item on this list that is actively
compounding rather than static. See §5, Phase 2a.

**4.2 — CORRECTED 2026-09-19, before Phase 2b implementation started.**
The original claim below ("18 `.mjs` scripts... not wired into any
GitHub Actions workflow") was checked before building on it and found
**false**: every one of the 19 `.mjs` scripts under `tests/js/` is
already wrapped by a Python test (`subprocess.run`, asserting on the
JSON result) and every one of those Python tests already runs inside
`python -m pytest tests -q`, which `pytest.yml` already runs in CI on
every push across 2 Python versions. No skip logic hides them; a
missing/failing `node` invocation fails the Python test hard. The
research pass that wrote this finding didn't check whether the scripts
were invoked from elsewhere before concluding they were orphaned — left
here struck through, not deleted, per this project's own rule to say
what actually happened rather than silently fix it.

**The real, narrower gap**, found while verifying the above: `tests/js/render_smoke.mjs`
walks the entire `views/` directory (44 files) and invokes every
export — self-maintaining coverage, new views are covered automatically.
The 4 top-level frontend files (`panel.js`, `lights_panel.js`,
`help_content.js`, `sample_data.js`) don't get that same treatment —
only one narrow method of `panel.js` is covered
(`whats_new_card.mjs`, one specific card). There's real precedent for
this costing something: `whats_new_card.mjs`'s own header documents a
real shipped bug (2026-08-25) where a rare-state method in `panel.js`
referenced an undeclared variable, passed `node --check`, passed the
full test suite, and silently blanked the Overview tab for every
install until one hit that rare state. `lights_panel.js` and
`help_content.js` have no equivalent net under them today. Separately,
there is genuinely no JS linter (ESLint or equivalent) anywhere, and
even the Python lint (`ruff`) isn't CI-enforced, only `pytest -q` is —
that part of the original claim holds.

**4.3 — Two "god files."** `maps.js` at 11,075 lines and `iso_lights.js`
at 6,116 lines each now exceed the size where a single read (by the owner or
an agent) captures the whole picture — precisely the condition §3C's
sources identify as where local-correct/global-wrong edits concentrate.
Splitting these should happen *after* 4.1's registry work, not before:
the registry will make the real seams (rendering vs. inspector-panel
logic vs. hover/HUD state) visible instead of requiring a guess.

**4.4 — No architectural fitness function guarding the registry (once
built).** Even after 4.1 lands, nothing currently stops a *future* device
class from silently skipping one of the registry's consumers the way
today's flood sensor skipped nothing (it just cost 25 edits) but a less
careful pass might. A cheap structural test — "every key in
`DEVICE_CLASS_REGISTRY` is iterated by every module that claims to
consume it" — turns a silent omission into a CI failure instead of a
user-reported bug. This is a ~20-line test, not a project.

**4.5 — Review-bandwidth is unverifiable from outside and self-reported
research says it erodes invisibly.** Not a structural gap the repo can
show — a discipline question only the owner can answer. Named explicitly in
§2 and §3D so it doesn't get lost as "not really a finding."

**4.6 — Scope has grown past the founding document without an explicit
re-scoping decision.** §1 already establishes the BLE-assistant → general
building-platform shift factually. The research in §3 (particularly the
Medium piece on "scope creep as discovery" and the Kalvium Labs guidance
that "agents don't infer scope — vague tasks produce vague results,
milestones set direction") frames AI-agent-driven scope growth as often
*legitimately generative*, not automatically bad — but only when it's
gated by an explicit decision rather than accreting by default feature-
by-feature. Nothing in this repo currently states, in one place, "these
are the surfaces PadSpan intentionally covers now, and here's the
decision trail for each addition." `PROJECT_SYNOPSIS.md` is the day-1
anchor; there's no day-225 equivalent stating the *current* intentional
scope. This is a paperwork gap, not a code gap, but it's the one that
would let a future contributor (or the owner in six months) tell the
difference between "this feature is core" and "this feature happened."

**4.7 — No baseline-deviation or cross-device-correlation layer on top of
Insights/Busy Times data (§H).** The dwell-time/occupancy history PadSpan
already computes has no "is this different from that room's own normal"
layer, and nothing correlates activity across device classes. Distinct
from 4.1-4.6: this isn't debt from something built wrong, it's upside not
yet built on data already in hand — see Phase 2g. Also worth stating
explicitly as a *boundary*, not a backlog item: true predictive
maintenance / equipment-failure prediction is out of reach for a
single-home, no-telemetry, GPLv3 project regardless of effort (§H) — this
gap should stay bounded to what §H's research found buildable, not expand
toward BMS-vendor "predictive maintenance" framing.

**4.8 — Alarm/Alert Subsystem, specific measured gaps (§J-L).**

1. **No generic alarm object.** `flood_latch.py` is hazard-specific
   from its first line (`device_class == "moisture"` is hardcoded into
   the event listener). There is nothing underneath it a smoke, CO, or
   intrusion alarm could call into — the *next* alarm type gets built
   the same bespoke way unless this is fixed first.
2. **No severity axis at all.** A slow drip and a burst pipe render
   identically — one boolean latch, no tiers. Flo's Critical/Warning/
   Informative split (§J) is the nearest off-the-shelf model and is
   absent entirely.
3. **Acknowledge and Reset are conflated into one action.** Only
   `async_reset_latch` exists. NFPA 72, ISA-18.2, and PagerDuty all
   treat "I've seen this" and "this is actually resolved" as distinct,
   independently-triggerable actions (§K); PadSpan has no
   acknowledge-without-clearing move today.
4. **No unified alarm history/log.** Today's UI surface is a single
   sidebar banner for the one alarm type that exists. There is no
   list a user (or the owner, debugging) can open to see "every alarm,
   every hazard type, in one place, in order" — which is also the
   object §J's Alertmanager/PagerDuty pattern needs to exist before
   grouping, routing, or inhibition between hazard types is even
   possible to build.
5. **No rate limiting / flood protection.** Nothing stops a chattering
   sensor from generating unbounded alarm events once a history exists
   to fill up. EEMUA's numeric benchmark (§J) is a usable off-the-shelf
   threshold to borrow, scaled down for a single-operator residential
   context (not the literal industrial number).
6. **No escalation policy concept.** Today's flood alarm does exactly
   one thing (persist a sidebar banner) regardless of how long it's
   been ignored. There's no declarative "if unacknowledged after N
   hours, do X" — the PagerDuty/Opsgenie pattern (§J) shows this
   should be a reusable policy object, not per-hazard code, once it's
   needed (not urgent for a single-operator household today — flagged
   as a gap, not a must-fix-now item).


## 5. Phase 2 Plan

Ordered; each phase should be a closed loop (built, tested, committed)
before the next starts, matching the project's own existing pattern
(Automorph critique → fix → adversarial re-review → fix).

**Phase 2a — Build the device-class registry (addresses 4.1, 4.4).**
One data table — `DEVICE_CLASS_REGISTRY` in Python, mirrored or generated
into JS the same way `bright_build.py` already proves this codebase knows
how to keep one generated artifact in sync with one source — with one row
per device class (motion, temp, humidity, air, door, lock, flood, and
whatever comes next), declaring per-class: border color, code letter,
shape, "casts light/aura" flag, health-check behavior, turn-on/off
eligibility, aggregate-count bucket. Refactor `light_codes.js`,
`lights_map.js`, `iso_lights.js`, and `maps.js` to read from it instead of
each maintaining its own exclusion list. Add the structural fitness test
from 4.4 in the same phase, not later — it's what makes the fix stick.
This is the single highest-leverage item in this report: it directly
retires the counted cost from today's session and prevents it from
recurring for every device class after this one.

**Phase 2b — REVISED 2026-09-19 (original scope was based on the
incorrect 4.2 claim above).** Not "wire JS into CI" — it already is.
Revised to the real gap: extend `render_smoke.mjs`-style
import-and-invoke coverage to the 3 top-level frontend files that don't
have it (`lights_panel.js`, `help_content.js`, `sample_data.js`;
`panel.js` has partial coverage via `whats_new_card.mjs`), following the
exact pattern that already caught a real shipped bug in `panel.js`. Add
a JS linter (ESLint, light config) as a separate, smaller item — genuinely
missing, unlike the smoke-test claim.

**Phase 2c — Split `maps.js` and `iso_lights.js` (addresses 4.3).**
Do this *after* 2a, using the seams the registry work exposes (rendering,
inspector-panel actions, hover/HUD state are the likely natural splits
based on what's already named in `09_HARD_WON_RULES.md` and the Automorph
critique's file references) rather than guessing at a split up front.

**Phase 2d — Schedule the fresh-pass cadence, don't leave it one-off
(addresses items 4 and 6 of §3E).** The Automorph critique + adversarial
re-review is proof this project already knows how to do this well; the
gap is that it happened once, reactively, for one feature. Pick a cadence
(e.g., before any feature that touches more than N files, or a fixed
monthly slot) and treat it as a standing item, with outcomes logged the
same way `AUTOMORPH_CRITIQUE.md` logs applied/deferred status per finding
— so a future critique's findings can't quietly go stale the way this
session's memory *believed* (incorrectly, per §2's correction) this one
had.

**Phase 2e — Write the day-225 scope charter (addresses 4.6).** A short,
one-sentence-per-surface document — BLE presence, Atlas, Automorph,
Locate, Insights/Busy Times, PadSpan Bright, Forensics — stating for each
whether it's core-and-extending, stable-and-maintained-only, or
candidate-for-freeze. This doesn't slow anything down; it gives the next
feature request (from the owner, a user, or an agent's own "opportunity I
noticed" suggestion, which §3A's research says is a real and recurring
event with agentic tools) something explicit to be measured against
instead of accreting by default. Fifteen minutes of writing, and it
directly answers "am I on the right path" for every feature after this
report, not just the ones already shipped.

**Phase 2f — Name the review-bandwidth discipline (addresses 4.5).**
Not a build task. A standing personal check, done honestly and
periodically: is every diff still being read line-by-line before it
ships, or has "tests are green" quietly become the actual approval
criterion? Every source in §3D says this erosion is real, gradual, and
invisible from the inside — naming it is the only defense that doesn't
require building anything.

**Phase 2g — Baseline-deviation + occupancy-aware HVAC hint on existing
Insights data (addresses 4.7, §H).** Two small, sequenced items, both
riding on data/infrastructure already shipped rather than requesting new
capability: (1) flag when a room's dwell time/occupancy deviates from
that same room's own rolling history — no ML dependency, same pattern
Flo/Phyn and ecobee's production thermostats already use at residential
scale; (2) a passive suggestion surface joining existing BLE room-presence
with existing Atlas temperature/humidity placement ("Living Room empty
6h, zone still heating"), not closed-loop control. Do this *after* Phase
2a — both items are per-device-class logic that should read from the
registry, not add an eighth place a device-class list gets hand-maintained.
Association-rule cross-device correlation is explicitly a *candidate*, not
committed scope: validate against actual Install Base device-class
diversity first (a data question) before building it. Predictive
maintenance / equipment-failure prediction is explicitly out of scope,
not deferred — §H's research found it requires fleet telemetry this
project cannot and should not collect.

**Phase 2h — Alarm Engine, proposed scope (addresses 4.8, right-sized, not ISA-18.2-in-full).**

**Principle:** generalize now, while there is exactly one hazard type
(flood) to migrate, rather than after a second one is hand-built the
bespoke way. This is a refactor of what already ships, not a rewrite —
flood_latch.py's actual behavior (2-day active window, event-driven
capture) is correct and tested; only its *shape* (hazard-specific
top-to-bottom) needs to change.

1. **New shared module, backend:** `alarm_engine.py` — one
   `AlarmRecord` shape: `{hazard_type, entity_id, severity
   ("critical"|"warning"|"info"), triggered_at, acknowledged_at |
   None, cleared_at | None, expires_at}`, stored under one
   `SettingsStore` key (`alarms`, replacing `flood_latches` as a
   migration, not an addition) keyed by hazard_type + entity_id.
   Exposes `trigger()`, `acknowledge()`, `reset()`, `is_active()`,
   `is_acknowledged()` — hazard-agnostic; a hazard module (flood,
   later smoke/CO/intrusion) only supplies the `device_class` →
   `hazard_type`/`severity` mapping and calls in.
2. **New shared module, frontend:** `alarm_engine.js` mirroring the
   same shape and the three actions, replacing `floodLatchActive()`'s
   hazard-specific logic with a call into the shared module — the
   "change one, change both" maintenance burden the flood_latch.py
   docstring already flags becomes "change one" instead.
3. **Migrate flood as the first (and only, for Phase 2) caller.** Do
   not build a second hazard type in Phase 2 just to prove the engine
   generalizes — that risks scope creep on a feature nobody asked for
   yet. Flood becomes the engine's first real caller; the abstraction
   is validated by successfully carrying flood's existing behavior
   (2-day window, one entry per sensor) through the refactor with the
   existing test suite still green, not by adding new hazard types.
4. **Add the missing acknowledge action** to the UI (distinct button
   from Reset) — the single most concrete, user-visible gap from §4.8,
   and the cheapest of these to ship on its own if the rest of the
   engine work needs to be sequenced later.
5. **Add one unified alarm history view** (even a simple list, not a
   dashboard) — the object every other item on this list, and any
   future escalation/routing work, needs to exist first.
6. **Explicitly deferred out of Phase 2** (flagged as future work, not
   silently dropped): severity-driven auto-actions (Flo's
   auto-shutoff-on-Critical pattern — PadSpan has no valves to shut
   off, but the *pattern* — severity gates behavior, not just color —
   applies to any future hazard type with an actuator), escalation
   policies, alarm-rate limiting/flood protection, and shelve/
   suppress/out-of-service states. None of these are needed until
   there's a second hazard type or a second household member actively
   managing alarms; building them now would be exactly the kind of
   speculative complexity the owner's own guidelines warn against.


---

**Bottom line:** the trajectory is sound. The evidence for that isn't
the release count — it's the test-to-source ratio, the existence of a
real closed-loop design critique, and a documentation habit most solo
AI-paired projects in the research above don't have. The one place this
report disagrees with "everything's fine" is the device-class pattern,
and that disagreement comes with a specific, small, already-precedented
fix (2a) rather than a call to slow down.

---

## 6. Outside Home Assistant: The BMS / Digital-Twin Category

The owner's brief specifically asked to research "even outside HA" — the
commercial Building Management System (BMS) and digital-twin category
PadSpan is drifting toward as it adds device control, alarms, and
analytics on top of a spatial map: Honeywell Forge, Johnson Controls
Metasys/OpenBlue, Siemens Desigo, Willow, Disruptive Technologies,
Density.io, Matterport for Business. This section is that pass, run
independently of §§1-5 above (live web search, 2026-09-19) — it
converges on the same headline fix (§5's device-class registry) from a
third, completely different direction, which is worth taking as a
signal in itself: three unrelated research angles (refactoring
literature, agentic-entropy research, and building-industry ontology
practice) landing on the identical missing piece.

**What real BMS/digital-twin platforms do that a home never needs — the
dividing line is portfolio scale, not any single feature.** Willow's
knowledge graph "unifies spatial, static, and live data" across "75+
built world systems" and "over 10 million telemetry points in
real-time" ([Willow platform](https://willowinc.com/willow-platform/)); its Oxford deployment is cited as
"approaching $1 million per year in avoided operating and energy
costs" ([Willow Knowledge Graph](https://willowinc.com/knowledge-graph/)) across a large commercial estate, and even its
flagship single-building deployment (Brookfield's One Manhattan West)
is measured in "200 hours of developer *integrator* time saved in a
single month" ([Microsoft: RealEstateCore now available](https://techcommunity.microsoft.com/blog/iotblog/realestatecore-a-smart-building-ontology-for-digital-twins-is-now-available/1914794)) — the unit of value is
professional integrator time across many disparate systems, a problem
PadSpan doesn't have because HA already normalizes every entity before
Atlas ever sees it. Siemens Desigo CC's headline capability is protocol
translation — "BACnet, OPC, Modbus and SNMP" plus "KNX over IP and
M-bus TCP/IP" ([Siemens Desigo CC](https://www.siemens.com/us/en/products/buildingtechnologies/automation/desigo-cc.html)) — dozens of incompatible field protocols
normalized into one view. **This is the single biggest reason PadSpan's
~100k lines look small next to "a real BMS": it is missing an entire
subsystem by design, correctly** — HA did that work already. Willow's
"Active Control" grid-interactive load shedding requires a utility
relationship no residence has. None of this is latent value PadSpan is
leaving on the table by not building it — it's a different problem
class, and chasing it would be a mistake, not a gap.

Formal ISA-18.2-style alarm-management apparatus — Honeywell Forge's
Active/Archived alarm console with per-alarm flag/unflag and a full
"Alarm Management Reporting" product line (Collector/Archiver/Analyzer)
for compliance documentation ([Honeywell Forge Alarm Management Reporting](https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc-list-alarm-management/hon-alarm-reporting.pdf)) —
exists because an industrial control room can have hundreds of alarms
fire in minutes during an upset and a missed one is a safety incident.
ISA-18.2 itself defines "alarm flood" as "more than 10 alarms
annunciating in a 10-minute period" ([Emerson: Alarm Rationalization white paper](https://www.emerson.com/documents/automation/white-paper-alarm-rationalization-deltav-en-56654.pdf)). A house
doesn't have that volume problem; PadSpan's flood-sensor alerting
should borrow the *shape* of alarm-state discipline (acknowledge vs.
resolve as distinct actions — the same split Section 3's sources arrive
at from software-engineering literature) without importing the
committee-and-compliance-reporting apparatus built for a very different
scale problem.

**Device-on-floorplan control has both a commercial and an open-source
precedent, and both point at exactly the registry fix §5 Phase 2a
proposes — from a third angle.** Desigo CC binds devices to floorplans
via "dedicated graphic templates" drawn from a *library*, looked up by
device type rather than hand-drawn per feature ([Siemens Desigo CC](https://www.siemens.com/us/en/products/buildingtechnologies/automation/desigo-cc.html)).
Matterport's "Tags" are one generic attachable-metadata primitive reused
across every asset type — "each tagged asset linked to its
specifications, maintenance history, and vendor contact" ([Matterport: Facilities Document Management](https://matterport.com/blog/facilities-document-management)) —
not a different code path per asset class. Most directly: **Brick
Schema, Project Haystack, and RealEstateCore** are metadata ontologies
that exist in the building industry because "highly customized and
inconsistent modeling practices" emerge whenever a device's class and
capabilities are ad hoc logic instead of structured data ([Brick vs. Haystack comparison](https://medium.com/@erik_paulson/a-comparison-of-the-brick-schema-and-project-haystack-2a9adde5013a), [Brick Ontology docs](https://docs.brickschema.org/intro.html)).
Brick represents a device as "triples of descriptive tags" ([Brick comparison page](https://brickschema.org/comparision/)) so
type and relationships are *looked up*, not hard-coded into every
consumer — the building-industry name for the identical problem §3F
names "Shotgun Surgery" and §4.1/§5 Phase 2a already propose fixing
with `DEVICE_CLASS_REGISTRY`. PadSpan does not need RDF triples or a
graph database at 7 device classes, but the fact that an entire
industry independently built ontology standards to solve this exact
class of problem is strong outside confirmation that Phase 2a is the
right fix, not gold-plating.

**Occupancy-analytics vendors treat "what does this number mean" as a
first-class design problem — worth checking Busy Times/Insights against
directly, not assumed either way.** Density's public position is that
"occupancy sensor accuracy isn't one number" and for large-area sensors
they report "Time Within Tolerance" rather than a bare percentage,
because "real-world conditions matter more than a flat '99%' claim"
([Density: "99% Accurate" Occupancy Sensors](https://www.density.io/resources/the-truth-behind-99-accurate-occupancy-sensors)). BLE RSSI-derived peak-occupancy and
dwell-time numbers sit on the same kind of noisy substrate. This pass
did not check whether Busy Times/Insights currently present any
confidence/error framing or show bare figures — a direct, checkable
question against the live UI, not a finding either way, and a small
addition to the gap list below.

**Is there a real "residential-scale BMS" category, and who else is in
it?** No incumbent combining PadSpan's specific bundle — BLE room-level
presence, a full device/sensor floorplan, historical occupancy
analytics, and an alarm-acknowledgment workflow — at consumer pricing
and DIY install surfaced anywhere in this pass:
- The enterprise BMS/digital-twin vendors above are portfolio
  businesses by construction. Honeywell's "Remote Building Manager" is
  explicitly marketed at "small- to medium-sized buildings" ([Honeywell SMB press release](https://www.honeywell.com/us/en/press/2020/12/honeywell-makes-building-management-easier-for-small-to-medium-sized-buildings)) — still
  commercial SMB (offices, retail), not residential.
- The closest incumbents by price tier and install context are luxury
  home-automation platforms — Control4, Savant, Crestron Home, Josh.ai.
  Savant's "TrueImage" (tap real room photos to control devices) is the
  closest existing consumer metaphor to device-on-a-map control
  ([Digital Systems: Control4 vs Savant vs Josh.ai](https://www.digitalsystemsav.com/blog/smartsystemcomparison/)), but nothing surfaced shows any of them
  shipping occupancy heatmaps, dwell-time analytics, or an alarm-ack
  workflow — they're control-and-scene platforms, not
  sensor-fusion-plus-analytics platforms.
- The closest architectural peers for device-on-floorplan specifically
  are open-source HA cards — `ha-floorplan`, `housemap-card`,
  `houseplan-card` ([ha-floorplan](https://github.com/ExperienceLovelace/ha-floorplan), [housemap-card](https://github.com/AldenDana/housemap-card), [houseplan-card](https://github.com/Matysh/houseplan-card)) — visualization/control
  primitives with no BLE fusion, analytics, or alarm workflow from what
  surfaced.

Read honestly, this cuts both ways and research alone can't fully
resolve it: either PadSpan is early to genuine residential-BMS
whitespace the enterprise vendors have no economic reason to chase (one
house is a rounding error next to a portfolio contract) and the
luxury-AV incumbents have no technical reason to chase (they sell
installation and scenes, not analytics) — **or** nobody has found
sufficient home demand for occupancy heatmaps and alarm workflows to be
worth building, and PadSpan is testing that demand for the first time.
Only PadSpan's own install-base usage data (presence-only vs.
Atlas/Locate/Busy-Times/flood-alarm adoption) can tell these apart —
worth adding to Phase 2 as a validation step, not a build step.

**One additional, separate risk this pass surfaced:** Home Assistant's
security team has twice published coordinated disclosures naming
vulnerabilities in third-party HACS integrations — flaws that "allowed
an attacker to steal any file without logging in" ([HA Security Disclosure, Jan 2021](https://www.home-assistant.io/blog/2021/01/22/security-disclosure/), [HA Security Disclosure 2](https://www.home-assistant.io/blog/2021/01/23/security-disclosure2/)) — and
GitHub's security team separately published a methodology for auditing
HA integrations specifically because of this risk class ([GitHub Security Lab: Home Assistant code review](https://github.blog/security/vulnerability-research/securing-our-home-labs-home-assistant-code-review/)).
This is the specific vulnerability class (unauthenticated file/service
access via a third-party HACS integration) that matters most once an
integration controls locks and issues alarm state — which PadSpan now
does. Nothing found suggests PadSpan has this specific problem; the
point is that the risk category is proven, documented, and rising in
relevance as PadSpan's blast radius grows, independent of code
quality — and nothing in this repo shows it's been checked for.

**Confirms/challenges, explicitly:**
- **CONFIRMS**, from a third independent direction: the device-class
  registry (§5 Phase 2a) is the correct, highest-leverage fix — the
  building industry built entire ontology standards (Brick/Haystack/
  RealEstateCore) to solve the same problem Fowler's literature calls
  Shotgun Surgery and today's agentic-entropy research calls locally-
  correct/globally-arbitrary code.
- **CONFIRMS**: no commercial BMS/digital-twin vendor and no luxury
  home-automation platform currently bundles PadSpan's specific
  combination of pillars at residential price/install context —
  consistent with genuine whitespace, not evidence of reinventing a
  solved product badly.
- **CHALLENGES**, and this is new relative to §§1-5 above: PadSpan has
  crossed into a risk category (lock control + alarm state, shipped at
  1.7 releases/day through a HACS distribution channel with documented
  precedent for exactly this vulnerability class) that has nothing to
  do with code architecture and everything to do with review-from-
  outside — a gap this report did not previously name.
- **CHALLENGES, mildly**: "residential-scale BMS" positioning is
  architecturally plausible but not usage-validated. The absence of an
  incumbent is as consistent with untested demand as with unclaimed
  whitespace.

**Added to the gap list (§4), not duplicating it:**
- **4.9 — REVISED 2026-09-19 (codex cross-check, verified by hand): "no
  independent security review" overstated as "nothing in this repo
  shows it's been checked."** Real, deliberate security-conscious code
  and tests already exist against exactly the vulnerability class named
  below: `tests/test_maps_store.py::test_delete_map_rejects_path_traversal`
  and `::test_replace_image_rejects_path_traversal` are targeted
  path-traversal defenses with test coverage, not incidental. That's
  narrower than a systematic security review (still doesn't exist), but
  the claim that there's no evidence of security consideration was
  wrong. Gap stands, softened: **no systematic/independent review**,
  against the documented HACS third-party-integration vulnerability
  class, given PadSpan now controls locks and holds alarm state — but
  starting from "some targeted defenses already exist," not zero.
- **4.10 — Occupancy-analytics confidence framing is unverified**, not
  confirmed broken. Whether Busy Times/Insights present any
  uncertainty framing on peak-occupancy/dwell-time numbers wasn't
  checked against the live UI in this pass — a five-minute look, not a
  research question.
- **4.11 — REVISED 2026-09-19 (codex cross-check, verified by hand): the
  instrumentation this gap says is missing already exists.** Originally:
  "'Residential-scale BMS' positioning is unvalidated by usage data...
  only PadSpan's own install-base adoption data can [tell]." True that
  it's unvalidated — but PadSpan already has a full opt-in telemetry
  system (`telemetry.py`) tracking per-tab usage (`VIEWS`-keyed `tab:X`
  events, covering Atlas/Locate/Busy-Times/flood-alarm exactly) feeding
  an Install Base admin dashboard (`ws_telemetry.py`) already listed as
  shipped in §1. The real remaining gap is analysis, not instrumentation:
  query the already-flowing data for presence-only vs. broader-surface
  adoption, not build new tracking.

**Added to the Phase 2 plan (§5), sequenced after Phase 2a-2c:**
- **Phase 2i — Independent security pass** (addresses 4.9): file/
  service-access-boundary review specifically, before the next feature
  that touches locks or alarm state — building on the path-traversal
  defenses that already exist, not starting from nothing.
- **Phase 2j — REVISED: query existing telemetry, don't build new
  instrumentation (addresses 4.11).** Originally scoped as "instrument
  or survey feature adoption" — the instrumentation already exists
  (`telemetry.py`'s per-tab `VIEWS` tracking). This is now a data-pull
  against the Install Base dashboard's already-collected numbers:
  presence-only vs. Atlas/Locate/Busy-Times/flood-alarm usage among
  current installs — the only available test for whether the
  residential-BMS breadth is earning its ~25-edit-per-feature cost, or
  running ahead of demand. Near-zero build cost now that the real scope
  is known.
- **Phase 2k — Check Busy Times/Insights against the Density
  confidence-framing bar** (addresses 4.10): either already there, in
  which case this closes in five minutes, or a small, well-scoped UI
  addition.

This section's own bottom line, additive to §5's: **the path is sound,
and the one architectural fix already prioritized (Phase 2a, the
device-class registry) now has three independent literatures — software
refactoring, agentic-AI-development research, and building-industry
metadata standards — agreeing it's the right and sufficient fix. The
net-new finding from going outside HA is not architectural; it's that
PadSpan's growing control surface (locks, alarms) has outpaced any
outside review of it, and that a residential-BMS category claim, while
plausible and currently unclaimed, is not yet backed by PadSpan's own
usage evidence.**



---

## 7. Monetization & Pricing — Research Angle (added in parallel with §§2-6 above)

*This section was researched independently, in parallel with the
architecture/velocity angle above (§§2-5), and answers a different half
of the owner's original question: not "is the codebase sound" but "is the
$45/$35/$12, two-product pricing structure sound, and does the
ecosystem support charging for a HACS-distributed integration at all."
It doesn't reference or depend on §§2-5's device-class registry work,
and should be read as a second, independent lens on "am I on the right
path" — the two verdicts don't conflict, they cover different risks.*

**Research method note:** built from live web search, direct page
fetches, and — for long-standing, stable facts about named products
(GPL terms, WordPress's freemium norm, Fowler's refactoring catalog) —
existing knowledge, since live search on those would only reconfirm
something unlikely to have changed. This session's live web search ran
out of its per-session call budget partway through this angle's research
(a hard cap, not a topic search coming up empty); a couple of
sub-questions below are marked **unverified live** and reasoned from
direct fetches plus general knowledge instead, flagged rather than
presented as confirmed.

### M. Monetization precedent inside the HA/HACS ecosystem specifically

**HACS's own stated position is that it is a free, open-source
distribution mechanism, full stop.** The HACS 2.0 announcement is
direct: *"HACS ... despite the name, it doesn't sell anything ... it's
all free and open-source."* ([Home Assistant blog, Aug 2024](https://www.home-assistant.io/blog/2024/08/21/hacs-the-best-way-to-share-community-made-projects/))
HACS is a discovery/install mechanism for GitHub repos — it doesn't
process payments, license keys, or gate downloads. PadSpan's actual
model (free code shipped through HACS, paid *features* gated at runtime
by a call to an external license server — `server/telemetry.php`,
`server/version.php` etc. in this repo) sits entirely outside anything
HACS itself contemplates. That's not forbidden, but it also means
there's no existing HACS-native UX pattern users already trust for
"this free-looking install needs a paid key," the way a WordPress.org
plugin's "Upgrade to Pro" notice is now a familiar, trusted pattern
(§N below).

**The two clearest examples of real money moving in the HA ecosystem are
both recurring *hosted services*, not feature-unlock licenses:**
- **Nabu Casa Home Assistant Cloud** — ~$6.50/mo or ~$65/yr, funds core
  HA development, buys remote access, cloud voice (Alexa/Google), managed
  backups. ([nabucasa.com](https://www.nabucasa.com/), [pricing](https://support.nabucasa.com/hc/en-us/articles/26179687501341-How-much-does-a-Home-Assistant-Cloud-subscription-cost))
  Nabu Casa is the company that employs HA's founder and funds core
  development — a "sustaining the thing I already trust" framing, not a
  feature paywall.
- **Frigate+** — $10/mo or annual, plus paid add-on fine-tunes — sells
  continuously-improving hosted ML models trained on real user
  submissions (packages, wildlife, delivery logos). The free, bundled
  Frigate NVR + HA integration remains fully functional without it.
  ([frigate.video/plus](https://frigate.video/plus/))

Both charge for something with an *ongoing marginal cost to the
provider* (bandwidth, retraining, hosting) — the argument this community
visibly accepts. **PadSpan Pro charges to unlock features in code that,
once downloaded, runs entirely on the user's own hardware with no
ongoing per-user cost** — structurally closer to a WordPress Pro-plugin
unlock (§N) than to Nabu Casa or Frigate+, but without WordPress's
decade of user habituation to that pattern inside *this specific*
community. That mismatch — paying for local software vs. paying for an
ongoing service — is very likely the real fault line this community's
free-software reflex runs along, more than "pay vs. free" in the
abstract.

**Despite deliberately searching for one** (multiple query variants,
direct fetches of HACS's own docs, and several search engines once the
web-search budget ran out), **I could not find a single named,
established third-party HA custom integration running a
free-HACS-listing + paid-license-key-gated-Pro model at anything like
PadSpan's scale.** That absence is itself the finding, not a research
gap: either this pattern is genuinely rare-to-novel in the third-party
HA integration space, or it exists but has never generated enough
discussion to be indexed — and given how vocal this community is about
pricing (below), the second explanation is the less likely one.
Moderate confidence, not certainty — worth a follow-up search with a
fresh budget rather than fully trusting this report on this point alone.

**Community sentiment found:** direct research surfaced a consistent
pattern of HA forum contributors advising that releasing an integration
free-first "attracts more users and generates genuine enthusiasm...
provide a platform to receive feedback... a collaborative and
user-focused approach that will yield better results in the long run" —
set against the fact that "most 3rd-party Home Assistant integrations
are maintained by a single person in their free time," i.e. the
community's own volunteers already absorb the cost PadSpan is charging
for. Home Assistant's own FAQ states plainly: *"no subscription to use
it, no features are locked behind a paywall"*
([home-assistant.io/faq/is-it-free](https://www.home-assistant.io/faq/is-it-free/))
— the baseline expectation everything in this ecosystem gets measured
against, fair or not. **Unverified live:** a specific, named
r/homeassistant thread reacting to a paid custom integration (or to
PadSpan Pro itself) — worth a direct, targeted follow-up search.

### N. Outside HA: the closest working analog is WordPress plugin freemium — and it's proven, with one structural mismatch

The closest real precedent to PadSpan's shape is not in home automation
at all — it's the WordPress plugin ecosystem, running exactly this
pattern (free-in-a-community-directory + separately-sold Pro,
license-key-gated, updates from your own server) at scale for over a
decade: **Yoast SEO, WooCommerce extensions, Advanced Custom Fields
(ACF), Elementor, WP Rocket** are all real, durable examples.

Documented best practice, worth checking PadSpan against directly:
*"The free plugin lives in the directory, is fully functional on its
own, and contains zero paid code — no disabled buttons or dead
'upgrade to unlock' screens... The Pro add-on is a separate product you
sell off-site; the free plugin never contains the Pro code and the Pro
code never ships in the directory."* ([dev.to writeup](https://dev.to/rebel_studios/how-to-structure-a-freemium-wordpress-plugin-that-passes-wporg-review-2hlf);
consistent with [freemius.com](https://freemius.com/blog/freemium-business-model-wordpress/))
The free tier is chosen to be genuinely useful standalone — a
trust-building tool, not a crippled trial.

**Where this maps cleanly onto PadSpan, and where it stops:** PadSpan HA
(free) → PadSpan Pro ($45/yr) matches this pattern well — the free core
is genuinely useful on its own. **PadSpan Bright is structurally
different from a WordPress-style free tier, though**: it isn't "the free
tier of PadSpan," it's BLE presence *removed entirely* and repackaged as
a second, separately-listed product. WordPress's model has exactly one
free/Pro relationship per plugin; PadSpan has built two products, each
with its own free/Pro split, sharing most of their code. **The
WordPress precedent validates PadSpan HA → PadSpan Pro. It does not
obviously validate a second product (Bright/Bright Pro) existing
alongside the first** — see §P.

**A second, less-close analog: Craft CMS's official Plugin Store**,
where paid plugins are normalized and sold *through the platform*
(revenue share, built-in licensing, price shown next to free plugins) —
closer to an app-store model than WordPress's off-site sales. HACS
offers none of this (§M) — there's no in-platform payment rail for HA
integrations the way Craft (or Shopify's App Store, or Figma's plugin
marketplace, per general knowledge) provide. That's a real structural
handicap: PadSpan does 100% of its own trust-building and payment UX
(this repo's `server/` directory), where Craft/Shopify-style plugin
authors get that trust and payment rail from the platform for free.

**A useful negative case, for contrast: Obsidian.** Obsidian's own
plugin documentation makes no mention of commercial/paid community
plugins at all — the ecosystem norm is single free plugins, monetized
informally via donations/GitHub Sponsors if at all. Obsidian is a
closer *cultural* match to Home Assistant (enthusiast/tinkerer-heavy,
historically donation- not subscription-oriented) than WordPress is
(which has a large professional/agency user base already comfortable
buying software). **That Obsidian's plugin economy stayed
donation-based while WordPress's became a real paid-tier economy
suggests the deciding factor isn't "can a plugin ecosystem support paid
tiers" in the abstract — it's whether the user base already buys
software for their business, vs. treats the whole stack as a hobby.**
Home Assistant's user base sits closer to Obsidian's than WordPress's on
that axis, even though PadSpan's monetization *mechanics* are copied
from WordPress. That mismatch — WordPress-shaped monetization,
Obsidian-shaped community — is a real, named risk, not a reason not to
charge: it means don't assume WordPress's *success rate* transfers, only
its *mechanics*.

### O. Pricing-tier psychology: is the $45/$35/$12, 2-product×2-tier matrix well-designed?

General SaaS/indie-pricing research converges on a few well-replicated
findings, plus one classic finding that's shakier than its reputation:

- **Three tiers is the practical sweet spot; five-plus tiers measurably
  hurts conversion.** *"Offering 5+ tier options confuses customers, who
  often pick the cheapest to avoid uncertainty. The fix is to stick to 3
  tiers... too many choices create decision fatigue, confusing feature
  comparisons create doubt, and the result is that buyers bounce."*
  ([HelloAdvisr](https://helloadvisr.com/foundation/what-are-the-biggest-mistakes-founders-make-with-pricing/))
- **The "decoy effect"** (a cheap/expensive pair making a middle option
  look reasonable) **is the most commonly cited justification for
  3-tier ladders, but rests on shakier empirical ground than pricing
  blogs usually admit** — the original Huber/Payne/Puto (1982) and
  Ariely-popularized result largely failed to replicate under realistic
  conditions in later work. ([atticusli.com on the replication problem](https://atticusli.com/replication-crisis/decoy-effect-asymmetric-dominance/))
  Worth knowing so a redesign doesn't lean on "add a decoy tier" as a
  proven lever — the more robust finding is simply *fewer options,
  clearer differentiation*.

**Applied directly to PadSpan's actual price sheet:** PadSpan HA (free)
/ PadSpan Pro ($45/yr) / PadSpan Bright (free) / PadSpan Bright Pro
($35/yr) / Bright→Pro upgrade ($12) is **5 distinct price points** — past
where this research says buyers stop reasoning cleanly. That count
*undersells* the real complexity, because standard tiering research
assumes **one product line** with tiers stacked on top. PadSpan's buyer
resolves an entirely separate, prior decision — "which of two
*products* am I even looking at" — **before** the familiar free-vs-Pro
tier decision starts. That's a decision axis pricing-psychology
literature doesn't model at all, because it's not a normal SaaS shape;
it's closer to "two SKUs, each with their own tiers," which is a
*product-line* problem (reduce the number of product lines), not a
*pricing-ladder* problem (reduce the number of tiers) — and the fix for
the two isn't the same fix. See §P.

### P. Explicit confirm/challenge callouts (monetization angle)

- **CHALLENGES the current structure directly:** no example found,
  inside or outside HA, of a healthy 2-product × 2-tier + cross-upgrade
  price sheet for a single-developer plugin/integration at this scale.
  Every proven precedent researched (WordPress, Craft) is single-product,
  free/Pro. The closest thing PadSpan has to justify *two* products is
  the BLE/no-BLE split — but §4.3's own architectural finding (Atlas,
  Automorph, flood alarms, Locate, and Busy Times all sell in *both*
  products) says BLE presence is already optional infrastructure, not
  the thing the rest of the platform depends on. If BLE is optional
  already, Bright isn't really a second product — it's "PadSpan Pro with
  a BLE toggle off," and giving it a separate brand, listing, and price
  is very likely adding SKU count without adding real user-facing
  distinctiveness. **This is the single highest-leverage pricing change
  available:** collapsing to one product fixes both the tier-count
  problem (§O) and the product-identity ambiguity in one move.
- **CONFIRMS the owner can charge for this at all:** WordPress's freemium
  plugin economy is a genuine, decade-proven existence case that a
  free-core + paid-Pro-addon model works for exactly this shape of
  product (a plugin extending a bigger free platform). The mechanics are
  sound and battle-tested.
- **CHALLENGES whether *this specific community* will respond to it the
  way WordPress users do:** Home Assistant's culture (§N, §M) skews
  toward Obsidian's donation-first norm, not WordPress's buy-first norm.
  The framing on the pricing page ("this funds continued development,"
  not "the free version is missing things") likely matters more here
  than it would in a typical SaaS market, and nothing in the current
  product pages was checked against that framing (out of scope for this
  pass — worth a follow-up).
- **No GPLv3-vs-license-gate legal read was attempted here** — PadSpan
  HA ships GPL v3 (confirmed: `LICENSE` in this repo). GPLv3 doesn't
  prohibit charging money or a server-side license check, but it does
  guarantee redistribution rights for anyone who receives the code, and
  (if Pro feature code itself ships client-side, dormant behind a gate,
  rather than being withheld server-side entirely the way a WordPress
  Pro plugin is) raises a real, checkable question about what exactly
  GPL's terms require be shared. This is a licensing question for a
  lawyer or a careful GPLv3 §4 read against the actual gating mechanism
  in this codebase — flagged, not resolved, here.

### Gaps (monetization angle)

1. **No ecosystem precedent for this exact monetization shape** — §M.
   Not disqualifying (someone has to be first), but it means PadSpan is
   validating a go-to-market pattern with no comparable data point to
   check pricing or backlash-risk against, on top of validating the
   product itself.
2. **Two products where the architecture suggests one.** §P — the
   Bright/Pro split doesn't track a real architectural boundary anymore
   (if it ever did); it currently tracks a marketing decision layered on
   top of what the codebase actually treats as one optional module
   (BLE). This is the pricing-side mirror of §1's "what is this project"
   identity question.
3. **5 price points is past the point pricing research says buyers
   reason cleanly through**, and that's before accounting for the
   extra "which product" decision this specific structure adds on top
   (§O).
4. **No public "why does this cost money" framing was found or
   evaluated** — given §M/§N's finding that this community responds
   better to "funds continued development" framing than to
   feature-paywall framing, and no evidence either way was gathered on
   what PadSpan's actual pricing page currently says.
5. **GPLv3-vs-license-gate compliance is an open, unchecked question**
   (§P) — not urgent, but unresolved, and cheap to resolve once with a
   qualified read rather than carried indefinitely.
6. **No visible support/refund/trial policy was found or evaluated**
   for the paid tiers — flagged as *unknown*, not *absent*; a real gap
   in this research pass, not a claim that no policy exists.

### Phase 2 plan additions (monetization angle)

**Phase 2l — Resolve the Bright/HA product-identity question before touching
any price numbers.** Decide explicitly: is BLE presence the flagship,
with Atlas/Automorph/flood/Locate/Busy Times as its dependents (in which
case Bright shouldn't be a separate product — it's a subset, and
subsets don't need their own brand)? Or is the platform's real identity
"Atlas + optional BLE" (in which case the free/Pro split should be drawn
along Atlas-vs-BLE lines explicitly, in the product's own language, not
left implicit in which of two differently-branded HACS repos someone
happened to install)? Either answer is defensible; leaving it unanswered
is what's producing the 5-price-point matrix. *Verify:* after the
decision, the number of separately-branded HACS listings and the number
of price points can both be stated in one sentence a new user could
repeat back correctly.

**Phase 2m — Collapse to the fewest tiers 2l's answer actually requires** —
very likely 2 (free/Pro) if 2l lands on "one product," matching the
well-supported "3 tiers max, ideally fewer" finding in §O, rather than
leaning on decoy-tier tricks whose evidence base is weaker than
reputation suggests. *Verify:* a first-time visitor to the pricing page
can state which one price applies to them without asking a question.

**Phase 2n — Rewrite the pricing/upgrade page copy around "sustaining
continued development of something already this deep,"** not "the free
version is missing things" — cheapest item on this list, no code
required, directly targets the community-fit risk in §N/§P.

**Phase 2o — Get a GPLv3-vs-license-gate read from someone qualified, once,
in writing** (§P item 5) — stop carrying it as an open question rather
than resolving it.

**Phase 2p — Once 2l-2m ship, go get the specific market data this pass
couldn't:** search r/homeassistant and the HA forum specifically for
reactions to PadSpan Pro itself (not generic precedent), and re-run "does
any comparable paid HACS integration exist" with a fresh search budget
rather than trusting §M's moderate-confidence null result indefinitely.

**Bottom line, monetization angle:** the mechanics of charging for a
free-core/paid-Pro HA integration are proven elsewhere (WordPress) and
not forbidden by anything HA/HACS enforces — this is not a "you can't do
this" finding. But the specific 5-price-point, 2-product structure is
more complex than either this community's own monetization precedent
(none found at this shape) or general pricing-tier research supports,
and — separately from the architecture question §§2-5 already answered
well — it's the one part of "am I on the right path" this report can't
say yes to without a change. The fix (Phase 2l-2m) is a positioning and
packaging decision, not a rebuild: collapsing Bright into a BLE toggle
inside one product removes a SKU axis pricing research says is actively
costing conversions, and resolves an identity question the codebase
itself has already been signaling isn't clean (§4.3/§P).


---

## 8. Outside HA, Consumer & Luxury Tier: "Digital Twin of a Home" Competitive Landscape

The owner's brief named this angle specifically: "The competitive landscape
for 'a complete visual, interactive digital twin of a home with device
control' ... Apple Home's roadmap ... Google/Nest's home visualization
direction, SmartThings Map View ..., Josh.ai, high-end integrator
platforms (Control4, Savant, Crestron) ... and any startup specifically
pitching 'digital twin for your house.'" Run independently of §§1-7 above
(live web search, 2026-09-18/19). Full sourced write-up, all findings
below plus additional detail: [docs/research/digital-twin-competitive-landscape-phase2.md](research/digital-twin-competitive-landscape-phase2.md).
This converges with §6/§7's own conclusions on one point (no incumbent
combines PadSpan's exact bundle) but surfaces a genuinely new, high-
leverage finding neither of those angles turned up: a repeated
**automated-geometry-acquisition** pattern across every serious
competitor, which Atlas's current all-manual placement workflow doesn't
have.

**SmartThings Map View (Samsung, CES 2024, live now)** ships **four**
separate floor-plan generation paths, manual sketch being only the
fallback: LiDAR scan via Samsung robot vacuums/Ballie (which can place
devices automatically as part of the scan), address lookup against public
floor-plan data, photo-of-a-paper-plan-to-3D conversion, and manual sketch
last. Devices render in 3D at their real position on phone/tablet/TV/
fridge. ([SmartThings blog](https://blog.smartthings.com/smartthings-updates/smartthings-revolutionizes-home-visualization-with-introduction-of-map-view/), [Samsung Newsroom](https://news.samsung.com/us/smartthings-revolutionizes-home-visualization-with-introduction-of-map-view))

**Apple** has no shipped floor-plan/spatial-layout feature in the Home
app, and nothing on its public 2026-2028 hardware roadmap (HomePad hub,
camera, doorbell, tabletop robot) points at one — but Apple has owned the
enabling capability since 2022: **RoomPlan** (ARKit/RealityKit), a free,
on-device Swift API that turns a LiDAR iPhone/iPad scan into a parametric
3D room model — walls, doors, windows, furniture — already used by
third-party real-estate/contractor/interior-design apps for exactly this
job. Nobody has pointed it at smart-home device placement specifically.
([Apple ML Research — RoomPlan](https://machinelearning.apple.com/research/roomplan), [RoomPlan docs](https://developer.apple.com/documentation/roomplan), [9to5Mac roadmap](https://9to5mac.com/2026/08/15/apple-home-product-roadmap-tv-homepod-smart-display/))

**Google Home/Nest** — no spatial-mapping direction found at all; visible
investment is in camera-vision-triggered automation, not spatial
representation. A genuine negative finding, not a search gap. ([9to5Google](https://9to5google.com/2026/05/13/google-home-display-appearance/))

**Josh.ai** markets an "auto-generated floor plan" with device
auto-discovery, but no independent documentation of the actual mechanism
was found — flagged explicitly as an **unverified marketing claim**, not
confirmed fact. ([Josh.ai](https://josh.ai/))

**Savant TrueImage** — already noted in §6 as "the closest existing
consumer metaphor to device-on-a-map control"; this pass adds the
mechanism detail: the installer/homeowner photographs the actual room or
fixture, and that literal photo becomes the live control surface —
tapping the real light **in the photo** dims it, and the photo's
rendered brightness/colour updates live to mirror the physical state.
Photorealism-of-your-actual-room as the control surface, not a schematic
map — the opposite representation choice from Atlas's stylized
Automorph/Showcase layers, and a paradigm PadSpan hasn't considered
either way (adopt a scoped version, or consciously reject it). Likely
IP/brand-protected as implemented; the transferable part is the paradigm.
([Savant Knowledge Base — TrueImage](https://support.savant.com/lighting/?c=Savant_Knowledge:TrueImage))

**Matterport + SIM-ON (SIMLAB)** — professionally captured 3D real-estate
scan plus a live IoT control overlay (lighting, climate, security, KNX).
**This is, today, the closest existing product to "a complete visual,
interactive digital twin of a home with device control"** — but sold to
property managers/short-term-rental operators via professional 3D-camera
capture, a different customer and capture method than PadSpan's
DIY-homeowner, phone-or-manual, free/open model. Validates the category
commercially without being a direct competitor for PadSpan's users.
([Matterport/SIMLAB case study](https://matterport.com/industries/case-studies/simlab-integrates-bim-and-smart-building-iot-technologies-matterport), [SIM-ON](https://sim-on.com/))

**Digs** — ~$20M pre-Series A, ~10,000 homes on platform, backed by SPLY
Capital et al. Its "3D digital twin" is explicitly a **static property
record** (plans, warranties, install dates, photoreal renderings) marketed
as "CarFax for the home" — nothing to do with live device control. Matters
because it's a large, funded company using the identical phrase "digital
twin of a home" for an unrelated job — direct evidence for why PadSpan
should stop using "digital twin" unqualified (it invites this exact
collision, for no benefit). ([PR Newswire](https://www.prnewswire.com/news-releases/digs-tops-off-nearly-20-million-pre-series-a-funding-to-solidify-position-as-leading-ai-platform-for-home-builders-302606693.html))

**What "digital twin" means in the literature** — per IBM and the
digital-twin literature, the trait separating a digital twin from a
dashboard is a persistent, **predictive/simulation-capable** connection
("what will happen," not just "what is happening"). By that bar, PadSpan
today (Atlas, Automorph, Locate, Insights) is a sophisticated **live-state
visualization and control platform**, not yet a digital twin —
Insights/Busy Times is backward-looking, not predictive. A real and
valuable category on its own terms; just not the one the term claims.
([IBM — What is a Digital Twin?](https://www.ibm.com/think/topics/digital-twin))

**AR overlay control** (point phone/glasses at a device, see live status
overlaid) — real research prototypes exist, no dominant shipped consumer
product found. Flagged as an emerging pattern worth re-checking in 6-12
months, evidence quality materially weaker than the findings above, not a
current gap.

**Confirms/challenges, explicitly:**
- **CONFIRMS** the core bet independently, at every market tier: Samsung
  (consumer), Savant (luxury), Matterport+SIMLAB (real estate/property
  management) all converged on "a visual, spatial, living map of the
  house tied to live device state" — three unrelated, well-capitalized
  companies, not PadSpan reasoning in isolation.
- **CONFIRMS** — consistent with §6/§7 — a genuinely undefended niche:
  none of the above fuse BLE-trilaterated human *presence* into the same
  map as device placement, and none place devices at measured
  centimetre accuracy (SmartThings/Matterport are qualitative/dollhouse-
  scale). Atlas + PadSpan's BLE fabric together is unoccupied territory.
- **CHALLENGES, and this is the sharpest new finding of this pass —
  CORRECTED 2026-09-19, independently cross-checked via a second AI
  (codex) then verified by hand, see below**: the single most
  consistent pattern across every serious competitor (Samsung,
  Matterport, Apple's own dormant RoomPlan) is **automated geometry
  acquisition** — scan, address lookup, photo-to-3D, or professional
  capture — with manual entry as a fallback, not the only path. ~~Atlas's
  placement workflow is manual centimetre entry with no automated
  fallback-*from* at all~~ — **false as stated.** `custom_components/padspan_ha/sh3d_import.py`
  and `ws_floorplan_import.py` already import Sweet Home 3D (.sh3d)
  floorplans into candidate room polygons (`maps.js`'s Rooms tab, the
  same "candidates" preview/edit/commit mechanism used elsewhere), and
  Atlas already has assisted bulk placement (`spreadInRoom`, "⊞ Spread
  in room") and a tap-to-place queue — not literal blank-canvas manual
  entry for every fixture. More consequentially: `sh3d_import.py`'s own
  docstring says this is *"gap #7 tier 1, best-in-class roadmap:
  Floorplan import: Sweet Home 3D first, then RoomPlan JSON, then image
  room-detection"* — and `docs/BEST_IN_CLASS_ROADMAP.md` (which this
  very report cites elsewhere as prior research, §G) already lists tier
  1 (Sweet Home 3D) as **DONE (commit 9c10575)** and tier 2 (RoomPlan
  JSON) as explicitly **REMAINING**, written 2026-09-05 — two weeks
  before this angle's research ran. The research agent that wrote this
  finding didn't check the project's own existing roadmap doc before
  presenting automated geometry acquisition as an undiscovered gap. It
  is not one: PadSpan already scoped it, already shipped tier 1, and
  RoomPlan JSON (tier 2) was already the planned next step — this
  report independently re-derived a conclusion the project had already
  reached.
- **CHALLENGES the self-description, not the product**: "digital twin"
  unqualified both overclaims (no predictive/simulation layer exists,
  per the IBM definition) and collides with Digs' unrelated, funded use
  of the identical phrase. PadSpan's real differentiator (BLE-fused,
  cm-accurate live map) doesn't need the term.
- **CHALLENGES the assumed threat tier**: Control4/Savant/Crestron are a
  different price/install tier, not a realistic threat to a free HACS
  integration. Consistent with §6's own finding, the nearer pressure is
  inside HA's own ecosystem (Picture Elements, community floor-plan
  cards) — already noted there, not re-litigated here.

**Verdict on this angle:** on the core question — is PadSpan on the right
path pursuing a visual, spatial, device-and-presence map, rather than
just adding device classes — **yes**, and independently confirmed at
every market tier researched, not merely agreeing with the premise.
**The "killer feature" framing below is corrected**, per the finding
above: automated geometry acquisition is not an undiscovered gap, it's
already 1/3 shipped (Sweet Home 3D, tier 1) against a plan this project
already wrote down (`docs/BEST_IN_CLASS_ROADMAP.md`, 2026-09-05) that
already names RoomPlan JSON as tier 2. The real, still-live value of
this angle's research is narrower but genuine: it independently confirms
tier 2 (RoomPlan) is worth prioritizing — three unrelated competitors
converging on "automated capture, manual as fallback" is real evidence
the existing roadmap's own ordering is right, not just plausible — and
it surfaces two things the existing roadmap doesn't mention: Savant
TrueImage's photo-as-control-surface paradigm (worth a deliberate stance
either way) and that PadSpan's own Insights/Busy-Times historical data
is unexploited relative to what "digital twin" implies. Two lower-urgency
findings stand as before: closing the predictive/historical-data gap is
the one move that would make "digital twin" literally true rather than
aspirational, and the TrueImage paradigm deserves a considered yes/no
rather than staying unconsidered.

**Added to the gap list (§4), continuing the numbering:**
- **4.12 — REVISED: tier 2 of an already-planned rollout, not a new
  gap.** Originally stated as "no automated geometry-acquisition path
  for Atlas placement... 100% manual cm entry... the single most
  research-validated gap in this entire report" — corrected above: tier
  1 (Sweet Home 3D import) already shipped, tier 2 (RoomPlan JSON) was
  already the documented next step in `docs/BEST_IN_CLASS_ROADMAP.md`
  before this angle's research ran. What this research pass actually
  adds: independent, three-competitor confirmation that tier 2 is worth
  doing next, ahead of other backlog items — real signal, just not a
  new discovery.
- **4.13 — "Digital twin" as unqualified self-description invites two
  avoidable category collisions** — with predictive-simulation twins
  (PadSpan has no forward/what-if capability) and with Digs' static
  property-record twin (same phrase, unrelated product) — for no benefit
  to the actual pitch.

**Added to the Phase 2 plan (§5):**
- **Phase 2q — REVISED: this is tier 2 of the existing floorplan-import
  rollout (`docs/BEST_IN_CLASS_ROADMAP.md` gap #7), re-prioritize it
  rather than treat it as new scope.** RoomPlan JSON capture companion
  for Atlas (addresses 4.12). Spec/prototype a flow where a user scans a
  room once with a LiDAR iPhone/iPad via Apple's free RoomPlan API,
  exports wall/door/window geometry, and Atlas ingests it through the
  same candidate-layout mechanism `sh3d_import.py` already uses rather
  than building a second import/preview UI. *Verify:* scan one real
  room, measure time-to-usable-placement against the current SH3D-import
  and manual workflows for the same room.
- **Phase 2r — Positioning correction** (addresses 4.13): drop
  unqualified "digital twin" from README/marketing copy in favour of the
  language that claims PadSpan's actually-undefended territory
  (BLE-fused, centimetre-accurate, live device *and* presence map).
  *Verify:* README/marketing copy reviewed against this framing.
