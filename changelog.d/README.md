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

A release with no notes here uses `CHANGELOG.md` as it is (an entry written by
hand still works). Having both a hand-written section for the version and notes
stops the release, so nothing is written twice.
