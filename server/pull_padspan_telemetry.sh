#!/usr/bin/env bash
# Nightly pull of the PadSpan opt-in usage reports: colo bcmail (75.157.233.12)
# -> home 5810 RAID. The web host holds a WRITE-ONLY spool; the data lives here,
# inside the knowledge tree that already gets backed up to UNAS weekly.
#
# The reports are counts/versions/flags only (see the PadSpan README "Help
# improve PadSpan") — no addresses, keys, names or coordinates. They are still
# other people's installs, so they live on the RAID, not in a repo.
#
# Pull-based (not push) because the colo box cannot reach home behind NAT.
# The spool dir is www-data-owned -> rsync through "sudo rsync" (administrator
# has sudo there). Same shape as backup_traks_db_offsite.sh.
#
# It also brings home the "Become a tester" sign-ups (server/tester.php) — a
# separate file WITH contact details, kept in its own folder; see that block.
set -euo pipefail

SRC_HOST="administrator@75.157.233.12"
SRC_DIR="/var/www/clients/client1/web10/private/padspan-telemetry/"
DEST="/mnt/storage/knowledge/padspan-telemetry"
LOG="$DEST/pull.log"
SUMMARY="$DEST/summary-latest.txt"
SUMMARISER="/home/administrator/telemetry_summary.py"
SPOOL_KEEP_DAYS=90        # how long a day's reports stay on the colo web host

# --- Telegram alerting, failure only (same pattern as the other backups).
# A silent failure here is how you discover months later that nobody's usage
# data ever came home. ---
CHAT=8841564535
TOKEN=$(grep -aoE '"botToken"[ :]+"[^"]+"' /home/administrator/.openclaw/openclaw.json | head -1 | sed -E 's/.*"botToken"[ :]+"([^"]+)"/\1/')
tg(){ curl -s -m 20 "https://api.telegram.org/bot${TOKEN}/sendMessage" --data-urlencode "chat_id=${CHAT}" --data-urlencode "text=$1" >/dev/null; }

mkdir -p "$DEST"
ts() { date '+%F %T'; }

# --- Pull. No --delete: what came home stays home, whatever the spool does. ---
if ! rsync -az --rsync-path="sudo rsync" \
        -e "ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new" \
        "$SRC_HOST:$SRC_DIR" "$DEST/" >>"$LOG" 2>&1; then
    echo "$(ts) ERROR: rsync pull failed" >>"$LOG"
    tg "[WARN] PadSpan telemetry $(ts): rsync pull from colo FAILED - usage reports are NOT coming home."
    exit 1
fi

