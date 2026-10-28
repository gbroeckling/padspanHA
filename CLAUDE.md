# Working on PadSpan HA

Several sessions often work on this repository at once, on one computer. To
keep out of each other's way:

- **Work in your own worktree and branch.** The main checkout is shared: touch
  it only to fast-forward it to your branch and run the release.
- **Write the release note as a file in `changelog.d/`** (see
  `changelog.d/README.md`). Never write a numbered section at the top of
  `CHANGELOG.md` yourself; the release makes it.
- **Release with `python -u scripts/release.py next --no-bright`** (betas skip
  Bright). It takes a lock every checkout shares, starts from `origin/main`,
  picks the next free version, gathers the notes, merges anything pushed
  meanwhile and pushes again, then waits for GitHub's checks on the tag. Don't
  say a release is done until those checks are green.
- **Any new third-party import goes into `requirements_test.txt`** in the same
  commit (`tests/test_requirements_declared.py` holds this).
- **A test that calls `release.main()`** stubs `acquire_release_lock`,
  `release_release_lock`, `sync_with_origin`, `_tags`, `gather_notes` and
  `wait_for_ci`.
