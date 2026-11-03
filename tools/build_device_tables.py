#!/usr/bin/env python3
# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Regenerate PadSpan's built-in name tables. Run by hand before a stable.

    python tools/build_device_tables.py               download the lists, write the tables
    python tools/build_device_tables.py --from DIR    the same from copies already downloaded:
                                                      DIR/ieee/{oui,mam,oui36}.csv and
                                                      DIR/sig_yaml/{company_identifiers,member_uuids}.yaml

What it writes, under custom_components/padspan_ha/data/, read by device_tables.py:
    bt_companies.tsv   Bluetooth SIG company numbers and names
    bt_members.tsv     16-bit service UUIDs SIG assigned to a company, and whose
    mac_makers.bin     IEEE MA-L, MA-M and MA-S address blocks and who owns each

Numbers and names only. No source file, header, postal address or other text
is copied. The tables are committed, so a release never asks IEEE or SIG for
anything, and a house never does. A list that comes back short or wrong stops
this tool before anything is written. Standard library only, so it needs no
Home Assistant and nothing from requirements_test.txt.
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import struct
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "custom_components" / "padspan_ha" / "data"

SIG = "https://bitbucket.org/bluetooth-SIG/public/raw/main/assigned_numbers/"
SOURCES = {
    "company_identifiers.yaml": SIG + "company_identifiers/company_identifiers.yaml",
    "member_uuids.yaml": SIG + "uuids/member_uuids.yaml",
    "oui.csv": "https://standards-oui.ieee.org/oui/oui.csv",
    "mam.csv": "https://standards-oui.ieee.org/oui28/mam.csv",
    "oui36.csv": "https://standards-oui.ieee.org/oui36/oui36.csv",
}
# IEEE answers 418 to the default urllib and requests user agents.
USER_AGENT = "PadSpan-table-builder/1.0 (+https://padspan.traks.ca)"

MAGIC = b"PSMAC1"
# Longest name kept, cut at a word: the badge is small and the table ships in every install.
NAME_CAP = 28
# Fewer than this and the download is broken or the format changed. Stop, write nothing.
MIN_COMPANIES, MIN_MEMBERS, MIN_BLOCKS = 4000, 700, 50000
# Who must come out right, whatever else the lists do.
KNOWN_COMPANIES = {0x004C: "Apple", 0x0006: "Microsoft", 0x0075: "Samsung Electronics",
                   0x0059: "Nordic Semiconductor", 0x0087: "Garmin International"}
KNOWN_MEMBERS = {"fef3": "Google", "fd5a": "Samsung Electronics"}
# What an IEEE row can say that isn't a maker. A Registration Authority row is
# the parent of MA-M and MA-S blocks, which name the real owner themselves.
NOT_A_MAKER = {"", "private", "ieee registration authority"}

_LEGAL = re.compile(
    r"(?:^|[\s,]+)(?:inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.l\.c|llp|lp|plc|pty|pte|pvt"
    r"|private|gmbh|mbh|kg|ag|ab|as|asa|a/s|aps|oy|oyj|bv|b\.v|nv|n\.v|sa|s\.a|sas|s\.a\.s|sarl|srl|s\.r\.l|spa"
    r"|s\.p\.a|sl|s\.l|kk|k\.k|bhd|sdn|eood|ood|doo|d\.o\.o|sro|s\.r\.o|ltda)\.?$",
    re.IGNORECASE)


def short_name(name: str) -> str:
    """A company's name as a badge shows it: no legal form, no bracketed
    place, at most NAME_CAP characters, cut at a word."""
    original = re.sub(r"\s+", " ", name.replace("&amp;", "&")).strip(" ,.-")
    s = re.sub(r"\s*\([^)]*\)", "", original).replace("，", ",")
    while True:
        cut = _LEGAL.sub("", s).strip(" ,.-&")
        if cut == s or not cut:
            break
        s = cut
    s = s or original
    if len(s) > NAME_CAP:
        s = s[:NAME_CAP + 1].rsplit(" ", 1)[0].strip(" ,.-&") or s[:NAME_CAP]
    return s


def _yaml_rows(text: str) -> list[tuple[str, str]]:
    """(value, name) pairs of a SIG list: `- value: 0x004C` then `name: '...'`.
    Read by pattern, so no YAML library and none of the file's other text."""
    rows = []
    for m in re.finditer(r"-\s*(?:value|uuid):\s*0x([0-9A-Fa-f]{4})\s*\r?\n\s*name:\s*(.+?)\s*(?:\r?\n|$)", text):
        raw = m.group(2)
        if raw[:1] == "'" and raw[-1:] == "'":
            raw = raw[1:-1].replace("''", "'")
        elif raw[:1] == '"' and raw[-1:] == '"':
            raw = raw[1:-1].replace('\\"', '"')
        rows.append((m.group(1), raw))
    return rows


