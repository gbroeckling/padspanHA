# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P4: the shared furniture library's server, server/furniture_library.php.

There is no PHP where these tests run, so the server is ported to Python
below, line for line, reading its lists and patterns out of the PHP source
itself (as tests/test_tester.py does for tester.php), and the fixtures in
tests/fixtures/furniture_library/ run against the port. The same fixtures run
against the install's own checks (tests/test_house3d_library.py) and the
details sheet in the browser (tests/js/live_aboard_library.mjs), so the three
copies of the rules answer alike. Change furniture_library.php, change
_Library. Before deploying, `php -l` the file on the server.

Held here, the server's half of the plan's "Done when" for P4: a share keeps
only the recipe, the details sheet and its own bookkeeping, and refuses
anything outside them; a piece missing a required detail is refused; free
text with an email address, a phone number, a street address or a web
address is refused; every filter and sort returns the right pieces on a
seeded library; near-identical pieces show as one; a withdrawal deletes and
logs only the id and the time; only the owner token changes or withdraws a
piece; three houses' reports hide the free text; the limits per day and in
total hold; the owner's tools need the secret file; and the script never
reads who is asking.
"""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import math
import re
import secrets
from collections import Counter
from functools import cmp_to_key
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PHP = _ROOT / "server" / "furniture_library.php"
_FIX = Path(__file__).parent / "fixtures" / "furniture_library"
_SAY = ("control", "secret", "email", "url", "phone", "address", "word")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")
_CANON = re.compile(r"(?:0|-?[1-9][0-9]*)")
_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def _fixture(name: str):
    return json.loads((_FIX / name).read_text(encoding="utf-8"))


def _php() -> str:
    if not _PHP.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    return _PHP.read_text(encoding="utf-8")


# ── reading the PHP source ───────────────────────────────────────────────────

def _unq(s: str) -> str:
    return s.replace("\\'", "'")


def _block(src: str, name: str) -> str:
    m = re.search(rf"^\${name} = array\((.*?)\);\n", src, re.S | re.M)
    assert m, f"${name} is gone from furniture_library.php"
    return m.group(1)


def _php_list(src: str, name: str) -> list[str]:
    return [_unq(x) for x in re.findall(r"'((?:[^'\\]|\\.)*)'", _block(src, name))]


def _php_int(src: str, name: str) -> int:
    m = re.search(rf"^\${name} = (\d+);", src, re.M)
    assert m, f"${name} is gone from furniture_library.php"
    return int(m.group(1))


def _php_pairs(src: str, name: str) -> dict[str, tuple[int, int]]:
    return {k: (int(a), int(b)) for k, a, b in re.findall(r"'(\w+)' => array\((\d+), (\d+)\)", _block(src, name))}


def _php_patterns(src: str, name: str) -> list[tuple[str, str]]:
    m = re.search(rf"^\${name} = array\((.*?)\n\);", src, re.S | re.M)
    assert m, f"${name} is gone from furniture_library.php"
    return [(k, _unq(v)) for k, v in re.findall(r"'([^']*)' => '((?:[^'\\]|\\.)*)'", m.group(1))]


def _php_string(src: str, name: str) -> str:
    m = re.search(rf"^\${name} = '((?:[^'\\]|\\.)*)';", src, re.M)
    assert m, f"${name} is gone from furniture_library.php"
    return _unq(m.group(1))


def _split(delimited: str) -> tuple[str, str]:
    """'/body/flags' -> (body, flags)."""
    d = delimited[0]
    end = delimited.rindex(d)
    return delimited[1:end], delimited[end + 1:]


def _search_rx(delimited: str) -> re.Pattern:
    """An unanchored PHP pattern, with the same ASCII rules (no /u)."""
    body, flags = _split(delimited)
    assert set(flags) <= {"i"}, delimited
    return re.compile(body, re.ASCII | (re.IGNORECASE if "i" in flags else 0))


def _full_rx(delimited: str) -> re.Pattern:
    """'/^core$/D' -> core, for fullmatch."""
    body, flags = _split(delimited)
    assert flags == "D" and body.startswith("^") and body.endswith("$"), delimited
    return re.compile(body[1:-1], re.ASCII)


# ── PHP's ways with JSON values ──────────────────────────────────────────────

def _php_key(k):
    """json_decode(…, true) makes a canonical decimal key an int."""
    return int(k) if isinstance(k, str) and _CANON.fullmatch(k) and -2**63 <= int(k) < 2**63 else k


def _is_list(v) -> bool:
    if isinstance(v, list):
        return True
    return isinstance(v, dict) and [_php_key(k) for k in v] == list(range(len(v)))


def _is_obj(v) -> bool:
    if isinstance(v, list):
        return not v
    return isinstance(v, dict) and (not v or [_php_key(k) for k in v] != list(range(len(v))))


def _values(v) -> list:
    return list(v.values()) if isinstance(v, dict) else list(v)


def _num(v) -> bool:
    if type(v) not in (int, float):
        return False
    try:
        return math.isfinite(float(v))
    except OverflowError:
        return False


def _count_in(v, lo: int, hi: int) -> bool:
    return type(v) is int and lo <= v <= hi


def _lower(s: str) -> str:
    return s.translate(_ASCII_LOWER)


def _trim(s: str) -> str:
    return s.strip(" \t\n\r\0\x0b")


def _cmp(a, b) -> int:
    return -1 if a < b else (1 if a > b else 0)


def _strcmp(a: str, b: str) -> int:
    return _cmp(a.encode("utf-8"), b.encode("utf-8"))


def _bin(v) -> str:
    return str(int(math.floor(v * 10 + 0.5)))


def _bin_color(c: str) -> str:
    return ".".join(str(int(c[j:j + 2], 16) >> 5) for j in (1, 3, 5))


class _Library:
    """server/furniture_library.php in Python, line for line. Its lists and
    patterns are read out of the PHP source, so the port runs the server's own
    rules; the logic below mirrors the PHP control flow (keep it so)."""

    def __init__(self, src: str):
        lst = lambda n: _php_list(src, n)   # noqa: E731
        self.categories, self.rooms, self.styles = lst("CATEGORIES"), lst("ROOMS"), lst("STYLES")
        self.materials, self.color_families = lst("MATERIALS"), lst("COLOR_FAMILIES")
        self.size_classes, self.bed_sizes, self.features = lst("SIZE_CLASSES"), lst("BED_SIZES"), lst("FEATURES")
        self.fixtures, self.forms, self.sorts = lst("FIXTURES"), lst("FORMS"), lst("SORTS")
        self.reasons, self.admin_ops = lst("REASONS"), lst("ADMIN_OPS")
        self.recipe_keys, self.detail_keys, self.required = lst("RECIPE_KEYS"), lst("DETAIL_KEYS"), lst("REQUIRED")
        self.filter_keys, self.words = lst("FILTER_KEYS"), lst("WORDS")
        self.counts, self.text = _php_pairs(src, "COUNTS"), _php_pairs(src, "TEXT")
        block = re.search(r"^\$ACTION_KEYS = array\((.*?)\n\);", src, re.S | re.M).group(1)
        self.action_keys = {a: re.findall(r"'(\w+)'", body)
                            for a, body in re.findall(r"'(\w+)' => array\(([^)]*)\)", block)}
        for n in ("MAX", "MAX_ENTRIES", "MAX_NEW_PER_DAY", "MAX_NEW_PER_PREFIX", "MAX_REPORTS_PER_DAY",
                  "MAX_PLACED_PER_DAY", "HIDE_AT", "MAX_REPORTERS", "PAGE_MAX", "PAGE_DEFAULT", "MAX_WITHDRAW",
                  "MAX_PARAMS", "MAX_COLORS", "MAX_TEXT"):
            setattr(self, n.lower(), _php_int(src, n))
        flt = lambda n: float(re.search(rf"^\${n} = ([\d.]+);", src, re.M).group(1))   # noqa: E731
        self.fit_margin, self.dim_min, self.dim_max = flt("FIT_MARGIN_M"), flt("DIM_MIN_M"), flt("DIM_MAX_M")
        full = lambda n: _full_rx(_php_string(src, n))   # noqa: E731
        self.kind_rx, self.param_key_rx, self.param_str_rx = full("KIND_RX"), full("PARAM_KEY_RX"), full("PARAM_STR_RX")
        self.color_rx, self.sub_rx, self.token_rx = full("COLOR_RX"), full("SUB_RX"), full("TOKEN_RX")
        self.lib_rx, self.prefix_rx, self.version_rx = full("LIB_RX"), full("PREFIX_RX"), full("VERSION_RX")
        self.secrets = [(w, _search_rx(p)) for w, p in _php_patterns(src, "SECRETS")]
        self.personal = [(w, _search_rx(p)) for w, p in _php_patterns(src, "PERSONAL")]
        self.word_rx = re.compile(r"\b(?:" + "|".join(self.words) + r")\b", re.ASCII | re.IGNORECASE)
        self.db: dict = {"entries": {}, "guard": {}}
        self.withdrawals: list[dict] = []
        self.removals: list[dict] = []
        self.admin_secret: str | None = None      # private/…/admin_secret.txt, or None: no file
        self.corrupt = False                      # library.json cannot be read
        self.today, self.now = "2026-10-04", "2026-10-04T12:00:00+00:00"

    # ── the checks ──
    def text_problem(self, s: str) -> str:
        if _CTRL.search(s):
            return "control"
        for _what, rx in self.secrets:
            if rx.search(s):
                return "secret"
        for what, rx in self.personal:
            if rx.search(s):
                return what
        if self.word_rx.search(s):
            return "word"
        return ""

    def set_of(self, v, lst: list[str], mn: int):
        if not _is_list(v) or len(v) < mn or len(v) > len(lst):
            return None
        vals = _values(v)
        if any(not isinstance(x, str) or x not in lst for x in vals):
            return None
        if len(set(vals)) != len(vals):
            return None
        return [x for x in lst if x in vals]

    def check_details(self, d, kind):
        if not _is_obj(d):
            return None, "details", "value"
        d = {} if isinstance(d, list) else d
        for k in d:
            if k not in self.detail_keys:
                return None, str(k), "key"
        for k in self.required:
            v = d.get(k)
            if k not in d or v is None or (isinstance(v, str) and v == "") or (isinstance(v, (list, dict)) and not v):
                return None, k, "missing"
        lists = {"category": self.categories, "style": self.styles, "material": self.materials,
                 "color_family": self.color_families, "size_class": self.size_classes, "bed_size": self.bed_sizes,
                 "fixture": self.fixtures, "form": self.forms}
        out: dict = {}
        for k in self.detail_keys:
            if k not in d:
                continue
            v = d[k]
            if k in lists:
                if not isinstance(v, str) or v not in lists[k]:
                    return None, k, "value"
                out[k] = v
            elif k == "kind":
                if not isinstance(v, str) or (v != kind and v != "other"):
                    return None, k, "value"
                out[k] = v
            elif k in ("rooms", "features"):
                s = self.set_of(v, self.rooms if k == "rooms" else self.features, 1 if k == "rooms" else 0)
                if s is None:
                    return None, k, "value"
                out[k] = s
            elif k in self.counts:
                if not _count_in(v, *self.counts[k]):
                    return None, k, "value"
                out[k] = v
            elif k in self.text:
                if not isinstance(v, str):
                    return None, k, "value"
                t = _trim(v)
                if t == "":
                    continue
                lo, hi = self.text[k]
                if not lo <= len(t) <= hi:
                    return None, k, "length"
                p = self.text_problem(t)
                if p:
                    return None, k, p
                out[k] = t
            else:
                if not isinstance(v, bool):
                    return None, k, "value"
                out[k] = v
        return out, "", ""

    def check_recipe(self, r):
        if not _is_obj(r) or not r:
            return None, None, "recipe", "value"
        for k in r:
            if k not in self.recipe_keys:
                return None, None, str(k), "key"
        kind = r.get("kind")
        if not isinstance(kind, str) or not self.kind_rx.fullmatch(kind):
            return None, None, "kind", "value"
        p = r["params"] if "params" in r else {}
        if not _is_obj(p) or len(p) > self.max_params:
            return None, None, "params", "value"
        p = {} if isinstance(p, list) else p
        for k, v in p.items():
            if not isinstance(_php_key(k), str) or not self.param_key_rx.fullmatch(k):
                return None, None, "params", "key"
            fine = (isinstance(v, bool) or (_num(v) and abs(v) <= 1000)
                    or (isinstance(v, str) and self.param_str_rx.fullmatch(v) is not None))
            if not fine:
                return None, None, "params", "value"
        c = r.get("colors")
        if not _is_list(c) or not 1 <= len(c) <= self.max_colors:
            return None, None, "colors", "value"
        colors = []
        for x in _values(c):
            if not isinstance(x, str) or not self.color_rx.fullmatch(_lower(x)):
                return None, None, "colors", "value"
            colors.append(_lower(x))
        out = {"kind": kind, "params": p, "colors": colors}
        for k in ("width_m", "depth_m", "height_m"):
            v = r.get(k)
            if not _num(v) or v < self.dim_min or v > self.dim_max:
                return None, None, k, "value"
            out[k] = v
        if "details" not in r:
            return None, None, "details", "missing"
        details, field, problem = self.check_details(r["details"], kind)
        if details is None:
            return None, None, field, problem
        return out, details, "", ""

    def check_filters(self, f):
        if not _is_obj(f):
            return None, "filters"
        f = {} if isinstance(f, list) else f
        lists = {"category": self.categories, "room": self.rooms, "style": self.styles, "material": self.materials,
                 "color_family": self.color_families, "size_class": self.size_classes}
        out: dict = {}
        for k, v in f.items():
            if k not in self.filter_keys:
                return None, str(k)
            if k in lists:
                if not isinstance(v, str) or v not in lists[k]:
                    return None, k
            elif k == "kind":
                if not isinstance(v, str) or not self.kind_rx.fullmatch(v):
                    return None, k
            elif k == "seats":
                if not _count_in(v, 1, 8):
                    return None, k
            elif k == "features":
                if self.set_of(v, self.features, 1) is None:
                    return None, k
            elif k == "outdoor":
                if not isinstance(v, bool):
                    return None, k
            else:
                if not _is_obj(v) or len(v) != 2 or v.get("width_m") is None or v.get("depth_m") is None:
                    return None, k
                for m in ("width_m", "depth_m"):
                    if not _num(v[m]) or v[m] < 0.05 or v[m] > 100:
                        return None, k
            out[k] = v
        return out, ""

    def guard_today(self, g):
        if not isinstance(g, dict) or g.get("day") != self.today:
            g = {"day": self.today, "new": 0, "prefixes": {}, "reports": 0, "placed": 0}
        return g

    # ── grouping, filtering, sorting ──
    def signature(self, e) -> str:
        r = e["recipe"]
        parts = [r["kind"], _bin(r["width_m"]), _bin(r["depth_m"]), _bin(r["height_m"])]
        for k, v in sorted(r["params"].items(), key=lambda kv: kv[0].encode("utf-8")):
            if isinstance(v, bool):
                parts.append(f"{k}={'yes' if v else 'no'}")
            elif isinstance(v, str):
                parts.append(f"{k}={v}")
            else:
                parts.append(f"{k}={_bin(v)}")
        parts += [_bin_color(c) for c in r["colors"]]
        return "|".join(parts)

    @staticmethod
    def dist(a, b) -> float:
        s = 0.0
        for k in ("width_m", "depth_m", "height_m"):
            s += abs(a["recipe"][k] - b["recipe"][k])
        for i, c in enumerate(a["recipe"]["colors"]):
            o = b["recipe"]["colors"][i]
            for j in (1, 3, 5):
                s += abs(int(c[j:j + 2], 16) - int(o[j:j + 2], 16)) / 765.0
        return s

    @staticmethod
    def mode_of(vals):
        count: dict = {}
        first: dict = {}
        for v in vals:
            key = json.dumps(v, separators=(",", ":"))
            if key not in count:
                count[key], first[key] = 0, v
            count[key] += 1
        best, best_n = None, 0
        for key, n in count.items():
            if n > best_n:
                best_n, best = n, key
        return first[best]

    def group_view(self, members):
        members = sorted(members, key=cmp_to_key(lambda a, b: _strcmp(a["created"], b["created"])
                                                 or _strcmp(a["id"], b["id"])))
        n, best = len(members), 0
        if n > 1:
            best_sum = math.inf
            for i in range(n):
                s = 0.0
                for j in range(n):
                    if i != j:
                        s += self.dist(members[i], members[j])
                if s < best_sum:
                    best_sum, best = s, i
        details: dict = {}
        for k in self.detail_keys:
            if k == "checked":
                continue
            vals = [m["details"][k] for m in members
                    if not (k in self.text and m.get("hidden")) and k in m["details"]]
            if vals:
                details[k] = self.mode_of(vals)
        checked = any(bool(m["details"].get("checked")) for m in members)
        houses = sum(1 + int(m["placed"]) for m in members)
        created = ""
        for m in members:
            if _strcmp(m["created"], created) > 0:
                created = m["created"]
        details["checked"] = checked
        recipe = dict(members[best]["recipe"])
        recipe["details"] = details
        return {"library_id": members[best]["id"], "recipe": recipe, "houses": houses, "copies": n,
                "checked": checked, "created": created, "members": [m["id"] for m in members]}

    def groups(self, entries: dict) -> list[dict]:
        by: dict = {}
        for e in entries.values():
            by.setdefault(self.signature(e), []).append(e)
        return [self.group_view(m) for m in by.values()]

    def leftover(self, r, fits):
        w, d = r["width_m"] + self.fit_margin, r["depth_m"] + self.fit_margin
        W, D = fits["width_m"], fits["depth_m"]
        if (w <= W and d <= D) or (d <= W and w <= D):
            return W * D - r["width_m"] * r["depth_m"]
        return None

    @staticmethod
    def words_of(s: str) -> list[str]:
        s = _trim(_lower(s).replace("-", " ").replace("_", " "))
        return [] if s == "" else re.split(r"\s+", s, flags=re.ASCII)

    def haystack(self, g) -> str:
        d = g["recipe"]["details"]
        parts = [d[k] for k in ("title", "brand", "model", "kind", "style", "material") if d.get(k) is not None]
        return " ".join(self.words_of(" ".join(parts)))

    def matches(self, g, f, words) -> bool:
        d = g["recipe"]["details"]
        for k in ("category", "kind", "style", "material", "color_family", "size_class", "seats"):
            if k in f and (d.get(k) is None or d[k] != f[k]):
                return False
        if "room" in f:
            rooms = d.get("rooms") or []
            if f["room"] not in rooms and "any" not in rooms:
                return False
        if "features" in f:
            have = d.get("features") or []
            if any(x not in have for x in _values(f["features"])):
                return False
        if "outdoor" in f:
            o = d["outdoor"] if d.get("outdoor") is not None else False
            if o is not f["outdoor"]:
                return False
        if "fits" in f and self.leftover(g["recipe"], f["fits"]) is None:
            return False
        if words:
            hay = " " + self.haystack(g) + " "
            if any(w not in hay for w in words):
                return False
        return True

    def name_of(self, g) -> str:
        d = g["recipe"]["details"]
        return _lower(d["title"] if d.get("title") is not None else g["recipe"]["kind"].replace("_", " "))

    def cmp_groups(self, a, b, sort, fits) -> int:
        if sort == "placed":
            c = _cmp(b["houses"], a["houses"])
            if c == 0:
                c = _strcmp(b["created"], a["created"])
        elif sort == "newest":
            c = _strcmp(b["created"], a["created"])
        elif sort == "size":
            c = _cmp(a["recipe"]["width_m"] * a["recipe"]["depth_m"], b["recipe"]["width_m"] * b["recipe"]["depth_m"])
            if c == 0:
                c = _cmp(a["recipe"]["height_m"], b["recipe"]["height_m"])
        elif sort == "name":
            c = _strcmp(self.name_of(a), self.name_of(b))
        else:
            c = _cmp(self.leftover(a["recipe"], fits), self.leftover(b["recipe"], fits))
        if c == 0:
            c = _cmp(1 if b["checked"] else 0, 1 if a["checked"] else 0)
        return c if c != 0 else _strcmp(a["library_id"], b["library_id"])

    @staticmethod
    def public_view(g) -> dict:
        return {"library_id": g["library_id"], "recipe": g["recipe"], "houses": g["houses"],
                "copies": g["copies"], "checked": g["checked"], "created": g["created"]}

    def admin_ok(self, given) -> bool:
        s = _trim(self.admin_secret) if self.admin_secret is not None else ""
        return len(s.encode("utf-8")) >= 24 and isinstance(given, str) and hmac.compare_digest(
            s.encode("utf-8"), given.encode("utf-8"))

    # ── a request ──
    def handle(self, raw: bytes, method: str = "POST") -> tuple[int, dict]:   # noqa: C901 — mirrors the PHP
        def reply(code, why="", **more):
            out = {"ok": code == 200}
            if why:
                out["why"] = why
            out.update(more)
            return code, out

        if method != "POST":
            return reply(405, "method")
        if len(raw) > self.max:
            return reply(413, "size")
        try:
            r = json.loads(raw.decode("utf-8"))
            json.dumps(r, ensure_ascii=False).encode("utf-8")   # json_decode refuses a lone surrogate
        except (ValueError, UnicodeError):
            return reply(400, "json")
        if not isinstance(r, dict):
            return reply(400, "json")
        if not (type(r.get("schema")) is int and r["schema"] == 1):
            return reply(400, "schema")
        action = r["action"] if isinstance(r.get("action"), str) else ""
        if action not in self.action_keys:
            return reply(400, "action")
        for k in r:
            if k not in self.action_keys[action]:
                return reply(400, "key")
        entries = self.db["entries"]

        if action == "search":
            text = r["text"] if "text" in r else ""
            if not isinstance(text, str) or len(text) > self.max_text or _CTRL.search(text):
                return reply(400, "text")
            f, bad = self.check_filters(r["filters"] if "filters" in r else [])
            if f is None:
                return reply(400, "filter", field=bad)
            sort = r["sort"] if "sort" in r else "placed"
            if not isinstance(sort, str) or sort not in self.sorts or (sort == "fit" and "fits" not in f):
                return reply(400, "sort")
            offset = r["offset"] if "offset" in r else 0
            limit = r["limit"] if "limit" in r else self.page_default
            if not _count_in(offset, 0, self.max_entries) or not _count_in(limit, 1, self.page_max):
                return reply(400, "page")
            if self.corrupt:
                return reply(500, "store")
            words = self.words_of(text)
            found = [g for g in self.groups(entries) if self.matches(g, f, words)]
            fits = f.get("fits")
            found.sort(key=cmp_to_key(lambda a, b: self.cmp_groups(a, b, sort, fits)))
            return reply(200, total=len(found),
                         entries=[self.public_view(g) for g in found[offset:offset + limit]])

        if action == "get":
            lid = r["library_id"] if isinstance(r.get("library_id"), str) else ""
            if not self.lib_rx.fullmatch(lid):
                return reply(400, "id")
            placed = r["placed"] if "placed" in r else False
            if not isinstance(placed, bool):
                return reply(400, "placed")
            if placed and not self.corrupt and lid in entries:
                g = self.guard_today(self.db["guard"])
                if int(g["placed"]) < self.max_placed_per_day:
                    g["placed"] = int(g["placed"]) + 1
                    self.db["guard"] = g
                    entries[lid]["placed"] = int(entries[lid]["placed"]) + 1
            if self.corrupt:
                return reply(500, "store")
            for g in self.groups(entries):
                if lid in g["members"]:
                    return reply(200, entry=self.public_view(g))
            return reply(404, "not_found")

        if action == "share":
            sid = r["submission_id"] if isinstance(r.get("submission_id"), str) else ""
            if not self.sub_rx.fullmatch(sid):
                return reply(400, "id")
            tok = r["owner_token"] if isinstance(r.get("owner_token"), str) else ""
            if not self.token_rx.fullmatch(tok):
                return reply(400, "token")
            tv = r.get("terms_version")
            if not _count_in(tv, 1, 1000):
                return reply(400, "terms")
            version = ""
            if "version" in r:
                if not isinstance(r["version"], str) or not self.version_rx.fullmatch(r["version"]):
                    return reply(400, "version")
                version = r["version"]
            recipe, details, field, problem = self.check_recipe(r.get("recipe"))
            if recipe is None:
                return reply(400, "text" if problem in _SAY else "details", field=field, problem=problem)
            h = hashlib.sha256(tok.encode("utf-8")).hexdigest()
            prefix = sid[4:10]
            if self.corrupt:
                return reply(500, "store")
            for lid, e in entries.items():
                if e["submission_id"] != sid:
                    continue
                if not hmac.compare_digest(e["owner_hash"], h):
                    return reply(403, "owner")
                if details["kind"] != e["recipe"]["kind"] and details["kind"] != "other":
                    return reply(400, "details", field="kind", problem="value")
                e.update(details=details, terms_version=tv, version=version, updated=self.now)
                return reply(200, library_id=lid, edited=True)
            if len(entries) >= self.max_entries:
                return reply(503, "full")
            g = self.guard_today(self.db["guard"])
            mine = int(g["prefixes"].get(prefix, 0))
            if int(g["new"]) >= self.max_new_per_day or mine >= self.max_new_per_prefix:
                return reply(429, "busy")
            g["new"] = int(g["new"]) + 1
            g["prefixes"][prefix] = mine + 1
            self.db["guard"] = g
            lid = "lib_" + secrets.token_hex(6)
            while lid in entries:
                lid = "lib_" + secrets.token_hex(6)
            entries[lid] = {"id": lid, "submission_id": sid, "owner_hash": h, "recipe": recipe, "details": details,
                            "version": version, "terms_version": tv, "created": self.now, "updated": self.now,
                            "placed": 0, "reports": {}, "hidden": False}
            return reply(200, library_id=lid, edited=False)

        if action == "withdraw":
            items = r.get("items")
            if not _is_list(items) or not 1 <= len(items) <= self.max_withdraw:
                return reply(400, "items")
            want: dict = {}
            for it in _values(items):
                if (not _is_obj(it) or len(it) != 2 or it.get("submission_id") is None
                        or it.get("owner_token") is None
                        or not isinstance(it["submission_id"], str) or not self.sub_rx.fullmatch(it["submission_id"])
                        or not isinstance(it["owner_token"], str) or not self.token_rx.fullmatch(it["owner_token"])):
                    return reply(400, "items")
                want[it["submission_id"]] = hashlib.sha256(it["owner_token"].encode("utf-8")).hexdigest()
            if self.corrupt:
                return reply(500, "store")
            gone, refused = [], []
            for lid, e in list(entries.items()):
                if e["submission_id"] not in want:
                    continue
                if hmac.compare_digest(e["owner_hash"], want[e["submission_id"]]):
                    del entries[lid]
                    gone.append(e["submission_id"])
                else:
                    refused.append(e["submission_id"])
            for sid in gone:
                self.withdrawals.append({"submission_id": sid, "withdrawn_at": self.now})
            return reply(200, withdrawn=[s for s in want if s not in refused], refused=refused)

        if action == "report":
            lid = r["library_id"] if isinstance(r.get("library_id"), str) else ""
            if not self.lib_rx.fullmatch(lid):
                return reply(400, "id")
            reason = r.get("reason")
            if not isinstance(reason, str) or reason not in self.reasons:
                return reply(400, "reason")
            who = r["reporter"] if isinstance(r.get("reporter"), str) else ""
            if not self.prefix_rx.fullmatch(who):
                return reply(400, "reporter")
            if self.corrupt:
                return reply(500, "store")
            if lid not in entries:
                return reply(404, "not_found")
            if not any(str(e["submission_id"])[4:10] == who for e in entries.values()):
                return reply(200)
            g = self.guard_today(self.db["guard"])
            if int(g["reports"]) >= self.max_reports_per_day:
                return reply(429, "busy")
            g["reports"] = int(g["reports"]) + 1
            self.db["guard"] = g
            rep = entries[lid]["reports"] if isinstance(entries[lid]["reports"], dict) else {}
            if who in rep or len(rep) < self.max_reporters:
                rep[who] = reason
            entries[lid]["reports"] = rep
            if len(rep) >= self.hide_at:
                entries[lid]["hidden"] = True
            return reply(200)

        if not self.admin_ok(r.get("secret")):
            return reply(403, "admin")
        op = r["op"] if isinstance(r.get("op"), str) else ""
        if op not in self.admin_ops:
            return reply(400, "op")
        if op == "reported":
            if self.corrupt:
                return reply(500, "store")
            rows = []
            for e in entries.values():
                if not e["reports"]:
                    continue
                row = {"library_id": e["id"], "reports": len(e["reports"]),
                       "reasons": dict(Counter(e["reports"].values())), "hidden": bool(e.get("hidden"))}
                for k in ("title", "brand", "model"):
                    if k in e["details"]:
                        row[k] = e["details"][k]
                rows.append(row)
            rows.sort(key=cmp_to_key(lambda a, b: (b["reports"] - a["reports"]) or _strcmp(a["library_id"], b["library_id"])))
            return reply(200, entries=rows[:200])
        lid = r["library_id"] if isinstance(r.get("library_id"), str) else ""
        if not self.lib_rx.fullmatch(lid):
            return reply(400, "id")
        given = r["details"] if "details" in r else []
        if op == "edit" and (not _is_obj(given) or not given):
            return reply(400, "details")
        if self.corrupt:
            return reply(500, "store")
        if lid not in entries:
            return reply(404, "not_found")
        e = entries[lid]
        if op == "remove":
            del entries[lid]
            self.removals.append({"library_id": lid, "removed_at": self.now})
            return reply(200)
        if op == "edit":
            merged = dict(e["details"])
            merged.update(given)
            details, field, problem = self.check_details(merged, e["recipe"]["kind"])
            if details is None:
                return reply(400, "details", field=field, problem=problem)
            e["details"], e["updated"] = details, self.now
        e["reports"], e["hidden"] = {}, False
        return reply(200)


@pytest.fixture
def server() -> _Library:
    return _Library(_php())


def _body(action: str, **fields) -> bytes:
    return json.dumps({"schema": 1, "action": action, **fields}).encode("utf-8")


def _at(doc: dict, path: str):
    *head, last = path.split(".")
    for k in head:
        doc = doc[k]
    return doc, last


def _shaped(base: dict, case: dict) -> dict:
    out = copy.deepcopy(base)
    for path in case.get("drop", []):
        d, k = _at(out, path)
        d.pop(k, None)
    for path, v in case.get("set", {}).items():
        d, k = _at(out, path)
        d[k] = copy.deepcopy(v)
    return out


def _seed(lib: _Library, seed: dict | None = None) -> None:
    """The seeded library, through the server's own checks (so the seed is a
    library the server could have made)."""
    for e in (seed or _fixture("seed.json"))["entries"]:
        recipe, details, field, problem = lib.check_recipe({**e["recipe"], "details": e["details"]})
        assert recipe is not None, (e["id"], field, problem)
        lib.db["entries"][e["id"]] = {
            "id": e["id"], "submission_id": "sub_" + e["id"][4:] + "0000", "owner_hash": "0" * 64,
            "recipe": recipe, "details": details, "version": "0.38.93", "terms_version": 1,
            "created": e["created"], "updated": e["created"], "placed": e["placed"], "reports": {}, "hidden": False}


def _share(lib: _Library, *, sid: str = "sub_a1b2c3d4e5f60718", tok: str = "00112233445566778899aabbccddeeff",
           **over) -> tuple[int, dict]:
    base = _fixture("shares.json")["body"]
    body = {**copy.deepcopy(base), "submission_id": sid, "owner_token": tok}
    for path, v in over.items():
        d, k = _at(body, path.replace("__", "."))
        d[k] = v
    return lib.handle(json.dumps(body).encode("utf-8"))


# ═══ 1. the rules, read out of the PHP ════════════════════════════════════════

def test_the_port_reads_the_plans_closed_lists_out_of_the_php(server) -> None:
    """The plan's details sheet, as the server holds it."""
    assert len(server.categories) == 16 and server.categories[-2:] == ["device", "other"]
    assert len(server.rooms) == 11 and "kids-room" in server.rooms and server.rooms[-1] == "any"
    assert len(server.styles) == 13 and "mid-century" in server.styles
    assert len(server.materials) == 9 and len(server.color_families) == 14
    assert server.size_classes == ["small", "medium", "large", "extra-large"]
    assert server.bed_sizes == ["twin", "double", "queen", "king", "crib", "bunk"]
    assert server.required == ["category", "kind", "rooms", "style", "material", "color_family", "size_class"]
    assert set(server.required) <= set(server.detail_keys)
    assert server.text == {"title": (3, 60), "brand": (2, 40), "model": (1, 60)}
    assert server.counts["seats"] == (1, 8) and (server.dim_min, server.dim_max) == (0.001, 8.0)
    assert [w for w, _ in server.personal] == ["email", "url", "phone", "address"]
    assert len(server.secrets) == 4 and server.words
    assert set(server.action_keys) == {"search", "get", "share", "withdraw", "report", "admin"}


