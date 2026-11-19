# Phase 2 Research — Competitive Landscape: "Digital Twin of a Home with Device Control"

**Date:** 2026-09-18
**Scope:** Feeds Section 3 ("External Research Findings") of
[PHASE2_STRATEGIC_REVIEW.md](../PHASE2_STRATEGIC_REVIEW.md). This file is
the full research trail for the specific question the owner asked: "The
competitive landscape for 'a complete visual, interactive digital twin of a
home with device control' specifically (broader than BLE presence
specifically) ... Is there a paradigm or 'killer feature' among these that
PadSpan doesn't have and should seriously consider as its next major
addition, distinct from incrementally adding more device classes to Atlas?"

Researched, per instruction, both inside and deliberately outside the
Home-Assistant/smart-home world: Apple Home, Google Home/Nest, SmartThings
Map View, Josh.ai, Control4/Savant/Crestron, Matterport + IoT overlays,
startups explicitly pitching "digital twin" + "home"/"residential," and the
industry definition of "digital twin" itself. Ten threads below, each with
what was actually found (not inference), followed by explicit confirm/
challenge callouts and a verdict.

---

## 1. SmartThings Map View (Samsung) — the closest direct analogue

Unveiled at CES 2024, now live across all SmartThings countries. The
notable thing is not the 3D rendering itself — it's that Samsung ships
**four separate floor-plan generation paths**, with manual sketch as only
one, least-preferred, fallback:

1. **LiDAR scan** via Samsung robot vacuums (Jet Bot) or the Ballie home
   robot, demoed at CES 2024 — scans the home and, per Samsung's own
   announcement, can place devices in roughly the right position
   automatically as part of the scan.
2. **Address lookup** — for homes with an available public/internet floor
   plan, the user just enters their address and SmartThings auto-creates
   the layout.
3. **Photo-to-3D** — photograph an existing paper floor plan and
   SmartThings converts it to a 3D layout automatically.
4. **Manual sketch** — draw the floor plan directly in-app, the fallback
   for when none of the above apply.

Devices then render in 3D "right where they are in the real world,"
viewable on phone, tablet, TV, and even refrigerator screens. Supported
monitoring surfaced on the map includes cameras, temperature, laundry
remaining-time, and energy usage.

**Why it matters to PadSpan:** this is the strongest single piece of
evidence that the market's answer to "how do I get my house's geometry
into the app" is "automatically, several different ways, manual entry only
as a last resort" — the exact inverse of Atlas's current all-manual,
type-coordinates-in-centimetres workflow.

