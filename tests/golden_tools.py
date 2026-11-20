"""Stored expected outputs for the exact-output tests (tests/golden/).

Three tests hold the output of a large function exactly as it is today, so
the function can be restructured and shown to give the same output after:

    tests/test_golden_poll.py       the poll and the room smoothing
    tests/test_golden_settings.py   the settings command
    tests/test_golden_snapshot.py   the live snapshot builder

A run gives a list of records (one per poll, per settings case, per
snapshot). A record is written as one line of JSON with values as Python
holds them: a dict keeps the order its keys were added in, and a set, which
has no order of its own, is written sorted. The SHA-256 of those lines is the
run's digest.

TWO DIGESTS FOR A RUN THAT DOES ARITHMETIC. pow, log10, log, exp, sin and cos
do not round the same way in every C library: the same Python on Windows and
on Linux gives results that differ in the last digit on some inputs (measured
here in November 2026: 13 of the 646 polls of one walk had a position that
differed in its 16th digit, and nothing else). So such a run has:

    sha256         of the lines with every float rounded to 9 significant
                   digits. Checked everywhere.
    sha256_exact   of the lines with every digit. Checked only on a machine
                   whose maths functions round like the one it was stored on
                   (exact_on is a digest of those functions' results on fixed
                   inputs); elsewhere that one check is left out.

What is stored under tests/golden/<part>/, per scenario:

    digests.json          the digests and the counts of every scenario
    <name>.json           every record, indented, or
    <name>.jsonl          every record, one on each line, or (large outputs)
    <name>.summary.jsonl  one short line per record: its main values as they
                          are and a short digest of each of its parts
    <name>.sample.json    a few whole records, indented, to read

To store today's output as the expected output, on purpose:

    python -m tests.regen_goldens            (all three parts)
    python -m tests.regen_goldens poll       (or settings, or snapshot)

To write every record of a run, every digit, to a folder (to compare two
versions of the code value by value with any diff tool):

    python -m tests.regen_goldens poll --dump some/folder

A test that fails says which record differs first, and what in it.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import struct
from collections import deque
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Iterable

import pytest

from custom_components.padspan_ha.build_info import EDITION

GOLDEN_DIR = Path(__file__).resolve().parent / "golden"
PORTABLE_DIGITS = 9

# The stored output is the full edition's. The Bright tree is generated from
# this one (scripts/bright_build.py), with its names changed in every text
# file, these included; what is held here is held in the tree it is made from.
FULL_EDITION_ONLY = pytest.mark.skipif(EDITION != "full", reason="the stored output is the full edition's")


def regen_hint(part: str) -> str:
    return f"If the change is meant, store the new output:  python -m tests.regen_goldens {part}"


# ── Records as plain data ────────────────────────────────────────────────────

def _key(k: Any) -> str:
    """A dict key as text: JSON has only text keys."""
    if isinstance(k, str):
        return k
    if isinstance(k, (frozenset, set)):
        return "|".join(sorted(_key(x) for x in k))
    if isinstance(k, tuple):
        return "|".join(_key(x) for x in k)
    if isinstance(k, (bool, int, float)) or k is None:
        return repr(k)
    raise TypeError(f"golden: a dict key of type {type(k).__name__} has no stored form: {k!r}")


def plain(value: Any, digits: int | None = None) -> Any:
    """`value` as JSON data, losing nothing a test should see. digits: round
    every float to that many significant digits (None: keep every digit).

    Strict: a type with no stored form (a mock, a live object) raises, so a
    stand-in that leaked into the output is found here and not hashed as its
    repr, which changes from run to run.
    """
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return float(f"{value:.{digits}g}") if digits else value
        return {"__float__": repr(value)}
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            ks = _key(k)
            if ks in out:
                raise TypeError(f"golden: two keys are written the same: {ks!r}")
            out[ks] = plain(v, digits)
        return out
    if isinstance(value, deque):
        return {"__deque__": [plain(v, digits) for v in value], "maxlen": value.maxlen}
    if isinstance(value, (list, tuple)):
        return [plain(v, digits) for v in value]
    if isinstance(value, (set, frozenset)):
        items = [plain(v, digits) for v in value]
        return {"__set__": sorted(items, key=lambda v: json.dumps(v, sort_keys=True))}
    if isinstance(value, (bytes, bytearray)):
        return {"__bytes__": bytes(value).hex()}
    if isinstance(value, (datetime, date)):
        return {"__time__": value.isoformat()}
    raise TypeError(f"golden: a value of type {type(value).__name__} has no stored form: {value!r:.200}")


def line(record: Any, digits: int | None = None) -> str:
    """One record as one line of JSON (key order kept)."""
    text = json.dumps(plain(record, digits), ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    if "Mock" in text or " object at 0x" in text:
        # A stand-in or a live object written out as text: its name carries a
        # memory address, different on every run.
        at = max(text.find("Mock"), text.find(" object at 0x"))
        raise TypeError(f"golden: a stand-in leaked into the output as text: ...{text[max(0, at - 120):at + 80]}...")
    return text


def lines(records: Iterable[Any], digits: int | None = None) -> list[str]:
    return [line(r, digits) for r in records]


def digest(text_lines: list[str]) -> str:
    h = hashlib.sha256()
    for ln in text_lines:
        h.update(ln.encode("ascii"))
        h.update(b"\n")
    return h.hexdigest()


def short(value: Any) -> str:
    """A short digest of one value, to tell which part of a record changed."""
    return hashlib.sha256(line(value).encode("ascii")).hexdigest()[:10]


def math_fingerprint() -> str:
    """A digest of what this machine's maths functions give on fixed inputs.

    Two machines with the same fingerprint round pow, log10, log, exp, sin
    and cos alike on 20,000 inputs each, so every digit of a run should agree
    between them; two with different fingerprints do not round alike, and
    only the rounded digest can be compared.
    """
    rnd = random.Random(1)
    xs = [rnd.uniform(-3.0, 3.0) for _ in range(20000)]
    ps = [rnd.uniform(0.01, 200.0) for _ in range(20000)]
    h = hashlib.sha256()
    for values in ([10.0 ** x for x in xs], [p ** x for p, x in zip(ps, xs)],
                   [math.log10(p) for p in ps], [math.log(p) for p in ps],
                   [math.exp(x) for x in xs],
                   [math.sin(100.0 * x) for x in xs], [math.cos(100.0 * x) for x in xs]):
        h.update(b"".join(struct.pack("<d", v) for v in values))
    return h.hexdigest()[:16]


def indented(value: Any, depth: int = 0) -> str:
    """JSON to read: one key per line, a list of plain values on one line."""
    pad = " " * (depth + 1)
    if isinstance(value, dict) and value:
        rows = [f"{pad}{json.dumps(k)}: {indented(v, depth + 1)}" for k, v in value.items()]
        return "{\n" + ",\n".join(rows) + "\n" + " " * depth + "}"
    if isinstance(value, list) and value and any(isinstance(v, (dict, list)) for v in value):
        rows = [f"{pad}{indented(v, depth + 1)}" for v in value]
        return "[\n" + ",\n".join(rows) + "\n" + " " * depth + "]"
    return json.dumps(value)


# ── Where two records differ ─────────────────────────────────────────────────

_ABSENT = "<absent>"


def differences(expected: Any, actual: Any, path: str = "", limit: int = 12) -> list[tuple[str, Any, Any]]:
    """Where two plain records differ: (path, stored, now), in the order the
    values are stored, at most `limit` of them."""
    out: list[tuple[str, Any, Any]] = []
    _walk(expected, actual, path, out, limit)
    return out


def _walk(e: Any, a: Any, path: str, out: list, limit: int) -> None:
    if len(out) >= limit:
        return
    if isinstance(e, dict) and isinstance(a, dict):
        before = len(out)
        for k in e:
            sub = f"{path}.{k}" if path else str(k)
            if k in a:
                _walk(e[k], a[k], sub, out, limit)
            else:
                out.append((sub, e[k], _ABSENT))
            if len(out) >= limit:
                return
        for k in a:
            if k not in e:
                out.append((f"{path}.{k}" if path else str(k), _ABSENT, a[k]))
                if len(out) >= limit:
                    return
        if len(out) == before and list(e) != list(a):
            out.append((f"{path or 'the record'}: the same values, keys in a different order", list(e), list(a)))
        return
    if isinstance(e, list) and isinstance(a, list):
        for i in range(min(len(e), len(a))):
            _walk(e[i], a[i], f"{path}[{i}]", out, limit)
            if len(out) >= limit:
                return
        if len(e) != len(a):
            out.append((f"{path}: length", len(e), len(a)))
        return
    if type(e) is not type(a) or e != a:
        out.append((path, e, a))


def clip(v: Any, width: int = 200) -> str:
    s = v if isinstance(v, str) and v == _ABSENT else json.dumps(v)
    return s if len(s) <= width else s[: width - 3] + "..."


def difference_lines(expected: Any, actual: Any, limit: int = 12) -> list[str]:
    return [f"    {path}\n        stored: {clip(e)}\n        now:    {clip(a)}"
            for path, e, a in differences(expected, actual, limit=limit)]


# ── Stored files ─────────────────────────────────────────────────────────────

def _write_if_changed(path: Path, text: str) -> bool:
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return True


def read_digests(part: str) -> dict[str, Any]:
    p = GOLDEN_DIR / part / "digests.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _store_digest(part: str, name: str, entry: dict[str, Any]) -> bool:
    digests = read_digests(part)
    digests[name] = entry
    return _write_if_changed(GOLDEN_DIR / part / "digests.json",
                             json.dumps(dict(sorted(digests.items())), indent=1) + "\n")


def _stored(part: str, name: str) -> dict[str, Any]:
    stored = read_digests(part).get(name)
    assert stored is not None, f'No stored output for "{name}" under tests/golden/{part}/. {regen_hint(part)}'
    return stored


# Small outputs: every record stored, every digit. <name>.json holds them
# indented; <name>.jsonl (one_per_line) holds one record on each line.

def _whole_path(part: str, name: str, one_per_line: bool) -> Path:
    return GOLDEN_DIR / part / (f"{name}.jsonl" if one_per_line else f"{name}.json")


def _read_whole(part: str, name: str, one_per_line: bool) -> list[Any]:
    text = _whole_path(part, name, one_per_line).read_text(encoding="utf-8")
    return [json.loads(x) for x in text.splitlines()] if one_per_line else json.loads(text)["records"]


def write_whole(part: str, name: str, records: list[Any], counts: dict[str, Any],
                one_per_line: bool = False) -> bool:
    ls = lines(records)
    if one_per_line:
        body = "".join(x + "\n" for x in ls)
    else:
        body = indented({"about": f"The expected output of \"{name}\", every record. "
                                  "Written by: python -m tests.regen_goldens " + part,
                         "records": [json.loads(x) for x in ls]}) + "\n"
    a = _write_if_changed(_whole_path(part, name, one_per_line), body)
    b = _store_digest(part, name, {"sha256": digest(ls), "records": len(ls), **counts})
    return a or b


def check_whole(part: str, name: str, records: list[Any],
                label: Callable[[Any], str] = lambda r: "", one_per_line: bool = False) -> None:
    """Fail unless `records` are exactly the stored ones; say which record
    differs first (label(record) names it) and how."""
    stored = _stored(part, name)
    ls = lines(records)
    if digest(ls) == stored["sha256"]:
        return
    path = _whole_path(part, name, one_per_line)
    expected = _read_whole(part, name, one_per_line)
    assert digest(lines(expected)) == stored["sha256"], (
        f"tests/golden/{part}/{path.name} is not the file digests.json describes. {regen_hint(part)}")
    actual = [json.loads(x) for x in ls]
    msg = [f'The output of "{name}" is not the stored output (tests/golden/{part}/{path.name}).']
    n_diff = sum(1 for e, a in zip(expected, actual) if line(e) != line(a))
    for i, (e, a) in enumerate(zip(expected, actual)):
        if line(e) != line(a):
            msg.append(f"First difference: record {i} {label(e)}".rstrip())
            msg.extend(difference_lines(e, a))
            break
    msg.append(f"{n_diff} of {min(len(expected), len(actual))} records differ"
               + (f"; stored has {len(expected)} records, this run {len(actual)}."
                  if len(expected) != len(actual) else "."))
    msg.append(regen_hint(part))
    raise AssertionError("\n".join(msg))


# Large outputs that do arithmetic: a short line per record and a few whole
# records (both with floats rounded to PORTABLE_DIGITS), and two digests.

def write_summarised(part: str, name: str, records: list[Any], summarise: Callable[[Any], Any],
                     sample: list[int], counts: dict[str, Any]) -> bool:
    ls = lines(records, PORTABLE_DIGITS)
    summary = "".join(line(summarise(json.loads(x))) + "\n" for x in ls)
    picked = {str(i): json.loads(ls[i]) for i in sample if 0 <= i < len(ls)}
    sample_body = indented({
        "about": f"Records {', '.join(picked)} of the {len(ls)} that \"{name}\" gives, whole, to read "
                 f"(floats to {PORTABLE_DIGITS} significant digits). "
                 f"{name}.summary.jsonl has a line for every record.",
        "records": picked}) + "\n"
    entry = {"sha256": digest(ls), "sha256_exact": digest(lines(records)), "exact_on": math_fingerprint(),
             "records": len(ls), **counts}
    old = read_digests(part).get(name) or {}
    if old.get("sha256") == entry["sha256"] and old.get("exact_on") not in (None, entry["exact_on"]):
        # The same output, on a machine whose maths rounds differently from
        # the one the every-digit digest was stored on: that digest stands.
        entry["sha256_exact"], entry["exact_on"] = old["sha256_exact"], old["exact_on"]
    a = _write_if_changed(GOLDEN_DIR / part / f"{name}.summary.jsonl", summary)
    b = _write_if_changed(GOLDEN_DIR / part / f"{name}.sample.json", sample_body)
    c = _store_digest(part, name, entry)
    return a or b or c


def exact_applies(part: str, name: str) -> bool:
    """Whether this machine can be held to the stored every-digit digest."""
    return _stored(part, name).get("exact_on") == math_fingerprint()


def check_summarised(part: str, name: str, records: list[Any], summarise: Callable[[Any], Any],
                     explain: Callable[[int, Any, Any, Any, Any], list[str]]) -> None:
    """Fail unless `records` are the stored run: to PORTABLE_DIGITS digits on
    any machine, and to every digit where exact_applies().

    On a difference: explain(index, stored_summary, summary_now, record_now,
    record_before_now) gives the message for the first record whose summary
    differs; a whole stored record that differs is shown value by value.
    """
    stored = _stored(part, name)
    ls = lines(records, PORTABLE_DIGITS)
    if digest(ls) == stored["sha256"]:
        if exact_applies(part, name) and digest(lines(records)) != stored["sha256_exact"]:
            raise AssertionError(
                f'The output of "{name}" is the stored output to {PORTABLE_DIGITS} significant digits, but not '
                "to the last digit: some calculation now rounds differently (its steps in another order, or "
                "another function used). This machine's maths functions round like those of the machine "
                "the stored digest came from, so the change is in the code.\n"
                "To find it, write every record of both versions and compare them:  "
                f"python -m tests.regen_goldens {part} --dump <folder>\n" + regen_hint(part))
        return
    d = GOLDEN_DIR / part
    expected = [json.loads(x) for x in (d / f"{name}.summary.jsonl").read_text(encoding="utf-8").splitlines()]
    actual = [json.loads(x) for x in ls]
    now = [json.loads(line(summarise(r))) for r in actual]
    msg = [f'The output of "{name}" is not the stored output (tests/golden/{part}/{name}.summary.jsonl).']
    first = next((i for i, (e, a) in enumerate(zip(expected, now)) if e != a), None)
    if first is not None:
        msg.extend(explain(first, expected[first], now[first], actual[first],
                           actual[first - 1] if first else None))
    n_diff = sum(1 for e, a in zip(expected, now) if e != a)
    msg.append(f"{n_diff} of {min(len(expected), len(now))} records differ"
               + (f"; stored has {len(expected)} records, this run {len(now)}."
                  if len(expected) != len(now) else "."))
    whole = json.loads((d / f"{name}.sample.json").read_text(encoding="utf-8"))["records"]
    for idx, rec in whole.items():
        i = int(idx)
        if i < len(actual) and line(rec) != line(actual[i]):
            msg.append(f"Record {i} is stored whole ({name}.sample.json); it differs so:")
            msg.extend(difference_lines(rec, actual[i]))
            break
    msg.append(regen_hint(part))
    msg.append(f"To compare every value of two versions: python -m tests.regen_goldens {part} --dump <folder>")
    raise AssertionError("\n".join(msg))