def test_the_secret_patterns_are_tester_phps_own(server) -> None:
    """The plan: free text that looks like a secret is refused with "the same
    patterns as tester.php"."""
    tester = (_ROOT / "server" / "tester.php").read_text(encoding="utf-8")
    assert _php_patterns(_php(), "SECRETS") == _php_patterns(tester, "SECRETS")


# ═══ 2. the fixtures every copy of the rules runs ═════════════════════════════

@pytest.mark.parametrize("case", _fixture("freetext.json")["cases"], ids=lambda c: c["text"][:40])
def test_free_text_is_refused_for_what_it_looks_like(server, case) -> None:
    assert (server.text_problem(case["text"]) or None) == case["refused"]


@pytest.mark.parametrize("case", _fixture("details.json")["cases"], ids=lambda c: c["name"])
def test_the_details_sheet(server, case) -> None:
    fx = _fixture("details.json")
    if "whole" in case:
        d = case["whole"]
    else:
        d = {k: v for k, v in fx["details"].items() if k in case.get("only", fx["details"])}
        d = _shaped(d, case)
    clean, field, problem = server.check_details(d, fx["kind"])
    if case["field"] is None:
        assert clean is not None, (field, problem)
    else:
        assert (field, problem) == (case["field"], case["problem"])


@pytest.mark.parametrize("case", _fixture("shares.json")["cases"], ids=lambda c: c["name"])
def test_a_share_is_checked_again_on_receipt(server, case) -> None:
    body = _shaped(_fixture("shares.json")["body"], case)
    code, out = server.handle(json.dumps(body).encode("utf-8"))
    assert code == case["status"], out
    if code == 200:
        assert len(server.db["entries"]) == 1
        return
    assert out.get("why") == case["why"] and not server.db["entries"]
    if "field" in case:
        assert (out["field"], out["problem"]) == (case["field"], case["problem"])


