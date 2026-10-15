# Live Aboard / Atlas test harness

A local page that renders the real Atlas card and Live Aboard (the 3D house) from a fixture house,
with no Home Assistant needed, plus Playwright scripts that drive it in a real-time browser. Used to
check visual and interactive changes before a release. Not part of the integration (nothing here is
in the release zip).

## Serve it

From the repo root:

```
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/tools/live_aboard_harness/index.html`.

## Page options (query string)

| Param | Effect |
|---|---|
| `one=1` | One floor (else Basement, Main, Upper) |
| `la=0` | The flat Atlas instead of Live Aboard |
| `display=0` | The Mapping layout instead of the sidebar's display mode |
| `edit=1` | Hand Live Aboard an `edit` (Edit and its tools show) |
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

Run them with `python -X utf8 <script> ...` (the page uses characters a Windows console can't
print otherwise).
