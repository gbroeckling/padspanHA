"""Every frontend module must actually parse as an ES module.

Twice in one session a real SyntaxError shipped, because the checks in use
could not see it:

  * `node --check file.js` treats a .js file as CommonJS, so it rejects the
    top-level `await import(...)` these modules are built on. Every run looked
    like a failure for the wrong reason, and the output was ignored.
  * `node --input-type=module -e "await import(...)"` fails the same way for
    the same reason.
  * The test suite copies a couple of files to .mjs to exercise the renderer,
    which covers those files and nothing else.

So a duplicate `const _esc` in an extracted module sailed through, and the
symptom was not a crash: panel.js loads views with a `.catch()` that logs
console.WARN and returns null, so a module that fails to parse becomes a
blank view with no errors in the console. It took a direct `await import()`
in the browser to see the real message.

Copying to .mjs is the whole trick — `node --check` parses .mjs as a module,
top-level await and all.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _js_files() -> list[Path]:
    out = sorted(_WWW.glob("*.js")) + sorted((_WWW / "views").glob("*.js"))
    return [p for p in out if "lib" not in p.parts]


def test_every_frontend_module_parses():
    files = _js_files()
    assert len(files) >= 25, f"only found {len(files)} modules — the glob is wrong"
    broken = {}
    with tempfile.TemporaryDirectory() as td:
        for path in files:
            mjs = Path(td) / (path.stem + ".mjs")
            mjs.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
            res = subprocess.run([_NODE, "--check", str(mjs)],
                                 capture_output=True, text=True, encoding="utf-8", timeout=60)
            if res.returncode != 0:
                msg = [l for l in (res.stderr or "").splitlines() if "Error" in l]
                broken[path.name] = msg[0] if msg else (res.stderr or "").strip()[:200]
    assert not broken, (
        "these modules do not parse — panel.js turns that into a blank view "
        "with only a console.warn, so it will not look like a crash:\n  "
        + "\n  ".join(f"{k}: {v}" for k, v in broken.items())
    )


def test_the_parse_check_can_actually_fail():
    """Proof the harness rejects bad syntax rather than passing everything."""
    with tempfile.TemporaryDirectory() as td:
        bad = Path(td) / "bad.mjs"
        bad.write_text("const a = 1;\nconst a = 2;\n", encoding="utf-8")
        res = subprocess.run([_NODE, "--check", str(bad)],
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert res.returncode != 0, "the parse check accepts a duplicate declaration"
        # ...and that it accepts the top-level await these modules rely on.
        good = Path(td) / "good.mjs"
        good.write_text('const { x } = await import("./nope.mjs");\n', encoding="utf-8")
        res2 = subprocess.run([_NODE, "--check", str(good)],
                              capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert res2.returncode == 0, "the parse check rejects top-level await"