# ═══ 3. what is kept ══════════════════════════════════════════════════════════

def test_a_kept_piece_holds_its_recipe_and_details_and_nothing_else(server) -> None:
    code, out = _share(server)
    assert code == 200 and out["edited"] is False
    e = server.db["entries"][out["library_id"]]
    assert set(e) == {"id", "submission_id", "owner_hash", "recipe", "details", "version", "terms_version",
                      "created", "updated", "placed", "reports", "hidden"}
    assert set(e["recipe"]) == {"kind", "params", "colors", "width_m", "depth_m", "height_m"}
    assert set(e["details"]) <= set(server.detail_keys)
    assert e["owner_hash"] == hashlib.sha256(b"00112233445566778899aabbccddeeff").hexdigest()
    assert "00112233445566778899aabbccddeeff" not in json.dumps(server.db), "the token itself is never kept"


def test_what_a_house_sees_never_carries_a_submission_id_a_hash_or_a_report(server) -> None:
    _share(server)
    code, out = server.handle(_body("search"))
    assert code == 200 and out["total"] == 1
    entry = out["entries"][0]
    assert set(entry) == {"library_id", "recipe", "houses", "copies", "checked", "created"}
    flat = json.dumps(out)
    assert "sub_" not in flat and "owner" not in flat and "reports" not in flat


