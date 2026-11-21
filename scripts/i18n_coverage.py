# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""How much of the panel is translated, per language.

English is the source text and the key (views/i18n.js): a string the code
asks for with t("...") or tn(n, "...", "...") is a key. Two groups:

  help   help_content.js, the ? pages        -> i18n/<lang>/help.json
  panel  every other file that imports i18n  -> i18n/<lang>/panel.json

For each shipped language and group this prints how many of the code's keys
have a translation, and which files already ask for their words through t()
(the rest of the panel is still plain English text, not counted as keys).

    python scripts/i18n_coverage.py            # the table
    python scripts/i18n_coverage.py --missing  # and each key still English
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
HELPER = WWW / "views" / "i18n.js"
HELP = WWW / "help_content.js"

_JS_STR = r'"((?:[^"\\]|\\.)*)"'
T_RE = re.compile(r"(?<![\w.$])t\(\s*" + _JS_STR)
TN_RE = re.compile(r"(?<![\w.$])tn\(\s*[^,()]+,\s*" + _JS_STR + r"\s*,\s*" + _JS_STR)


def unjs(s: str) -> str:
    return json.loads('"' + s + '"')


def shipped() -> list[str]:
    m = re.search(r"export const LANGUAGES = Object\.freeze\(\[([^\]]*)\]\);", HELPER.read_text(encoding="utf-8"))
    return re.findall(r'"([a-z]{2,3})"', m.group(1)) if m else []


def group_files() -> dict[str, list[Path]]:
    """The files whose t()/tn() strings make each group's keys."""
    users = [p for p in sorted(WWW.rglob("*.js"))
             if p != HELPER and "vendor" not in p.parts and "i18n.js" in p.read_text(encoding="utf-8")]
    return {"help": [p for p in users if p == HELP], "panel": [p for p in users if p != HELP]}


def keys_in(files: list[Path]) -> dict[str, Path]:
    """English key -> the first file that asks for it (tn(): the "other" form)."""
    out: dict[str, Path] = {}
    for p in files:
        src = p.read_text(encoding="utf-8")
        for m in T_RE.finditer(src):
            out.setdefault(unjs(m.group(1)), p)
        for m in TN_RE.finditer(src):
            out.setdefault(unjs(m.group(2)), p)
    return out


def coverage() -> dict[str, dict[str, dict]]:
    """{group: {lang: {"keys": n, "translated": n, "missing": [key, ...]}}}."""
    res: dict[str, dict[str, dict]] = {}
    for group, files in group_files().items():
        keys = keys_in(files)
        res[group] = {}
        for lang in shipped():
            f = WWW / "i18n" / lang / f"{group}.json"
            data = json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {}
            missing = [k for k in keys if k not in data]
            res[group][lang] = {"keys": len(keys), "translated": len(keys) - len(missing), "missing": missing}
    return res


def main(argv: list[str]) -> int:
    cov = coverage()
    for group, langs in cov.items():
        for lang, c in langs.items():
            pct = 100.0 * c["translated"] / c["keys"] if c["keys"] else 100.0
            print(f"{group:6} {lang}: {c['translated']:4} of {c['keys']:4} keys translated ({pct:.0f}%)")
            if "--missing" in argv:
                for k in c["missing"]:
                    print(f"         still English: {k!r}")
    views = sorted(p for p in (WWW / "views").glob("*.js") if p != HELPER)
    asking = [p for p in group_files()["panel"]]
    print(f"files asking for their words through t(): {len(asking)} "
          f"({', '.join(str(p.relative_to(WWW)).replace(chr(92), '/') for p in asking)}); "
          f"view files in all: {len(views)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
