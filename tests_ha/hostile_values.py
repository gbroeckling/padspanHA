# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Wrong and hostile values for a websocket command's fields, chosen by what
each field's schema expects (test_hostile.py sends them).

Nothing here imports Home Assistant or the integration.

Categories, so a run can pick a selection:
    type        a value of another type (text for a number, a list for a
                dict, a boolean, null ...)
    missing     a name or id of something that does not exist, the id of a
                thing of another kind, an existing id in other letter case
    unknown     a field the schema does not name
    extreme     0, -1, 1e308, past 64 bits, 100,000 characters, 10,000
                entries, nesting 200 deep, empty, whitespace only
    number_text "nan", "inf" and friends where a number is expected
    odd_text    control characters, a NUL, unusual Unicode, markup
    path        ../ paths, absolute and Windows paths, file:// and private
                URLs, long names, names with / \\ : and ..
    base64      not base64, base64 of junk, a picture claiming an enormous
                size, nothing at all
    shape       a dict or list holding every key the handler's code reads,
                each set to the wrong kind of value
"""

from __future__ import annotations

import ast
import base64
import re
import struct
import zlib
from pathlib import Path
from typing import Any, NamedTuple

import voluptuous as vol

SOURCE = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"

CATEGORIES = ("type", "missing", "unknown", "extreme", "number_text", "odd_text", "path", "base64", "shape")
# The selection every command gets on every run (the full set needs
# PADSPAN_HOSTILE=full): wrong types and things that do not exist, plus the
# path and picture values for a field that names a file, a path or a URL.
QUICK = frozenset({"type", "missing", "unknown"})
QUICK_FOR_FILES = frozenset({"path", "base64"})

# A field that names a file, a path, a URL or carries a picture.
FILEISH = re.compile(r"file|path|url|photo|image|png|base64|backup_id|library_id|mime")
BASE64ISH = re.compile(r"base64|photo|png")
# A number field that counts or names something (an index, a revision).
NUMBER_ID = re.compile(r"(^|_)(id|index|rev|version|merge|read)$")


class Hostile(NamedTuple):
    category: str
    label: str
    value: Any


# ── what a schema expects ────────────────────────────────────────────────────

def expects(validator: Any) -> set[str]:
    """The kinds of value a validator takes: text, number, bool, dict, list,
    enum (one of fixed choices), object (a dict with its own schema)."""
    if isinstance(validator, vol.Schema):
        return expects(validator.schema)
    if isinstance(getattr(validator, "padspan_expects", None), str):    # ws_common's limits: text, number
        return {validator.padspan_expects}
    if validator is bool:
        return {"bool"}
    if validator is str:
        return {"text"}
    if validator in (int, float):
        return {"number"}
    if validator is dict:
        return {"dict"}
    if validator is list:
        return {"list"}
    if isinstance(validator, vol.Coerce):
        return {"number"} if validator.type in (int, float) else {"text"}
    if isinstance(validator, vol.In):
        return {"enum"}
    if isinstance(validator, vol.Match):
        return {"text"}
    if isinstance(validator, (vol.All, vol.Any)):
        return set().union(*(expects(v) for v in validator.validators))
    if isinstance(validator, dict):
        return {"object"}
    if isinstance(validator, list):
        return {"list"}
    if isinstance(validator, (str, int, float)) and validator is not None:
        return {"enum"}
    return set()


def list_item(validator: Any) -> Any | None:
    """The validator of a list's entries ([str] -> str), when it says."""
    if isinstance(validator, vol.Schema):
        return list_item(validator.schema)
    if isinstance(validator, list) and len(validator) == 1:
        return validator[0]
    if isinstance(validator, vol.All):
        for inner in validator.validators:
            if (item := list_item(inner)) is not None:
                return item
    return None


# ── pictures and blobs ───────────────────────────────────────────────────────

def _png(width: int, height: int, idat: bytes = b"") -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat or zlib.compress(b"\x00" * 16)) \
        + chunk(b"IEND", b"")


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


BLOBS = (
    ("not_base64", "this is not base64 !!"),
    ("base64_of_junk", _b64(b"junk" * 64)),
    ("png_claims_12000x12000", _b64(_png(12_000, 12_000))),
    ("png_claims_100000x100000", _b64(_png(100_000, 100_000))),
    ("zip_header_junk", _b64(b"PK\x03\x04" + b"\x00" * 60)),
    ("data_url_junk", "data:image/png;base64,AAAA"),
    ("zero_bytes", ""),
)

