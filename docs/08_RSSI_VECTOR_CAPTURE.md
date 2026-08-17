# RSSI Vector Capture

Every tuning change to the positioning pipeline used to be argued from memory:
a room felt stickier, a floor flipped less. Capture records the **input the
pipeline actually consumed** — the full `{scanner: rssi}` vector per tracked
object per poll — alongside the answer it produced, so the same walk can be
re-run offline against changed code and the difference stated as a number.

Off by default. Settings → Features → **RSSI Vector Capture**.

## Recording

Health → Quick actions gains a Record button once the feature is on.

1. **⏺ Record** — asks for a duration (1–60 min) and an optional label.
2. Walk the house. Press **Mark room** whenever you enter a room; that stamps
   ground truth, and it is what turns a recording into something scoreable
   rather than merely replayable.
3. **⏹ Stop**, then **Export .jsonl**.

A session stops itself at its duration, at 25 MB, or on integration unload, and
records which (`stop_reason`).

## What is recorded

Only **identified or followed** devices — the same rule `traceback_store` uses.
Measured on a real house that is ~12 objects out of ~1,800 BLE objects per
poll; the rest are neighbours' phones heard by one or two scanners, useless to
a positioning fixture and not ours to record. An explicit `keys` list overrides
this, for diagnosing a device the system has never identified.

## File format

JSONL, one record per line, in `.storage/padspan_ha.capture_sessions/<id>.jsonl`.
Every line carries a `t` discriminator.

| `t` | When | Contents |
|---|---|---|
| `hdr` | once, first | schema version, geometry, and every setting `_smooth_room` re-reads live |
| `env` | on change | a mid-session change to the source list or its room/floor attribution |
| `gt` | on Mark | the operator's ground-truth assertion |
| `f` | each poll | one frame: inputs and outputs |
| `end` | once, last | frame count and `stop_reason` |

### The source index

The header declares `"src": ["AA:BB:...", ...]` and every vector is keyed by
**position in that array**: `"v":{"0":-72.5,"3":-81.2}`. A literal MAC key costs
26 bytes per source per object per frame; an index key costs 10. The array is
append-only for the life of the session, so an index once written never changes
meaning.

### Frame fields

Inputs — without these the trace cannot be re-run:

- `k` object key, `a` Kalman state key, `t` kind (`ble`/`private_ble`/`ibeacon`)
- `v` the vector: calibrated, exclusion-filtered, freshness-gated raw values —
  **not** the Kalman-smoothed `_source_rssi`, which is the filter's own output
  and could never reproduce the filter
- `x` tx power, `e` ESPresense node distances
- `w` warm filter state, **first frame per key only**

Outputs — what makes it a golden fixture:

- `r` room after smoothing, `c` confidence, `mx`/`my`/`mf` position in metres
- `q` k-NN confidence
- `p` pin room, when the object is pinned
- `g` ground truth, while a mark is active

### Two traps the format exists to disarm

**`w` is the state AFTER its own frame's update** — i.e. exactly what the next
frame consumed. A replay seeds from a key's first frame and scores from its
second. That costs one frame and makes the comparison exact instead of
warm-up biased, which is the single reason the existing traceback could not be
used as a replay source.

**A pinned object's `r` is the pin, not the pipeline's answer.** The pin
overrides `_smooth_room` after it returns. A replay that scores a pinned beacon
against `r` fails 100% of its frames for a reason nobody would find, so `p` is
recorded to tell them apart.

## Replaying

`tests/test_capture_replay.py` provides `load_capture()` and `replay()`, both
public so a tuning test can import them.

- **Golden regression** — replayed room == the frame's own `r`. A refactor that
  moves one answer fails.
- **Accuracy benchmark** — replayed room == `g`, over the frames a human
  labelled. This is what makes a tuning change measurable rather than
  anecdotal, and the harness also reports transition latency, because
  stickiness moves those two in opposite directions.

Vectors come back keyed by scanner **name**; the source index never reaches a
consumer. The loader refuses a schema version it does not speak.

## Caps and retention

| Cap | Value | Why |
|---|---|---|
| `MAX_SESSION_S` | 3600 | one hour |
| `MAX_SESSION_BYTES` | 25 MB | duration binds first at home scale, size at commercial scale |
| `MAX_SOURCES_PER_OBJECT` | 32 | strongest kept; bounds a 200-scanner site |
| `MAX_OBJECTS_PER_FRAME` | 250 | a backstop, not the policy — the identified/followed filter is |
| `MAX_SESSIONS` / `MAX_TOTAL_BYTES` | 10 / 200 MB | across all sessions |
| retention | 1/3/7/14/30 days | default 14 |

The session is never held in RAM: `_pending` is bounded by **bytes** (2 MB) and
flushed every 10 s, appended never rewritten. A torn tail from a crash costs
exactly one frame.

## Deliberate omissions

- **Not in backups.** Captures are disposable multi-MB diagnostics; three of
  them would be a 75 MB backup blob. A restore does not bring them back. A
  factory reset *does* delete them, files included.
- **Not Pro-gated.** It records only objects the coordinator is already
  tracking, for minutes, at the operator's explicit request.
- **No replay UI.** Replay lives in pytest, where the pipeline it replays runs.
- **No committed fixtures.** A capture contains real MACs, room names and
  device labels; a real trace in git history cannot be taken back out. The
  tests build synthetic sessions through the real recorder. Committing a
  scrubbed trace stays available as a separate, deliberate decision.

## Preconditions

`capture_start` refuses when the feature is off, when a session is already
running, and **when the coordinator has not completed its first poll** — a
session started in the window after a restart wrote a header, an end line and
zero frames while reporting a healthy scanner count, because that count comes
from the fabric and not from anything having run.