# --- Integrity: every line of every file must be JSON carrying a report.
# A truncated append (two writers, one disk-full) would otherwise sit here
# looking like data until the summariser choked on it months later. ---
bad=0
for f in "$DEST"/*.jsonl; do
    [ -e "$f" ] || continue
    if ! python3 - "$f" <<'PY' >>"$LOG" 2>&1
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as fh:
    for n, line in enumerate(fh, 1):
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)          # raises on a torn line
        if not isinstance(rec.get("report"), dict) or not rec["report"].get("install_id"):
            raise ValueError(f"{path}:{n} has no report/install_id")
PY
    then
        echo "$(ts) CORRUPT: $f" >>"$LOG"
        bad=1
    fi
done

# --- What we hold, and whether today's spool actually arrived. ---
files=$(ls -1 "$DEST"/*.jsonl 2>/dev/null | wc -l)
lines=$(cat "$DEST"/*.jsonl 2>/dev/null | grep -c . || true)
installs=$(cat "$DEST"/*.jsonl 2>/dev/null | python3 -c 'import sys,json;print(len({json.loads(l)["report"]["install_id"] for l in sys.stdin if l.strip()}))' 2>/dev/null || echo "?")
echo "$(ts) OK files=$files lines=$lines installs=$installs corrupt=$bad" >>"$LOG"

# --- Refresh the human-readable summary beside the data, so the answer to
# "what do other people's installs look like" is a file, not a command. ---
if [ -x "$SUMMARISER" ] || [ -f "$SUMMARISER" ]; then
    python3 "$SUMMARISER" "$DEST" --days 30 >"$SUMMARY" 2>>"$LOG" || true
fi

# --- "Become a tester" sign-ups (server/tester.php). NOT usage reports: the
# one file with contact details in it, so it lives apart from the reports, in
# its own folder that only administrator can read. A read-only pull of that
# one file — nothing on the colo is changed or trimmed — and the copy here is
# REPLACED each night, never accumulated, so a sign-up withdrawn there is gone
# from here by the next pull. When the new copy holds tester_ids the previous
# one did not: ONE Telegram message to Garry (the tg() above, CHAT only) —
# how many, and for each the email, interests and PadSpan version. Nothing
# else from the record goes into the message. ---
T_SRC="/var/www/clients/client1/web10/private/padspan-testers/testers.json"
T_DEST="/mnt/storage/knowledge/padspan-testers"
(umask 077; mkdir -p "$T_DEST")
chmod 700 "$T_DEST"
t_there=0
ssh -o BatchMode=yes -o ConnectTimeout=20 "$SRC_HOST" "sudo test -f '$T_SRC'" 2>>"$LOG" || t_there=$?
if [ "$t_there" -eq 1 ]; then
    echo "$(ts) testers: no sign-ups on the colo yet" >>"$LOG"
elif [ "$t_there" -ne 0 ]; then
    echo "$(ts) ERROR: could not check the colo for testers.json (ssh exit $t_there)" >>"$LOG"
    tg "[WARN] PadSpan testers $(ts): could not check the colo for tester sign-ups - see $LOG" || true
else
    if rsync -a --rsync-path="sudo rsync" \
            -e "ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new" \
            "$SRC_HOST:$T_SRC" "$T_DEST/.testers.json.new" >>"$LOG" 2>&1; then
        chmod 600 "$T_DEST/.testers.json.new"
        if new_msg=$(python3 - "$T_DEST/testers.json" "$T_DEST/.testers.json.new" 2>>"$LOG" <<'TESTERS_PY'
import json, sys
prev_path, new_path = sys.argv[1], sys.argv[2]
with open(new_path, encoding="utf-8") as fh:
    new = json.load(fh)                 # a torn or corrupt copy raises: it is not kept
testers = new.get("testers") if isinstance(new, dict) else None
if not isinstance(testers, dict):
    raise SystemExit("testers.json has no testers object")
try:
    with open(prev_path, encoding="utf-8") as fh:
        old = json.load(fh)
    prev = old["testers"] if isinstance(old, dict) and isinstance(old.get("testers"), dict) else {}
except (OSError, ValueError):             # first pull, or an unreadable old copy
    prev = {}
fresh = [t for t in testers if t not in prev]
if fresh:
    head = f"PadSpan: {len(fresh)} new tester sign-up{'' if len(fresh) == 1 else 's'}"
    lines = []
    for tid in fresh:
        rec = testers.get(tid) if isinstance(testers.get(tid), dict) else {}
        contact = rec.get("contact") if isinstance(rec.get("contact"), dict) else {}
        email = str(contact.get("email") or "?")[:254]
        interests = ", ".join(str(i) for i in (rec.get("interests") or [])) or "none ticked"
        lines.append(f"- {email} | {interests} | PadSpan {str(rec.get('version') or '?')[:32]}")
    # One Telegram message holds 4096 characters.
    body, shown = head, 0
    for line in lines:
        if len(body) + len(line) + 60 > 3800:
            break
        body += "\n" + line
        shown += 1
    if shown < len(lines):
        body += f"\n(+{len(lines) - shown} more in testers.json)"
    print(body)
TESTERS_PY
        ); then
            mv -f "$T_DEST/.testers.json.new" "$T_DEST/testers.json"
            echo "$(ts) testers: pulled OK" >>"$LOG"
            if [ -n "$new_msg" ]; then
                tg "$new_msg" || echo "$(ts) WARN: Telegram notice of new tester sign-ups failed" >>"$LOG"
            fi
        else
            rm -f "$T_DEST/.testers.json.new"
            echo "$(ts) ERROR: testers.json from the colo is not readable JSON - previous copy kept" >>"$LOG"
            tg "[WARN] PadSpan testers $(ts): testers.json on the colo is not readable JSON - see $LOG" || true
        fi
    else
        rm -f "$T_DEST/.testers.json.new"
        echo "$(ts) ERROR: rsync pull of testers.json failed" >>"$LOG"
        tg "[WARN] PadSpan testers $(ts): pull of tester sign-ups from colo FAILED - see $LOG" || true
    fi
fi

if [ "$bad" -ne 0 ]; then
    tg "[WARN] PadSpan telemetry $(ts): pulled OK but $DEST holds a corrupt/torn .jsonl - see $LOG"
    exit 1
fi

# --- Trim the colo spool. The web host is a BUFFER; home is the archive, and
# home never deletes. A day is removed from the spool only when a file of the
# same name and the same byte count is already here — so a day that failed to
# come home is never trimmed, whatever its age. Nothing here can delete
# anything under $DEST. ---
trimmed=0
while IFS=$'\t' read -r name size; do
    [ -n "$name" ] || continue
    local_file="$DEST/$name"
    [ -f "$local_file" ] || continue
    local_size=$(stat -c%s "$local_file" 2>/dev/null || echo -1)
    [ "$local_size" = "$size" ] || continue          # not fully home yet — keep it there
    if ssh -o BatchMode=yes -o ConnectTimeout=20 "$SRC_HOST" \
           "sudo rm -f -- '$SRC_DIR$name'" >>"$LOG" 2>&1; then
        echo "$(ts) trimmed from spool: $name ($size bytes, safe at home)" >>"$LOG"
        trimmed=$((trimmed + 1))
    else
        echo "$(ts) WARN: could not trim $name from spool" >>"$LOG"
    fi
done < <(ssh -o BatchMode=yes -o ConnectTimeout=20 "$SRC_HOST" \
         "sudo find '$SRC_DIR' -maxdepth 1 -name '*.jsonl' -mtime +$SPOOL_KEEP_DAYS -printf '%f\t%s\n'" 2>>"$LOG")
[ "$trimmed" -gt 0 ] && echo "$(ts) spool trim: $trimmed file(s) older than ${SPOOL_KEEP_DAYS}d removed" >>"$LOG"

exit 0