PATHS = (
    ("dotdot_etc_passwd", "../../../etc/passwd"),
    ("dotdot_canary", "../canary.txt"),
    ("absolute", "/etc/passwd"),
    ("windows_path", "C:\\Windows\\win.ini"),
    ("unc_path", "\\\\server\\share\\x"),
    ("file_url", "file:///etc/passwd"),
    ("url_loopback_port1", "http://127.0.0.1:1/"),
    ("url_metadata", "http://169.254.169.254/latest/meta-data/"),
    ("long_name", "n" * 300 + ".png"),
    ("slash", "a/b"),
    ("backslash", "a\\b"),
    ("colon", "a:b"),
    ("dotdot", ".."),
    ("encoded_dotdot", "..%2f..%2f..%2fetc%2fpasswd"),
    ("home_dir", "~/.ssh/id_rsa"),
)

ODD_TEXT = (
    ("nul", "\x00"),
    ("nul_inside", "a\x00b"),
    ("control", "\x01\x1b[31m\x7f"),
    ("newlines", "line\nbreak\r\t"),
    ("rtl_override", "\u202eevil"),
    ("zero_width", "\u200b"),
    ("emoji", "\U0001f600" * 8),
    ("combining", "e\u0301\u0301\u0301"),
    ("bom", "\ufeff"),
    ("markup", "<script>alert(1)</script>"),
    ("format", "{0}{__class__}%s%n"),
)

NUMBER_TEXT = (("nan", "nan"), ("NaN", "NaN"), ("inf", "inf"), ("minus_inf", "-inf"), ("1e999", "1e999"),
               ("hex", "0x10"), ("spaced", " 1 "))


def _nested(depth: int, leaf: Any, as_list: bool) -> Any:
    out = leaf
    for _ in range(depth):
        out = [out] if as_list else {"a": out}
    return out


EXTREME = {
    "number": (("zero", 0), ("minus_one", -1), ("1e308", 1e308), ("minus_1e308", -1e308), ("past_64_bits", 2 ** 70),
               ("tiny", 5e-324)),
    "text": (("empty", ""), ("whitespace", "   "), ("100k_chars", "x" * 100_000)),
    "list": (("10k_entries", ["x"] * 10_000), ("nested_200", _nested(200, "x", True)), ("empty", [])),
    "dict": (("nested_200", _nested(200, "x", False)), ("10k_keys", {f"k{i}": i for i in range(10_000)}),
             ("empty", {})),
}

# Wrong types for each kind. A value of the kind itself is left out.
WRONG_TYPE = {
    "text": (("number", 1), ("float", 1.5), ("bool", True), ("null", None), ("list", ["x"]), ("dict", {"x": "y"})),
    "number": (("text", "x"), ("empty_text", ""), ("bool", True), ("null", None), ("list", [1]), ("dict", {"v": 1})),
    "bool": (("text", "x"), ("text_true", "true"), ("number", 2), ("null", None), ("list", [True]), ("dict", {})),
    "dict": (("text", "x"), ("number", 1), ("bool", True), ("null", None), ("list", [{}])),
    "object": (("text", "x"), ("number", 1), ("null", None), ("list", [{}])),
    "list": (("text", "x"), ("number", 1), ("bool", True), ("null", None), ("dict", {"0": "x"})),
    "enum": (("not_a_choice", "zz_not_a_choice"), ("number", 1), ("null", None), ("list", ["x"]), ("dict", {})),
}


# ── the keys a handler's code reads ──────────────────────────────────────────

_KEY = re.compile(r"""(?:\.get\(\s*|\[\s*)["']([a-z_][a-z0-9_]{0,40})["']""")
_KEYS_CACHE: dict[str, list[str]] = {}


