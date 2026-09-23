# WLED Advanced tab — research (2026-09-23)

> One claim below was wrong and is corrected inline (search CORRECTION): partial `/json/cfg` writes are NOT safe for every key.

Garry, 2026-09-23: "In the wled card that comes up in atlas, add an advanced tab that is absolute best in class gui for working on wled configuration. Really dig for the absolute best tool out there" — "should cover every facet of WLED operation and setup, as complete as the webpage, but more intuitive" — "and include teaming with other wled devices for proper light control in HA".

Four research agents (tools survey, WLED API surface, PadSpan card today, synthesis). Raw outputs, unedited.



---

## BRIEF

WLED ADVANCED TAB: DESIGN BRIEF (2026-09-23)

1. VERDICT

Best at each job:
- Live editing and segment layout: the WLED+ canvas (v1.13 streams real LED colours while you drag; "Layouts" groups presets by segment bounds) and WLED Max Segments Studio.
- Finding a segment on the hardware: LedFx. The segment being edited turns white, with a bar showing direction.
- Hardware settings: WLED 16's own LED page (memory gauge, power-supply estimate, driver limits, refuses unsafe saves: wled/WLED#5303, #4939) plus its Pin Info page (#5361).
- Safe config writes: uber-wled (dry-run, a diff before applying, snapshots).
- 2D wiring: the WLED settings_2D preview (first LED green, last LED red, serpentine path, panel numbers).
- Effect controls: WLED's /json/fxdata metadata. Effect previews: openlamp/wled-assets (free to reuse, CC0).
- Test patterns: the xLights Test dialog.

