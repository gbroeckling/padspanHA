# Accuracy benchmark

How often does PadSpan get the room right in *your* house, measured on walks
it has never seen? `tools/benchmark/` answers that from a recorded walk, and
puts a plain "nearest scanner" baseline next to it. It is a developer and
power-user tool: it is not shipped to users and it changes nothing in an
install. Everything it needs comes from features PadSpan already has.

## Why held-out, and grouped

Most room-presence scores, PadSpan's old Calibration score included, test
against the same walk that was just used to calibrate. Neighbouring readings
share most of their radio conditions, so a reading left out is answered by
its near-copies and the score reads close to perfect. Published work shows
the size of the gap: k-NN had a 0.0 m median on a random row split and
9.4 m when whole positions were held out (arXiv 2610.22680).

So the benchmark never splits readings at random. A poll is only tested
against fingerprints from other groups:

| `--group-by` | held out together | use when |
|---|---|---|
| `walk` (default with 2+ walks) | a whole walk | you recorded the house more than once, ideally on different days |
| `visit` (default with 1 walk) | one stay in a room | you only have one walk; the same room visited again later can still answer |
| `position` | a visit, plus every poll within 1.5 m of its marked spots (`--radius`) | the walk has x/y marks |
| `--train-walk NAME` | everything except NAME | a calibration walk and separate test walks |

`--settle 5` drops the first 5 s of every visit from both sides (you were
still in the doorway when you marked the room).

## Recording a walk

### From PadSpan (no new code)

1. Settings → Features → **RSSI Vector Capture** (off by default).
2. Health → **Record**, give it a label (the label becomes the walk name).
3. Carry the phone or tag. Each time you arrive in a room, pick it and press
   **Mark room**. Typing the x/y of the spot (metres, the map's own
   coordinates) as well enables metre errors and `--group-by position`.
4. Stay 1–2 minutes per room, move around inside it. **Stop**, **Export .jsonl**.
5. Turn the feature off again if you like. Repeat on another day for a
   second walk.

```
python tools/benchmark/from_capture.py padspan-capture-*.jsonl -o walk.json
```

Only polls under a mark are kept. The scanner rooms and positions, the room
centroids and what PadSpan showed at the time come along from the capture.
`--device KEY` keeps one device when several were marked.

A capture contains your scanner and device addresses and room names. Keep it
private unless you mean to share it.

### By hand, or from another system

A walk log is JSON:

```json
{
  "format": "padspan-walk", "version": 1,
  "scanners": {"kitchen_proxy": {"room": "Kitchen", "x": 2.0, "y": 3.5, "floor": "main", "z": 2.1}},
  "rooms":    {"Kitchen": {"floor": "main", "polygon": [[0,0],[4,0],[4,4],[0,4]]}},
  "floors":   {"main": 0.0},
  "polls": [
    {"ts": 1761300000.0, "walk": "sat-am", "device": "phone", "room": "Kitchen",
     "x": 1.2, "y": 2.0, "floor": "main",
     "rssi": {"kitchen_proxy": -61.0, "hall_proxy": -78.5}}
  ]
}
```

Required per poll: `room` (the true room) and `rssi` (dBm per scanner that
heard the device; leave a scanner out if it heard nothing). Optional: `ts`
(epoch seconds; needed for `--settle` and the sensor scorer), `walk`,
`device`, `x`/`y`/`floor` (true position), `live` (`{"room", "x", "y"}`,
what the system under test said). Scanner `room` feeds the baseline;
scanner `x`/`y` are needed for the spatial method. Room polygons are
optional (rooms are then called from k-NN's room vote, or the nearest
`centroid`).

CSV works too: columns `ts,walk,device,room,x,y,floor` plus one
`rssi:<scanner>` column per scanner (empty = not heard), with the scanners
in a second CSV (`id,room,x,y,floor,z`) given by `--scanners`.

## Running it

```
pip install voluptuous          # the one non-stdlib import PadSpan's modules need
python tools/benchmark/benchmark.py walk.json [more.json ...] [--group-by ...] [--json results.json]
```

Home Assistant does not need to be installed: PadSpan's modules are loaded
straight from `custom_components/padspan_ha` with a stand-in for the
`homeassistant` names they import and do not use here.

What is scored, all with PadSpan's own code:

