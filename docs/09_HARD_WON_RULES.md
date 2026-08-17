# Hard-Won Rules

Each of these cost real debugging time. They are written as rules because the
underlying mistakes are all easy to make again, and several of them were made
more than once.

---

## 1. A frontend change you cannot see is not a frontend change

`BUILD_ID` was a release-time literal, so every panel asset URL kept the same
`?b=` stamp between releases. Files copied to a running install were invisible:
a fixed view stayed broken, and a broken view could not be proven fixed.

**Never verify a frontend change with a cache-busted import.** `import(url +
"?cb=" + Date.now())` bypasses the cache and proves the file is on disk, which
was never in doubt. Read the `?b=` stamp in a console stack trace or the
Network tab and confirm *it* moved.

See `06_UI_CACHE_BUSTING.md`.

---

## 2. `node --check` does not run the code

Four view modules shipped this week that parsed cleanly and threw at runtime.
`panel.js` loads views with `.catch(console.warn)`, so the view renders **blank
with a clean console** — the single most expensive failure mode in this repo.

The recurring shapes:

- a `const`/`let` declared inside an `if`/`else` block and used after it
- a `const` arrow referenced above its declaration (temporal dead zone)
- a call to a helper that is a local of a *different* function
- a duplicate `const` in the same scope after extracting a module

The only thing that has ever caught these before a user did is running
`render()` for real. Until the smoke harness lands, do that in the browser
console.

---

## 3. Look at it rendered

More than once a conclusion drawn from reading source or from a stale
`.storage` file was flatly contradicted by the running system:

- floor ordering was "diagnosed" from a stored blob holding one floor while the
  live registry held four — the resulting "fix" made things worse
- a floor-registration fault was "measured" from **bounding boxes** of rooms
  rather than the rooms; a bbox of an angled room is far larger than the room,
  so the fault was manufactured and then dutifully measured

Pull the live data over the websocket, or screenshot the view. Never diagnose
geometry from a bounding box.

---

## 4. The fabric is the truth, and every write goes through its store

Room geometry, scanner/beacon/light positions and RF barriers live in metres in
the FabricStore. Metadata, floors, adjacency and map transforms live in the
ModelStore.

A handler that edits `mdl.data` directly will silently miss whatever has since
moved to the fabric. **Delete room** did exactly that: it cleared `room_meta`,
adjacency and the scanner map, and left `room_geometry_m` alone — so the room
kept its shape and went on drawing and voting. Every other remove handler
delegated to a store method; this one did not, and it was the only one broken.

---

## 5. A sidecar that nothing populates is worse than no sidecar

`ModelStore.data["floors"]` is the sole input to `floor_stack_index()` and
`floor_base_elevations_m()`, and nothing ever wrote it. The panel looked
correct because `ws_model_get` reads the HA floor registry live *for display*.
Positioning read the stored list, found one synthetic `main` entry, and ran
every multi-floor house as a single storey for the lifetime of the install.

When a value has a display path and a compute path, check that the compute path
is reading something real. "It looks right in the UI" is not evidence.

---

## 6. An index difference that means something must be computed that way

`floor_stack_index()` returned `enumerate()` positions, so two floors on the
same storey got different indices. The difference between indices *is* the slab
count, so the garden and the ground floor came out one slab apart and outdoor
scanners were charged 10 dB of concrete they never saw through.

If a number is defined as a difference, assign it so the difference is right —
not so the ordering is right.

---

## 7. Guards that list their targets by hand go stale

Three separate guards have now failed this way:

- the photo-divorce guard listed its files by hand, so a new file escaped it
- the Kalman-state-leak guard named the dicts it checked, so `_spatial_debug`
  leaked for the process lifetime
- the light-shape whitelist existed on both sides of the websocket, and the
  chooser offered a shape the backend threw away

Make the guard **discover** its targets — walk the directory, introspect the
object, compare the two implementations. A guard that can only confirm a list
agrees with itself is decoration.

---

## 8. A fixture that cannot fail is worse than no fixture

A negative control for the metre-anchor bug used `scale_y_m: 5.0` against
`ref_ar: 0.25`, which makes both axis scales 20 — so the test passed with the
bug reintroduced. Always check that the fixture actually exercises the fault,
and say so in an assertion:

```python
assert out["y"] != out["x"], "the fixture no longer exercises the fault"
```

---

## 9. Record what the pipeline consumed, not what it produced

The traceback store could not serve as a replay source because it holds
outputs. A replay needs the **inputs** — the raw calibrated vector, not the
Kalman-smoothed one — plus the warm filter state, or the first several frames
of any replay are warm-up noise.

See `08_RSSI_VECTOR_CAPTURE.md`.

---

## 10. Test it against the site it will run on

Sizing assumptions written from a 40-object reference install met a real house
that shows **~1,800 BLE objects per poll**. The capture recorder's
"250 objects per frame" backstop silently became the policy, and it was keeping
14% of every frame and calling it a recording.

Before shipping a cap, measure the thing it caps on a live install.

---

## 11. Deploy, restart, and click the button

Every bug in this document that reached a user got there because something was
verified by reading rather than by using. The suite is 690 tests and green; it
did not catch the wrong coordinator object, the empty session after a restart,
the label written into every frame, or any of the four runtime ReferenceErrors.

---

## 12. Two views that draw one thing must share a contract, not a guess

Pure Live borrows the overview's map element and zooms it. Its counter-scale
found each marker's anchor by looking for a child `<circle>` and then *set* the
group's transform to `scale(1/zoom)` — overwriting the annotation scale the
overview had baked into that same attribute. At zoom 1 the labels were giant;
at zoom 2 they were giant. Nothing threw. The overview had "fixed the fonts"
and Pure Live had "fixed the zoom", each correctly, on the same attribute.

When one view mutates markup another view composed, the composer publishes what
it did (`data-ann-k` on the root, `data-ann="x y"` on each group) and the
mutator composes with it (`k / zoom`). Guessing the anchor from a child element
and overwriting is how two correct fixes cancel.

---

## 13. When something "no longer works", check what it is still reading

The overview's heat and warp overlays stopped drawing. Nothing was logged; the
functions ran and returned `""`. They were sizing their grid from the corners
of the photographs at that level — through a per-photo pixel transform that
indoor plans no longer carried after the metric-fabric move. Every input around
them had migrated to metres; the overlay's *extent* had not.

A migration is not done when the new path works. It is done when nothing still
reads the old one — and the surest way to find a straggler is a feature that
silently goes blank. Grep for the old structure (`mapPt`, `mapTransforms`,
`m.receivers`, `groupMaps`) in anything that touches the migrated data, and
guard the finding with a test that names the words.
