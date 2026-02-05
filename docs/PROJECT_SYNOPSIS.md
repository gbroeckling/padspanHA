# PadSpan — Project Synopsis (as of 2026-02-04)

## One-line description
**PadSpan** is a **low-power Bluetooth (BLE) integration assistant for Home Assistant** that makes BLE device onboarding, calibration, and room/position tracking *consumer-simple*—with a map-first workflow and guided “walk-to-identify” discovery.

## What we agreed PadSpan is “closest to”
- Closest product archetype: **Option C** — an assistant/agent-like experience that **ingests HA Bluetooth**, guides setup, and produces reliable outcomes (room/location, confidence, diagnostics).
- Inspiration reference: “vaguely similar to Bermuda” (BLE room presence/tracking), but **much easier to use**, designed for **low power**, and **no MAC-address workflows in the UI**.

## Core setup philosophy (“Labens-style”)
- Put listening devices (BLE proxies/scanners) in place.
- Import a map of inside/outside.
- Place devices on the map.
- Run guided tests that collect data.
- Use the data to build:
  1) a Physical map (ground truth canvas),
  2) a Radio map (signal-space / “closest signal-wise” understanding),
  3) a Distortion map (where radio and physical disagree),
  4) a Combined “Stretch/Span” view that fuses the above into an easy customer-facing experience.

## The 4-pane map model
### 1) Physical Map (Ground Truth)
- User-provided floorplan/site image (inside + outside supported).
- Anchors placed here: BLE listeners/proxies (“listening devices”), beacons, zones/rooms.

### 2) Radio Map (Signal Space)
- A visual that represents “closest signal-wise” relationships (not literal geometry).
- MVP-friendly representation: **anchor-dominance regions** (which listener is ‘winning’ / most likely).
- Advanced representation: signal embedding/projection (PCA/UMAP-like), optional.

### 3) Distortion Map (Mismatch Overlay)
- Visualizes mismatch between Physical Map and Radio-derived inference:
  - vector arrows (radio pulls),
  - heatmap of error/uncertainty,
  - per-room “problem zones” diagnostics.

### 4) Combined Stretch/Span Map (Fused View)
- Customer-facing fused map: Physical map + radio overlays aligned through fitting.
- **Per-room adjustment** preferred to avoid “weird distortion”:
  - apply local constrained transforms inside room polygons,
  - blend at boundaries (doorways) to avoid dot jumps.
- Never permanently distort the uploaded floorplan; distort overlay coordinate frames.

## Primary calibration method (current plan)
### “Compass Ring (2m)” test around a beacon
For each beacon/target device:
- Stand **North 2m**, **South 2m**, **West 2m**, **East 2m** (optionally Center).
- All BLE listening devices must be active and in their proper locations.
- Repeat for each beacon.
- Outcome: labeled signal fingerprints that help infer left/right/N/S/E/W relationships relative to beacons.

### Data captured (conceptual)
For each BLE advert during calibration:
- target_id, anchor_id (listener), timestamp, RSSI, calibration_point (N/S/E/W/CENTER), radius_m, map coordinates.

### Inference approach (recommended MVP)
- **Fingerprinting classifier** over RSSI vectors across anchors:
  - robust indoors, avoids fragile multilateration,
  - yields room/zone and “relative position around beacon” with confidence.
- Later optional: hybrid distance model / multilateration-like fusion.

## Discovery / onboarding (current plan)
### “Walk-to-identify” device detection (no MACs shown)
- Once there are ~5+ devices/listeners in the home, user can start a discovery session.
- User walks end-to-end through the home carrying the device/token(s).
- PadSpan ranks candidate BLE advertisers by how well they match the movement path.
- User selects a candidate card and names it (e.g., “Nicole’s Keys”).
- Under the hood, PadSpan stores a stable identifier or a fingerprint, but **UI never exposes MAC addresses**.

## Device “Trackability Rating” (added requirement)
During discovery and ongoing operation, compute and store:
- **Strength**
- **Stability**
- **Reliability**
- **Coverage**
and an overall grade (A/B/C/D or 0–100) with a recommended mode:
- A/B: dot-on-map + room
- C: room-first, dot optional/approx
- D: presence-only or “not recommended”

This rating should be visible later so users understand expected accuracy.

## Runtime output goal
Using Physical + Radio + Distortion layers, PadSpan should locate people/devices **physically on the map** with a dot and confidence halo:
- Ingest BLE adverts → build measurement vector per device
- Use fingerprint matching / radio likelihood → provisional location
- Apply distortion corrections (per-room transforms + error field)
- Apply physical constraints (inside polygons) and temporal smoothing
- Publish room + position + confidence + “why”

## Diagnostics (current plan)
A “Fix it” view that answers:
- Are enough listeners hearing the device?
- Is RSSI saturated or too noisy?
- Is the device sleeping / advert interval too slow?
- Are there dead zones / high distortion zones?
- Recommendations: move/add listeners, adjust beacon settings, etc.

## MVP vs Pro
### MVP (ship quickly)
- Custom HA integration:
  - listen to HA Bluetooth advertisements
  - discovery session (candidate ranking + naming)
  - basic sensors/services for testing
- Map UI can start as “backend-only + simple debug entities”, then move to a custom card/panel.

### Pro (later, “wow” features)
- Per-room constrained fitting with boundary blending (default)
- Optional local piecewise warp inside rooms (“Pro mode”)
- Multi-radius rings (1m/3m) for better dot accuracy
- Heatmap generation, replay timeline, and explainability panels
- Potential “open-core” packaging (free room presence, paid mapping/fusion tooling)

## Immediate testing plan (Home Assistant OS)
- Install as custom integration from this ZIP
- Confirm BLE ingest is working (seen devices count increases)
- Run discovery session and confirm candidate collection
- Iterate: add scoring model + storage + UI later

