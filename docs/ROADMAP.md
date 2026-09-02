# ROADMAP

## mmWave presence sensors (MQTT) — under consideration

Raised by u/Jay4255 on the 2026-09-02 r/homeassistant launch thread (post 1w5h7qs):
a whole-home mmWave view, ideally combined with the existing BLE trilateration in
one plugin rather than the single-sensor add-ons that exist today.

No commitment yet. mmWave needs its own solver, it is not a drop-in on top of the
BLE trilateration: different data shape (per-sensor zones/point clouds vs.
per-scanner RSSI), and no existing UI for a sensor's own zone geometry.

Revisit November 2026 (calendar reminder set) once the current release cadence
settles. Scoping prompt for that session:

> Research feasibility of adding mmWave presence sensor support (MQTT-based, e.g.
> ESPHome mmWave or Aqara FP2 style zone data) to PadSpan HA alongside the
> existing BLE trilateration. Read this ROADMAP entry and the original ask
> (r/homeassistant post 1w5h7qs, u/Jay4255, 2026-09-02) for context. Investigate:
> (1) what MQTT payload shapes real mmWave sensors actually publish (zone
> occupancy vs. point coordinates vs. distance), (2) whether an mmWave source can
> feed the same room-level positioning pipeline (fabric_truth.py /
> presence_coordinator.py) or needs a parallel solver, (3) whether this is
> additive (one more scanner type) or needs new UI (sensors don't currently have
> their own zone geometry). This is a feasibility/scoping pass, not a design
> commitment, report back with a recommendation and rough sizing before writing
> any code.
