# Live Aboard / Atlas test harness

A local page that renders the real Atlas card and Live Aboard (the 3D house) from a fixture house,
with no Home Assistant needed, plus Playwright scripts that drive it in a real-time browser. Used to
check visual and interactive changes before a release. Not part of the integration (nothing here is
in the release zip).

## Run all the checks

```
python tools/live_aboard_harness/run_all.py
```

It serves the repo on 127.0.0.1:8765, runs every `pw_*.py` in a fresh headless browser and judges
each log (`check_log.py`: the scripts print their state rather than assert). A check whose 3D view
never started gets up to 3 tries. `tools/test_all.py` runs this with the test suite and the live check.

`browser.py` picks the browser: Edge with SwiftShader on Windows, Chrome on the machine's GPU on
macOS and Linux (SwiftShader breaks the editor there, and headless frame pacing needs the steady-frame
flags). `PADSPAN_HARNESS_BROWSER` overrides it; `PADSPAN_HARNESS_CDP=http://127.0.0.1:<port>` drives a
browser already running on another machine (a wall screen's own GPU) through an SSH tunnel, with the
harness forwarded back to it (`ssh -L <port>:127.0.0.1:9333 -R 8765:127.0.0.1:8765 <host>`).

## Serve it

From the repo root:

```
python tools/live_aboard_harness/serve.py
```

(`python -m http.server 8765 --bind 127.0.0.1` works too; serve.py answers /favicon.ico with 204 so
the only 404s in a check's console are real.) Then open `http://127.0.0.1:8765/tools/live_aboard_harness/index.html`.

## Page options (query string)

| Param | Effect |
|---|---|
| `one=1` | One floor (else Basement, Main, Upper) |
| `la=0` | The flat Atlas instead of Live Aboard |
| `display=0` | The Mapping layout instead of the sidebar's display mode |
| `edit=1` | Hand Live Aboard an `edit` (Edit and its tools show) |
| `tool=heights\|door\|window\|doorway\|strip`, `teid=` | With `edit=1`: open Edit at that tool (and pick that light in Strip), as the setup wizard does |
| `sky=rainy` / `sunny` | The weather entity's condition (rain alert, rain) |
| `night=1` | `sun.sun` below the horizon |
| `cls=temp` | Pick a device-type chip (heat map with `temp`) |
| `smoke=0`, `wopen=0` | The smoke alarm quiet; the living-room window shut |
| `w=380` | Card width in px (a phone; desktop browsers won't go narrower than ~500 px) |
| `click=A,B` | Press buttons by their text after load |
| `wheel=N&wx=&wy=` | Zoom N wheel steps at a point (0..1 of the canvas) |
| `tapeid=`, `hovereid=` | Tap or hover a device by entity id |
| `draw=fid,x0,y0,x1,y1` | Drag a line along a wall (plan metres) after picking a tool |
| `probe=<js>` / `pd=ms` | Run `js` (gets `slot`) and print its JSON into `<pre id="out">` |

The house's fixture (rooms, lights, sensors, states) is at the top of `index.html`.

`wizard.html?step=<id>` shows the Live Aboard setup wizard (views/aboard_wizard.js) on its own, with
a small fixture house, opened on that step (on, floors, rooms, devices, heights, openings, strips,
furniture, extras, screen).

## Screenshots

Static views (no interaction after load) work with headless Edge's own screenshot:

```
msedge --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1300,950 --virtual-time-budget=12000 --screenshot=out.png "<url>"
```

**Anything interactive needs real time.** With `--virtual-time-budget`, `requestAnimationFrame`
stops after a few frames, so the 3D view never redraws after a change (it can even go black). Use
the Playwright scripts for those (`pip install playwright`; they use the installed Edge):

| Script | What it checks |
|---|---|
| `pw_flow.py <draw\|corner\|taps\|resize\|undo\|keys\|strip> <outprefix>` | Edit's line tools, snapping, undo/redo/discard, keyboard, Strip's Round this room |
| `pw_door.py <Door\|Window\|Doorway> <fid,x0,y0,x1,y1> <out.png>` | Draw one opening, then Iso |
| `pw_sheet.py <out.png>` | A door's sheet: hinge, swing, shown, type (sliding), arcs, Save |
| `pw_help.py` | Views ▾ → How it works and its guide link |
| `pw_load.py` | Load the page, list visible buttons and any errors |
| `pw_tool.py [light]` | The setup wizard's way in (`?edit=1&tool=<t>&teid=<light>`): Edit opens at Heights, Door, Window, Strip (with the light picked) |

Run them with `python -X utf8 <script> ...` (the page uses characters a Windows console can't
print otherwise).