def test_an_edit_keeps_only_the_latest_details_and_the_first_recipe(server) -> None:
    _, first = _share(server)
    code, out = _share(server, recipe__details__title="Grey sofa with slim arms",
                       recipe__details__style="modern", recipe__width_m=2.0)
    assert code == 200 and out == {"ok": True, "library_id": first["library_id"], "edited": True}
    e = server.db["entries"][first["library_id"]]
    assert e["details"]["title"] == "Grey sofa with slim arms" and e["details"]["style"] == "modern"
    assert e["recipe"]["width_m"] == 2.2 and len(server.db["entries"]) == 1


def test_only_the_owner_token_changes_or_withdraws_a_piece(server) -> None:
    _, first = _share(server)
    code, out = _share(server, tok="ffeeddccbbaa99887766554433221100", recipe__details__title="Taken over")
    assert (code, out["why"]) == (403, "owner")
    item = {"submission_id": "sub_a1b2c3d4e5f60718", "owner_token": "ffeeddccbbaa99887766554433221100"}
    code, out = server.handle(_body("withdraw", items=[item]))
    assert code == 200 and out["refused"] == ["sub_a1b2c3d4e5f60718"] and out["withdrawn"] == []
    assert first["library_id"] in server.db["entries"] and not server.withdrawals


