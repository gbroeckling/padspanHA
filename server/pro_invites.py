#!/usr/bin/env python3
"""The free-year PadSpan Pro invite list (private/padspan-invites.json).

telemetry.php hands an invited install its token in the report's reply (0.38.124
and later only); the licence server's invite_claim / invite_decline answer it.
This is the hand that writes the list. Run on the web host as the web user:

    sudo -u www-data python3 pro_invites.py add 83902182 d89ebbcb --until 2026-12-31 --wave 1
    sudo -u www-data python3 pro_invites.py list

An install is named by its anonymous id or the first 8 characters of it (the
Pro Candidates tab), resolved against the report ledger. Adding an install
that is already on the list changes nothing.
"""

import argparse
import fcntl
import json
import os
import re
import secrets
import sys

PRIVATE = "/var/www/clients/client1/web10/private"
LIST = os.path.join(PRIVATE, "padspan-invites.json")
LEDGER = os.path.join(PRIVATE, "padspan-telemetry", "installs.json")


def resolve(name, ids):
    hits = [i for i in ids if i.startswith(name.lower())]
    if len(hits) != 1:
        sys.exit(f"{name}: {'no install' if not hits else 'more than one install'} starts with that")
    return hits[0]


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("installs", nargs="+")
    a.add_argument("--until", required=True)
    a.add_argument("--wave", type=int, default=1)
    sub.add_parser("list")
    args = ap.parse_args()

    with open(LIST, "r+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        inv = json.loads(f.read() or "{}")
        if args.cmd == "add":
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.until):
                sys.exit("--until is YYYY-MM-DD")
            with open(LEDGER, encoding="utf-8") as lf:
                ids = list(json.load(lf))
            for name in args.installs:
                iid = resolve(name, ids)
                if iid in inv:
                    print(f"{iid[:8]}  already {inv[iid].get('status')}")
                    continue
                inv[iid] = {"token": secrets.token_hex(16), "until": args.until, "status": "invited", "wave": args.wave}
                print(f"{iid[:8]}  invited (wave {args.wave}, until {args.until})")
            f.seek(0)
            f.truncate()
            f.write(json.dumps(inv, indent=4))
        for iid, e in sorted(inv.items(), key=lambda kv: (kv[1].get("wave", 0), kv[0])):
            if args.cmd == "list":
                print(f"{iid[:8]}  wave {e.get('wave', '-')}  {e.get('status'):<9}  until {e.get('until')}"
                      f"  {e.get('delivered', '')}  {e.get('answered', '')}")


if __name__ == "__main__":
    main()
