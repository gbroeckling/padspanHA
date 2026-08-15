"""The photo rule, enforced across the WHOLE frontend — not one feature at a time.

Garry's rule, stated the way he states it: an uploaded plan has two jobs. You
trace on it once to get shapes into the fabric, and you look at it when you ask
to look at it. It holds NOTHING. Delete every photo in the install and the
software still knows the house.

This rule has been "finished" three times and kept coming back, for one reason:
every pass fixed the instances someone could see, and the enforcement was
written as an ALLOWLIST of files to check. A list of files to check cannot
catch the file nobody thought about — which is exactly how Overview kept
deriving the building's storeys from a photo's alignment for months after the
photo divorce was declared done.

So this is inverted. EVERY view is checked. A file is exempt only if it is
named in _PHOTO_TOOLING below, and each exemption carries the reason it is
allowed. A new view is covered the moment it exists, by default, forever.

_QUARANTINE lists the files known to break the rule while the sweep lands. It
only ever shrinks. When it is empty, delete it, and this file becomes a flat
statement that the frontend does not use photographs for anything.
"""

from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"

# What the rule actually forbids: deriving the BUILDING from a photograph.
#
# Patterns, not substrings, and each one is narrow on purpose. A guard that
# cries wolf is a guard people learn to skip: a plain substring test flagged
# `has_room_bounds` (a diagnostics column about a stored plan), the sentence
# "maps at z_level 0" inside help text, and mapImageUrl() doing the one thing
# photographs ARE for.
#
# Displaying an image on request is deliberately NOT on this list. Images stay
# keyed to the fabric so they can be looked at; that is the sanctioned use.
# NOTE what is absent: simply READING the map list. Reporting that six plans
# are uploaded, dumping them into a diagnostics blob, or finding one by id to
# show its image are all fine — those are the two sanctioned jobs. The sin is
# deriving the building's GEOMETRY from a photo, or refusing to draw without
# one, and the second of those has its own test below.
_FORBIDDEN = {
    "makeStackXform":  r"\bmakeStackXform\b",
    "imageAr":         r"\bimageAr\b",
    "metreAnchor":     r"\bmetreAnchor\b",
    "room_bounds":     r"\broom_bounds\b",
    "map_transforms":  r"\bmap_transforms\b",
    "stack_transform": r"\bstack_transform\b",
    # z_level as a PROPERTY being read, not the words in a help sentence.
    "z_level":         r"""(?:\.|\[["']|["'])z_level\b|\bz_level\s*[:=]""",
}

# Files allowed to touch photographs, and why. Anything not listed here is
# expected to be photo-free. Adding to this list is a deliberate act to be
# argued for in review, not a place to park a failure.
_PHOTO_TOOLING = {
    # Tracing a plan into the fabric IS the legitimate use. This is the editor:
    # upload, trace, align, measure. Photographs are its subject matter.
    "maps.js": "the plan editor — tracing a photo into the fabric",
    # The alignment maths itself. Only the editor should import it.
    "stack_transform.js": "the photo alignment module",
    # The experimental 2D flat map, lifted out of overview.js. Its subject IS
    # the photograph: it draws the uploaded plans and lays rooms over them in
    # image coordinates. That is the sanctioned use — look at the picture when
    # you ask to look at the picture — and separating it is what finally let
    # the house view be certified photo-free.
    "plan_viewer.js": "the plan viewer — shows the uploaded image on request",
    # Repairs room_bounds entries orphaned on old plans. That IS photo upkeep.
    "manage.js": "repairs orphaned room_bounds on stored plans",
    # The app shell. Its remaining mentions are the model's own state shape,
    # loading the model payload the plan editor needs, and the onboarding step
    # "have you measured a plan yet?" — which is a question about setup
    # progress, not about the building. Judged valid and left alone.
    "panel.js": "app shell — state shape, model load, onboarding setup steps",
}

# Files that still break the rule. SHRINKS ONLY. Never add to this.
_QUARANTINE = {
    "calibration.js",  # refuses to render twice without a photo
    "traceback.js",    # refuses to render; derives storeys
    "radio_map.js",    # heatmaps still in photo-fraction space
}


def _code_only(src: str) -> str:
    """Source with comment lines stripped, so prose about the rule is allowed."""
    return chr(10).join(l for l in src.splitlines() if not l.strip().startswith("//"))


