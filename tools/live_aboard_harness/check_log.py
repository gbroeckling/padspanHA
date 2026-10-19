"""Read one harness check's output and say whether it really passed.

    python check_log.py <name.log> [script exit code]

Exit 0: it ran clean. Exit 1: it ran, but something's wrong (printed).
Exit 2: it never got going (it crashed, or Live Aboard's 3D view didn't
start), so it's worth another try in a fresh browser.

The pw_*.py scripts print their state and error lists rather than asserting,
so their exit code alone doesn't make a pass (issue #95).
"""

import ast
import re
import sys

NOISE = ("GL Driver Message",)  # WebGL performance notes from the GPU driver


def verdict(text: str, code: int = 0) -> tuple[int, list[str]]:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if code != 0 or "Traceback" in text or "no button" in text:
        return 2, ["didn't run: " + (lines[-1][:200] if lines else f"exit {code}, no output")]
    problems: list[str] = []
    # The error lists the scripts print: errs [...], errors: [...], bad [...]
    for m in re.finditer(r"^(?:errs|errors|bad)\s*:?\s*(\[.*\])\s*$", text, re.M):
        try:
            items = ast.literal_eval(m.group(1))
        except (ValueError, SyntaxError):
            problems.append("unreadable error list: " + m.group(1)[:160])
            continue
        problems += [str(i)[:200] for i in items if not any(n in str(i) for n in NOISE)]
    # A Live Aboard state that reports a failure ('failed': None / "failed": null is fine)
    for m in re.finditer(r"""["']failed["']:(?!\s*(?:None|null)\b)\s*([^,}\]]+)""", text):
        problems.append("state failed: " + m.group(1)[:160])
    return (1 if problems else 0), problems


if __name__ == "__main__":
    text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
    rc, problems = verdict(text, int(sys.argv[2]) if len(sys.argv) > 2 else 0)
    if problems:
        print("\n".join("    " + p for p in problems))
    sys.exit(rc)