def test_withdraw_deletes_and_logs_only_the_id_and_the_time(server) -> None:
    _share(server)
    _share(server, sid="sub_a1b2c3000000000b", tok="0123456789abcdef0123456789abcdef")
    items = [{"submission_id": "sub_a1b2c3d4e5f60718", "owner_token": "00112233445566778899aabbccddeeff"},
             {"submission_id": "sub_ffffff0000000000", "owner_token": "00112233445566778899aabbccddeeff"}]
    code, out = server.handle(_body("withdraw", items=items))
    assert code == 200
    # Gone, and an id that was never here counts as withdrawn too: the goal holds.
    assert out["withdrawn"] == ["sub_a1b2c3d4e5f60718", "sub_ffffff0000000000"] and out["refused"] == []
    assert [e["submission_id"] for e in server.db["entries"].values()] == ["sub_a1b2c3000000000b"]
    assert server.withdrawals == [{"submission_id": "sub_a1b2c3d4e5f60718", "withdrawn_at": server.now}]
    code, out = server.handle(_body("withdraw", items=[]))
    assert (code, out["why"]) == (400, "items")


# ═══ 4. finding pieces ════════════════════════════════════════════════════════

@pytest.mark.parametrize("q", _fixture("queries.json")["queries"], ids=lambda q: q["name"])
def test_every_filter_and_sort_returns_the_right_pieces(server, q) -> None:
    _seed(server)
    code, out = server.handle(_body("search", **q["search"]))
    assert code == 200, out
    assert [e["library_id"][len("lib_00000000000"):] for e in out["entries"]] == q["ids"]
    assert out["total"] == q.get("total", len(q["ids"]))


