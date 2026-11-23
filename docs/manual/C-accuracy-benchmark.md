# Appendix C. Accuracy benchmark

[Contents](README.md)

How often does PadSpan get the room right in **your** house, measured on walks it has never seen?
`tools/benchmark/` answers that from a recorded walk, with a plain "nearest receiver" answer beside
it. It is a tool for developers and power users: it isn't shipped in the integration and changes
nothing in an install. For the everyday score, use **Calibration → Model** instead
([chapter 11](11-calibration.md#the-model-tab)).

## Why held out, and grouped

Most room-presence scores test against the same walk that was just used to calibrate. Neighbouring
readings share most of their radio conditions, so a reading left out is answered by its near-copies
and the score reads close to perfect. Published work shows the size of the gap: k-NN had a 0.0 m
median on a random split and 9.4 m when whole positions were held out (arXiv 2610.22680).

So the benchmark never splits readings at random. A reading is tested only against fingerprints from
other groups:

| `--group-by` | Held out together | Use when |
|---|---|---|
| `walk` (default with 2+ walks) | A whole walk | You recorded the house more than once, ideally on different days |
| `visit` (default with 1 walk) | One stay in a room | You have one walk |
| `position` | A visit, plus every reading within 1.5 m of its marked spots (`--radius`) | The walk has x/y marks |
| `--train-walk NAME` | Everything except NAME | A calibration walk and separate test walks |

`--settle 5` drops the first 5 seconds of every visit (you were still in the doorway when you marked
the room).

## Recording a walk in PadSpan

1. Turn on **Settings → Features → RSSI Vector Capture** (off by default).
2. In **Health**, under **RSSI Vector Capture**, choose **⏺ Record**. It asks first how many
   minutes to record (1 to 60, 5 unless you change it): give enough for the whole walk, since the
   recording stops itself when the time is up. Then give it a label: the label becomes the walk's
   name.
3. Carry the phone or tag. Each time you arrive in a room, pick it and choose **Mark room**. Typing
   the spot's x/y as well (metres, the map's own) gives metre errors and `--group-by position`.
4. Stay 1 to 2 minutes in each room, moving around. **⏹ Stop**, then **Export .jsonl**.
5. Repeat on another day for a second walk.

```
python tools/benchmark/from_capture.py padspan-capture-*.jsonl -o walk.json
```

Only readings under a mark are kept; the receivers' rooms and positions, the room centres and what
PadSpan showed at the time come along. `--device KEY` keeps one device when several were marked.

A capture holds your receiver and device addresses and room names. Keep it private unless you mean
to share it.

## A walk from another system

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

Each reading needs `room` (the true room) and `rssi` (dBm for each receiver that heard it). Optional:
`ts` (needed for `--settle`), `walk`, `device`, `x`/`y`/`floor`, and `live` (what the system under
test said). A receiver's `room` feeds the baseline; its `x`/`y` are needed for the spatial method.
CSV works too: `ts,walk,device,room,x,y,floor` plus one `rssi:<scanner>` column per receiver, with the
receivers in a second CSV given by `--scanners`.

## Running it

```
pip install voluptuous
python tools/benchmark/benchmark.py walk.json [more.json ...] [--group-by ...] [--json results.json]
```

Home Assistant needn't be installed: PadSpan's modules are loaded straight from
`custom_components/padspan_ha`. What is scored, all with PadSpan's own code:

- **PadSpan k-NN**: the calibration match over the held-in readings.
- **PadSpan spatial**: the path-loss solve, with each receiver's fit redone from the held-in
  readings. Needs at least 3 placed receivers.
- **Nearest scanner**: the room of the receiver that hears the device loudest.
- **PadSpan live (as recorded)**: from a capture only. Not held out, so it is "what you saw", not a
  fair split.

**Reading the results**: **rooms right** is the share of readings where the room was right (one a
method couldn't answer counts as wrong; **answered** shows how many it answered). **median m** and
**p75 m** are metre errors over readings with a marked x/y. The JSON adds per-room shares and the
most common wrong calls (true room → called room), which usually name the open-plan pair or the
stairs.

## Scoring any Home Assistant room sensor

```
python tools/benchmark/score_sensor.py walk.json history.json --entity sensor.phone_area [--map "living_room=Living Room"]
```

`history.json` is Home Assistant's history (its REST history, or the History panel's
**Download data** CSV). At each reading, the sensor's last state at or before that moment is its
answer; `unknown`, `unavailable` and `not_home` count as no answer. This works for Bermuda, PadSpan's
own sensors and others. Running two systems side by side on the same walk is the fair comparison;
please publish only comparisons where each was set up its own documented way.

## A public dataset

Zenodo record [4783076](https://zenodo.org/records/4783076) (CC BY 4.0): a house with 6 fixed beacons
and 10 rooms, one calibration session (a laptop, 600 fingerprints) and two later test sessions (a
laptop and a Raspberry Pi, 1,200 each).

```
python tools/benchmark/datasets/zenodo_4783076.py DATA_DIR -o house.json
python tools/benchmark/benchmark.py house.json --train-walk calibration-laptop
```

Result (PadSpan 0.38.165's code, 2026-10-25), trained on the calibration session only:

| Method | Rooms right | Test laptop | Test Raspberry Pi |
|---|---|---|---|
| PadSpan k-NN | 84.2% | 88.4% | 79.9% |
| Nearest beacon | 52.7% | 53.6% | 51.8% |

What that does and doesn't show:

- The radios are the other way round from a PadSpan house (fixed beacons, a moving receiver).
- The dataset doesn't say where the beacons are, so the spatial method can't run.
- The rows are averaged fingerprints with no times: k-NN without PadSpan's smoothing over time, on
  cleaner input than one reading.
- The Raspberry Pi row is a different receiver from the calibration one.

## Limits, plainly

- Each reading is scored on its own, so one stray reading counts as a wrong room. Live PadSpan
  smooths rooms over time: a stray reading doesn't move a device, so while you stay in a room it is
  usually right more often than these scores say. But it moves a device only once the new room has
  kept winning for a while (up to the **Room Change Delay**, 40 seconds unless you changed it), so
  just after you walk into another room it still shows the one you left, and is wrong more often than they say.
  The `live` row from a capture shows the smoothed answer.
- A walk is one person, one device, one afternoon. Several walks on different days, with doors in
  different states, are what make the number mean something.
- The room you mark is only as true as your marking; `--settle` helps.
- The baseline is deliberately simple. Beating it is a floor, not a boast.
