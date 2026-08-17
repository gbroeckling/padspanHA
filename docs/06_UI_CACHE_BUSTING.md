# UI Cache Busting

Home Assistant serves custom panel JS/CSS aggressively cached by browsers, so
every panel asset URL carries a stamp. Getting that stamp wrong does not look
like a caching problem — it looks like your code not working.

## How it works now

| Symbol | Where | Meaning |
|---|---|---|
| `BUILD_VERSION` | `build_info.py` | semver, shown in the sidebar and Diagnostics |
| `BUILD_ID` | `build_info.py` | the **release** stamp, rewritten by `scripts/release.py` |
| `ASSET_ID` | `build_info.py` | `BUILD_ID` + a digest of the frontend tree — **this is what URLs carry** |

The chain:

1. `build_info._frontend_digest()` walks `www/` and hashes every `.js` / `.css`
   / `.html` file's path, size and mtime. Sorted, so it does not depend on
   directory order; stable across a restart that changed nothing.
2. `ASSET_ID = f"{BUILD_ID}-{digest}"`.
3. `panel.py` registers the panel with `?v=<VERSION>&b=<ASSET_ID>`.
4. `panel.js` reads the `b` parameter **off its own `import.meta.url`** and
   uses it for every view import and for `styles.css`.

So one stamp flows from the files on disk all the way to every view URL, and it
moves whenever any frontend file moves.

## The bug this replaced (2026-08-16)

`BUILD_ID` was a hard-coded literal and `panel.js` had its own copy of the same
literal. Both changed exactly once per release. Any frontend file that reached
a running install by another route — an `scp` during development, a manual
copy, a patched file — was **invisible**:

```
overview.js?b=20260816T234608Z    ← the browser keeps serving this
```

...no matter how many times `overview.js` changed on disk, and no matter how
many times Home Assistant restarted.

It cost most of a debugging session. A fix was deployed, verified as present on
disk, and the panel went on running the old code — because every verification
used a cache-busted `import("...?cb=" + Date.now())`, which bypassed the cache
and showed the NEW file while the panel ran the OLD one. A view was "fixed"
four separate times before anyone looked at the `?b=` in the console stack
trace and noticed it had not moved all day.

**Rule: never verify a frontend change with a cache-busted import.** That
proves the file is on disk, which was never in doubt. Read the `?b=` stamp in
the browser's network tab or in a console stack trace, and confirm it changed.

## For maintainers

- `scripts/release.py` regex-replaces `BUILD_ID = "..."` in `build_info.py` and
  `const BUILD_ID = "..."` in `panel.js`. **Do not rename those symbols** — the
  regexes are positional and a rename fails silently, freezing the stamp
  forever. `panel.js` keeps its literal as `RELEASE_BUILD_ID` only as the
  fallback for loading the module directly, outside the panel.
- The digest uses mtime, so copying a file with an unchanged mtime (`cp -p`,
  some rsync flags) will not bust the cache. Use a plain copy.

## If you still see old UI

1. Check the `?b=` stamp on `panel.js` and on a view in the Network tab. If it
   has not changed since your edit, the problem is the stamp, not your browser.
2. Restart Home Assistant — `ASSET_ID` is computed at module import.
3. Hard refresh (Ctrl+F5) only after the above; it treats the symptom.
4. Confirm the build stamp in Diagnostics.