@pytest.mark.parametrize("search, why", [
    ({"filters": {"colour": "grey"}}, "filter"),
    ({"filters": {"style": "baroque"}}, "filter"),
    ({"filters": {"seats": 9}}, "filter"),
    ({"filters": {"features": []}}, "filter"),
    ({"filters": {"fits": {"width_m": 2}}}, "filter"),
    ({"filters": {"fits": {"width_m": 2, "depth_m": 0}}}, "filter"),
    ({"filters": ["sofa"]}, "filter"),
    ({"sort": "price"}, "sort"),
    ({"sort": "fit"}, "sort"),
    ({"limit": 61}, "page"),
    ({"limit": 0}, "page"),
    ({"offset": -1}, "page"),
    ({"text": "x" * 61}, "text"),
    ({"text": "sofa\n"}, "text"),
    ({"install_id": "abc"}, "key"),
])
def test_a_search_the_library_does_not_know_is_refused(server, search, why) -> None:
    code, out = server.handle(_body("search", **search))
    assert (code, out["why"]) == (400, why)


def test_near_identical_pieces_show_as_one_entry_with_the_most_common_details(server) -> None:
    base = _fixture("seed.json")["entries"][0]
    seed = {"entries": []}
    for i, (w, style, placed) in enumerate([(2.20, "mid-century", 4), (2.22, "modern", 0), (2.18, "mid-century", 1),
                                           (3.0, "modern", 0)]):
        e = copy.deepcopy(base)
        e["id"] = f"lib_00000000010{i}"
        e["created"] = f"2026-09-0{i + 1}T10:00:00+00:00"
        e["placed"] = placed
        e["recipe"]["width_m"] = w
        e["details"]["style"] = style
        e["details"]["checked"] = i == 1
        seed["entries"].append(e)
    _seed(server, seed)
    code, out = server.handle(_body("search"))
    assert code == 200 and out["total"] == 2, "2.18, 2.20 and 2.22 m are one sofa; 3 m is another"
    g = out["entries"][0]
    assert g["library_id"] == "lib_000000000100", "the medoid: the real piece nearest the others"
    assert g["copies"] == 3 and g["houses"] == 3 + 4 + 0 + 1
    assert g["recipe"]["width_m"] == 2.20 and g["recipe"]["details"]["style"] == "mid-century"
    assert g["checked"] is True and g["created"] == "2026-09-03T10:00:00+00:00"
    code, out = server.handle(_body("get", library_id="lib_000000000102"))
    assert code == 200 and out["entry"]["library_id"] == "lib_000000000100", "any copy finds its group"