def keys_read(module: str) -> list[str]:
    """Every key the module (and the package modules it imports) reads out of
    a dict with .get("k") or ["k"]: what a dict a caller sends is looked
    into for."""
    if module in _KEYS_CACHE:
        return _KEYS_CACHE[module]
    names = {module}
    tree = ast.parse((SOURCE / f"{module}.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 1:
            if node.module:
                names.add(node.module.split(".")[0])
            else:
                names.update(a.name for a in node.names)
    keys: set[str] = set()
    for name in names:
        path = SOURCE / f"{name}.py"
        if path.exists():
            keys.update(_KEY.findall(path.read_text(encoding="utf-8")))
    _KEYS_CACHE[module] = sorted(keys)
    return _KEYS_CACHE[module]


POISON = (("none", None), ("text", "x"), ("list", []), ("dict", {}), ("nan_text", "nan"), ("minus_one", -1),
          ("1e308", 1e308))


def _poisoned(keys: list[str]) -> list[tuple[str, dict]]:
    return [(f"every_key_{label}", dict.fromkeys(keys, value)) for label, value in POISON]


# ── the pool ─────────────────────────────────────────────────────────────────

def _swapcase(value: str) -> str | None:
    swapped = value.swapcase()
    return swapped if swapped != value else None


def values_for(name: str, validator: Any, *, module: str, existing: dict[str, list[str]] | None = None,
               kind_of: dict[str, str] | None = None) -> list[Hostile]:
    """Hostile values for field `name` whose schema is `validator`.

    `existing` maps a kind of thing (map, floor, room ...) to ids that exist
    in the house; `kind_of` maps a field name to its kind. With them a field
    also gets an existing id in other letter case and the id of a thing of
    another kind."""
    existing = existing or {}
    kind_of = kind_of or {}
    kinds = expects(validator) or {"text"}
    item = list_item(validator)
    out: list[Hostile] = []
    seen: set[str] = set()

    def add(category: str, label: str, value: Any) -> None:
        key = repr(value)[:2000]
        if key not in seen:
            seen.add(key)
            out.append(Hostile(category, label, value))

    # A value of a kind the field takes is not a wrong type.
    taken = {type(v) for k in kinds for v in ({"text": ("",), "number": (0, 0.0), "bool": (True,),
                                                "dict": ({},), "object": ({},), "list": ([],)}.get(k, ()))}
    for kind in sorted(kinds):
        for label, value in WRONG_TYPE.get(kind, ()):
            if type(value) not in taken or kind == "enum":
                add("type", label, value)

    # Things that do not exist.
    mine = kind_of.get(name)
    if "text" in kinds:
        add("missing", "does_not_exist", f"zz_missing_{name}")
        if "entity" in name:
            add("missing", "entity_does_not_exist", "light.zz_missing")
        for value in existing.get(mine, [])[:1]:
            if (swapped := _swapcase(value)) is not None:
                add("missing", "other_case", swapped)
        other = next((ids[0] for kind, ids in sorted(existing.items()) if kind != mine and ids), None)
        if other is not None:
            add("missing", "id_of_another_kind", other)
    if "list" in kinds and item is not None and "text" in expects(item):
        add("missing", "does_not_exist", [f"zz_missing_{name}"])
        if mine and existing.get(mine):
            add("missing", "other_case", [existing[mine][0].swapcase()])
    if "number" in kinds and NUMBER_ID.search(name):
        add("missing", "does_not_exist", 999_999)

    for kind in sorted(kinds):
        for label, value in EXTREME.get(kind if kind != "object" else "dict", ()):
            add("extreme", label, value)
    if "number" in kinds:
        if name in ("width", "height") or name.endswith(("_s", "_m", "minutes", "limit", "offset")):
            add("extreme", "claims_a_billion", 1_000_000_000)
        for label, value in NUMBER_TEXT:
            add("number_text", label, value)
    if "text" in kinds:
        for label, value in ODD_TEXT:
            add("odd_text", label, value)
        for label, value in PATHS:
            add("path", label, value)
        if BASE64ISH.search(name):
            for label, value in BLOBS:
                add("base64", label, value)
    if "list" in kinds and item is not None and "text" in expects(item):
        for label, value in PATHS[:3]:
            add("path", label, [value])
        add("odd_text", "nul", ["\x00"])

    if "dict" in kinds:
        for label, value in _poisoned(keys_read(module)):
            add("shape", label, value)
    if "list" in kinds and (item is None or expects(item) & {"dict", "object"}):
        for label, value in _poisoned(keys_read(module)):
            add("shape", f"list_of_{label}", [value])
        for label, value in (("list_of_text", ["x"]), ("list_of_null", [None]), ("list_of_lists", [[]]),
                             ("list_of_numbers", [1])):
            add("shape", label, value)
    return out


def select(values: list[Hostile], name: str, full: bool) -> list[Hostile]:
    """The values a run sends: all of them for PADSPAN_HOSTILE=full, else the
    quick selection."""
    if full:
        return values
    wanted = QUICK | (QUICK_FOR_FILES if FILEISH.search(name) else frozenset())
    return [v for v in values if v.category in wanted]


UNKNOWN_FIELDS = (Hostile("unknown", "zz_unknown", {"zz_unknown": "x"}),
                  Hostile("unknown", "__proto__", {"__proto__": {"admin": True}}))
