#!/usr/bin/env python3
"""pad.traks.ca: take one upload from the Mac's markers_export.py and file it in the archive, as root.

    ssh bcmail sudo -n /usr/bin/python3 /usr/local/lib/pad-digest/pad_put.py <name>   < file.json

Only these names are taken, all inside /var/lib/pad-archive/ (root only):
    markers.json   github/stars.json   github-traffic/YYYY-MM-DD.json
The upload must be JSON of the expected shape and under 2 MB. Strings lose any email address or IP
(pad_digest.scrub). It's written with pad_digest's safe write: mkstemp in the root-owned directory,
mode set on the open descriptor, synced, renamed. Nothing is staged in /tmp or any shared directory.
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pad_digest as P  # noqa: E402

MAX_BYTES = 2 * 1024 * 1024
NAMES = {
    re.compile(r"markers\.json"): dict,
    re.compile(r"github/stars\.json"): list,
    re.compile(r"github-traffic/\d{4}-\d{2}-\d{2}\.json"): dict,
}


def check_name(name):
    for pat, kind in NAMES.items():
        if pat.fullmatch(name):
            return kind
    raise ValueError(f"not an archive name: {name!r}")


def put(archive, name, raw):
    kind = check_name(name)
    if len(raw) > MAX_BYTES:
        raise ValueError("too large")
    obj = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    if not isinstance(obj, kind):
        raise ValueError(f"{name}: expected a JSON {kind.__name__}")
    obj = P.scrub(obj)
    P.write_json(os.path.join(archive, name), obj, 0o600)
    return name


def main(argv=None, stdin=None, archive=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: pad_put.py <name> < file.json", file=sys.stderr)
        return 2
    raw = (stdin or sys.stdin.buffer).read(MAX_BYTES + 1)
    try:
        put(archive or P.DEFAULTS["archive"], argv[0], raw)
    except Exception as e:
        print(f"pad_put refused {argv[0]!r}: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
