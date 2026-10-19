"""The whole PadSpan test pass in one command, on Windows or macOS (issue #97).

    python tools/test_all.py [--no-suite] [--no-harness] [--no-live]

  1. the pytest suite (JS tests and the Bright build included), at low priority
  2. the Live Aboard harness, 14 checks (tools/live_aboard_harness/run_all.py)
  3. a read-only check of a running Home Assistant (tools/ha_live_check.py),
     only when PADSPAN_HA_URL and PADSPAN_HA_TOKEN_FILE are set

PADSPAN_HARNESS_CDP runs parts 2 and 3 in a browser that is already running,
another machine's through an SSH tunnel (a wall screen's own GPU); see
tools/live_aboard_harness/browser.py. Logs go to tools/test_runs/<stamp>/.
Exit 0 only when every part that ran passed.
"""

import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tools" / "test_runs" / time.strftime("%Y%m%d-%H%M%S")
ENV = {**os.environ, "PYTHONIOENCODING": "utf-8"}


def low_priority() -> dict:
    """Run a child at low CPU priority, so a busy machine (a DJ set, a wall screen) stays smooth."""
    if sys.platform.startswith("win"):
        return {"creationflags": subprocess.BELOW_NORMAL_PRIORITY_CLASS}
    return {"preexec_fn": lambda: os.nice(10)}


def run(name: str, cmd: list[str]) -> tuple[int, str]:
    log = OUT / f"{name}.log"
    with open(log, "w", encoding="utf-8") as fh:
        rc = subprocess.run(cmd, cwd=ROOT, stdout=fh, stderr=subprocess.STDOUT, env=ENV, **low_priority()).returncode
    return rc, log.read_text(encoding="utf-8", errors="replace")


def last(pattern: str, text: str) -> str:
    hits = re.findall(pattern, text, re.M)
    return hits[-1].strip(" =") if hits else ""


def main() -> int:
    args = set(sys.argv[1:])
    unknown = args - {"--no-suite", "--no-harness", "--no-live"}
    if unknown:
        sys.exit(__doc__)
    OUT.mkdir(parents=True, exist_ok=True)
    version = re.search(r'"version":\s*"([^"]+)"', (ROOT / "custom_components/padspan_ha/manifest.json").read_text()).group(1)
    print(f"PadSpan test pass {time.strftime('%Y-%m-%d %H:%M')} | repo {version} | logs: {OUT}")
    results: dict[str, str] = {}

    if "--no-suite" not in args:
        print("suite...", flush=True)
        rc, text = run("suite", [sys.executable, "-m", "pytest", "tests", "-q", "--no-header", "-p", "no:cacheprovider"])
        results["Suite"] = ("PASS" if rc == 0 else "FAIL") + "  " + last(r"^=*\s*(\d+ (?:passed|failed).*?)\s*=*$", text)

    if "--no-harness" not in args:
        print("browser checks...", flush=True)
        rc, text = run("harness", [sys.executable, "tools/live_aboard_harness/run_all.py", str(OUT / "harness")])
        results["Browser checks"] = ("PASS" if rc == 0 else "FAIL") + "  " + last(r"^(\d+ passed, .*?)\. Logs", text)

    if "--no-live" not in args:
        if os.environ.get("PADSPAN_HA_URL") and os.environ.get("PADSPAN_HA_TOKEN_FILE"):
            print("live HA check...", flush=True)
            ENV["PADSPAN_LIVE_OUT"] = str(OUT / "live")
            rc, text = run("live", [sys.executable, "tools/ha_live_check.py"])
            ha = last(r"^PadSpan on Home Assistant: (\S+)", text)
            results["Live HA"] = ("PASS" if rc == 0 else "FAIL") + f"  HA {ha}: " + last(r"^SUMMARY: (.*)$", text)
        else:
            results["Live HA"] = "SKIP  set PADSPAN_HA_URL and PADSPAN_HA_TOKEN_FILE to run it"

    print()
    for k, v in results.items():
        print(f"  {k:15} {v}")
    failed = any(v.startswith("FAIL") for v in results.values())
    print("Overall:", "FAIL" if failed else "PASS")
    (OUT / "summary.txt").write_text("\n".join(f"{k}: {v}" for k, v in results.items()) + "\n", encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