def test_placing_counts_anonymously_and_never_past_the_days_cap(server) -> None:
    _seed(server)
    code, out = server.handle(_body("get", library_id="lib_000000000003", placed=True))
    assert code == 200 and out["entry"]["houses"] == 2
    code, out = server.handle(_body("get", library_id="lib_000000000003"))
    assert out["entry"]["houses"] == 2, "looking is not placing"
    server.db["guard"] = {"day": server.today, "new": 0, "prefixes": {}, "reports": 0,
                          "placed": server.max_placed_per_day}
    code, out = server.handle(_body("get", library_id="lib_000000000003", placed=True))
    assert code == 200 and out["entry"]["houses"] == 2, "a full day still shows the piece"
    assert server.handle(_body("get", library_id="lib_0000000000ff"))[0] == 404
    assert server.handle(_body("get", library_id="lib_000000000003", placed="yes"))[1]["why"] == "placed"


# ═══ 5. reports, limits, the owner's tools ════════════════════════════════════

def _has_shared(server: _Library, *prefixes: str) -> None:
    """Each prefix is a house that has shared a piece (its submission ids start with it)."""
    for p in prefixes:
        assert _share(server, sid=f"sub_{p}0000000000")[0] == 200, p


def test_a_report_counts_only_from_a_house_that_has_shared(server) -> None:
    """The prefix is the client's own choice: one that starts no kept
    submission id is answered alike and never counted, so made-up prefixes
    can neither hide a piece nor use up the day's reports."""
    _seed(server)
    lid = "lib_000000000001"
    for who in ("aaaaaa", "bbbbbb", "cccccc"):
        assert server.handle(_body("report", library_id=lid, reason="title", reporter=who)) == (200, {"ok": True})
    e = server.db["entries"][lid]
    assert e["reports"] == {} and e["hidden"] is False, "none of them has shared a piece"
    assert int(server.db["guard"].get("reports", 0)) == 0, "the day's reports are not used up"
    _has_shared(server, "aaaaaa")
    assert server.handle(_body("report", library_id=lid, reason="title", reporter="aaaaaa")) == (200, {"ok": True})
    assert server.db["entries"][lid]["reports"] == {"aaaaaa": "title"} and server.db["guard"]["reports"] == 1


