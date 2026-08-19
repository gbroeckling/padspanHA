# 2025 Restyle — Rollout and Revert Plan

Branch: `restyle-2025`
Baseline: `v0.35.0` = `71d21ff` — `main` clean and level with `origin/main` at branch time.

The panel restyle (grouped icon nav, 56px collapsed rail, underline sub-tabs,
real light-theme tokens) touches shared CSS classes used by every view. This
document is the revert path, written **before** the first edit.

---

## Three layers, cheapest first

### 1. Setting — `ui_skin` (the one that matters)

The restyle ships as a **selectable skin**. Revert is a control in
Settings → Appearance. No redeploy, no HA restart, per-install.

**Default changed 2026-08-18 (Garry's call): `2025` is now the default.**
Because settings load as `{**DEFAULT_SETTINGS, **saved}`, anyone who has already
chosen a skin keeps it; the new default only reaches installs that never touched
the setting. The revert path is unchanged and still costs one click — but note
it is now an *opt-out* rather than an opt-in, so a regression reaches users
before they ask for it. That is the trade being made deliberately.

- `styles.css` stays **byte-identical**. It is the `classic` skin.
- New file `styles-2025.css` carries the new tokens, nav, tabs and app bar.
- `panel.js` `connectedCallback` picks the stylesheet href from
  `settings.ui_skin`.
- `_renderNav` branches: `classic` runs the existing dot-and-label path
  untouched; `2025` runs the icon + group path.

Why this and not a straight replace: `DEFAULT_SETTINGS` is merged as
`{**DEFAULT_SETTINGS, **loaded}` (settings_store.py:191), so adding
`"ui_skin": "classic"` means **every existing install keeps the current look on
upgrade** and opts in deliberately. Nobody wakes up to a redesign.

Three places to add the key:
- `settings_store.py` → `DEFAULT_SETTINGS["ui_skin"] = "2025"`
- `ws_settings.py:75` → `vol.Optional("ui_skin"): str` in the schema
- `ws_settings.py:367` → add `"ui_skin"` to the passthrough allowlist

### 2. Release — pre-release channel

Per `scripts/release.py`, a build without `--stable` is a GitHub pre-release.
The restyle ships that way and stays there until Garry says otherwise. HACS
users on the stable channel are unaffected; testers opting into betas get it.

Revert = cut the next pre-release from `v0.35.0` and delete the bad tag. It does
**not** require touching anyone's install.

### 3. Git — the branch and the tag

```
git checkout main                       # abandon the branch entirely
git diff v0.35.0 --stat                 # prove what moved
git checkout v0.35.0 -- custom_components/padspan_ha/www/   # frontend only
```

The frontend is self-contained under `www/padspan-ha/`, so a frontend-only
restore is clean — no backend state is involved in any of items 1–15.

---

## The one item that is not safe to ship as written

**#14 — replace `filter: invert(1) hue-rotate(180deg)` with real light tokens.**

Measured blast radius on the current tree:

| | count |
|---|---|
| hardcoded 6-digit hex literals across the frontend | **4,516** |
| inline `style="…color…"` strings in views + panel.js | 222 |
| `training.js` alone | 841 hex |
| `maps.js` | 419 |
| `settings.js` | 270 |
| `overview.js` | 263 |

The invert filter is currently the *only* reason all of those work in light
mode. Delete it globally and every one of them stays dark on a light
background. That is an audit, not a 20-line change.

Under the skin flag this stops being dangerous: `classic` keeps the filter,
`2025` gets real tokens, and the 2025 skin is converted view by view. Light-theme
users — this is an accessibility setting, per the comment at
`settings_store.py:66` — are never stranded on a half-converted skin.

---

## Other hazards worth naming

- **`items[0][0]` (panel.js:1441).** `_renderNav` falls back to the first entry
  when the current view is not visible in this mode. If group headers are pushed
  into that same array, a header becomes a route. Render groups as a separate
  pass, never as array entries.
- **`ha-icon` is used nowhere in this codebase.** Inside a shadow root a missing
  registration gives 18 blank boxes. Use inline SVG — it also inherits
  `currentColor`, which is what makes the active tint work.
- **`.tab` is referenced by 13 view modules** (bluetooth, calibration, follow,
  forensics, history, lights_map, manage, maps, monitor, objects, overview,
  settings, traceback). Restyling the shared class changes all 13 at once.
- **Delete the correct dead CSS block.** `.tabs`/`.tab` are defined twice —
  styles.css:31–33 (pill, dead) and styles.css:129–132 (boxed, live). Removing
  the wrong one silently restyles every sub-tab bar.
- **Sidebar width is set in three places** — `.app` (styles.css:2, 300px), the
  `@media(max-width:1100px)` block (300px) and the `@media(max-width:900px)`
  block (320px). Change all three or the mobile drawer desyncs from the rail.
- **View titles live inside the views.** Hoisting them into a shared app bar
  means editing ~20 view modules. Ship the shell half (status chips, segmented
  toggles) first and leave titles alone.
- **`MENU_COLORS` is safe to retire** — only three references, all inside
  `_renderNav` (panel.js:1474, 1494, 1510). Nothing else consumes it.

---

## Verifying a revert actually took

Per `docs/06_UI_CACHE_BUSTING.md`: **never verify a frontend change with a
cache-busted import.** That proves the file is on disk, which was never in
doubt. Read the `?b=` stamp on `panel.js` and on a view in the Network tab and
confirm it moved, then check the stamp in Diagnostics against what you expect.

`ASSET_ID` hashes path, size and mtime across `www/`, so adding
`styles-2025.css` busts the stamp automatically — but a restore done with
`cp -p` or an mtime-preserving rsync will **not**. Use a plain copy.