- **PadSpan k-NN**: `CalibrationStore.knn_locate` over the held-in polls,
  chosen the way `heldout.evaluate` chooses them.
- **PadSpan spatial**: `heldout.SpatialSite`, the path-loss solve, with each
  scanner's fit redone from the held-in polls. Needs at least 3 positioned
  scanners. The floor is the marked one, else the loudest scanner's.
- **Nearest scanner**: the room of the scanner that hears the device
  loudest (its position, for metre error).
- **PadSpan live (as recorded)**: from a capture only. Not held out (it ran
  on the calibration the house had), so it is "what you saw", not a fair split.

## Reading the results

```
method                       rooms right  answered  median m   p75 m
PadSpan k-NN                       84.2% 2397/2397         -       -
Nearest scanner                    52.7% 2397/2397         -       -
```

- **rooms right**: share of labelled polls where the room was right. A poll
  a method could not answer counts as wrong; **answered** shows how many it
  answered.
- **median m / p75 m**: metre error over polls with a marked x/y that the
  method placed. p75 is the third quartile IPIN ranks by. k-NN only reports
  it when every poll in the log has x/y.
- The JSON adds per-room and per-walk shares and the most common wrong calls
  (true room → called room), which usually name the open-plan pair or the
  stairs.

## Any HA room sensor (Bermuda, PadSpan's own, others)

```
python tools/benchmark/score_sensor.py walk.json history.json --entity sensor.phone_area [--map "living_room=Living Room"]
```

`history.json` is HA's REST history
(`GET /api/history/period/<start>?filter_entity_id=sensor.phone_area`), or
the History panel's **Download data** CSV. At each walk poll the sensor's
last state at or before that moment is its answer. Names compare ignoring
case and `_` vs space; `unknown`, `unavailable`, `not_home` count as no
answer. Sensors run on their own calibration, so this is also a "what you
saw" score. Running two systems side by side on the same walk is the fair
comparison; please only publish comparisons where each was set up its own
documented way.

## Public dataset result

Zenodo record [4783076](https://zenodo.org/records/4783076) (CC BY 4.0):
a house with 6 fixed BLE beacons and 10 rooms, one calibration session
(laptop, 600 fingerprints) and two later test sessions (laptop and
Raspberry Pi, 1,200 each). Download the three `house - ...` CSVs, then:

```
python tools/benchmark/datasets/zenodo_4783076.py DATA_DIR -o house.json
python tools/benchmark/benchmark.py house.json --train-walk calibration-laptop
```

Result (PadSpan 0.38.165 code, 2026-10-25), trained on the calibration
session only:

| method | rooms right | test laptop | test Raspberry Pi |
|---|---|---|---|
| PadSpan k-NN | 84.2% | 88.4% | 79.9% |
| Nearest beacon | 52.7% | 53.6% | 51.8% |

What that does and does not show:

- The radios are the other way round from a PadSpan house (fixed beacons, a
  moving receiver). k-NN does not care which end moves; absolute levels and
  scan behaviour still differ from ESP32 or Shelly proxies.
- The dataset does not say where the beacons are, so the baseline takes each
  beacon's room as the room where the calibration session heard it loudest,
  and the spatial method cannot run.
- Rows are already averaged fingerprints with no timestamps, so this is
  k-NN without PadSpan's smoothing over time, on cleaner input than a
  single poll.
- The Pi row is a different receiver from the calibration one, which is
  the cross-device case.

Other datasets looked at: the UEx multi-slot BLE database (Zenodo 3927588)
is an office/campus facility in a custom multi-file format; SPHERE and the
IPIN tracks need more conversion work. None is wired up yet.

## Limits, plainly

- Each poll is scored on its own. Live PadSpan smooths rooms over time, so
  it usually does better on room changes and worse right after one; use the
  `live` row from a capture to see the smoothed answer.
- A walk is one person, one device, one afternoon. The number is for that
  house and those conditions. Several walks on different days, with doors in
  different states, are what make it mean something.
- The room you mark is only as true as your marking. Marking late after a
  room change puts wrong labels on the doorway polls; `--settle` helps.
- The baseline is deliberately simple. Beating it is a floor, not a boast.
- The spatial method uses the same defaults as the live system (-59 dBm at
  1 m, exponent 2.5) where a scanner has too few positioned polls for its
  own fit.
