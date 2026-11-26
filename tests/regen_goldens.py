"""Store today's output as the expected output of the exact-output tests.

    python -m tests.regen_goldens                     all parts
    python -m tests.regen_goldens poll                one part (poll, settings, snapshot)
    python -m tests.regen_goldens poll --dump DIR     write every record to DIR instead
                                                      (one JSON line each; nothing stored)

Run it from the repository's top folder. It changes files under
tests/golden/ only, and only those whose content changed. Look at the diff
before committing it: each changed line is a changed output.
"""

from __future__ import annotations

import sys
from pathlib import Path

import tests.conftest  # noqa: F401  (the Home Assistant stand-ins, as under pytest)
from tests import golden_tools as gt
from custom_components.padspan_ha import licence as _licence

# The licence's clock as under pytest (tests/conftest.py _licence_clock_before_dec1): the same day whenever this runs.
_licence._clock = lambda: tests.conftest.LICENCE_TODAY_TS


def _poll(dump: Path | None) -> None:
    from tests import golden_poll as gp
    for name, run in gp.SCENARIOS.items():
        polls = run().polls
        if dump:
            _dump(dump, "poll", name, polls)
            continue
        changed = gt.write_summarised("poll", name, polls, gp.summarise, gp.SAMPLE[name], gp.counts(polls))
        print(f"poll/{name}: {len(polls)} polls, {'stored' if changed else 'unchanged'}")


def _settings(dump: Path | None) -> None:
    from tests import golden_settings as gs
    records = gs.run()
    if dump:
        _dump(dump, "settings", "settings_set", records)
        return
    changed = gt.write_whole("settings", "settings_set", records, gs.counts(records), one_per_line=True)
    print(f"settings/settings_set: {len(records)} cases, {'stored' if changed else 'unchanged'}")


def _snapshot(dump: Path | None) -> None:
    from tests import golden_snapshot as gsn
    records = gsn.run()
    if dump:
        _dump(dump, "snapshot", "builds", records)
        return
    changed = gt.write_whole("snapshot", "builds", records, gsn.counts(records))
    print(f"snapshot/builds: {len(records)} builds, {'stored' if changed else 'unchanged'}")


PARTS = {"poll": _poll, "settings": _settings, "snapshot": _snapshot}


def _dump(folder: Path, part: str, name: str, records: list) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    out = folder / f"{part}.{name}.jsonl"
    out.write_text("\n".join(gt.lines(records)) + "\n", encoding="ascii", newline="\n")
    print(f"wrote {out}")


def main(argv: list[str]) -> int:
    dump = None
    if "--dump" in argv:
        i = argv.index("--dump")
        dump = Path(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    parts = argv or list(PARTS)
    unknown = [p for p in parts if p not in PARTS]
    if unknown:
        print(f"unknown part: {', '.join(unknown)} (parts: {', '.join(PARTS)})")
        return 2
    for p in parts:
        PARTS[p](dump)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