What no tool does well (where PadSpan can win):
1. Checking segments for overlaps and gaps. WLED closed this as not planned (#5017).
2. Warning that segments vanish on reboot, with a one-click fix (discourse t/6795).
3. A colour-order wizard (discourse t/12574).
4. An automatic backup before every config write, and a check after a restore that it worked (#3778, #5246), all inside HA.
5. All of the above working over HTTPS and remotely. wled_liveviewproxy only proxies a gradient preview.
6. Custom firmware. The fleet runs SoundReactive, board-specific and Gyver-class builds; every other tool assumes stock firmware.

PadSpan wins by putting 1-6 into the card users already open, not by trying to out-draw WLED+.

2. LAYOUT OF THE TAB

- A tab strip goes under the header (lights_map.js after :1266): Controls | Advanced. Controls keeps today's brightness, colour, effect and IP link.
- On Advanced, the fixed 300px box (:1253) switches to the _S.sheet style: a bottom sheet on phones, centred and up to 960px wide on larger screens.
- The code goes in a new module, views/wled_advanced.js, loaded only when the tab opens.

A. Layout (the default sub-tab)
- Live view: a 1D strip, or a 2D grid if info.leds.matrix is present. Frames come from WLED's /ws with {"lv":true}, relayed through the backend (binary 'L' frames; version 1 = strip, version 2 = matrix with w,h). Pattern: WLED+.
- Segment bars drawn over the live view:
  - Drag the ends to change start/stop (startY/stopY in 2D).
  - Tap to select, shift-tap to add to the selection (sel). Split at the cursor.
  - "Smart add" fills a gap or splits the largest segment (WLED+).
  - Writes POST json/state {seg:[{id,start,stop,n}]}. Always resend n, because v16 clears the segment name when its bounds change (json.cpp).
  - Show ranges inclusively, e.g. "LEDs 0-59 (60)". WLED's exclusive stop value reads as a bug to users (#1712). Deleting a segment sends stop:0.
- Segment inspector: n, grp, spc, of, rev, mi, rY, mY, tp, m12, si, on, bri, frz, cct, col[0..2], bm (16+) and lc capability badges.
- Whole-device settings: bs transition style (16+; 2D-only styles hidden on strips), transition, mainseg, rSeg.
- Warning bar:
  - segments overlap (not flagged when a blend mode, bm, is set on purpose)
  - LEDs not covered by any segment
  - a segment stops beyond info.leds.count
  - segment count against maxseg
- "Unsaved layout" chip: compares the live segment bounds with the boot preset (cfg def.ps, looked up in /presets.json). Its "Save as boot preset" button sends {psave:N,n,sb:true,ib:true,bootps:N} (0.15+).
- Identify (LedFx pattern): save the current json/state, set the segment to a white "Chase" (effect looked up by name, tt:0) and dim the others, then restore the saved state after 10 s.
- Undo/redo over saved state snapshots (from HyperHDR Layout Lab).

B. Effect
- Built from /json/eff + /json/fxdata: search, plus 1D/2D/volume/frequency/palette filters taken from each effect's flags. Reserved slots (RSVD) are hidden.
- Controls are generated from the metadata: sx, ix, c1-c3, o1-o3, colour-slot labels, palette on/off. fxdef:true resets to the effect's defaults. No code per effect.
- Previews from wled-assets load lazily and are matched by effect name, so a fork with shifted effect IDs never shows the wrong preview.
- Palette grid from /json/palx?page=N.

C. Presets & Playlists
- Reads /presets.json and caches it until info.fs.pmt changes.
- Search; sort by ID, name, effect or palette; filter by segment layout (WLED+).
- Save with psave (n, ql, ib, sb, sc); delete with pdel.
- Playlist editor: drag to reorder ps[]; dur[] and transition[] per entry; repeat, end, shuffle (r); at most 100 entries. "Test" plays the playlist without saving it.

D. Hardware (admin only)
- LED outputs from /json/cfg hw.led.ins: type, start, len, pin[], order (colour order in the low nibble, white swap in the high nibble), rev, skip, rgbwm, drv (16), and per-output maxpwr/ledma (0.15+).
- Limits: total LEDs against MAX_LEDS for the chip (info.arch), 2048 LEDs per output, a power-supply estimate, and the brightness limiter (hw.led.maxpwr).
- Pins: /json/pins on 16 shows owner, input-only and strapping pins. Older firmware gets a duplicate-pin check only.
- Colour-order wizard: light pure red, green, blue, then white; the user taps the colour they actually see; the answers give the colour order and white swap. Based on the xLights RGBW test and FastLED RGBCalibrate.
- Test patterns per output or segment: chase, alternate and single-LED walk, sent as i ranges. In v16, i ignores grouping, which is what a hardware test wants. The saved state is restored afterwards.
- 2D panels: a canvas like settings_2D, saved through POST /settings/2D. json/cfg can't rebuild the matrix (cfg.cpp).
- hw.com (colour-order overrides), Wi-Fi, access point and Ethernet are read-only, with a link to the device's own page. A bad Wi-Fi write leaves the unit unreachable.

E. Sync & Realtime
- Applied live: udpn send/recv/sgrp/rgrp and lor.
- Marked "reboot required": if.sync ports and if.live (E1.31, Art-Net, DDP, DMX).
- Shows the /json/nodes list.

F. Backup (admin only)
- Snapshot list, manual backup, restore with a diff.
- Raw JSON editor per config section, formatted and validated like the v16 file editor (#4956).

G. Info
- ver, vid, release, brand, arch, freeheap, fps, estimated vs max power, RSSI, uptime, WebSocket client count, filesystem use.
- state.error decoded into plain words, and a badge when the device runs a fork.

3. HOW THE CARD REACHES THE DEVICE

Decision: a proxy in the PadSpan backend, as HA websocket commands in a new ws_wled.py registered at websocket.py:268. The other two options fail:
- The browser can't call the device directly. Over HTTPS or Nabu Casa, http:// and ws:// requests are blocked as mixed content, and WLED has no secure WebSocket. Chrome's Local Network Access exemption doesn't cover WebSockets, and off the LAN the device can't be reached at all.
- HA's WLED integration doesn't expose segment bounds, fxdata, config or the presets file, and python-wled's internals change between releases. HA's own connection to the device still picks up our writes, so the Controls tab stays in sync.

Commands: wled_get {entity_id,path}, wled_state {entity_id,body}, wled_cfg {entity_id,patch,base_hash}, wled_form2d, wled_backup {list|create|restore}, and a wled_live subscription.

Rules:
- The backend finds the device address itself: entity, then device, then the "wled" config entry, then entry.data["host"]. A host sent by the browser is never accepted. The panel allows non-admin users (require_admin=False, ws_settings.py:848-866), so accepting one would let any user point the backend at arbitrary addresses (SSRF).
- Readable paths: json/{state,info,si,eff,fxdata,pal,palx,nodes,cfg,pins,net}, presets.json, cfg.json. /upload is used only by the restore command, from a stored snapshot.
- Always refused:
  - /win and the "win" key. Gyver-class forks jam on it.
  - /update, /updatebootloader, /reset and /edit. There is no firmware-update button (custom-firmware rule).
- Tier: Bright, checked in both frontend (tierAtLeast) and backend (_tier_at_least).
- Any Bright user can make live, unsaved changes (segments, effects, identify, tests). HA already lets them control the light.
- Admin only: psave, pdel, bootps, saving playlists, config writes, the 2D form, restore and reboot (rb).
- Request bodies stay under 10 KB, the limit on ESP8266. If the device has a settings PIN, the card asks for it and never stores it.
- Live view: one upstream WebSocket per device, opened by the first viewer and closed by the last, sent to viewers at 10 fps or less. An ESP8266 has only 3 WebSocket slots and drops the oldest, and HA already uses one. On those devices the card asks first; if the user declines, it shows a preview labelled "simulated".

4. SAFETY

- Every config write reads the current config, changes one section and writes it back:
  - Keys the card doesn't know are kept, so fork settings survive.
  - hw.led.ins is always sent in full.
  - hw.com is never sent through /json/cfg, because the device appends to it instead of replacing it.
- Order of a config write in the backend:
  1. Back up cfg.json and presets.json to <config>/padspan_ha/wled_backups/<mac>/ (the last 20 are kept).
  2. Re-read the device and refuse the write if the config changed since the user started editing (base_hash).
  3. POST the section.
  4. Re-read and show the before/after diff (uber-wled).
- Confirmation with a diff first: LED output type/pin/length, colour order, 2D panels, sync and realtime ports, deleting a preset, overwriting a playlist, restore, reboot.
- These need a reboot: sync ports and ESP-NOW, E1.31/Art-Net port, universe and multicast, MQTT, I2C/SPI pins, usermods, network, NTP, IR, Hue and Alexa. They get a "reboot required" badge and a "Reboot now" button (rb:true). The button warns that the boot settings (def.on, def.bri, def.ps) will take effect. state.error 100 and 101 get the same badge.
- Checks run in both the frontend and the backend: no duplicate pins, no input-only pins used as outputs, LED limits per chip, segments within the LED count, playlists of 100 entries or fewer.
- Restore only goes back to the same device (by MAC address). Different LED counts break segment bounds.
  - The "restore presets" and "restore config" buttons look clearly different (#3778).
  - Both upload through /upload; uploading cfg.json reboots the device.
  - The card re-reads the device afterwards to confirm the restore worked (#5246).

5. BUILD PLAN

P0 (S): plumbing.
- ws_wled.py with its address lookup, path allowlist, admin and tier checks.
- One shared controlApiFor(eid) returning {tier, deviceId, platform, isAdmin, ip}. It replaces the two host copies that have drifted before (lights_panel.js:319, maps.js:8677).
- ensureLightsRegistry also keeps an entity-to-device map.
- WLED is detected by its registry platform, not by the effect list.
- The tab strip.
- Pytest: win and update refused, host from the browser ignored, psave by a non-admin refused, free tier refused, unknown path refused.

P1 MVP (M): Layout (without identify and undo), Effect, Info.
- Node tests with dom_shim: fxdata parsing checked against sample strings from v0.14.4, 0.15.4 and 16.0.1; segment maths (overlaps, gaps, inclusive display, name resent); decoding live frames, versions 1 and 2.
- Pytest for the live-view connection opening and closing.
- Deploy, then click through it with the ?b= stamp (HARD_WON_RULES 1-3) on one stock v16 unit and one fork.

P2 (M): presets and playlists, backup and restore, identify, undo.
- Tests: the backup is taken before the write, and a write is refused if the config changed in the meantime.

P3 (L): hardware, colour wizard, test patterns, 2D panels, sync, raw config editor.
- Tests: the limit checks for each chip type, and the 2D form field names (from set.cpp).

P4 (L): palette editor (/paletteN.json), LED map and gap editor, and segments drawn along the light's Atlas position in metres, never tied to the map image.

6. OPEN QUESTIONS

1. Do you want to configure any WLED units that aren't in HA's WLED integration? The proxy only finds devices through that integration.
2. Should non-admin users be able to make live, unsaved segment and effect changes, or should the whole Advanced tab be admin-only?
3. Should Advanced sit in Bright, like the rest of WLED in Atlas, or in Pro?

Working draft: C:\Users\Garry\AppData\Local\Temp\claude\C--Users-Garry\358fe285-8250-4736-b223-dd684814fd43\scratchpad\wled_brief.txt

---

## TOOLS

RESEARCH NOTES: best-in-class WLED configuration GUI (surveyed 2026-09-23)

ACCESS NOTE: I couldn't reach Reddit (r/WLED) through any route. WebSearch with allowed_domains=reddit.com returned "400 ... not accessible to our user agent". WebFetch refused www.reddit.com and old.reddit.com. SearXNG returned zero results for every query, including a bare "WLED". User pain points below therefore come from wled.discourse.group, GitHub issues and app-store reviews instead.

=== PART 1: TOOL SURVEY ===

1. WLED NATIVE WEB UI (current release v16.0.0, released 3 May 2026; numbering jumped from 0.15 to 16. Sources: https://github.com/wled/WLED/releases and https://learn.adafruit.com/wled-16-what-is-new/overview)

Best at:
- Layout: bottom tab bar on phones. A "PC Mode" button shows tabs side by side on wide screens. Top bar: Power, Timer, Sync, Peek, Info, Nodes, Config, master brightness. https://kno.wled.ge/basics/web-ui/
- Effect list: searchable, with capability icons and a filter dropdown (palette, 0D/1D/2D, volume ♪, frequency ♫). Controls change per effect, driven by /json/fxdata. The metadata format is "<Effect parameters>;<Colors>;<Palette>;<Flags>;<Defaults>". Up to 5 sliders (sx, ix, c1, c2, c3) and 3 checkboxes (o1–o3). https://kno.wled.ge/interfaces/json-api/ and https://github.com/wled/WLED/blob/main/wled00/data/index.js
- Segments tab, per segment:
  - name
  - Start/Stop, or a count toggle; 2D adds Start Y/Stop Y (or Height)
  - grouping, spacing, offset
  - reverse and mirror per axis, plus transpose
  - "Expand 1D FX": Pixels, Bar, Arc, Corner, Pinwheel
  - Sound sim
  - Blend mode (17 options, bm 0–16): Top/Default, Bottom/None, Add, Subtract, Difference, Average, Multiply, Divide, Lighten, Darken, Screen, Overlay, Hard Light, Soft Light, Dodge, Burn, Stencil
  - freeze, colour-coded group sets, per-segment power and brightness
  - Edits apply to every checked segment. There is also "Reset segments".
  Source: https://github.com/wled/WLED/blob/main/wled00/data/index.js
- Transition styles (the bs key, new in v16): Fade, Fairy Dust, Swipe right/left, Push right/left, Outside-in, Inside-out. 2D-only: Swipe up/down, Open H/V, Push up/down, Swipe TL/TR/BR/BL, Circular Out/In. https://github.com/wled/WLED/blob/main/wled00/data/index.htm and https://github.com/wled/WLED/pull/4658 (segment layering, "3x speed")
- Preset save dialog: "Include brightness", "Save segment bounds", "Checked segments only", Ledmap select, "Apply at boot", raw "API command" textarea, Quick load label.
- Playlist editor: Shuffle, Manual advance, Repeat indefinitely or n times, End preset (None, Restore, or a preset), duration per entry (0=inf.), transition per entry, and a "Test" button. Source: index.js above.
- Peek / liveview: /liveview is a 1D canvas; /liveview2D shows the matrix in a bottom sheet. Both use the WebSocket message {"lv":true}. Binary frame: byte 0 'L', byte 1 version (1=strip, 2=matrix with w,h). Long strips are downsampled. https://kno.wled.ge/interfaces/websocket/ ; nightly adds "Display gaps in peek": https://github.com/wled/WLED/releases/tag/nightly
- LED Preferences page:
  - LED memory usage gauge, "Recommended power supply for brightest white", auto brightness limiter (ABL) with per-output option
  - pin conflict and input-only-pin alerts
  - "Show Advanced Settings" toggle, colour order override, custom bus start indices
  - buttons, IR and relay
  Source: https://github.com/wled/WLED/blob/main/wled00/data/settings_leds.htm
- Per-bus RMT/I2S driver select: enforces platform channel limits, highlights invalid choices in red, and estimates DMA memory. https://github.com/wled/WLED/pull/5303
- Refuses to save unsafe configs, with a "big red warning" when memory is exceeded more than 2x. https://github.com/wled/WLED/pull/4939
- 2D settings page: a "Populate" generator plus a canvas preview. It draws a green first LED, a red last LED, the wiring path through serpentine rows, panel outlines and panel numbers, and accepts a gaps file. https://github.com/wled/WLED/blob/main/wled00/data/settings_2D.htm
- Pin Info page (v16): every GPIO with its owner and capabilities (touch, input-only, analog, bootstrap), live green/grey state dots, raw touch/analog readings. New /json/pins endpoint. https://github.com/wled/WLED/pull/5361
- File editor (v16): JSON shown pretty and saved minified, live validation (red border), ledmap shown as aligned 2D columns, optional ACE highlighting, image preview, upload/download/delete. https://github.com/wled/WLED/pull/4956
- Palette editor (v16): iro.js picker, draggable gradient stops, live LED preview, harmonic (triadic/tetradic) generator, 800+ cpt-city palettes to download, editor stays pinned while browsing, larger touch handles. https://github.com/wled/WLED/pull/5010
- PixelForge (v16): image/GIF crop, pan and zoom; per-frame GIF handling; scrolling text with tokens; pixel painting; "dark pixel cutoff"; output auto-sized to the segment. https://github.com/wled/WLED/pull/4982 ; font editor #5372 (release notes)
- CORS is open: the server sets Access-Control-Allow-Origin: * (wled_server.cpp line 352), https://github.com/wled/WLED/blob/main/wled00/wled_server.cpp

User complaints:
- Segments are lost on reboot unless saved in a preset. "nothing in the UI even hints at this"; "an absolute nightmare" with 13 devices. https://wled.discourse.group/t/consider-changing-segments-to-persist/6795
- Boot preset was buried in LED Preferences (fixed in 0.15). https://github.com/wled/WLED/issues/3806
- Presets: two numbering systems, random Quick Load order, no grouping. https://github.com/wled/WLED/issues/5841 and https://wled.discourse.group/t/preset-organization/14774
- No warning when two segments hit the same LEDs; the symptom looked like a power fault. Closed as not planned. https://github.com/wled/WLED/issues/5017
- Backup/restore: the presets and config upload buttons look alike, so it's easy to wipe config. https://github.com/wled/WLED/issues/3778 ; a restore reported success but factory-reset the device. https://github.com/wled/WLED/issues/5246
- Colour order/swap "illogical"; no per-section colour order. https://wled.discourse.group/t/led-settings-color-order-swap-illogical/12574 and https://wled.discourse.group/t/changing-color-order-per-section/9413
- Stop LED is exclusive, which reads as an off-by-one bug. https://github.com/wled/WLED/issues/1712
- No playlist per segment and no segment selection inside playlists (wontfix). https://github.com/wled/WLED/issues/3472 and https://wled.discourse.group/t/segments-presets-playlists-oh-my/4837
- No continuous effect across segments or controllers ("use-as-is"). https://github.com/wled/WLED/issues/5028
- A wrong 2D corner or serpentine setting "rotated, mirrored, or scrambled" the grid. https://pipplee.com/wled-2d-matrix-setup/
- HUB75 colour order is hidden. https://github.com/wled/WLED/issues/5723

2. WLED NATIVE APPS (official, by Moustachauve)
- Android: mDNS discovery, one list of all devices, rename, hide/delete, tablet layouts, opens the control UI directly on WLED-AP. https://github.com/Moustachauve/WLED-Android
- iOS: https://github.com/Moustachauve/WLED-iOS ; v7.1 adds OTA for WLED 0.16+ and a "Software Update Assistant". https://apps.apple.com/us/app/wled-native/id6446207239
- Complaints: easy to swipe sideways by accident and delete a light; scheduling doesn't work; freezes; presets broke after an update. https://apps.apple.com/us/app/wled-official-app/id6446207239?see-all=reviews&platform=iphone

3. WLED+ (Pixel Heart; iOS, iPadOS, macOS, visionOS, Android; free)
Best-in-class for segment layout plus library management:
- Canvas layout editor: tap to select, drag to reshape a strip or matrix, pinch-to-zoom, real LED colours streamed onto the canvas while you edit (v1.13.0).
- "Layouts": the unique segment configurations found across saved presets. You can switch layouts when making a preset and filter presets by layout.
- Smart add-segment fills gaps or splits the largest segment.
- Sort presets by recency, effect or palette; add to a playlist while creating a preset; quick-load toolbar; randomizer; device groups; animated effect previews; fallback to the original web UI.
- Rating 4.6 (13 ratings).
Sources: https://github.com/pixel-heart/wledplus-releases , https://apps.apple.com/us/app/wled/id6474789652 , https://wledplus.com/

4. WLED MAX (MeowScript; iOS and Android; free for 2 devices, one-time unlock for unlimited)
- "Segments Studio": drag to build, split and resize segments for 1D and 2D, with a "live mirror" of the real pixels.
- Live in-app preview of every effect, with speed, intensity, palette and custom sliders updating in real time.
- "Every setting from the WLED web UI rendered natively": Wi-Fi, LED pins, sync, time, schedules, security.
- Setup wizard, rooms (a device can be in several groups), community presets (iOS), OTA with changelog, widgets and Siri, backup.
Sources: https://meowscript.com/apps/wled-max/ and https://apps.apple.com/es/app/wled-max/id6758780253

5. OTHER APPS
- ESPHome-WLED Device Manager (iOS): live WebSocket preview for 1D/2D, palette editor, PixelForge tools, Watch app with Digital Crown brightness. https://apps.apple.com/us/app/esphome-wled-device-manager/id6754686752
- Pipplee (matrix-focused, paid per device): 1000+ animations, real-time pixel painting, scrolling text, playlists with timing, schedules, games. https://pipplee.com/
- WLED Pro (subscription): sunrise/sunset schedules, widgets, OTA. https://apps.apple.com/ml/app/wled-pro/id6466218761
- WLEDControl: macOS menu-bar app. https://apps.apple.com/us/app/wledcontrol/id6759883611
- Flutter WLED-App (cross-platform clone of the old app): https://github.com/casvanluijtelaar/WLED-App

6. DESKTOP, WEB AND COMMUNITY TOOLS
- WLED-GUI (Electron, looks like the old mobile app, autostart; 282 stars): https://github.com/w00000dy/WLED-GUI ; topic list https://github.com/topics/wled-gui
- uber-wled (best for safe config and fleet management):
  - floorplan layout, rooms, themes with live animated previews
  - schedules with sunrise/sunset offsets; sync groups using native UDP
  - structured editing of Identity, LED hardware, Wi-Fi, GPIO and NTP, with server-side dry-run validation and a diff to confirm before applying
  - fleet OTA with firmware-asset pinning and "Update All"; daily snapshots kept 14 days
  https://github.com/bwilliam79/uber-wled
- WLEDashboard: Three.js 3D view with glowing strip meshes, "Effect Studio & Timeline Animator" (multi-track keyframes), nested groups, selective restore by category. https://github.com/upioneer/WLEDashboard
- wled-preset-groups: one HTML file uploaded to the device. User groups, last 8 recents, search, playlist badge, live WebSocket preview, optional /pgroups.json on device. https://github.com/j0nz/wled-preset-groups
- WLED Preset Editor (offline presets.json): edits every API field, bulk multi-select with shift-range. https://spongeball.github.io/WLED-utils/
- wled-matrix-tool: paint with a live mirror on the matrix, brush sizes, right-click erase, gradients, image import with auto-resize, save as a GIF for the Image effect, reads matrix size from the device, network Discover. https://github.com/kudp02/wled-matrix-tool
- Ledmap generators:
  - Intrinsically-Sublime: enable/discard/hide states, serpentine/vertical/flip, Freestyle click-in-wire-order. https://intrinsically-sublime.github.io/WLED-Ledmap.json-Generator/
  - dosipod: https://dosipod.github.io/WLED-Ledmap-Generator/
  - Pipplee: https://pipplee.com/tools/wled-ledmap-generator/
  - cstenkamp: drag-to-paint the wiring path, rescale without losing the path, invert. https://cstenkamp.de/tech_posts/wled_ledmap_generator/
- Camera mappers:
  - Vitminee: lights one LED at a time, camera scatter plot, wire-order overlay, exports ledmap.json plus 2d-gaps.json. https://github.com/Vitminee/wled-mapper
  - savdb: ArtNet blink plus OpenCV. https://github.com/savdb/led_camera_map
- Jason Coon LED Mapper (click LEDs on a photo in wire order, pattern previews): https://jasoncoon.github.io/led-mapper/
- wled-sim (Go/Fyne fake WLED with JSON API and DDP, useful for testing a GUI): https://github.com/13rac1/wled-sim
- WLED-Utils GIF visualizer of effects: https://github.com/scottrbailey/WLED-Utils
- Backups: https://github.com/KrX3D/WLED-Backup (Docker, mDNS, all devices), https://github.com/thibmaek/wled-backup
- Installers:
  - https://github.com/wled/WLED-WebInstaller (install.wled.me; variant and flash-size picker, Improv Wi-Fi setup after flashing)
  - QuinLED preconfigured board builds: https://install.quinled.info/ and https://github.com/intermittech/quinled-web-installer
  - online compiler with usermod picker: https://wled-compile.github.io/
- VieWLED (Vue rewrite, experimental, never tested on-device): https://github.com/ShiftLimits/viewled ; the JS client library is https://github.com/ShiftLimits/wled-client

7. HOME ASSISTANT
- Integration entities: master light plus one light per segment (when 2 or more segments), selects (Live override, Playlist, Preset, Palette per segment), numbers (Intensity, Speed per segment), switches (Nightlight, Sync send/receive, Reverse, Freeze), sensors (current, LEDs, RSSI, etc.), restart button, firmware update.
- Integration limits: ignores segment names, primary colour only, no all-segments master, no usermods; nothing for segment bounds, blend mode, 2D, custom sliders, ledmap or LED hardware. https://www.home-assistant.io/integrations/wled/
- Preset dropdown showed only 5 entries: https://github.com/home-assistant/core/issues/98283 ; request for Peek plus sliders on the card, closed without work: https://github.com/home-assistant/frontend/issues/5775
- wled_liveviewproxy: HACS; proxies liveview through HA over WebSocket, gradient rendering only, no 2D. https://github.com/danishru/wled_liveviewproxy and https://community.home-assistant.io/t/wled-live-view-proxy-for-home-assistant/869518
- WLED Assets Card: tap an illustrated palette or effect to apply it; localized. https://github.com/openlamp/openlamp-card-wled-assets
- wled-assets (CC0): 72 palette SVG stencils (filled with the device's own palette colours), 216 animated 144px effect GIFs, 234 per-effect slider labels, 8 languages. https://github.com/openlamp/wled-assets

8. LEDFX (best "identify on hardware" pattern)
- Segment editor with draggable range blobs. The segment being edited washes white on the physical LEDs, with a dark bar showing effect direction; other segments cycle R/G/B. Flip button, up/down reorder, trash. https://docs.ledfx.app/en/latest/howto/virtuals.html
- Creates virtuals from WLED segments automatically; DDP by default. https://docs.ledfx.app/en/latest/configuring.html
- Complex Segments mode renders up to 13x faster with many segments. https://docs.ledfx.app/en/v2.1.5/howto/complex_segments.html

9. XLIGHTS / FPP
- xLights: add an Ethernet controller as WLED with DDP. "Visualise" lets you drag models onto physical ports; "Upload Output" pushes that setup to the controller. https://learn.adafruit.com/lighting-led-nets-with-wled-and-xlights/xlights-setup and https://learn.adafruit.com/xlights-for-sparkle-motion-board/xlights-setup-and-mapping
- xLights Test dialog: Chase, Alternate, Background; RGB cycles A-B-C, A-B-C-All, R-G-B-W; node-level tests; saved test sets. https://manual.xlights.org/xlights/chapters/chapter-five-menus/tools/test
- FPP runs WLED effects on overlay models, with a model preview; running effects appear on the Effects page and can be stopped there. https://github.com/FalconChristmas/fpp/releases/tag/10.1

10. HYPERION.NG / HYPERHDR
- Hyperion: finds WLED by mDNS, streams to a chosen segment, saves and restores device state around streaming. https://docs.hyperion-project.org/user/leddevices/network/wled.html
- Hyperion LED layout uses normalized 0–1 coordinates with "Update Preview". https://docs.hyperion-project.org/user/advanced/Advanced.html
- HyperHDR LED Layout Lab: strips as objects you drag, resize and flip; snapping to edges, centre and neighbours; undo/redo; import/export that keeps unknown properties. https://github.com/ward-sentry/HyperHDR-LED-Layout-Lab

11. MOONMODULES (MoonLight, projectMM, WLED-MM)
- MoonLight/projectMM: live 3D preview of every effect, modifier and layout in the same tab. Controls are rendered from each module's declared controls ("zero UI code").
- Layout nodes (Panel, Panels, Cube, Rings, Wheel, Human Sized Cube, rows/columns), each with its own pins, merged into one shared grid.
- projectMM changes pin map, strand length or protocol "without reboot", has a filesystem browser with drag-drop, and acts as a WLED device.
Sources: https://moonmodules.org/MoonLight/moonlight/overview/ , https://moonmodules.org/MoonLight/moonlight/layouts/ , https://github.com/MoonModules/projectMM
- WLED-MM: pins page, FPS in Info, "apply effect defaults from metadata". https://github.com/MoonModules/WLED-MM/blob/mdev/CHANGELOG.md

12. MAPPING BENCHMARKS
- Pixelblaze mapper: JSON array or a JavaScript generator, applied live. It runs an animated pattern through the 2D/3D preview and normalizes coordinates to 0–1 with fill/contain. https://github.com/simap/pixelblaze/blob/master/README.mapper.md and https://electromage.com/docs/intro-to-mapping/
- Pixelblaze builds controls from exported slider/colour functions. https://www.crowdsupply.com/hencke-technologies/pixelblaze-v3/updates/manufacturing-ui-controls-pov
- MADRIX patch editor: marquee select, Ctrl-drag to copy, lock fixtures. https://help.madrix.com/m5/html/madrix/hidd_preferences_patch.html
- SignalRGB layout canvas (effects flow across devices placed where they physically sit; WLED over realtime UDP): https://docs.signalrgb.com/guides/device-configuration/about-layouts/ and https://wled.discourse.group/t/signalrgb-now-natively-supports-wled-devices/8427

13. CONSUMER UX BENCHMARKS
- Nanoleaf:
  - panels find their positions themselves and appear that way in the app; AR Layout Assistant. https://nanoleaf.me/en-US/products/nanoleaf-canvas/get-started/designing-your-layout/
  - Paint scenes: pick a palette colour, tap panels to paint. Scene types are Paint, Dynamic, AI Magic Scene and Playlist. https://support.nanoleaf.me/hc/en-us/articles/36067889374356-In-the-App-Feature-Create-Edit-Delete-or-Upload-Scenes
- Hue gradient:
  - segment colour points sit on the colour picker; tap the group icon to pull out single segments. https://hueblog.com/2021/09/04/this-is-how-the-gradient-function-will-work-in-the-hue-app/
  - "Segmented" mode gives up to 5 unblended colours. https://hueblog.com/2026/01/03/segmented-new-mode-for-philips-hue-gradient-products/
  - Main complaint: you can't tell which dot is which physical end. https://hueblog.com/2021/10/25/how-can-philips-hue-make-it-easier-to-select-gradient-segments/
- LIFX: pick a palette colour and paint over the strip drawn at the top of the screen; single-light screen only. https://support.lifx.com/hc/en-us/articles/14509024309783-Control-How-to-Paint-LIFX-Polychrome-Products
- Twinkly:
  - camera mapping in 2D and 3D; LEDs go red, orange, yellow, green as they get mapped; points can be adjusted by hand. https://www.fantasylights.com/twinkly-mapping/
  - drawing mode with wide, thin or sparkle lines and an eraser. https://twinkly.com/blogs/magazine/5-exclusive-twinkly-light-features-you-didn-t-know-existed
- Govee: select segments, then pick a colour; segment length is configurable. https://community.govee.com/support/faqs/article/1-86-does-my-light-strip-supports-segment-colors and https://forum.aqara.com/t/govee-rgbic-led-strip-lights-segment-control-and-customization-tips/209857

14. VENDORS AND ESPHOME
- QuinLED: preconfigured WLED builds per board. https://quinled.info/2021/03/21/wled-0-12-what-do-i-configure-for-quinled/
- Athom: ships WLED pre-flashed. https://www.athom.tech/wled
- Gledopto: remote pairing guide. https://www.gledopto.eu/mediafiles/anleitungen/wled-controller.pdf
- None of the three has its own config GUI.
- ESPHome: web_server v3 uses HA styling with sorting and groups. https://esphome.io/components/web_server/ ; segments are defined in YAML light partitions (from/to/reversed) with no visual editor. https://esphome.io/components/light/partition/

=== PART 2: RANKED CAPABILITIES FOR A BEST-IN-CLASS WLED CONFIG GUI ===

1. The live LED view is the editing surface. Stream the real LEDs (1D strip and 2D matrix with gaps) and draw segment bounds on top. Best today: WLED+ canvas (v1.13) and WLED Max "live mirror". Data comes from WebSocket {"lv":true}, version 2 frames. https://apps.apple.com/us/app/wled/id6474789652 , https://meowscript.com/apps/wled-max/ , https://kno.wled.ge/interfaces/websocket/
2. Direct segment editing: drag to create, split and resize; tap and multi-select; smart add that fills gaps or splits the largest segment. Best: WLED Max Segments Studio, WLED+. (same URLs)
3. Identify on the hardware: the selected segment or output flashes on the real LEDs with a direction marker. Best: LedFx. https://docs.ledfx.app/en/latest/howto/virtuals.html
4. Make the segment-persistence trap visible: show an "unsaved layout" state and offer one-click "save layout as boot preset". WLED+ "Layouts" is the best model. Pain: https://wled.discourse.group/t/consider-changing-segments-to-persist/6795 ; https://github.com/wled/WLED/issues/3806
5. Effect browser with animated previews, search, 1D/2D/audio/palette filters, and per-effect controls built from fxdata. Best: WLED Max live previews plus WLED's native filters; the preview assets could come from wled-assets (CC0). https://github.com/openlamp/wled-assets
6. Palette editor: drag gradient stops, live preview on the LEDs, cpt-city library, harmonic generator. Best: WLED 16. https://github.com/wled/WLED/pull/5010
7. Layer, blend and transition authoring: expose bm 0–16 per segment and the bs transition styles, with a visual stack order. Only WLED 16 exposes these, as plain dropdowns; no tool shows the stack visually. https://github.com/wled/WLED/pull/4658
8. Overlap and conflict checking: warn when segments hit the same LEDs, unless a blend mode is set on purpose. No tool does this; WLED declined it. https://github.com/wled/WLED/issues/5017
9. 2D panel wizard: draw the wiring (first LED, last LED, serpentine path, panel numbers), then run a wipe test. Best: WLED settings_2D canvas. https://github.com/wled/WLED/blob/main/wled00/data/settings_2D.htm ; test advice: https://pipplee.com/wled-2d-matrix-setup/
10. Ledmap and gap editor: grid with enabled/discarded/hidden cells, drag-to-paint wiring path, rescale, invert, camera import. Best: Intrinsically-Sublime, cstenkamp, Vitminee camera mapper; Twinkly for the progress-colouring UX. URLs in Part 1, section 6.
11. LED hardware editor with live budgets: memory gauge, PSU/current estimate, pin capability and conflict awareness, driver limits, refusal of unsafe saves. Best: WLED 16 LED settings plus Pin Info. https://github.com/wled/WLED/pull/5361 , https://github.com/wled/WLED/pull/5303 , https://github.com/wled/WLED/pull/4939
12. Colour-order wizard: light R, G, B and W in turn, ask what the user sees, then set the order and swap. No WLED tool does this. Building blocks: xLights R-G-B-W test and FastLED RGBCalibrate. https://manual.xlights.org/xlights/chapters/chapter-five-menus/tools/test , https://github.com/FastLED/FastLED/wiki/Rgb-calibration ; pain: https://wled.discourse.group/t/led-settings-color-order-swap-illogical/12574
13. Test patterns per output, segment or node: chase, alternate, single-node. Best: xLights Test dialog. (URL above)
14. Preset library: search; sort by name, ID, recent, effect or palette; groups or folders; filter by layout; bulk edit. Best: WLED+ for sort and layout filters, wled-preset-groups for groups and recents, the spongeball editor for bulk edits. Pain: https://github.com/wled/WLED/issues/5841
15. Playlist editor: drag to reorder, duration and transition per entry, shuffle/repeat/end preset, test run, add-to-playlist while saving a preset, timeline view. Best: WLED native fields, WLED+ add-while-creating, WLEDashboard timeline. https://github.com/upioneer/WLEDashboard
16. Safe config writes: forms over /json/cfg with dry-run validation, a diff before apply, and an automatic snapshot for rollback. Best: uber-wled. https://github.com/bwilliam79/uber-wled ; pain: https://github.com/wled/WLED/issues/3778 and https://github.com/wled/WLED/issues/5246
17. Raw file and JSON editor with validation and ledmap formatting. Best: WLED 16 file editor. https://github.com/wled/WLED/pull/4956
18. Image, GIF, pixel art and scrolling text for matrices. Best: WLED PixelForge; kudp02 for live painting. https://github.com/wled/WLED/pull/4982 , https://github.com/kudp02/wled-matrix-tool
19. Placement in the room (floorplan or 3D), with effects flowing across devices. Best: SignalRGB layout canvas, MoonLight 3D preview, uber-wled floorplan, WLEDashboard 3D. Atlas already has this surface, so the card can reuse it. URLs above.
20. Controls generated from metadata, with no hard-coded UI per effect. Best: WLED fxdata, projectMM declarative controls, Pixelblaze exported functions. URLs above.
21. Multi-device work: discovery, rooms, UDP sync groups, fleet OTA with asset pinning and changelog. Best: uber-wled; WLED Native for OTA on 0.16+; WLED Max for OTA with changelog. URLs above.
22. Undo/redo for layout edits. Best: HyperHDR LED Layout Lab. https://github.com/ward-sentry/HyperHDR-LED-Layout-Lab
23. Remote and HTTPS-safe live view: proxy the WebSocket through HA, because WLED has no TLS. Best: wled_liveviewproxy. https://github.com/danishru/wled_liveviewproxy

=== PART 3: API FACTS THAT CONSTRAIN THE ATLAS ADVANCED TAB ===

- HTTPS problem. WLED has no wss://, so a page served over HTTPS cannot open ws://<wled>/ws. https://kno.wled.ge/interfaces/websocket/ If HA is reached over HTTPS, the live view and commands must be proxied through the HA backend.
- CORS is * on WLED, so plain-HTTP origins can call the device directly (wled_server.cpp, URL above).
- WebSocket limits: 8 clients on ESP32 and 3 on ESP8266, and the oldest is dropped. One frame is at most 1428 bytes (528 on ESP8266). https://kno.wled.ge/interfaces/websocket/
- Endpoints (https://kno.wled.ge/interfaces/json-api/):
  - /json/fxdata: dynamic effect controls
  - /json/palx?page=: palette previews, paginated
  - /json/cfg: POST accepts partial config
  - /json/pins: v16 pin info
  - /json/live: only in WLED_ENABLE_JSONLIVE builds
- JSON keys:
  - preset save: psave, sb, ib
  - playlist: ps, dur, transition, repeat, end
  - ledmap: 0–9 selects ledmap.json or ledmap1–9.json
  - segment 2D: startY, stopY, rY, mY, tp, m12
  - blend mode: bm; transition style: bs

---

## CODE

WLED control card in PadSpan HA (Atlas): how it works now, and where an Advanced tab would go. Read-only; nothing was edited. Paths are relative to C:\Users\Garry\padspanha; FE = custom_components\padspan_ha\www\padspan-ha.

Summary: there is no WLED-specific card and no tabs. Every light uses one shared control card, `openControlCard`. Its WLED part is an Effect dropdown plus an IP link, shown only when the entity reports an effect list. Everything goes through `hass.callService("light", ...)`. There is no backend WLED code and no proxy to the device. The only direct device access is an `<a href="http://ip">` that opens the unit's own web UI in a new tab.

1. How the card is opened

- **The card itself.** `openControlCard(hass, eid, api)` is at FE\views\lights_map.js:1231-1434. The comment block above it is at 1208-1216. It is shared by both hosts.
- **Atlas sidebar panel** (sidebar title "Atlas", module lights_panel.js, registered at custom_components\padspan_ha\panel.py:128-136 with `require_admin=False`):
  - `_openWledDetail(eid)` at FE\lights_panel.js:319-326 passes `{toast, rerender, onEdit (admin only), ip: this._regStore?.reg?.ipMap?.[eid]}`.
  - Reached from `_useApi().openControls` (lights_panel.js:344).
  - Reached from `onRowLongPress` and `onRowMore` (the "⋯" button) at lights_panel.js:626 and :628, both gated by `hasControlCard(l)`.
- **Mapping → Lights builder.** Only in "▶ Preview as sidebar" mode (maps.js:8552, 8759). There `previewApi.openControls` calls `openControlCard` with `{toast, rerender, ip: ctx.state._lightsRegStore?.reg?.ipMap?.[eid]}` (FE\views\maps.js:8674-8690). It has no `onEdit`. The builder's inspector only shows a "WLED" chip (maps.js:9707).
- **Gestures on the map.** `wireUseSurface` (lights_map.js:796-889) handles them. A 500ms hold resolves to "open", then `api.openControls(eid)` if `controlsFor(l)`, otherwise toggle (lights_map.js:804, 862). A quick tap toggles. The code chip has no handler of its own; taps on it bubble to the marker (lights_map.js:881-886).
- **Aggregate room/floor sheet.** Its "⋯" also opens the card (lights_map.js:1009-1012).
- **Who gets a card.** `hasControlCard(l) = l.dimmable || deviceClassOf(l).controlCard` (FE\views\light_codes.js:396). The class table sets `controlCard: true` for wled, partition, fan and lock (light_codes.js:363-374).
- **What counts as WLED.**
  - `isWledLight`: a type override wins, otherwise a non-empty `effect_list` (light_codes.js:27-30).
  - `gatherLights` passes `effect_list` and `platform` only when the tier is paid (lights_map.js:2090-2096).

2. Current layout and controls (a single fixed 300px box, no tabs)

- **Overlay.** Fixed full-screen blur overlay mounted on `document.body`; clicking the backdrop closes it (lights_map.js:1244-1249).
- **Box.** `width:300px; max-width:90vw`, dark green gradient (lights_map.js:1251-1255).
- **Header.** Friendly name, an admin-only ✎ pencil that deep-links to Mapping → Lights, and ✕ (lights_map.js:1257-1266).
- **On/off button.** Turn On/Off, or Lock/Unlock for `lock.*`. Uses optimistic state and restores `lastBrightness`, then closes the card (lights_map.js:1268-1298).
- **Fan branch.** Speed, preset, oscillate, direction, then an early return (lights_map.js:1300-1348).
- **Brightness slider.** Shown if any of three capability signals holds, because WLED's `supported_color_modes` flips between `['rgb']` and `['onoff']`. Calls `light.turn_on` with `brightness` (lights_map.js:1350-1380).
- **Colour.** A native `<input type=color>` calling `light.turn_on` with `rgb_color` (lights_map.js:1382-1398).
- **Effect `<select>`.** Calls `light.turn_on` with `effect`. Failures are swallowed silently: no toast and no rerender (lights_map.js:1400-1413).
- **IP link.** "IP: <a href=http://ip target=_blank rel=noopener>" (lights_map.js:1414-1429).
  - It sits inside the `if (effectList.length)` block, so a light forced to WLED by override but with no effect list gets neither the effects nor the IP.
  - Any effect-capable light with a `configuration_url` gets the link.
- **Static snapshot.** The card does not re-render on state changes. It closes on on/off; other controls call `rerender` on the host map only.
- **What the card doesn't get.** It sees no `l` object, tier or class. It reads raw `hass.states[eid].attributes` (lights_map.js:1233-1239).

3. How it talks to WLED

- **Only through HA services:** `hass.callService("light", "turn_on" | "turn_off", ...)`. No direct HTTP to the device, no WLED JSON API, no `/win`.
- **No backend WLED code at all.** The only backend WLED references are:
  - `LIGHT_TYPE_OVERRIDE_KINDS` (custom_components\padspan_ha\const.py:136-143)
  - settings key `light_type_overrides` (settings_store.py:90)
  - its validation (ws_settings.py:684)
  - telemetry counting (telemetry.py:566)
- There is no `ws_*wled*` handler and no `HomeAssistantView`; api.py is a placeholder.
- **Existing outbound-HTTP patterns worth copying:**
  - `async_get_clientsession(hass)` in update_check.py:51-53, telemetry.py:842, ws_forensics.py:193-199
  - ESPresense Companion LAN fetch using a raw `aiohttp.ClientSession`, with error mapping, in ws_devices.py:177-216

4. How it gets the device IP/host

- `ensureLightsRegistry` (lights_map.js:1870-1983) makes one `config/device_registry/list` call.
- It maps device_id → `new URL(d.configuration_url).hostname` (lights_map.js:1905-1918).
- Then entity_id → host into `ipMap` (lights_map.js:1952), stored on `store.reg.ipMap` (lines 1958, 1978).
- There is no per-device network call.
- It keeps no entity_id → device_id map (only derived maps), so the card cannot currently find a WLED device's sibling HA entities.

5. Tier gating (free < bright < pro)

- `tierAtLeast` and `currentTier` live in FE\views\editions.js:94-107. That file mirrors licence.py:94 and never re-derives the tier.
- `LIGHTING_TIER = "bright"` and `lightingUnlocked` are at lights_map.js:41-42. `lightsHostForTier` is a read-time override (lights_map.js:51-70).
- WLED classing (`effect_list`, `platform`) is paid-only (lights_map.js:2090-2096). The type override is pro-only (lights_map.js:2049; lights_panel.js:645; maps.js:4134-4146).
- The card itself is **not** tier-gated. `dimmable` is ungated (lights_map.js:2110-2116), and the card reads effects from live attributes. So a free-tier dimmable WLED still opens the card with Effect and IP.
- Hosts get the tier from `padspan_ha/settings_get`: sidebar `this.state._tier` (lights_panel.js:196, 254); builder `ctx.state.settings?.tier`.
- Backend gate helper: `_tier_at_least(hass, want)` (ws_common.py:249-252). Example refusal: `send_error(..., "pro_required", _PRO_REQUIRED_MSG)` at the bright tier (ws_fabric.py:95-97).

6. Styling conventions

- Everything outside shadow roots is styled inline, because the shadow-root `lv-` classes from styles.css don't reach `document.body` (comments at lights_map.js:1213-1215, 913-915).
- `_S` style object for the room/floor bottom sheet (lights_map.js:916-939): overlay, sheet (`max-width:520px`, bottom sheet on phone, centred when `innerWidth > 768`), head, title, sub, act, actPrimary, actions, row, code, name, `onoff(on)`, `state(on)`.
- `openAggregateSheet` shows the mk/overlay/close pattern (lights_map.js:940-952).
- `_CAL_S` for the activity calendar (lights_map.js:1137).
- `_mkEl` DOM helper (lights_map.js:1217-1230).
- The same overlay/box recipe is copied in `_pickEntityOverlay` (1466-1478) and `openBarrierCard` (1574-1585).
- Palette:
  - background `#101f15→#0b1710`
  - border `rgba(120,190,155,.28)`
  - text `#e2e8f0`, labels `#94a3b8`, small caps label style at lines 1364 and 1675
  - amber on-state `#f59e0b/#fbbf24`
  - green primary `#166534→#22c55e`
  - WLED purple `WLED_BORDER = "#c084fc"` (light_codes.js:315)
  - z-index 10000
- There is no existing tab component. Preact and htm are vendored in FE\lib but only purelive.js uses them.

7. Tests covering the card

- **tests\test_wled_control_card_ip_link.py.** Runs the real `openControlCard` under node with tests\js\dom_shim.mjs. Asserts the anchor has `href=http://ip`, `target=_blank` and `rel=noopener`, and that no IP means no anchor.
- **tests\test_wled_popup_capability.py.** Lifts the `dimmable` and colour expressions straight from lights_map.js by regex. Changing the text of `const dimmable =` or the `modes.some(m => ["rgb"...` condition will break its extractor.
- **tests\test_lights_free_gate.py.**
  - :808-845: `ipMap` comes from `configuration_url`; a device without one reads null.
  - :218-228: WLED is withheld at free.
  - :349-365: overrides.
  - :1332-1350: WLED health check when effects are lost.
- **Other tests:**
  - tests\test_device_class_registry.py:95-148: W-series and the `controlCard` contract
  - tests\test_lights_row_longpress_ring.py: the row hold that opens the popup
  - tests\test_lights_ergonomics.py:819-890: `resolveBrand` "WLED"
  - tests\js\lights_panel_lifecycle.mjs: panel smoke test
  - No JS test covers the card's controls or tabs.

8. Project rules about WLED

- **In the repo:**
  - CHANGELOG.md:453-454: IP made a link (v0.38.27, commit 1c618510).
  - :576, :579, :610-611: fan card is "set up the same way WLED's is"; the pro override; partitions.
  - :1068: the free gate withholds the W-series from the drawing only and never writes stored data.
  - README.md:137, 210-212 and docs\padspan-bright-plan.md:45-46: WLED is part of the bright/pro Atlas toolset.
  - docs\09_HARD_WON_RULES.md #1-3 and #11: verify rendered via the `?b=` stamp; `node --check` is not enough; deploy and click. #12: shared views need a shared contract (relevant because two hosts build the api object separately, and they have drifted before, per light_codes.js:390-395).
  - docs\02_WEBSOCKET_API.md: "All panel actions should go through websocket commands."
  - ws_settings.py:848-866: the Phase 2i security note. The panel is `require_admin=False`, so any service-firing or outbound path must be allowlisted and validated server-side.
- **Not in the repo.** The "custom firmware / one-click updates" rule does not appear anywhere in the repo; the grep only hits "No custom firmware" marketing lines about BLE scanners. It lives in Garry's auto-memory:
  - C:\Users\Garry\.claude\projects\C--Users-Garry\memory\feedback_wled_custom_firmware.md: never trigger `update.install` on WLED firmware entities (SoundReactive/MoonModules forks, board-specific builds), so no firmware or OTA button.
  - project_480_wled_controller.md: use the JSON API (`POST /json/state`) only, never legacy `/win` (Gyver1-class forks wedge on it); never copy presets.json between devices (different LED counts break segment bounds).
  - project_wled_cleanup.md: a WLED reboot turns strips ON at boot; manual OTA quirks.

9. Where an Advanced tab plugs in

- **Frontend insertion point: `openControlCard`'s tail**, after the fan early return, lines 1350-1433.
  1. Put the existing brightness/colour/effect/IP nodes in a "Controls" pane.
  2. Add a tab strip under the header row (after line 1266) when the light is WLED-class.
  3. Widen the box while Advanced is active: the 300px width at line 1253 won't hold a segment editor. Reuse `_S.sheet`'s bottom-sheet-on-phone behaviour.
- **Own module.** Put the tab in a new module, e.g. FE\views\wled_advanced.js, loaded on demand with the cache-busting pattern `await import(\`./wled_advanced.js${new URL(import.meta.url).search}\`)` (see lights_map.js:14-23 and docs\06_UI_CACHE_BUSTING.md). lights_map.js is already 3,788 lines.
- **New api fields, both hosts in lockstep** (lights_panel.js:319-326 and maps.js:8677-8678): `tier`, `deviceId`, `platform`, and `isAdmin` (the sidebar has `_isAdmin()`).
  - This means `ensureLightsRegistry` must also keep an entity → device_id map, added next to `ipMap` at lines 1920/1952/1958/1966/1978, plus the device's integration domain (`devIdentDomain` already exists at line 1914).
  - Better: one shared `controlApiFor(eid)` helper so the two hosts can't drift.
- **Detection signal for WLED.** Prefer the registry platform "wled" or the device identifier domain over the `effect_list` test currently used (line 1400). That also makes a forced WLED override, or one whose effect list is currently empty, show the tab.
- **Gating.**
  - Frontend: `tierAtLeast(api.tier, "bright")`, matching the WLED distinction.
  - Backend: `_tier_at_least(hass, "bright")` on every proxy command.
  - Writes are admin-only.

10. Backend proxy needed?

- **Tier A, no proxy.** HA's core WLED integration already exposes sibling entities on the same device. I know these from general knowledge; they are not verified against this install:
  - `number` intensity and speed per segment
  - `select` colour palette per segment, preset, playlist, live override
  - `switch` nightlight, sync send, sync receive, reverse per segment
  - `sensor` estimated current, uptime, free memory, Wi-Fi RSSI/channel, IP, LED count
  - `button` restart
  - `update` firmware (must be excluded, per the firmware rule)
  - An Advanced tab can drive all of these with `hass.callService` via the device_id → entity lookup (`config/entity_registry/list` is already fetched at lights_map.js:1881).
  - This is the native path: live updates come free through `hass.states`, since HA keeps its own push connection to each WLED unit.
- **Tier B, proxy required** for real configuration: segment start/stop/grouping/spacing/offset/mirror, 2D matrix, the three colour slots per segment, effect params c1-c3 and o1-o3, `/json/fxdata`, `/json/palettes`, preset and playlist editing (`/presets.json`, psave), `/json/cfg` (LED count, pins, current limit, sync/UDP, time/macros), `/json/info`, `/json/nodes`.
  - **Why the browser can't call the device directly:** HA is often served over https (remote or Companion app), so `fetch("http://192.168.x.x/json/state")` is blocked as mixed content or by Chrome's Private Network Access, and it can't work off-LAN at all. I haven't confirmed whether WLED sends CORS headers.
  - **Proposed file.** A new custom_components\padspan_ha\ws_wled.py, registered in `async_register_websockets` (websocket.py:268+). The `padspan_ha/` prefix gets renamed for Bright automatically (scripts\bright_build.py:17-19).
  - **Commands.** `padspan_ha/wled_get` {entity_id, path} and `padspan_ha/wled_post` {entity_id, path, body}.
  - **Host resolution.** Resolve the host server-side from the entity registry → device registry `configuration_url`, and require that the device belongs to the `wled` integration. Never accept a client-supplied host: the panel is `require_admin=False`, so that would be an SSRF hole.
  - **Path allowlist.** `json/state`, `json/info`, `json/si`, `json/effects`, `json/fxdata`, `json/palettes`, `json/cfg`, `presets.json`, `json/nodes`.
  - **Writes.** POST only to `json/state` and `json/cfg`, both `@require_admin`.
  - **Refused outright:** `/win`, `/update` (OTA), `/reset`.
  - **Transport.** `async_get_clientsession(hass)` with a short timeout, and error mapping like ws_devices.py:203-216. Document the commands in docs\02_WEBSOCKET_API.md.
  - **Optional, heavier:** a subscription command for WLED's `/ws` live LED preview (`{"lv":true}`) using `connection.subscriptions`.
  - **Alternative:** reuse the HA WLED integration's own client (config entry `runtime_data` coordinator, python-wled `WLED.request`). That avoids a second host lookup but depends on HA-core internals that change between releases; I'm not certain of its current shape.
- **What to keep off the tab:** a firmware update button, and any cross-device preset copy.

---

## EXTRA 2

WLED CONFIG GUI: API SURFACE MAP (researched 2026-09-23)

Method: I checked the kno.wled.ge docs against the firmware source at four tags: v0.14.4, v0.15.4, v16.0.1 and main (17.0.0-dev). I diffed the JSON and config keys across those tags. Where the docs and the source disagree, I followed the source. Local copies of the source are in C:\Users\Garry\AppData\Local\Temp\claude\C--Users-Garry\358fe285-8250-4736-b223-dd684814fd43\scratchpad\wled\{v0.14.4,v0.15.0,v0.15.4,v16.0.1,main}\ (json.cpp, cfg.cpp, set.cpp, wled_server.cpp, ws.cpp, const.h, FX.h, FX_fcn.cpp, bus_manager.*, presets.cpp, playlist.cpp, xml.cpp, index.js/htm, settings_*.htm).

SOURCE KEY (full URLs; shorthand used below)
REL   https://github.com/wled/WLED/releases
KJ    https://kno.wled.ge/interfaces/json-api/
KH    https://kno.wled.ge/interfaces/http-api/
KWS   https://kno.wled.ge/interfaces/websocket/
KUDP  https://kno.wled.ge/interfaces/udp-realtime/
KDMX  https://kno.wled.ge/interfaces/e1.31-dmx/
KMAP  https://kno.wled.ge/advanced/mapping/
KPS   https://kno.wled.ge/features/presets/
J16/J15/J14   https://github.com/wled/WLED/blob/v16.0.1/wled00/json.cpp (swap tag for v0.15.4 / v0.14.4)
C16/C15/C14   https://github.com/wled/WLED/blob/v16.0.1/wled00/cfg.cpp (same tag swap)
S16   https://github.com/wled/WLED/blob/v16.0.1/wled00/set.cpp
SRV16 https://github.com/wled/WLED/blob/v16.0.1/wled00/wled_server.cpp (SRV15 = v0.15.4)
WS16  https://github.com/wled/WLED/blob/v16.0.1/wled00/ws.cpp
K16   https://github.com/wled/WLED/blob/v16.0.1/wled00/const.h
FXH16 https://github.com/wled/WLED/blob/v16.0.1/wled00/FX.h
F16   https://github.com/wled/WLED/blob/v16.0.1/wled00/FX_fcn.cpp
BM16  https://github.com/wled/WLED/blob/v16.0.1/wled00/bus_manager.cpp
X16   https://github.com/wled/WLED/blob/v16.0.1/wled00/xml.cpp
P16   https://github.com/wled/WLED/blob/v16.0.1/wled00/presets.cpp
PL16  https://github.com/wled/WLED/blob/v16.0.1/wled00/playlist.cpp
COL16 https://github.com/wled/WLED/blob/v16.0.1/wled00/colors.cpp
FILE16 https://github.com/wled/WLED/blob/v16.0.1/wled00/file.cpp
W16   https://github.com/wled/WLED/blob/v16.0.1/wled00/wled.cpp
UTIL16 https://github.com/wled/WLED/blob/v16.0.1/wled00/util.cpp
OTA16 https://github.com/wled/WLED/blob/v16.0.1/wled00/ota_update.cpp
IDX16 https://github.com/wled/WLED/blob/v16.0.1/wled00/data/index.js (IDXH16 = data/index.htm)
SLED16 / SUM16 / SSYNC16  https://github.com/wled/WLED/blob/v16.0.1/wled00/data/settings_leds.htm (/settings_um.htm, /settings_sync.htm)
E131H https://github.com/wled/WLED/blob/v16.0.1/wled00/src/dependencies/e131/ESPAsyncE131.h
NODE16 https://github.com/wled/WLED/blob/v16.0.1/wled00/NodeStruct.h
PIN16 https://github.com/wled/WLED/blob/v16.0.1/wled00/pin_manager.h
AR16  https://github.com/wled/WLED/blob/v16.0.1/usermods/audioreactive/audio_reactive.cpp
AWS   https://github.com/Aircoookie/ESPAsyncWebServer/blob/v2.4.2/src/AsyncWebSocket.h
SPED  https://github.com/Aircoookie/ESPAsyncWebServer/blob/v2.2.1/src/SPIFFSEditor.cpp
HAW   https://www.home-assistant.io/integrations/wled/
HAWC  https://github.com/home-assistant/core/tree/dev/homeassistant/components/wled
PYW   https://github.com/frenck/python-wled/blob/main/src/wled/wled.py
HARC  https://www.home-assistant.io/integrations/rest_command/
HARCS https://github.com/home-assistant/core/blob/dev/homeassistant/components/rest_command/__init__.py
HAWS  https://developers.home-assistant.io/docs/api/websocket/
HAWSX https://developers.home-assistant.io/docs/frontend/extending/websocket-api/
HAPERM https://developers.home-assistant.io/docs/auth_permissions/
LNA   https://developer.chrome.com/blog/local-network-access
LNAX  https://github.com/WICG/local-network-access/blob/main/explainer.md
MDNMC https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content
HAIFR https://community.home-assistant.io/t/iframe-issue-panel-iframe-webpage-card/205255

0. VERSION LANDSCAPE (REL)
- Stable releases:
  - v0.14.4 (2024-05-18)
  - v0.15.0 (2024-12-10), then 0.15.1, 0.15.2, 0.15.3, and v0.15.4 (2026-03-14)
  - v16.0.0 (2026-05-03) and v16.0.1 (2026-07-07)
- Upstream dropped the leading "0.": what people call "0.16" is 16.x. There is no v0.16 tag.
- main is 17.0.0-dev (the nightly asset names read WLED_17.0.0-dev_*).
- Gate on info.vid, the build number YYMMDDB (C16 uses 2605010 as the 16.0 migration cutoff), or parse info.ver.
- The Home Assistant WLED integration requires 0.14.0 or newer (HAW). 0.14 is therefore the realistic floor.

1. ENDPOINTS (J16 serveJson, SRV16 initServer)
Routing is by URL substring:
- GET /json = {state, info, effects[], palettes[]}
- /json/state, /json/info, /json/si (state+info)
- /json/nodes
- /json/eff (effect names; the "@metadata" suffix is stripped)
- /json/fxdata (metadata strings, index-aligned with /json/eff; streamed with sendChunked in 16)
- /json/pal (built-in palette names only)
- /json/palx?page=N (palette color previews, paginated)
- /json/net (WiFi scan; the first call starts an async scan and returns an empty list)
- /json/cfg (config)
- /json/pins (16+ only)
- /json/live (only in builds with WLED_ENABLE_JSONLIVE)
- Any other /json/* returns 501.

POST handling:
- POST /json or /json/state or /json/si goes to deserializeState.
- POST to any URL containing "cfg" goes to deserializeConfig.
- Bodies are limited to JSON_BUFFER_SIZE: 10240 on ESP8266, 24576 on ESP32-S2, 32767 on other ESP32 (K16; 0.14 ESP32 was 24576, per the v0.14.4 const.h).
- When the JSON buffer is busy: 0.15 returns 503 {"error":3} with Retry-After: 1 (J15/SRV15). 16 defers the response instead (J16).

Other endpoints:
- /version (plain text vid), /uptime, /freeheap
- /reset: reboots
- /win&...: legacy HTTP API with an XML response (KH). It can also be embedded in JSON as {"win":"..."} (J16).
- /settings, /settings/{wifi,leds,ui,sync,time,sec,dmx,um,2D,pins(16),lock}: GET serves the page, POST is a form save
- /settings/s.js?p=N: JavaScript that fills in the form values. p=1 wifi, 2 leds, 3 ui, 4 sync, 5 time, 6 sec, 7 dmx, 8 um, 9 update, 10 2D, 11 pins (K16 SUBPAGE_*).
- /edit, /upload
- /update (OTA), /updatebootloader (16, ESP32 only)
- /liveview, /liveview2D, /ws
- /cpal.htm (palette editor)
- /pixelforge.htm (16), /pixart.htm and /pxmagic.htm (build flags)
- /dmxmap (DMX builds)
- /u (usermod page, build flag)
- Any file on the filesystem is served with GET /<file> (FILE16 handleFileRead), except paths that contain "sec" (so wsec.json is excluded).
  - This means /presets.json, /cfg.json, /paletteN.json and /ledmapN.json are readable with no PIN.

2. STATE OBJECT: POST /json/state (J16 deserializeState/serializeState; KJ)

Read/write keys:
- on: bool, or "t" to toggle.
- bri: 0-255. When off, it reports the last brightness.
- transition: in 100 ms units; sets the default for later calls.
- tt: one-shot transition. Not reported.
- tb: effect timebase. Not reported.
- ps: -1 or 1-250. Also accepts "a~b~" to cycle a range, "r" or "1~5r" for random. Setting ps unloads a running playlist.
- pd: "preset direct". Used by the UI when it has already sent the preset's content.
- psave: 1-250, or 255 for the temporary preset. Companion keys: n, ql, ib, sb, sc, ledmap, bootps (0.15+), and "o" (see section 7).
- pdel: delete a preset.
- playlist: {...} (see section 7).
- np: advance the playlist (0.15+).
- nl: {on, dur 1-255 minutes, mode 0 set / 1 fade / 2 color fade / 3 sunrise, tbri}. nl.rem is read-only (seconds, -1 when inactive).
- udpn: {send, sgrp, rgrp}. sgrp/rgrp are bitfields for sync groups 1-8. nn = don't notify for this call only. recv is read-only (true when rgrp != 0).
- lor: 0, 1 or 2 (live override). When "use main segment only" is active, lor only freezes or unfreezes the main segment and the override is then reset.
- live: true enters realtime (65 s lock, blanks the LEDs); false exits.
- mainseg: ignored while realtime is active.
- time: unix time, used as a fallback when NTP is not synced.
- ledmap: load ledmap.json (0) or ledmapN.json. N goes up to WLED_MAX_LEDMAPS-1: 10 maps on ESP8266/S2, 16 on other ESP32.
- rmcpal: remove a custom palette.
  - 0.14/0.15: true removes the last custom palette.
  - 16: the value N removes /paletteN.json.
- rb: reboot. Ignored when psave is in the same body.
- v: true makes the response the full JSON for the URL you posted to. Posting to /json with v:true returns state, info, effects and palettes.
- win: an embedded HTTP API string.
- pin: settings PIN (see section 16).
- wifi: {ap: bool} starts or stops the access point (0.15+).
- bs: blending style, 16+ (see below).
- rSeg: true resets segments to the automatic layout (16+).
- seg: object or array (see section 3).
- Usermods can add their own keys through readFromJsonState, e.g. state.AudioReactive.on (AR16).

Read-only keys:
- pl: current playlist.
- error: cleared after it is read. Codes in K16: 1 denied, 3 no buffer, 4 not implemented, 7/8 out of RAM, 9 JSON parse, 10-19 filesystem, 33-37 low memory, 90 reboot after error, 91 brownout, 100 reboot needed (16), 101 power-off needed (16).
- nl.rem.
- udpn.recv.
- ps also reads back -1 when no preset is active.

bs (16+) values (FXH16 TRANSITION_*; IDXH16 labels):
- 1D or 2D: 0 Fade, 1 Fairy Dust, 2 Swipe right, 3 Swipe left, 4 Outside-in, 5 Inside-out, 16 Push right, 17 Push left.
- 2D only: 6 Swipe up, 7 Swipe down, 8 Open H, 9 Open V, 10-13 Swipe TL/TR/BR/BL, 14 Circular out, 15 Circular in, 18 Push up, 19 Push down, 20-23 Push TL/TR/BR/BL.

3. SEGMENT OBJECT: state.seg (J16 deserializeSegment/serializeSegment; KJ)

How writes are addressed:
- seg as an object with no id applies to every selected segment.
- seg as an array applies elements in order; an element's id defaults to its array index.
- stop:0 deletes a segment. If more than half of more than 3 segments are deleted in one call, the list is purged.
- A new id >= the current count appends a segment, provided stop > 0.

Keys:
- id
- start, stop (exclusive), or len (stop wins if both are given)
- startY, stopY (2D)
- grp: grouping. spc: spacing. of: offset, which may be negative and wraps modulo len.
- on
- bri: segment opacity. bri 0 turns the segment off.
- frz: freeze
- cct: 0-255, or Kelvin 1900-10091
- set: 0-3, a UI grouping aid only
- n: name. Max length is WLED_MAX_SEGNAME_LEN: 32 on ESP8266, 64 on ESP32 (K16). Changing start or stop without sending n clears the name.
- col: up to 3 colors (primary, background, custom). Each can be:
  - an [r,g,b(,w)] array
  - a hex "RRGGBB" or "WWRRGGBB" string
  - "r" for random (16)
  - an {"r","g","b","w"} object for partial channel updates
  - an integer Kelvin value (0 = black)
- fx: 0 to fxcount-1, "~", "~-" or "r". sx and ix: 0-255, "~" or "~-". fxdef: true loads the effect's defaults.
- c1, c2: 0-255. c3: 0-31.
- o1, o2, o3: booleans.
- pal: 0-255, "~", "~-" or "r". Ignored on segments without RGB.
- sel
- rev, mi. rY, mY, tp are 2D only and are only serialized when the setup is a matrix.
- si: sound simulation 0-3.
- m12: 1D-to-2D expansion. 0 Pixels, 1 Bar, 2 Arc, 3 Corner, 4 Pinwheel (4 is 0.15+; FXH16).
- bm: segment blend mode, 16+. 0 Top/Default, 1 Bottom/None, 2 Add, 3 Subtract, 4 Difference, 5 Average, 6 Multiply, 7 Divide, 8 Lighten, 9 Darken, 10 Screen, 11 Overlay, 12 Hard Light, 13 Soft Light, 14 Dodge, 15 Burn, 16 Stencil (IDX16).
- rpt: true repeats the segment until the strip is full, alternating rev.
- i: individual LED colors (see below).
- lx, ly: Loxone color values (Loxone builds only).
- lc: read-only light capabilities, 16+. Bits: 1 RGB, 2 White, 4 CCT (K16 SEG_CAPABILITY_*). Before 16, use info.leds.seglc.
- len: read-only in state output.

Individual LEDs (i):
- Forms: an array of colors, [index, color, ...], or [start, stop, color, ...] (KJ).
- Using i freezes the segment and clears it first, and sets transition to 0.
- Limit each call to about 256 colors (KJ).
- Behavior changed in 16:
  - 0.14/0.15 call seg.setPixelColor, so grouping, spacing, mirror and reverse apply.
  - 16 calls setRawPixelColor, which per its source comment applies "without 1D->2D expansion, grouping or spacing" (J16 vs J15).
  - The KJ docs still describe the old behavior.

Limits (FXH16):
- Max segments: 16 on ESP8266, 32 on ESP32 and S2, 64 on ESP32 with PSRAM.
- info.leds.maxseg reports the limit.

4. INFO OBJECT: all read-only (J16 serializeInfo; KJ)

Present in all versions (0.14 baseline):
- ver, vid, cn (codename)
- leds: {count, pwr (mA estimated by the brightness limiter), fps, maxpwr, maxseg, lc, seglc (deprecated in 16), rgbw/wv/cct (deprecated), matrix:{w,h} (2D only)}
- str, name, udpport, live, liveseg, lm (realtime source name), lip (realtime source IP)
- ws: WebSocket client count, or -1 if WebSockets are disabled
- fxcount, palcount, cpalcount
- maps: [{id, n}]. Map names are ESP32 only.
- wifi: {bssid, rssi, signal, channel}
- fs: {u, t, pmt}. pmt is the presets.json modification time; use it to invalidate a presets cache.
- ndc, arch, core, lwip (deprecated), freeheap, psram, uptime, time
- opt: build-option bitmask. 0x01 OTA, 0x02 Adalight, 0x04 Hue, 0x08 filesystem, 0x10 Cronixie, 0x40 Alexa, 0x80 debug.
- brand, product, mac, ip
- u: usermod info rows as {Name: [value, unit]} (AR16)

Added in 0.15.0 (J15 vs J14): leds.bootps, clock, flash, release (build/env name), simplifiedui, wifi.ap.

Added in 0.15.4: deviceId, repo, bootloaderSHA256. KJ says these arrived in 16.0.0, but the source shows them in 0.15.4.

Added in 16: umpalcount, cpalmax, umpalnames, psrSz.

Added on main (17-dev): wifi.band.

5. EFFECTS AND METADATA

- /json/eff returns an array of names. Reserved slots are named "RSVD", and the UI skips them.
- /json/fxdata returns an array of metadata strings in the same order.
- Grammar (KJ, and IDX16 setEffectParameters): "<sliders>;<colors>;<palette>;<flags>;<defaults>"
  - sliders: comma list in the order sx, ix, c1, c2, c3, o1, o2, o3. "!" means use the default label. An empty entry hides the control.
  - colors: up to 3 slots. "!" gives the default labels Fx, Bg, Cs. The UI shows only the first 2 characters of a label.
  - palette: empty means no palette. "!" enables the palette picker. "label=NN" embeds a default palette.
  - flags: 0 works on a single LED, 1 is 1D, 2 needs 2D, 3 is 3D (unused), v reacts to volume, f reacts to frequency.
  - defaults: comma list, e.g. sx=24,pal=50.
- setMode(fx, fxdef=true) applies defaults for these keys (F16): sx, ix, c1, c2, c3, o1, o2, o3, m12 (0-7, otherwise reset to Pixels), si, rev, mi, rY, mY, pal.
  - "pal" also sets the effect's default palette when pal=0 is selected (0 falls back to 6).
- When an effect has no metadata string, the UI shows 2 sliders (for fx IDs below 128), all 3 color slots and the palette picker.

6. PALETTES

- /json/pal: built-in names only.
- /json/palx?page=N returns {"m": maxPage, "p": {"<id>": [[pos,r,g,b],...] | ["r","r","r","r"] | ["c1",...]}}. Pages hold 8 palettes (5 on ESP8266). In 16 the results include custom and usermod palettes (J16 serializePalettes).
- Palette IDs:
  - 0.14/0.15: 71 built-ins (0-70). Custom palettes start at 255 and count down (255 = palette0.json), max 10.
  - 16: 72 built-ins (0-71). Custom palettes 72-200, counting down from 200 (200 = palette0.json); max 129 on ESP32, 10 on ESP8266. Usermod palettes 201-255, counting down from 255. Gaps in the file numbering become gray placeholders so later IDs stay stable. (K16, COL16, J15)
- Custom palette files: upload /paletteN.json via /upload.
  - Format: {"palette":[pos,"RRGGBB",pos,"RRGGBB",...]} or [pos,r,g,b,...]. At least 2 stops, max 18 (COL16).
  - Uploading any file named palette*.json reloads the palettes; no reboot needed (SRV16 handleUpload).
- /cpal.htm is the on-device palette editor.
- The default palette's blending mode is cfg light.pal-mode: 0 blend (wrap if moving), 1 always wrap, 2 never wrap, 3 no blend or wrap (wled.h paletteBlend comment: https://github.com/wled/WLED/blob/v16.0.1/wled00/wled.h).

7. PRESETS AND PLAYLISTS (P16, PL16, KPS)

presets.json structure:
- {"0":{}, "1":{...}, ...}. IDs 1-250. 255 is a temporary preset held in RAM.
- Read it with GET /presets.json. Replacing the whole file uses /upload and needs the PIN.
- The docs recommend keeping to roughly 50 single-segment or a dozen multi-segment presets, because file writes can freeze the device for seconds (KPS).

Saving the current state:
- {"psave":N, "n":"name", "ql":"xx", "ib":bool, "sb":bool, "sc":bool, "ledmap":M, "bootps":N}
  - ib: include brightness. sb: include segment bounds. sc: selected segments only.
  - bootps (0.15+) also sets the boot preset.
- This save is asynchronous and writes serializeState(forPreset).
- Saved preset content: n, ql, on, bri, transition, bs (16), mainseg, seg[] (id, start/stop/startY/stopY, grp, spc, of, on, frz, bri, cct, set, n, col, fx, sx, ix, pal, c1-c3, sel, rev, mi, rY/mY/tp, o1-o3, si, m12, bm (16), lc). Unused segment slots are written as {"stop":0}.

Saving an arbitrary API call as a preset:
- Include "o":true, e.g. {"psave":N,"o":true,"n":"x","win":"FX=~"} or any state JSON.
- It is written immediately. The keys o, v, time, error and psave are stripped.

Playlists:
- Saved via psave together with playlist:{...}, or applied inline.
- Keys: ps [preset IDs, max 100 entries]; dur (tenths of a second, a single value or an array; 0 = infinite, advance with "np"); transition (tenths, value or array); repeat (0 = infinite); end (0 = stay on last; 255 = restore the prior state, 0.15+); r (shuffle).
- One level of nested playlists is supported in 16 only (PL16; the parentPlaylist code is commented out in 0.15.4: https://github.com/wled/WLED/blob/v0.15.4/wled00/playlist.cpp).

Boot preset: cfg def.ps. It must save segment bounds (KPS).

8. CONFIG: GET/POST /json/cfg (C16 serializeConfig/deserializeConfig)

Caveats that shape the whole design:
- The C16 file header says: "The structure of the JSON is not to be considered an official API and may change without notice." Gate every section by version.
- Scalars are merged: CJSON(a, b) keeps the current value when a key is missing, so partial objects are fine.
  - **CORRECTION (review 2026-09-23, verified in cfg.cpp at 0.14.4/0.15.4/16.0.1): NOT all of them.** `hw.led.fps` (→42), `hw.led.rgbwm` (→off), `light.gc.bri`/`col` (→defaults) and `nw.linked_remote` (cleared) are RESET when a write leaves them out. ws_wled.py carries their current values on every write (`with_preserved`).
- Arrays behave differently:
  - Posting hw.led.ins REPLACES all buses.
  - hw.btn.ins clears and rebuilds the buttons.
  - timers.ins clears and rebuilds the timers.
  - nw.ins overwrites the WiFi slots.
  - hw.com is APPENDED, not reset: the ColorOrderMap::add path in C16 has no reset. The settings form does reset it (S16).
- "sv": false applies without saving to flash (default true). "rb": true reboots after applying.
- The response is always {"success":true}. 401 {"error":1} if a PIN is set and not yet entered.
- Passwords are never returned; only their lengths appear as pskl.
  - Secrets (WiFi psk, AP psk, MQTT psk, Hue key, settings PIN, OTA pwd) live in /wsec.json. It cannot be served or edited over HTTP.
  - You can write them by including psk or pwd in the POST.
  - OTA lock settings are only accepted if the OTA password matches or OTA is unlocked.

Full tree as of 16.0.1:
- rev [1,0]; vid (read-only info)
- id: {mdns, name, inv (Alexa invocation name), sui (simplified UI)}
- nw:
  - ins[]: {ssid, pskl, bssid, ip[4], gw[4], sn[4]}. WPA-Enterprise builds add enc_type, e_anon_ident, e_ident (16).
  - dns[4]
  - espnow
  - linked_remote: a string in 0.15, an array in 16
  - Multi-WiFi (3 slots) arrived in 0.15. In 0.14 this was a single nw.ins[0].
- ap: {ssid, pskl, chan 1-13, hide, behav, ip (fixed 4.3.2.1)}. behav: 0 open if no connection after boot, 1 open when disconnected, 2 always, 3 button only, 4 temporary (0.15+) (K16).
- wifi: {sleep, phy (force 802.11g), txpwr (ESP32), band (main/17-dev, 5 GHz chips)}
- eth: {type, pin[] (informational)}. Ethernet is initialized only once per boot (initEthernet guard in https://github.com/wled/WLED/blob/v16.0.1/wled00/network.cpp).
- hw.led:
  - total: informational
  - maxpwr: global brightness-limiter budget in mA
  - ledma: global mA per LED, 0.14 only
  - cct: correct white balance; cr: CCT from RGB; ic: CCT IC used (0.15+); cb: CCT blend
  - fps: 0 = unlimited, default 42
  - rgbwm: global auto-white override, 255 = off
  - ld: global LED buffer, 0.14/0.15, removed in 16
  - prl: parallel I2S, 0.15.4 only
  - matrix: see the 2D bullet below
  - ins[]: one entry per bus:
    - start, len
    - pin[]: up to 5 entries. For network buses these are the target IP octets. For HUB75 they hold width, height, chain, rows and cols.
    - order: the low nibble is the color order (0 GRB, 1 RGB, 2 BRG, 3 RBG, 4 BGR, 5 GBR); the high nibble is the white-channel swap.
    - rev, skip (skip the first N LEDs), type, ref (off-refresh), rgbwm (per-bus auto-white: 0 manual, 1 brighter, 2 accurate, 3 dual, 4 max)
    - freq: kHz for 2-pin chipsets, Hz for PWM
    - maxpwr and ledma: per-bus current limiting, 0.15+. Forced to 0 on PWM, on/off and virtual buses.
    - drv: 0 RMT, 1 I2S (16)
    - text: hostname for network buses (16, ESP32)
- 2D matrix: hw.led.matrix = {mpc (panel count, max 18), panels[]: {b bottom start, r right start, v vertical, s serpentine, x, y, h, w}}. It is only emitted when the setup is a matrix.
- hw.com[]: {start, len, order}. Max 5 entries on ESP8266, 10 on ESP32.
- hw.btn: {max (read-only), pull, ins[]: {type, pin[1], macros[press, long, double]}, tt (touch threshold), mqtt}. Button types: 0 none, 2 push, 3 push active-high, 4 switch, 5 PIR, 6 touch, 7 analog, 8 analog inverted, 9 touch switch.
- hw.ir: {pin, type, sel}
- hw.relay: {pin, rev, odrain (0.15+)}
- hw.baud: value x100 (1152 = 115200)
- hw.if: {i2c-pin [sda,scl], spi-pin [mosi,sclk,miso]}
- light:
  - scale-bri, pal-mode, aseg
  - gc: {bri, col, val}. Gamma val range 0.1-3; 1.0 means off.
  - tr: {dur (100 ms units), rpc (random palette change time), hrp (harmonic random palettes)}. 0.15 also had tr.mode, tr.fx and tr.pal; 16 removed them.
  - nl: {mode, dur, tbri, macro}
- def: {ps (boot preset), on, bri}
- if.sync:
  - port0 (default 21324), port1 (default 65506), espnow (0.15+)
  - recv: {bri, col, fx, pal (0.15+), grp, seg, sb}
  - send: {en (0.15+), dir, btn, va, hue, grp, ret (retries)}. 0.14 had send.macro.
- if.nodes: {list, bcast}
- if.live:
  - en: UDP/Hyperion realtime receive
  - mso: use main segment only
  - rlm: respect LED maps (0.15+)
  - port: E1.31 5568 or Art-Net 6454. 4048 is rejected because it is the DDP port.
  - mc: multicast
  - dmx: {uni, seqskip, e131prio (0-200), addr (1-510), dss (0-150), mode, inputRxPin/inputTxPin/inputEnablePin/dmxInputPort (16, DMX-input builds)}. DMX modes: 0 disabled, 1 single RGB, 2 single DRGB, 3 effect, 4 multi RGB, 5 dimmer + multi RGB, 6 multi RGBW, 7 effect + W, 8 effect segment, 9 effect segment + W, 10 preset (K16).
  - timeout (100 ms units), maxbri, no-gc, offset
- if.va: {alexa, macros [on, off], p}
- if.mqtt: {en, broker, port, user, pskl, cid, rtn, topics: {device, group}}
- if.hue: {en, id, iv, recv: {on, bri, col}, ip[4]}
- if.ntp: {en, host, tz, offset, ampm, ln, lt}
- ol: {clock, cntdwn, min, max, o12pix, o5m, osec, osb (0.15+)}
- timers: {cntdwn: {goal [Y,M,D,h,m,s], macro}, ins[]: {en, hour, min, macro (preset), dow (7-bit mask), start: {mon, day}, end: {mon, day}}}
  - 0.14/0.15: a fixed array of 10. Slots 8 and 9 are sunrise and sunset, both stored as hour=255.
  - 16: a dynamic list, max 64 on ESP32 and 16 on ESP8266. hour 255 = sunrise, 254 = sunset. The old format is migrated when vid < 2605010.
- ota: {lock, lock-wifi, pskl, aota, same-subnet (16)}
- dmx (DMX-output builds): {chan, gap, start, start-led, fixmap[15], e131proxy}
- um: {<UsermodName>: {...}}. Structure is free-form per usermod, e.g. AudioReactive: {enabled, add-palettes, analogmic{pin}, digitalmic{type, pin[]...}, config{squelch, gain, AGC}, frequency{scale}, dynamics{limiter, rise, fall}, sync{port, mode}} (AR16).

Bus type IDs (K16, BM16):
- Digital:
  - 22 WS281x RGB, 24 400 kHz, 25 TM1829, 26 UCS8903, 27 APA106 (0.15+), 33 TM1914 (0.15+)
  - 30 SK6812/WS2814 RGBW, 29 UCS8904, 31 TM1814
  - 28 FW1906 RGBCCT (0.15+), 32 WS2805 (0.15+), 34 SM16825 (0.15+)
  - 19 WS2811 white, 21 WWA
- 2-pin: 50 WS2801, 51 APA102, 52 LPD8806, 53 P9813, 54 LPD6803
- On/off: 40
- PWM: 41-45 (1 to 5 channels)
- Network: 80 DDP RGB, 88 DDP RGBW, 82 Art-Net RGB, 89 Art-Net RGBW (0.15+)
- HUB75 (16+, build flag): 65 half scan, 66 quarter scan
- Bit 7 of type = off-refresh.

Hardware metadata comes only from JavaScript, not JSON:
- /settings/s.js?p=2 emits d.ledTypes=[{i:id, c:caps, t:"D"|"2P"|"A..."|"N"|"H", n:name}]. caps bits: 1 RGB, 2 W, 4 CCT, 16 16-bit, 32 must-refresh.
- It also emits bLimits(platformId, maxLedsPerBus, maxLedMemory, maxLeds, maxCOM, maxDigital, maxRMT, maxI2S, maxAnalog, maxButtons) and reserved and read-only GPIO lists (X16).
- 16 adds /json/pins: [{p, c (caps: 0x02 ADC, 0x08 boot, 0x10 strapping, 0x20 input-only), a (allocated), o/n (owner ID and name), m, s, t, r (live button/touch/analog readings)}] (J16, PIN16).
- MAX_LEDS is 1536 on ESP8266, 2048 on S2, 16384 on ESP32; MAX_LEDS_PER_BUS is 2048 (K16).

9. LIVE VS REBOOT

Applied live:
- State API: everything.
- /json/cfg bus changes (hw.led.ins): doInitBusses rebuilds the buses in the main loop (W16).
- Brightness limiter, auto-white, FPS, gamma, transitions, nightlight defaults, sync send/receive flags, live/DMX mode flags, buttons, relay, IR pin allocation, I2C/SPI pin allocation (but see below).

Needs a reboot, or the matching /settings form POST:
- /json/cfg only assigns variables. Unlike the form handlers (S16), it does not:
  - reconnect WiFi or restart the AP (the form sets forceReconnect)
  - re-query NTP
  - re-init IR (the form calls initIR)
  - reconnect Hue
  - re-init Alexa
  - rebuild the 2D matrix or ledmap (the C16 comment says setUpMatrix cannot run there; /settings/2D does rebuild it, S16)
  - re-init Ethernet (initEthernet runs once per boot)
- The settings UI itself marks as "Reboot required" (SSYNC16, SUM16):
  - UDP sync ports and ESP-NOW (Send block)
  - E1.31 port, multicast and universe
  - DMX input port
  - MQTT
  - global I2C/SPI pins
  - most usermod changes (RBT checkbox)
- Uploading cfg.json via /upload reboots automatically (SRV16).
- HUB75 changes on ESP32-S3 set error 100 "reboot needed" (BM16, SLED16).
- A factory reset from the Security page reboots.

A GUI should send "rb":true, or tell the user to reboot, whenever it changes those sections through /json/cfg.

10. SETTINGS FORM API (alternative write path)

- POST /settings/<page> with application/x-www-form-urlencoded, using the legacy short field names.
  - LED page: L0<bus>..L4<bus> pins, LC len, LT type, LS start, CO order, CV rev, SL skip, RF refresh, AW, WO swap, SP speed index 0-4, LA mA per LED, MA max mA (only when PPL), LD driver, HS host. Bus index is 0-9 then A-Z. Also MA global, PPL, CCT, CR, IC, CB, FR, AW, BT/BE buttons, IR/IT, RL/RM/RO relay, TD, BO/BP/CA, GB/GC/GV, PB, BF (S16).
  - 2D page: SOMP, MPC, P<i>{B,R,V,S,X,Y,W,H}.
- Requires the client IP to be private (10/8, 172.16/12, 192.168/16, the WLED AP subnet, or the device's own subnet), otherwise 401 (SRV16 inLocalSubnet).
- The official usermod page does this:
  1. fetch /json/cfg and render the um tree generically
  2. load /settings/s.js?p=8, where usermods emit addInfo(), addDropdown() and addOption() UI hints (only as JavaScript)
  3. post form fields named "Mod:key:sub" (SUM16)

11. FILES AND /edit

- /upload: POST multipart. The filename becomes the path. Requires the PIN.
  - presets.json updates pmt.
  - palette*.json reloads palettes.
  - cfg.json triggers a reboot.
- /edit in 0.14/0.15 is the AsyncWebServer SPIFFSEditor (SPED):
  - GET ?list=/ lists files
  - GET ?edit=path or ?download=path fetches a file
  - DELETE with form field path deletes
  - PUT with path creates
  - POST uploads
- /edit in 16 is WLED's own handler (SRV16):
  - GET ?func=list returns [{name, type, size}]
  - GET ?func=edit|download|delete&path=/x
  - the old ?list= still works
  - wsec.json is always excluded
- Other files:
  - ledmap.json / ledmapN.json: {"map":[...], "width":W, "height":H, "n":"name"}. -1 marks a gap. The parser is whitespace-sensitive (KMAP, F16 deserializeMap).
  - 2d-gaps.json is ignored when a ledmap exists (KMAP).

12. WEBSOCKET /ws (WS16, KWS)

- Max clients: 8 on ESP32, 3 on ESP8266. When the limit is exceeded, the oldest client is dropped (AWS DEFAULT_MAX_WS_CLIENTS, KWS).
- On connect the device pushes {state, info}. Changes are pushed again, rate-limited (roughly one per second per KWS).
- Text frames:
  - state JSON
  - {"v":true} returns state+info to this client only
  - {"lv":true|false} turns the live LED stream on or off
  - "p" is answered with "pong"
- Frames must be single and at most 1428 bytes (528 on ESP8266). Split or multi-frame text gets {"error":9}; a busy buffer gets {"error":3}.
- Live stream: binary frames every 40 ms or slower. Format: 'L', version (1 = strip, 2 = matrix), [w, h], then RGB triplets (white is added into RGB). Downsampled above 1024 LEDs on ESP32 (256 on ESP8266).
- 16 only: binary realtime input where byte 0 selects the protocol (0 E1.31, 1 Art-Net, 2 DDP).
- There is no wss:// (KWS).

13. SYNC AND REALTIME

- UDP notifier (WLED sync) on port 21324, with port1 = 65506. Group bitmasks: udpn.sgrp/rgrp (state) and if.sync.send.grp / recv.grp (cfg). ESP-NOW sync is 0.15+.
- Realtime inputs:
  - UDP realtime on port 21324: WARLS (1, 255 LEDs), DRGB (2, 490), DRGBW (3, 367), DNRGB (4, 489 per packet with a start index). Byte 1 is the timeout in seconds; 255 means no timeout (KUDP).
  - Hyperion 19446, TPM2.NET 65506, audio sync 11988 (KUDP).
  - E1.31 5568, Art-Net 6454, DDP 4048 (E131H). 170 LEDs per universe (KDMX). Priority handling exists from 0.14.0-b1 on (KDMX).
  - DDP always uses the multi-RGB mode (KDMX).
- Outputs to other devices: network buses (types 80/88/82/89) with the target IP in pin[0..3] and a hostname in text (16) (BM16).
- info.live, lm and lip show the active realtime source. Control it with lor.

14. OTHER READ ENDPOINTS

- /json/nodes: {nodes: [{name, type, ip, age, vid}]}. type: 82 ESP8266, 32 ESP32, 33 S2, 34 S3, 35 C3, 37 C2, 38 H2 (NODE16).
- /json/net: {networks: [{ssid, rssi, bssid, channel, enc}]}.

15. OTA AND VERSION

- POST /update, multipart.
  - Requires: OTA not locked, correct PIN, and a client subnet check. In 16 the check is: if otaSameSubnet, the same subnet unless a PIN is set; otherwise any private subnet (SRV16).
  - From 0.15.2 on, OTA checks that the binary's release name matches, unless you send the form field skipValidation=1 (OTA16; also present in https://github.com/wled/WLED/blob/v0.15.2/wled00/ota_update.cpp).
- 16 adds POST /updatebootloader (ESP32) and info.bootloaderSHA256 (which 0.15.4 also has).
- Use info.release, ver and vid to pick the right binary.
- The HA "update" entity already handles release tracking and installation (HAW).

16. SECURITY MODEL

- 4-digit settings PIN:
  - Send "pin":"1234" in any JSON POST, or PIN= to /settings/lock.
  - correctPIN is a single device-wide flag, not per client. It stays set for 15 minutes (PIN_TIMEOUT 900000).
  - Retries have a 3 s cooldown (UTIL16, K16, W16).
- What the PIN protects:
  - POST /json/cfg
  - /settings pages 2 and up
  - /settings/s.js p>0
  - /edit, /upload, /update
- What the PIN does NOT protect:
  - GET /json/cfg
  - GET /presets.json and /cfg.json
  - the state API
- OTA lock and wifi-lock further restrict writes.

17. BROWSER ACCESS FROM THE HA FRONTEND

CORS:
- WLED adds Access-Control-Allow-Origin: *, Access-Control-Allow-Methods: * and Access-Control-Allow-Headers: * to every response. OPTIONS gets 200 with Access-Control-Max-Age: 7200. This is the same in 0.14.4, 0.15.4, 16.0.1 and main (SRV16, SRV15).
- There is no Access-Control-Allow-Private-Network header.
- There is no authentication, so wildcard CORS works for plain fetch without credentials.

What works where:
- HA served over plain http on the LAN: a card can fetch http://<wled>/json/* and open ws://<wled>/ws directly.
- HA over HTTPS (local TLS or Nabu Casa): mixed-content rules block http:// fetches, ws:// connections and http iframes (MDNMC, KWS, HAIFR).
- Chrome 142+ Local Network Access (LNA):
  - Public-to-local requests trigger a permission prompt.
  - If granted, the mixed-content check is skipped when the target host is a private IP literal, a .local name, or the fetch uses {targetAddressSpace:"local"} (LNA).
  - A Nabu Casa page (public origin) on a phone that is on the LAN could therefore fetch http://192.168.x.y after the prompt.
  - The explainer frames this exemption for requests from public origins. Local-to-local is not an "LNA request", so an HTTPS HA on a private IP likely still gets blocked. This is unverified; test it (LNAX).
  - WebSockets are not yet covered by LNA (LNA), so treat ws:// from HTTPS as blocked.
  - Firefox and Safari have no such exemption.
- Remote use via Nabu Casa while off the LAN can never reach the LAN IP. Only a proxy on the HA side works in every case.

Proxy options, best first:
- (a) Custom integration, HTTP route: an aiohttp HomeAssistantView (requires_auth defaults to True) registered with hass.http.register_view (HAPERM).
  - Route shape: /api/<domain>/<entry_id>/{path:.*}. The card calls it with hass.callApi or hass.fetchWithAuth.
  - Forward to http://<host>/json/..., /presets.json, /edit, /upload.
  - Require an admin user for cfg, upload, edit and OTA writes.
- (b) Custom integration, WebSocket commands: websocket_api.async_register_command with an admin-only guard for writes. The frontend calls hass.connection.sendMessagePromise (HAWSX). This also allows a subscription that relays WLED /ws pushes and live frames.
- Reusing HA's WLED integration inside (a) or (b):
  - entry.runtime_data is a WLEDDataUpdateCoordinator. coordinator.wled is a python-wled WLED client (HAWC).
  - WLED.request(uri, method, data) sends arbitrary GET/POST to http://host:80 and returns parsed JSON (PYW).
  - It automatically adds v:true to POST /json/state.
  - The host is entry.data["host"].
  - HA's integration already keeps one /ws connection open (HAWC coordinator, PYW connect). On ESP8266, a card opening its own /ws (3 slots, oldest evicted) can knock HA off, so prefer relaying HA's data.
  - HA polls /json every 10 s when no WebSocket is available, and refetches /presets.json when info.fs.pmt changes (HAW, PYW update).
  - HA exposes only light, select, number, switch, sensor, button and update entities. There is no raw config passthrough (HAW).
- (c) No-code option: rest_command.
  - url, payload and headers are templates rendered with parse_result=False. method is fixed per command, so define one GET command and one POST command.
  - Responses come back as {status, content (parsed if the response is application/json), headers} with SupportsResponse.OPTIONAL (HARC, HARCS).
  - The frontend calls it over WebSocket with {"type":"call_service", ..., "return_response":true} (HAWS).
  - Downsides: any HA user can call it, and a templated URL is an open request-forgery vector. Restrict it to a fixed host list.

GUI implementation notes from the source:
- Fetch /json/info first, then gate features by version:
  - 16: bs/bm, rSeg, per-segment lc, /json/pins, WebSocket binary realtime, 72+ palette IDs, dynamic timers.
  - 0.15: per-bus current limiting, multi-WiFi, ESP-NOW, np, bootps, pinwheel.
- Build effect controls from /json/fxdata.
- Treat /json/cfg as version-specific and do read-modify-write only per section.
- Never post hw.com through /json/cfg; use /settings/leds.
- Always include hw.led.ins in full when changing buses.
- Size the POST under JSON_BUFFER_SIZE.
- After network, 2D, MQTT, sync-port or usermod edits, send rb:true.
- Watch state.error for 100/101.