def test_reports_from_three_houses_hide_the_free_text_and_keep_the_recipe(server) -> None:
    _seed(server)
    _has_shared(server, "aaaaaa", "bbbbbb", "cccccc")
    lid = "lib_000000000001"
    for _ in range(3):
        assert server.handle(_body("report", library_id=lid, reason="title", reporter="aaaaaa"))[0] == 200
    assert not server.db["entries"][lid]["hidden"], "one house reporting three times is one report"
    for who in ("bbbbbb", "cccccc"):
        server.handle(_body("report", library_id=lid, reason="details", reporter=who))
    assert server.db["entries"][lid]["hidden"] is True
    _, out = server.handle(_body("get", library_id=lid))
    d = out["entry"]["recipe"]["details"]
    assert "title" not in d and "brand" not in d and "model" not in d
    assert d["style"] == "mid-century" and out["entry"]["recipe"]["kind"] == "sofa"
    assert server.handle(_body("report", library_id=lid, reason="rude", reporter="dddddd"))[1]["why"] == "reason"
    assert server.handle(_body("report", library_id=lid, reason="title", reporter="sub_aa"))[1]["why"] == "reporter"


def test_the_limits_per_day_per_house_and_in_total(server) -> None:
    for i in range(server.max_new_per_prefix):
        assert _share(server, sid=f"sub_a1b2c3{i:010x}")[0] == 200
    code, out = _share(server, sid="sub_a1b2c3ffffffffff")
    assert (code, out["why"]) == (429, "busy"), "one house's prefix: 20 a day"
    assert _share(server, sid="sub_0000010000000000")[0] == 200, "another house still can"
    server.today = "2026-10-05"
    assert _share(server, sid="sub_a1b2c3fffffffffe")[0] == 200, "a new UTC day starts again"
    server.db["guard"]["new"] = server.max_new_per_day
    assert _share(server, sid="sub_0000020000000000")[1]["why"] == "busy", "200 a day in all"
    server.today = "2026-10-06"
    for i in range(server.max_entries - len(server.db["entries"])):
        server.db["entries"][f"lib_x{i}"] = {"submission_id": f"x{i}"}
    code, out = _share(server, sid="sub_0000030000000000")
    assert (code, out["why"]) == (503, "full")


def test_the_owner_tools_need_the_secret_file(server) -> None:
    _seed(server)
    _has_shared(server, "aaaaaa")
    server.handle(_body("report", library_id="lib_000000000001", reason="title", reporter="aaaaaa"))
    ask = lambda **f: server.handle(_body("admin", **f))   # noqa: E731
    secret = "correct horse battery staple 42"
    assert ask(secret=secret, op="reported")[1]["why"] == "admin", "no file: no tools at all"
    server.admin_secret = "short\n"
    assert ask(secret="short", op="reported")[1]["why"] == "admin", "a secret under 24 characters is no secret"
    server.admin_secret = secret + "\n"
    assert ask(secret="wrong", op="reported")[1]["why"] == "admin"
    code, out = ask(secret=secret, op="reported")
    assert code == 200 and out["entries"] == [{"library_id": "lib_000000000001", "reports": 1,
                                               "reasons": {"title": 1}, "hidden": False,
                                               "title": "Three-seat grey sofa", "brand": "IKEA", "model": "KIVIK"}]
    code, out = ask(secret=secret, op="edit", library_id="lib_000000000001", details={"title": "a@b.co"})
    assert (code, out["field"], out["problem"]) == (400, "title", "email"), "the owner's edits pass the same checks"
    code, _ = ask(secret=secret, op="edit", library_id="lib_000000000001", details={"title": "Grey sofa"})
    e = server.db["entries"]["lib_000000000001"]
    assert code == 200 and e["details"]["title"] == "Grey sofa" and e["reports"] == {} and e["hidden"] is False
    assert ask(secret=secret, op="remove", library_id="lib_000000000001")[0] == 200
    assert "lib_000000000001" not in server.db["entries"]
    assert server.removals == [{"library_id": "lib_000000000001", "removed_at": server.now}]
    assert ask(secret=secret, op="purge")[1]["why"] == "op"


def test_a_store_that_cannot_be_read_is_never_written(server) -> None:
    server.corrupt = True
    for raw in (_body("search"), _body("withdraw", items=[{"submission_id": "sub_a1b2c3d4e5f60718",
                                                          "owner_token": "00112233445566778899aabbccddeeff"}])):
        assert server.handle(raw)[0] == 500
    assert _share(server)[0] == 500 and not server.db["entries"]


def test_the_request_itself(server) -> None:
    assert server.handle(_body("search"), method="GET")[0] == 405
    assert server.handle(b"x" * (server.max + 1))[0] == 413
    assert server.handle(b"[1, 2]")[1]["why"] == "json"
    assert server.handle(b'{"schema": true, "action": "search"}')[1]["why"] == "schema"


# ═══ 6. the script itself ═════════════════════════════════════════════════════

def test_the_script_never_reads_who_is_asking() -> None:
    """No IP address, user agent or other header is read, so none can be kept."""
    src = _php()
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("//"))
    assert re.findall(r"\$_SERVER\[[^\]]*\]", code) == ["$_SERVER['REQUEST_METHOD']"]
    for banned in ("REMOTE_ADDR", "HTTP_", "getallheaders", "apache_request_headers", "$_COOKIE", "$_GET",
                   "$_REQUEST", "error_log", "setcookie"):
        assert banned not in code, banned
    assert "__DIR__ . '/../../../private/padspan-furniture'" in code, "kept outside the web root"
    # Each file the script writes is under that private directory.
    writes = re.findall(r"file_put_contents\(([^,]+),", code)
    assert writes and all(w.startswith(("$tmp", "$DIR")) for w in writes), writes


def test_the_admin_secret_never_lives_in_the_repository() -> None:
    assert "admin_secret.txt" in _php()
    hits = [p for p in _ROOT.rglob("admin_secret*") if ".git" not in p.parts]
    assert hits == []
