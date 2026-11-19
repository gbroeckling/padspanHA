# changelog.d — one note per change

Two sessions both writing at the top of `CHANGELOG.md` clash. So each change
gets its own file here instead, and `scripts/release.py` gathers every note
into one `## X.Y.Z — title (date)` section of `CHANGELOG.md` when it releases,
then removes the notes in the same commit. Nobody writes a version number:
the release picks the next free one.

Name a note after the change (`split-levels.md`, `garage-steps.md`). Its shape:

```markdown
# A few steps within a floor

### New
- **A few steps within one floor.** Stairs used to always climb a whole floor…

### Fixed
- **Where a stair goes is stored as a whole floor.** …
```

- The `# ` line is the note's title. A release with several notes joins their
  titles with "; ".
- Headings go in the order New, Changed, Fixed, then any others. Lines before
  any heading count as Changed.
- Write for the people who run PadSpan, as the rest of `CHANGELOG.md` does.

## Thank whoever reported it

When someone reported the problem or asked for the change, end that entry's
line with `thanks @name (#123)`: their GitHub login and the issue or
discussion number.

```markdown
### Fixed
- **Floor plans keep their scale after a restart.** The scale was saved before the plan finished loading. Thanks @name (#123).
```

- The line goes out as written: into `CHANGELOG.md`, the panel's notes, the
  site's What's new and the GitHub release notes, which are what HACS and the
  Home Assistant Marketplace show in the update dialog.
- `@name` only for a real GitHub login: GitHub tells that account when the
  release is published. Someone who reported it elsewhere (the Home Assistant
  forum, Reddit, an email) is thanked by the name they used there, with no
  `@`: `thanks Sam on the Home Assistant forum`. Leave out a name they didn't
  give in public.
- An issue with no one to name gets just the number: `(#123)`.
- Keep it on the entry's own line (the site's What's new takes only the `- `
  lines).

A release with no notes here uses `CHANGELOG.md` as it is (an entry written by
hand still works). Having both a hand-written section for the version and notes
stops the release, so nothing is written twice.