Sources: [SmartThings blog announcement](https://blog.smartthings.com/smartthings-updates/smartthings-revolutionizes-home-visualization-with-introduction-of-map-view/), [Samsung Newsroom](https://news.samsung.com/us/smartthings-revolutionizes-home-visualization-with-introduction-of-map-view), [Samsung support page](https://www.samsung.com/us/support/answer/ANS10004030/), [The Ambient coverage](https://www.the-ambient.com/news/smartthings-map-view-takes-smart-home-control-to-the-next-level-3216/), [Tom's Guide CES coverage](https://www.tomsguide.com/news/samsung-just-perfected-the-way-you-access-your-smart-home-devices-at-ces-2024-and-apple-google-and-amazon-needs-to-copy-it).

---

## 2. Apple — no shipped spatial-layout feature, but owns the enabling API

Searched both the Apple Home app's current feature set and Apple's public
2026–2028 smart-home hardware roadmap. Found: a **HomePad** hub (7" display,
wall-mount and speaker-base configurations, fall 2026 target), a security
camera and doorbell (later 2026), and a tabletop robot with a robotic arm
and 9" display (slipping from 2027 into 2028). Also: AI-generated text
descriptions of HomeKit Secure Video clips and smarter accessory-
notification grouping, both via Apple Intelligence. None of this is a
floor-plan or spatial-layout feature — it's new hardware surfaces and better
notifications, not a new spatial UI paradigm. No evidence found of Apple
Home adopting anything like Map View.

What Apple *does* already own, and has owned since 2022, is the enabling
capability underneath such a feature: **RoomPlan** (Swift API built on
ARKit + RealityKit). It uses the LiDAR Scanner on iPhone/iPad Pro models
(iPhone 12 Pro and later, LiDAR-equipped iPads, iOS 16+) to output a
**parametric 3D room model in real time** — walls, doors, windows, and
room-defining furniture (couches, tables, cabinets, fireplaces) — entirely
on-device, free, with no cloud dependency and no Apple Home integration
required. Apple's own machine-learning research page describes the
underlying model. Third-party apps already build on it for exactly the
"turn a phone scan into placeable room geometry" job: interior-design apps
(wall-color/paint calculators), architecture apps (real-time layout
previews), and real-estate/contractor apps (floor-plan capture for
listings). A 2026 use-case roundup (Volpis) and multiple scan-to-plan apps
(Room Xpand, RoomPlot, ScanManifold-covered tools) confirm this is an
active, still-growing third-party category on top of Apple's API, not a
dead or deprecated one.

**Why it matters to PadSpan:** this is a concrete, already-built, freely
available, on-device capability PadSpan could target directly for a
capture-companion flow, without having to build LiDAR point-cloud
processing from scratch. Apple ships the hard part; nobody outside Apple's
own Home app is using it for smart-home device placement specifically yet
— that gap is open.

Sources: [Apple ML Research — RoomPlan](https://machinelearning.apple.com/research/roomplan), [Apple Developer — RoomPlan documentation](https://developer.apple.com/documentation/roomplan), [Apple Developer — RoomPlan overview page](https://developer.apple.com/augmented-reality/roomplan), [WWDC22 session "Create parametric 3D room scans with RoomPlan"](https://developer.apple.com/videos/play/wwdc2022/10127/), [9to5Mac — Apple's 2026 smart-home roadmap](https://9to5mac.com/2026/08/15/apple-home-product-roadmap-tv-homepod-smart-display/), [ithinkdiff — HomePad/camera/robot roadmap](https://www.ithinkdiff.com/apple-homepad-smart-home-roadmap-2026/), [Volpis — top RoomPlan use cases 2026](https://volpis.com/blog/top-use-cases-for-apps-utilizing-apple-roomplan/), [Volpis — RoomPlan overview for developers](https://volpis.com/blog/apple-roomplan-overview/).

---

## 3. Google Home / Nest — no spatial-mapping direction found (real negative finding)

Searched specifically for floor-plan visualization or spatial device
mapping on Google's smart-home roadmap. Found instead: a rumored "Google
Home Display" possibly doubling as a Nest Cam, and new automation
"starters" based on **visual insights from cameras** — i.e. automations
that trigger off what a camera sees, not spatial representation of the
home. No evidence anywhere in the search results of Google investing in a
Map-View-style spatial layout. This is treated as a genuine negative
finding — Google's visible investment is in vision-triggered automation,
not spatial mapping — and flagged as worth re-checking periodically rather
than assumed permanent.

Sources: [9to5Google — "Google Home Display" appearance](https://9to5google.com/2026/05/13/google-home-display-appearance/), [Forbes — rumored Home Display as Nest Cam](https://www.forbes.com/sites/paullamkin/2026/07/15/googles-rumored-home-display-could-double-as-a-nest-cam/), [Android Authority — make-or-break year for Google smart home](https://www.androidauthority.com/this-is-make-break-year-for-google-smart-home-line-up-3669822/), [Google Home Spring 2026 update page](https://home.google.com/get-inspired/smart-updates-that-make-a-big-difference/).

---

## 4. Josh.ai — marketing claims auto-generated floor plan; mechanism unverified

Josh's own marketing copy states the system "auto-discovers supported
devices and intelligently generates a home's floor plan, logically
associating corresponding images to each area," with tools to "adjust a
home's floor plan, nickname devices, and add custom photos to personalize
your experience." No independent technical documentation, case study, or
third-party teardown was found describing the actual generation mechanism.
There is no evidence of LiDAR or scan-based capture in any source found —
the phrasing ("auto-discovers *devices*," "adjust," "add custom photos")
reads more consistently with device-driven room *association* (devices
report which room they're in, the app arranges known rooms accordingly)
plus manual layout/photo customization, similar in spirit to Control4 and
Savant below, rather than a geometry-scanning system like SmartThings'.

**This is explicitly flagged as an unverified marketing claim, not
confirmed fact** — the gap between what Josh.ai's copywriting implies
("intelligently generates a floor plan") and what's independently
verifiable is itself worth noting: it's a category where vendors describe
capabilities more confidently in marketing than in documentation.

Sources: [Josh.ai homepage](https://josh.ai/), [Josh.ai — "3 Keys to Building the Future of Smart Home Control"](https://josh.ai/stories/joshais-3-keys-to-building-the-future-of-smart-home-control), [Josh.ai — Josh One / DoorLink launch](https://josh.ai/stories/joshai-launches-new-josh-one-reimagined-music-experience-doorlink-intercom-dozens-of-new).

---

## 5. Control4 / Crestron / Savant — mostly room-list UIs, one genuine standout

Public documentation for Control4's Room screen / Home Screen and
Crestron Home's app navigation describes **room-based icon/list UIs** with
customizable per-room background images — not confirmed, in any source
found, as literal 2D/3D spatial floor-plan maps the way SmartThings or
Matterport are. Comparison articles (Ideal Automation, Audio Advice,
Definitive Electronics) consistently describe the three platforms in terms
of customization depth (Crestron's CH5 HTML5 framework allows fully
bespoke panels), interface polish (Savant praised for app/on-wall
cleanliness), and consistency (Control4 icon-based UI, $600+ touchscreens)
— not spatial mapping as a headline feature.

The genuine standout, and the closest thing to a "killer feature" this
entire research pass turned up, is **Savant TrueImage**. Documented
mechanism, from Savant's own knowledge base and independent trade coverage
(Essential Install):

- The installer or homeowner photographs the actual room or light fixture
  using a mobile device.
- That literal photograph becomes the control surface: touching the real
  light fixture **in the photo** dims or turns it on/off, from any Savant
  interface — phone, tablet, in-wall touch panel, or the Savant Pro Remote.
- Crucially, it's bidirectional and live: the photo's rendered
  brightness/color updates in real time to mirror the physical light's
  actual state, so the interface *shows* what the room currently looks
  like, not just an abstract on/off icon.
- Marketed explicitly against "confusing icons" — the pitch is photographic
  realism replacing abstraction, and it's an award-winning, actively
  promoted feature (industry "Mark of Excellence" nominee).

**Why it matters to PadSpan:** this is a fundamentally different
representation *choice* from every map-based UI found elsewhere in this
research — photorealism of *your actual, specific room*, rather than a
schematic, stylized, or generic abstraction. It's the opposite design bet
from Atlas's Automorph/Showcase decorative layers, which stylize rather
than photograph. It is very likely IP/brand-protected as implemented (it's
Savant's named, award-winning feature) — the transferable part is the
*paradigm* (control the real photo of the room, not an icon on a diagram),
not the specific mechanism, and it hasn't been considered as an option in
PadSpan's own design conversations to date, as far as this research trail
can determine.

Sources: [Savant Knowledge Base — TrueImage](https://support.savant.com/lighting/?c=Savant_Knowledge:TrueImage), [Essential Install — "Savant TrueImage Lighting Control Overhauled"](https://essentialinstall.com/news/smart-home/savant-trueimage-lighting-control-overhauled-simplified-ui/), [EH Publishing Mark of Excellence Awards entry](https://markofexcellenceawards.secure-platform.com/a/gallery/rounds/170/details/44323), [Control4 Room screen documentation](https://docs.control4.com/help/c4/user/userguide/content/topics/interfaces/roomscreen.htm), [Crestron Home app listing](https://apps.apple.com/us/app/crestron-home/id1466827669), [Ideal Automation — Crestron vs Control4 vs Savant](https://www.myidealav.com/blog/crestron-vs-control4-vs-savant), [Definitive Electronics comparison](https://definitiveelectronics.com/blog/compare-crestron-vs-control4-vs-savant-vs-josh-ai/).

---

## 6. Matterport + SIM-ON (SIMLAB) — the most literal existing product in this category

Matterport's professionally captured 3D real-estate scan (dedicated 3D
camera hardware, not a phone), combined with SIMLAB's **SIM-ON** platform,
produces an actual **live IoT control panel layered directly on the 3D
scan** — lighting, temperature, appliances, entertainment, and security
systems, with documented KNX integration and stated plans for broader
building-automation-provider support. Practical use cases described:
remote climate preparation before guest arrival, awareness of doors/
windows left open, smoke/fire detection, and occupancy monitoring against
rental-agreement limits — clearly aimed at short-term-rental and property-
management operators, not owner-occupiers.

**This is, today, the closest thing found in this entire research pass to
"a complete visual, interactive digital twin of a home with device
control."** It validates the category commercially — it's an actual
shipping, monetized product, not a concept — but at a different customer
(property manager / rental owner, often managing multiple units) and a
different capture method (professional 3D camera, walkthrough service)
than PadSpan's DIY-homeowner, phone-or-manual-entry, free-and-open-source
model. Adjacent validation of the product category, not a direct
competitor for PadSpan's actual users.

Sources: [Matterport — SIMLAB BIM/IoT case study](https://matterport.com/industries/case-studies/simlab-integrates-bim-and-smart-building-iot-technologies-matterport), [SIM-ON](https://sim-on.com/), [Matterport — Smart Building IoT blog](https://matterport.com/en-gb/blog/smart-building-iot), [We Get Around Network forum thread on SIM-ON](https://www.wegetaroundnetwork.com/topic/16057/sim-on---matterport-iot-solution/).

---

## 7. Digs — a different "digital twin of a home," and why the name collision matters

Digs raised roughly **$20M pre-Series A** total (a further $5M tranche
announced/covered November 2025, per GeekWire and PropTech Connect),
backed by Dallas-based SPLY Capital and existing investors OVF, Fuse, and
Flying Fish. Nearly 10,000 homes on the platform; builders on the platform
represent more than $12B in annual home builds. Its "3D digital twin"
product is explicitly a **static property record** — home plans,
construction records, material selections, photographs, warranty details,
install dates, and photorealistic renderings, generated with AI —
marketed directly as **"CarFax for the home"** / "Homefax." The company
also launched DigsCare, an AI-driven warranty-management product for
builders.

Digs has **nothing to do with live device state or control**. It's a
document-provenance and construction-collaboration platform serving home
builders and new-home buyers, adjacent to real estate and warranty
workflows, not smart-home automation.

**Why it matters to PadSpan:** it's a large, well-funded, currently-active
company using the identical phrase — "digital twin of a home" — for a
completely different job than PadSpan does. This is the concrete evidence
behind the recommendation (§2/§4 of the main review) that PadSpan stop
using "digital twin" as unqualified self-description: it invites exactly
this kind of category confusion, for no benefit, since PadSpan's actual
differentiator doesn't need the phrase.

Sources: [PR Newswire — Digs $20M pre-Series A](https://www.prnewswire.com/news-releases/digs-tops-off-nearly-20-million-pre-series-a-funding-to-solidify-position-as-leading-ai-platform-for-home-builders-302606693.html), [GeekWire — Digs raises $5M](https://www.geekwire.com/2025/real-estate-startup-digs-raises-5m-to-boost-software-platform-for-residential-builders/), [PropTech Connect — Digs raises $19M](https://proptechconnect.com/digs-raises-19m-to-make-home-construction-easier-with-ai/), [goskagit.com syndication of the PR Newswire release](https://www.goskagit.com/digs-tops-off-nearly-20-million-pre-series-a-funding-to-solidify-position-as-leading/article_4aa84a06-ce32-5d67-9580-8d04d078a1cf.html).

---

## 8. What "digital twin" actually means in the literature — and what PadSpan is instead

Per IBM's own definitional page and the broader digital-twin literature
(Niantic Spatial, industry commentary), the trait that separates a digital
twin from a live dashboard/visualization is a **persistent, bidirectional
connection with predictive/simulation capability** — a system that can
answer "what will happen if," not only "what is happening now." The
literature explicitly frames this as an *evolution*: digital twins
"started as static 3D representations that helped engineers visualize
equipment... but today's digital twins are rapidly becoming tools that
predict what will be," modeling risk, stress, deformation, or failure
before it happens. A visualization dashboard is described as one
*component* of a full digital-twin stack (alongside data processors,
sync services, and a simulation/analytics engine), not the whole thing.

Measured against that bar: PadSpan today — Atlas, Automorph, Showcase,
Locate, even Insights/Busy Times — is a genuinely sophisticated **live-
state visualization and control platform**. It reflects current and
historical reality extremely well. It does not, anywhere in the current
codebase, model or predict a future state — Insights/Busy Times is
backward-looking (historical dwell time, peak occupancy, aggregate
heatmaps), not forward-looking. That's a real and valuable category on
its own terms; it just is not, yet, what the industry means by "digital
twin."

**Why it matters to PadSpan:** this is the direct evidence for §2(d) of
the main review — recommending PadSpan describe itself precisely (BLE-
fused, centimetre-accurate, live device+presence map) rather than reaching
for "digital twin," a term that both overclaims (no prediction/simulation
exists yet) and, per §7 above, collides with an unrelated funded company
using the same words for a different product.

Sources: [IBM — "What is a Digital Twin?"](https://www.ibm.com/think/topics/digital-twin), [Niantic Spatial — Digital Twins vs Simulations](https://www.nianticspatial.com/en/campaigns/simulation-vs-digital-twin), [OctaSence (Medium) — "Digital Twins Are Evolving: From Visualization to Predictive Intelligence"](https://medium.com/@admin_93917/digital-twins-are-evolving-from-visualization-to-predictive-intelligence-1d957a36baaf).

---

## 9. AR overlay control — emerging pattern, weak evidence, not a current threat

Searched for shipped augmented-reality smart-home control products (point
a phone or glasses at a device, see live status and controls overlaid on
the physical object). Found real academic/research prototypes (IEEE,
ResearchGate papers on AR-driven smart homes and IoT overlay) and forward-
looking trend commentary, but **no single dominant, shipped, mainstream
consumer product**. The evidence quality here is materially weaker than
every other thread in this document — mostly speculative trend pieces
("2026 will begin a new era...") rather than named, live products with
adoption numbers.

**Explicitly flagged as a pattern worth re-checking in 6–12 months, not a
current competitive gap.** Including it in this document at all is a
calibration choice — distinguishing "real signal" (SmartThings, Savant,
Matterport, RoomPlan) from "worth watching" (this) matters more than
treating every search result as equally solid.

Sources: [ESP for Beginners — AR home automation](https://www.espforbeginners.com/guides/ar-home-automation/), [ESP for Beginners — AR and Home Automation](https://www.espforbeginners.com/guides/augmented-reality-home-automation/), [ResearchGate — "AR-Driven Smart Homes: Enhancing Automation and User Experience"](https://www.researchgate.net/publication/388967201_AR-Driven_Smart_Homes_Enhancing_Automation_and_User_Experience), [Augmentecture — AR-Enabled Smart Homes 2025](https://www.augmentecture.com/blog/ar%E2%80%91enabled-smart-homes-integration-and-connectivity-in-2025/).

---

## 10. Home Assistant's own ecosystem — the nearest *currently live* competitive pressure

This is the finding most worth taking seriously precisely because it's not
external at all — it's inside PadSpan's own install base.

- **Picture Elements** is a card built into HA core (not a PadSpan
  invention, not a third-party add-on): set a background image as your
  floor plan, then position entity icons, state labels, and service-call
  buttons on top of it using percentage-based coordinates. It has existed
  for years, is free, and requires no additional integration. It is,
  functionally, "a floor plan with icons on it" — PadSpan's most basic
  value proposition, already given away by HA core itself.
- HA has also been actively developing an **experimental Areas/Home
  dashboard** concept, visible from the 2025.4 release onward and still
  evolving through 2025.9-era releases per Notebookcheck's coverage —
  groups and navigates by physical area, though not (per what was found)
  a literal spatial floor-plan map.
- The HA **community** independently maintains multiple actively-updated,
  free, third-party "floor plan card" projects, several with visual
  no-YAML editors:
  - **easy-floorplan** — visual drag-and-drop editor for walls, doors,
    furniture, text, device controls; SVG over a virtual coordinate space.
  - **houseplan-card** — draw rooms directly on the dashboard, bind to HA
    Areas so devices populate automatically, no YAML/Inkscape required.
  - **ha-floorplan** (pkozul) — SVG-file-based, entity IDs drive live
    state rendering.
  - **ha-explorer-card** — SVG floor plan + interactive rooms + live
    presence objects combined.
  - **floorplan-card** (chr1st1ank) — custom interactive SVG element,
    individual elements react to clicks.

**Why it matters to PadSpan:** this is the nearest *currently live*
substitution pressure found anywhere in this research — closer than any
luxury integrator or Samsung feature, because it's free, it's inside the
exact ecosystem PadSpan sells into, and some of it is built into HA core
itself with zero add-on required. It means "a floor plan exists, with
icons on it" is not, by itself, a sustainable PadSpan pitch — that premise
alone is already commoditized in this specific market. PadSpan's actual
moat (BLE-fusion, centimetre precision, alarm latching, wayfinding,
historical analytics depth) needs to be the explicit pitch, not an
implicit assumption riding on top of "we have a floor plan."

Sources: [Community writeup — "100% Floorplan UI Dashboard"](https://community.home-assistant.io/t/100-floorplan-ui-dashboard-colored-lights-everything-accessable/527231), [easy-floorplan (GitHub)](https://github.com/nicosandller/easy-floorplan), [houseplan-card (GitHub)](https://github.com/Matysh/houseplan-card), [ha-floorplan (GitHub)](https://github.com/pkozul/ha-floorplan) / [project site](https://experiencelovelace.github.io/ha-floorplan/), [ha-explorer-card (GitHub)](https://github.com/MVtag/ha-explorer-card), [floorplan-card (GitHub)](https://github.com/chr1st1ank/floorplan-card), [Notebookcheck — HA 2025.9 coverage](https://www.notebookcheck.net/Home-Assistant-2025-9-brings-new-automations-sidebar-and-tile-features.1108689.0.html).

---

## 11. Explicit confirm/challenge callouts

- **CONFIRMS the core premise, independently, at every market tier
  researched.** "A visual, spatial, living map of the house, richer than a
  list of entities, tied to live device state" is not a niche idea PadSpan
  invented in isolation. Samsung shipped a version consumer-side, Savant
  shipped a version at the luxury-integrator tier, Matterport+SIMLAB
  shipped a version commercially for real estate/property management.
  Three unrelated, well-capitalized companies at three different price
  tiers and business models converged on overlapping bets. That's real,
  independent signal.
- **CONFIRMS a genuinely undefended niche.** Every competitor found
  auto-generates room *geometry* but places devices coarsely (SmartThings:
  "right where they are," described qualitatively, not to measured
  centimetres; Matterport: dollhouse-scale). None of them fuse BLE-
  trilaterated human *presence* into the same map as device placement.
  Atlas + PadSpan's BLE fabric together — precise device position *and*
  precise human position, on one map, in a free/open HA integration — is
  not occupied by anything found in this research.
- **CHALLENGES the placement workflow specifically, and this is the
  sharpest finding in the whole pass.** The single most consistent pattern
  across every serious competitor (Samsung/SmartThings, Matterport, and
  Apple's own dormant-for-this-purpose RoomPlan capability) is *automated
  geometry acquisition* — scan-to-map, address lookup, photo-to-3D, or
  professional capture — with manual entry as a fallback, not the only
  path. Atlas's current workflow is manual centimetre entry with no
  fallback-from, i.e. the inverse emphasis of where the field has gone.
- **CHALLENGES the self-description, not the underlying product.** By the
  industry's own definition (§8), a digital twin implies predictive/
  simulation capability PadSpan doesn't have anywhere yet. Separately,
  "digital twin" as applied to a home already has a large, funded,
  unrelated incumbent user of the exact phrase (Digs, §7). Continuing to
  use the term unqualified costs PadSpan a category-precision argument it
  doesn't need to make, since the actual differentiator stands on its own.
- **CHALLENGES the assumption that the competitive threat sits at the
  luxury-integrator tier.** Control4/Savant/Crestron are a different price
  tier and install model entirely (dealer-installed, proprietary hardware,
  four-to-six-figure installs) — not a realistic threat to a free HACS
  integration's user base. The real, *currently live* proximate pressure
  is inside Home Assistant itself: Picture Elements (built into HA core)
  and several actively maintained free community floor-plan cards already
  give away "a floor plan with live icons on it," for $0, in the exact
  install base PadSpan sells into.

---

## 12. Verdict on this angle

**On the core question — is PadSpan on the right path pursuing a visual,
spatial, device-and-presence map, as opposed to just adding more device
classes to Atlas — the evidence says yes, with one important correction,
not a reversal.** The general bet is validated independently at every
market tier researched (§1, §5, §6), and PadSpan's specific combination —
BLE presence fused with centimetre-accurate device placement, free and
open, inside Home Assistant — is not occupied by anything found in this
pass (§11). That is real, currently defensible territory, not
wishful thinking.

**The correction: the "killer feature" this research turned up is not a
new Atlas rendering capability — it's automated geometry acquisition**,
and it is the single most consistently repeated pattern across every
competitor that matters (SmartThings' four capture paths, Matterport's
professional scans, and Apple's already-built, currently-untapped RoomPlan
API). Atlas's manual, type-coordinates-in-centimetres placement workflow
is, right now, the one place PadSpan is furthest behind the field — more
consequential to the product's near-term trajectory than whichever device
class gets added next, precisely because it's the one thing every serious
competitor independently decided was worth solving and PadSpan hasn't
touched yet. It's also concretely buildable, not speculative: Apple's
RoomPlan is free, on-device, requires no server infrastructure, and is
already used by third-party apps for this exact "phone scan → placeable
room geometry" job (§2) — a capture-companion flow that lets a user scan a
room once with a LiDAR iPhone/iPad and hands Atlas a starting geometry to
fine-tune, instead of a blank canvas and a ruler, is a direct, evidence-
backed answer to "where the real gaps are."

**Secondary findings, ranked by how strongly the evidence supports each:**

1. **Stop using "digital twin" as unqualified self-description** (§7,
   §8, §11) — it invites comparison to two categories PadSpan doesn't
   occupy (predictive-simulation twins, Digs-style static property-record
   twins) for no benefit, when the actual differentiator (BLE-fused,
   centimetre-accurate live map) doesn't need the phrase to be compelling.
2. **Savant's TrueImage validates photorealistic-photo-as-control-surface
   as a legitimate alternate design paradigm** (§5) — worth a deliberate
   stance (a scoped one-room experiment, or a conscious, stated rejection)
   rather than remaining an unconsidered option.
3. **PadSpan's own Insights/Busy Times historical data is a real,
   currently under-exploited asset relative to this competitive set** (§8)
   — no competitor found in this research exposes anything predictive to
   end users at all. Turning "what happened" into "what would happen if"
   would be the one move that makes "digital twin" literally true instead
   of aspirational, and it's the one place PadSpan already has a data
   asset none of the researched competitors do.
4. **HA core's Picture Elements plus the free community floor-plan-card
   ecosystem mean the base "a floor plan exists" premise is already
   commoditized inside PadSpan's own install base** (§10) — the pitch has
   to rest explicitly on BLE-fusion + precision + alarm/wayfinding/
   analytics depth, not on the floor plan existing at all.

**Direct answer to "am I on the right path": yes, on the macro bet — and
the research confirms it independently rather than merely agreeing with
the premise handed to it. But the single most evidence-backed next
investment is automated geometry acquisition, not another device class,
and reprioritizing toward that is the main actionable output of this
angle.**