def _offences(path: Path) -> list[str]:
    code = _code_only(path.read_text(encoding="utf-8"))
    return [name for name, pat in _FORBIDDEN.items() if re.search(pat, code)]


def _all_view_files() -> dict:
    out = {p.name: p for p in sorted(_VIEWS.glob("*.js"))}
    for extra in ("panel.js", "lights_panel.js"):
        p = _WWW / extra
        if p.exists():
            out[extra] = p
    return out


def test_the_guard_can_actually_fail():
    """A guard that matches nothing passes forever.

    Every pattern is proved against a line that must trip it. This exists
    because sharpening these patterns once broke every one of them at the same
    time, and the suite went green — which looked exactly like success.
    """
    samples = {
        "makeStackXform":  "const t = makeStackXform(stk, ar);",
        "imageAr":         "const a = imageAr(m);",
        "metreAnchor":     "const a = metreAnchor(m);",
        "room_bounds":     "for (const r of m.room_bounds) {}",
        "map_transforms":  "const t = map_transforms[m.id];",
        "stack_transform": 'import { x } from "./stack_transform.js";',
        "z_level":         "const z = m.stack.z_level || 0;",
    }
    assert set(samples) == set(_FORBIDDEN), "a pattern has no proof sample"
    for name, line in samples.items():
        assert re.search(_FORBIDDEN[name], line), f"pattern {name} matches nothing"
    # ...and must NOT fire on the things that are allowed.
    innocent = [
        'el("div", {}, String(m.has_room_bounds))',      # a diagnostics column
        "const imgUrl = ctx.helpers.mapImageUrl(mapData);",  # the viewer
        "text: 'Only maps at z_level 0 (ground level) are eligible'",  # help text
        "const maps = (ctx.state.maps && ctx.state.maps.list) || [];",  # reporting
        "pass: maps.length > 0, detail: `${maps.length} maps`",          # a QA row
    ]
    for line in innocent:
        hits = [n for n, p in _FORBIDDEN.items() if re.search(p, line)]
        assert not hits, f"{hits} fires on innocent code: {line}"


def test_no_view_outside_the_plan_editor_reads_a_photograph():
    """The rule itself. Every file, every release, no list to keep updated."""
    files = _all_view_files()
    assert len(files) >= 20, (
        "the view sweep found only {} files — the glob is wrong, and a guard "
        "that scans nothing passes forever: {}".format(len(files), sorted(files))
    )
    broken = {}
    for name, path in files.items():
        if name in _PHOTO_TOOLING or name in _QUARANTINE:
            continue
        bad = _offences(path)
        if bad:
            broken[name] = bad
    assert not broken, (
        "these files read a photograph and are not the plan editor: {}\n"
        "The fabric is the truth. Build the frame with fabricFrame() from "
        "iso_lights.js — it is exported, it is what the lights map draws "
        "with, and it needs no photo to exist.".format(broken)
    )


def test_the_quarantine_only_shrinks():
    """A file that has been swept must never quietly re-enter quarantine.

    This is the test that makes the job finishable. Every previous pass ended
    with someone believing it was done; this one ends when the set is empty,
    and cannot be declared done before then.
    """
    files = _all_view_files()
    stale = sorted(n for n in _QUARANTINE if n not in files)
    assert not stale, f"quarantine names files that no longer exist: {stale}"
    clean = sorted(n for n in _QUARANTINE if not _offences(files[n]))
    assert not clean, (
        "these files no longer break the rule — remove them from _QUARANTINE "
        "so they stay fixed: {}".format(clean)
    )


def test_a_house_with_no_photographs_is_still_a_house():
    """The rule as an executable sentence.

    No view outside the plan editor may refuse to render because the map list
    is empty. This single assertion is the one that would have caught all of
    it: Overview, calibration and traceback each bail to a placeholder when
    nobody has uploaded a picture, however complete the fabric is.
    """
    files = _all_view_files()
    bail = re.compile(r"if\s*\(\s*!?\s*(?:maps_list|maps\.list)[^)]{0,40}\.length")
    refuses = {}
    for name, path in files.items():
        if name in _PHOTO_TOOLING or name in _QUARANTINE:
            continue
        hits = bail.findall(_code_only(path.read_text(encoding="utf-8")))
        if hits:
            refuses[name] = len(hits)
    assert not refuses, (
        "these views refuse to draw when no photo has been uploaded: {}\n"
        "A house with rooms, floors and scanners in the fabric is a house.".format(refuses)
    )
