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
