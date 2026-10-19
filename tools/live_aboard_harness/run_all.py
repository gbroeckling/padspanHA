"""Run every harness check and say which really passed (issue #95).

    python tools/live_aboard_harness/run_all.py [out_dir]

Serves the repo itself on 127.0.0.1:8765 unless something already answers
there, runs each pw_*.py in a fresh headless browser (browser.py picks it),
and judges each log with check_log.py. A check that never got going (its 3D
view didn't start) gets up to 3 tries; earlier tries' logs are kept as
<name>.try<N>.log. Exit 0 only when all pass.
"""

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from check_log import verdict  # noqa: E402

URL = "http://127.0.0.1:8765/tools/live_aboard_harness/index.html"
SEG = "main,6,10,7,10"   # the main-floor wall pw_sheet.py draws its door on
TRIES = 3
CHECKS = (
    [("load", ["pw_load.py"]), ("help", ["pw_help.py"]), ("tool", ["pw_tool.py"]), ("sheet", ["pw_sheet.py", "sheet.png"])]
    + [(f"door-{t}", ["pw_door.py", t, SEG, f"door-{t}.png"]) for t in ("Door", "Window", "Doorway")]
    + [(f"flow-{s}", ["pw_flow.py", s, f"flow-{s}"]) for s in ("draw", "corner", "taps", "resize", "undo", "keys", "strip")]
)


def answers(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=5):
            return True
    except OSError:
        return False


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "out" / time.strftime("%Y%m%d-%H%M%S")).resolve()
    out.mkdir(parents=True, exist_ok=True)
    server = None
    if not answers(URL):
        server = subprocess.Popen([sys.executable, str(HERE / "serve.py")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            if answers(URL):
                break
            time.sleep(0.5)
        else:
            print("The harness server didn't come up on 127.0.0.1:8765.")
            server.terminate()
            return 1
    passed = flagged = failed = retried = 0
    try:
        for name, cmd in CHECKS:
            log = out / f"{name}.log"
            for attempt in range(1, TRIES + 1):
                if attempt > 1:
                    log.replace(out / f"{name}.try{attempt - 1}.log")
                with open(log, "w", encoding="utf-8") as fh:
                    # UTF-8 out: the scripts print ▾ and − (Windows would write cp1252 and crash).
                    code = subprocess.run([sys.executable, str(HERE / cmd[0]), *cmd[1:]], cwd=out,
                                          stdout=fh, stderr=subprocess.STDOUT,
                                          env={**os.environ, "PYTHONIOENCODING": "utf-8"}).returncode
                rc, problems = verdict(log.read_text(encoding="utf-8", errors="replace"), code)
                if rc != 2:
                    break
            note = f" (try {attempt} of {TRIES})" if attempt > 1 else ""
            retried += attempt > 1
            label = {0: "pass", 1: "FLAGGED"}.get(rc, "FAIL")
            print(f"{name:14} {label}{note}")
            for p in problems if rc else []:
                print("    " + p)
            passed += rc == 0
            flagged += rc == 1
            failed += rc == 2
    finally:
        if server:
            server.terminate()
    print(f"{passed} passed, {flagged} flagged, {failed} failed ({retried} needed a retry). Logs and screenshots: {out}")
    return 0 if not (flagged or failed) else 1


if __name__ == "__main__":
    sys.exit(main())
