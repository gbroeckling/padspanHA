# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""One definition of "this receiver does not count", not four.

A scanner can be masked three ways — `excluded_scanners`, `lost_radios`,
`disabled_radios` — and downstream they mean the same thing: its readings must
not place anything.

There were four implementations. Two were complete. The two that mattered most
were not:

    presence_coordinator, ingestion   lost + disabled      (no excluded)
    websocket, live snapshot          lost + disabled      (no excluded)

So a receiver the user had explicitly excluded — the mask that exists for a
scanner which has physically MOVED, and whose readings are therefore actively
misleading rather than merely absent — went on entering the per-object RSSI
maps and went on assigning rooms in the snapshot. Meanwhile the smoothed-state
purge a few lines further down the same poll was busy removing that very
source, so two halves of one function disagreed about whether the receiver
existed.

This is the third time a rule with more than one implementation has drifted
here (the away rule had nine copies; the light-shape whitelist had two). The
rule now lives beside the away rule in presence_rules, for the same reason.
"""

from __future__ import annotations

from custom_components.padspan_ha.presence_rules import excluded_sources


def test_all_three_masks_count() -> None:
    """The bug, as the assertion that was missing.

    `excluded_scanners` is a list; the other two are dicts keyed by source.
    Shape differences are exactly how one of them got left out.
    """
    out = excluded_sources({
        "excluded_scanners": ["AA:01"],
        "lost_radios": {"AA:02": {"marked_at": "2026-01-01"}},
        "disabled_radios": {"AA:03": {"marked_at": "2026-01-01"}},
    })
    assert out == {"AA:01", "AA:02", "AA:03"}


def test_an_excluded_scanner_is_not_forgotten_when_the_others_are_empty() -> None:
    """The precise shape of the live fault: only `excluded_scanners` set."""
    assert excluded_sources({"excluded_scanners": ["AA:01"]}) == {"AA:01"}


def test_empty_and_missing_settings_are_the_same_answer() -> None:
    """A settings store that has not loaded must not mask everything, or
    nothing — it must mask nothing, and say so without raising."""
    for d in (None, {}, {"excluded_scanners": None, "lost_radios": None,
                         "disabled_radios": None}):
        assert excluded_sources(d) == frozenset()


def test_blank_entries_do_not_become_a_mask_for_the_empty_string() -> None:
    """An empty source id would match every radio whose source failed to read."""
    out = excluded_sources({"excluded_scanners": ["", None, "AA:01"]})
    assert out == {"AA:01"}


def test_ids_are_strings_whatever_the_store_holds() -> None:
    """Sources are compared as strings everywhere downstream."""
    out = excluded_sources({"excluded_scanners": [123], "lost_radios": {456: {}}})
    assert out == {"123", "456"}


def test_the_result_is_immutable() -> None:
    """The coordinator caches this between polls; a caller mutating it would
    change what every later poll considers excluded."""
    out = excluded_sources({"excluded_scanners": ["AA:01"]})
    assert isinstance(out, frozenset)


def test_no_module_rebuilds_the_masking_set() -> None:
    """The guard that stops a fifth copy appearing.

    Hand-listing the call sites is what let the previous copies drift, so this
    looks for the RULE being re-derived rather than for known files.

    It matches the COMBINING pattern specifically — `excluded_scanners` read
    close to `lost_radios` or `disabled_radios` — because that is what building
    the mask looks like, and it is exactly the union the two broken sites were
    missing a third of. Reading the settings individually is legitimate and
    common: the websocket validates `excluded_scanners` in its settings schema,
    writes `lost_radios` in the lost-radio handler, and clears both in a radio
    reset. Those are hundreds of lines apart and are not this rule.
    """
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    # A read that pulls the value out, not a mention in prose.
    def _lines_reading(src: str, key: str) -> set[int]:
        pat = re.compile(r'(get\(\s*["\']%s["\']|\[\s*["\']%s["\']\s*\])' % (key, key))
        return {i for i, ln in enumerate(src.splitlines()) if pat.search(ln)}

    WINDOW = 12
    offenders = []
    for path in sorted(root.glob("*.py")):
        if path.name in ("presence_rules.py", "settings_store.py"):
            continue  # the owner, and the schema that declares the keys
        src = path.read_text(encoding="utf-8")
        excl = _lines_reading(src, "excluded_scanners")
        others = _lines_reading(src, "lost_radios") | _lines_reading(src, "disabled_radios")
        for a in excl:
            near = [b for b in others if abs(a - b) <= WINDOW]
            if near:
                offenders.append(f"{path.name}:{a + 1} (with {[b + 1 for b in near]})")
    assert not offenders, (
        "these sites rebuild the excluded-scanner mask instead of calling "
        "presence_rules.excluded_sources: " + "; ".join(offenders))
