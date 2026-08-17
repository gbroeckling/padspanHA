# PadSpan HA – Repo Logic Overview (v0.4.0)

This file is a **“why + how” memory dump** so future-you (or another maintainer) can open the repository in a year and immediately understand:

- What the integration does
- The architecture (backend + frontend)
- The decisions made and the constraints that drove them
- Where data lives (storage + www + state)
- How to debug the common failure modes we hit (especially the 500 “Config flow could not be loaded”)

If you are reading this after a long break, start here, then follow the numbered docs in this folder.

> **Note (2026-08-16).** Sections below still describe the v0.4-era shape.
> The current doctrine — the metric fabric as the single source of truth, the
> FabricStore/ModelStore split, and the floor stack — is in
> [`03_MAPPING_SUITE.md`](03_MAPPING_SUITE.md).
> Before changing anything, read [`09_HARD_WON_RULES.md`](09_HARD_WON_RULES.md):
> eleven rules, each one paid for by a shipped bug.

---

## 1) Project goal in plain language

**PadSpan HA** is a Home Assistant custom integration that provides a **single side-panel UI** (left sidebar entry in HA) for:

- Viewing “objects/tags seen by rooms”
- Switching between **sample data** and **live data**
- Managing **maps/floorplans** used for receiver placement and later calibration
- Exporting/importing the mapping data for testing and backup

The core UX goal is: **“use HA as the control plane”** for a BLE presence / mapping system without needing external dashboards.

---

## 2) Core design constraints that drove the implementation

### A) Avoid fragile HA APIs (reduce 500s)
We repeatedly saw:
- **500 Internal Server Error** when clicking the **integration gear** (Options / Configure).
- “Invalid handler specified” when HA couldn’t resolve the config flow domain/handler.

These errors almost always came from:
- Import-time failures in Python modules (missing imports, new files not copied, mismatch domain)
- Using frontend/selector features that changed across HA versions
- Partial zip updates where old JS or old Python modules remained

So we biased toward:
- **Minimal dependencies**
- **Local-first storage**
- **Websocket-based frontend integration**
- Defensive imports and initialization

### B) Single side-panel entry only
Earlier iterations accidentally produced “sidebar everywhere” behavior by registering multiple panels.
The desired behavior is:
- One HA sidebar entry (**PadSpan**) → one panel UI → internal navigation in that panel.

### C) Future-proof data model
Maps + receivers should survive:
- Image resizing
- Replacing a map image
- UI changes

So receiver placement uses **normalized 0..1 coordinates** instead of absolute pixels.

---

## 3) High-level architecture

### Backend (Python)
- `__init__.py` initializes:
  - coordinator
  - stores (settings/maps)
  - websocket commands
  - panel registration
- `coordinator.py` holds the **runtime state** for the panel:
  - sample vs live mode
  - room/tag map (sample or discovered)
  - diagnostics info
- `settings_store.py` persists UI choices:
  - sample vs live
  - active map id
- `map_store.py` persists:
  - list of maps
  - receiver placements per map
  - calibration metadata
- `websocket.py` defines the WS API consumed by the panel

### Frontend (Panel JS)
- `/www/padspan-ha/panel.js` is the HA panel entrypoint.
- It renders:
  - a left navigation menu inside the panel
  - the top-right **Sample/Live** switch
  - per-view renderers under `/www/padspan-ha/views/*.js`
- All data exchange uses `hass.callWS(...)` (websocket).

---

## 4) Data flow (sample vs live)

### Sample mode
- Use a curated `room_tag_map` stored in the coordinator.
- This is deterministic and ensures the UI works even with no hardware.

### Live mode (best-effort discovery)
- Discover **rooms** from HA Areas
- Discover **receivers** from HA Devices by heuristics
- Discover **tags** primarily from Bermuda entities / sensors (heuristic)
- Then build a `room_tag_map` that drives the UI.

Important: live discovery is **heuristic** by default. It becomes deterministic if you provide:
- your receiver entity naming pattern
- your tag entity naming pattern
- which integration owns the tag-room relationship (Bermuda vs custom)

---

## 5) Mapping suite (why it’s built this way)

We start mapping by supporting:
- Upload floorplan images (multiple image types)
- Convert to standard PNG
- Resize to a manageable max dimension
- Drop receiver points
- Save and export metadata

**Normalized coordinates** make receiver placement stable even if the image changes resolution.

Calibration is stored separately as `px_per_meter` plus reference points; it does not move receivers.

---

## 6) The “500 on gear icon” root causes we hit

This doc set intentionally preserves the reasoning:

The integration gear triggers `config_flow` / options flow loading.
If HA can’t import or resolve the handler, you get:
- “Config flow could not be loaded”
- 500 error
- stack trace in logs

Common causes:
- Domain mismatch between folder name and `manifest.json` domain
- Missing `config_flow.py` or wrong class name
- Import errors from missing files (partial zip overwrite)
- Using HA features (selectors/options) not supported by your HA version

The fix strategy:
- Keep a stable domain: `padspan_ha`
- Keep config flow simple and defensive
- Always ship full zips (include README/docs)
- Add auto-diagnostics websocket to quickly surface missing parts

---

## 7) Where to go next
- Read `01_ARCHITECTURE.md`
- Then `02_WEBSOCKET_API.md`
- Then `03_MAPPING_SUITE.md`
- Then `04_LIVE_DISCOVERY.md`
- Keep `90_TROUBLESHOOTING.md` handy when HA upgrades.

