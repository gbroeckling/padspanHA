# Working on PadSpan HA

Several sessions often work on this repository at once, on one computer. To
keep out of each other's way:

- **Work in your own worktree and branch.** The main checkout is shared: touch
  it only to fast-forward it to your branch and run the release.
- **Write the release note as a file in `changelog.d/`** (see
  `changelog.d/README.md`). Never write a numbered section at the top of
  `CHANGELOG.md` yourself; the release makes it.
- **Release with `python -u scripts/release.py next --no-bright`** (betas skip
  Bright). It takes a lock every checkout shares and holds it to the end,
  starts from `origin/main`, stops if an earlier release is still a draft that
  could be published, picks the next free version, gathers the notes, merges
  anything pushed meanwhile and pushes again. Then it makes the GitHub release
  as a **draft**, waits for GitHub's checks on the tag (about twelve minutes;
  it says what it is waiting for), and only when every check is green
  publishes the release and then tells the update check. Don't say a release
  is done until the script has exited 0.
- **Exit 4 means not released**: a check was red, or the checks had not
  finished after 30 minutes. The release stays a draft, which no install is
  offered, and the update check was not told. Then either fix it and release
  the next version (that release says the draft is there and goes ahead), or
  give the version up with `python scripts/release.py X.Y.Z --abandon`
  (deletes the draft and the tag). If the checks were only late, a failed one
  was run again, or the run was interrupted: `python -u scripts/release.py
  X.Y.Z --finish --no-bright` publishes the draft once its checks are green.
- **Any new third-party import goes into `requirements_test.txt`** in the same
  commit (`tests/test_requirements_declared.py` holds this).
- **A test that calls `release.main()`** stubs `acquire_release_lock`,
  `release_release_lock`, `sync_with_origin`, `stop_for_unpublished_draft`,
  `_tags`, `gather_notes`, `wait_for_ci` and `publish_github_release`.
