# Click-through test of the panel

Presses every control on every screen of the panel, on the demo build
(`tools/demo`: the real panel over a made-up house and a fake Home Assistant,
so every press is harmless), and writes down what went wrong.

    python tools/ui_click_through/crawl.py --out <folder>

Options: `--minutes 36` (time for the crawl itself), `--depth 3` (how many
presses deep it follows what a press opens; a wizard's Next/Continue does not
count), `--second-skin-depth 1`, `--workers 4` (browsers at once),
`--skins 2025,classic`, `--sizes phone,desk`, `--pages overview,atlas3d,...`
(a few views only), `--port 9391`. Needs Playwright for Python and Google
Chrome; the browser is headless and every request that is not to the local
demo server is refused, so nothing is loaded from the internet.

## What it does

- Pages: every view in the panel's menu (`MENU` in `panel.js`) and every view
  reached only by a link (`_VIEW_PATHS`), read from `panel.js` each run, in
  both skins (the demo's settings are changed on their way to the page:
  `ui_skin`, and Forensics and Guests switched on so their views exist), at
  phone size (390x844, touch, `&narrow=1`) and desktop (1920x1080); and the
  Atlas page flat, in 3D and as a wall screen (`&kiosk=1`).
- On each page it finds the controls (`probe.js`, inside the page: buttons,
  links, tabs, anything with a click handler, toggles, selects, sliders, text
  and number fields, file pickers, maps and 3D canvases, inside shadow roots
  too) and uses each from a known state: a reload, then the presses that led
  there. Text fields get ordinary text, nothing and a very long name; number
  fields a negative, zero, a huge number, letters and nothing. Canvases get
  clicks, a drag, the wheel, and on the phone a pinch and a two-finger drag.
- What a press opens (a dialog, a sheet, a menu, the next step of a wizard) is
  crawled in turn, breadth first, to `--depth`.
- After every press: page errors, console errors, refused promises, failed
  requests; a blank page; a sideways scrollbar at phone width; a spinner or
  "Loading…" still there after 10 s; "undefined", "NaN", "null",
  "[object Object]" or an unfilled `{name}` in the text; an error message; and
  for each overlay it opened, whether Escape, its close control or a click
  outside closes it (and where the focus went).
- Then pairs: open something, switch view and come back; two changes in a row.

Controls that something else lies over (the flat Atlas's list under the 3D
house) are not pressed: no person can reach them either. They are listed under
"Not pressed".

## Results

- `results.md`: totals, the findings (stuck first, then errors, visible junk,
  polish) with the steps and a screenshot each, the demo gaps (messages the
  fake Home Assistant answered with nothing or refused: an error that comes
  only from those is the demo's, not the panel's), what was not pressed and
  why, and every control used with what happened.
- `results.json`: the same, and everything the page asked the fake.
- `shots/`: one picture per finding.

The same run gives the same order of pages and presses; the people in the demo
house keep walking, so live labels differ a little from run to run.