def _tsv(rows: dict[str, str]) -> bytes:
    return "".join(f"{k}\t{rows[k]}\n" for k in sorted(rows)).encode("utf-8")


def company_table(text: str) -> bytes:
    rows = {v.upper(): short_name(n) for v, n in _yaml_rows(text)}
    if len(rows) < MIN_COMPANIES:
        raise SystemExit(f"company list has only {len(rows)} entries, expected at least {MIN_COMPANIES}")
    for cid, want in KNOWN_COMPANIES.items():
        if rows.get(f"{cid:04X}") != want:
            raise SystemExit(f"company 0x{cid:04X} reads {rows.get(f'{cid:04X}')!r}, expected {want!r}")
    return _tsv(rows)


def member_table(text: str) -> bytes:
    rows = {v.lower(): short_name(n) for v, n in _yaml_rows(text)}
    if len(rows) < MIN_MEMBERS:
        raise SystemExit(f"member list has only {len(rows)} entries, expected at least {MIN_MEMBERS}")
    for uuid, want in KNOWN_MEMBERS.items():
        if rows.get(uuid) != want:
            raise SystemExit(f"member {uuid} reads {rows.get(uuid)!r}, expected {want!r}")
    return _tsv(rows)


def _varint(n: int) -> bytes:
    out = bytearray()
    while n > 0x7F:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)
    return bytes(out)


def mac_table(csvs: dict[str, str]) -> bytes:
    """The binary maker table, smallest of the forms measured in the research.

    Layout (little endian): MAGIC, then four u32s (bytes of names, number of
    24-, 28- and 36-bit blocks); the names, newline separated; then, per block
    size, each sorted prefix as a varint of its distance from the one before,
    then a u16 per block saying which name.
    """
    blocks: dict[int, dict[int, str]] = {24: {}, 28: {}, 36: {}}
    spelling: dict[str, str] = {}
    for fname, bits in (("oui.csv", 24), ("mam.csv", 28), ("oui36.csv", 36)):
        for row in csv.DictReader(io.StringIO(csvs[fname])):
            prefix = (row.get("Assignment") or "").strip().upper()
            full = (row.get("Organization Name") or "").strip()
            if len(prefix) * 4 != bits or full.lower() in NOT_A_MAKER:
                continue
            name = short_name(full)
            # The same company in two spellings is one name; the one with lower
            # case wins over ALL CAPS. A prefix listed twice keeps the first
            # name in sorted order, so a rebuild comes out the same.
            have = spelling.get(name.casefold())
            if have is None or sum(c.islower() for c in name) > sum(c.islower() for c in have):
                spelling[name.casefold()] = name
            key = int(prefix, 16)
            prev = blocks[bits].get(key)
            blocks[bits][key] = min(prev, name) if prev else name
    total = sum(len(b) for b in blocks.values())
    if total < MIN_BLOCKS:
        raise SystemExit(f"IEEE lists hold only {total} blocks, expected at least {MIN_BLOCKS}")
    names = sorted(set(spelling.values()))
    if len(names) > 0xFFFF:
        raise SystemExit(f"{len(names)} maker names do not fit the table's u16 index")
    index = {n: i for i, n in enumerate(names)}
    blob = "\n".join(names).encode("utf-8")
    out = bytearray(MAGIC + struct.pack("<IIII", len(blob), len(blocks[24]), len(blocks[28]), len(blocks[36])))
    out += blob
    for bits in (24, 28, 36):
        last = 0
        ids = bytearray()
        for key in sorted(blocks[bits]):
            out += _varint(key - last)
            last = key
            ids += struct.pack("<H", index[spelling[blocks[bits][key].casefold()]])
        out += ids
    return bytes(out)


def _download(fname: str) -> str:
    req = urllib.request.Request(SOURCES[fname], headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as resp:  # noqa: S310 - fixed https URLs above
        return resp.read().decode("utf-8", errors="replace")


def _local(base: Path, fname: str) -> str:
    sub = "sig_yaml" if fname.endswith(".yaml") else "ieee"
    return (base / sub / fname).read_text(encoding="utf-8", errors="replace")


def build(read) -> dict[str, bytes]:
    """{table file: its bytes}, from read(source file name) -> its text."""
    return {
        "bt_companies.tsv": company_table(read("company_identifiers.yaml")),
        "bt_members.tsv": member_table(read("member_uuids.yaml")),
        "mac_makers.bin": mac_table({f: read(f) for f in ("oui.csv", "mam.csv", "oui36.csv")}),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="source", type=Path, help="read copies from this folder, don't download")
    ap.add_argument("--out", type=Path, default=DATA, help="where to write (default: the integration's data folder)")
    args = ap.parse_args(argv)
    tables = build((lambda f: _local(args.source, f)) if args.source else _download)
    args.out.mkdir(parents=True, exist_ok=True)
    for fname, data in tables.items():
        (args.out / fname).write_bytes(data)
        print(f"{fname}: {len(data):,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
