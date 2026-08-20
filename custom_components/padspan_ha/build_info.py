# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Generated at build time. Used to prove what version is actually installed.

BUILD_ID identifies the RELEASE. scripts/release.py rewrites the literal below
by regex, matching on the assignment's exact shape, so its NAME must not change
and no other line in this file may look like that assignment — this sentence
used to quote it, and the release script duly rewrote the prose as well.

ASSET_ID is what the panel URLs actually carry, and it is BUILD_ID plus a
digest of the frontend files. The two used to be the same string, which meant
the cache-buster only moved once per release — so any frontend file that
reached a running install by another route was invisible. A browser holding
`overview.js?b=<last release>` kept serving that copy however many times the
file on disk changed: a fixed view stayed broken, and a broken view could not
be proven fixed. It cost most of a debugging session, because every check that
used a cache-busted import saw the NEW code while the panel ran the OLD one.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

BUILD_VERSION = "0.36.6"
# Which build this is and the tier it is guaranteed without a key. Stamped by
# scripts/release.py: "full"/"free" for PadSpan HA, "bright"/"free" for
# PadSpan Bright. The floor is a constant of the BUILD, never fetched — see
# licence.py. Every copy built carries its own floor and never asks permission.
EDITION = "full"
TIER_FLOOR = "free"
BUILD_ID = "20260820T185622Z"
CHANNEL = "beta"

# Backwards/for convenience
VERSION = BUILD_VERSION

_WWW = Path(__file__).parent / "www"
_ASSET_SUFFIXES = (".js", ".css", ".html")


def _frontend_digest() -> str:
    """Short digest of every served frontend file's identity.

    Path + size + mtime rather than content: this is a cache key, not a
    signature, and stat-ing ~100 small files once at import is cheap. Sorted,
    so it does not depend on directory order, and unchanged across a restart
    that changed nothing — a stamp that moved every boot would defeat caching
    entirely rather than merely breaking it.
    """
    h = hashlib.sha1()
    try:
        for p in sorted(_WWW.rglob("*")):
            if not p.is_file() or p.suffix not in _ASSET_SUFFIXES:
                continue
            st = p.stat()
            h.update(str(p.relative_to(_WWW)).replace("\\", "/").encode("utf-8"))
            h.update(f"{st.st_size}:{int(st.st_mtime)}".encode("ascii"))
    except OSError:
        # An unreadable www tree is a bigger problem than a stale cache, and
        # the panel still has to load. Fall back to the release stamp alone.
        return ""
    return h.hexdigest()[:10]


_DIGEST = _frontend_digest()

#: The cache-buster for panel asset URLs. Use this, not BUILD_ID, in any URL.
ASSET_ID = f"{BUILD_ID}-{_DIGEST}" if _DIGEST else BUILD_ID
