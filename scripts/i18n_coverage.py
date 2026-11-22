# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""How much of the panel is translated, per language.

English is the source text and the key (views/i18n.js): a string the code
asks for with t("...") or tn(n, "...", "...") is a key. The groups, each
i18n/<lang>/<group>.json:

  help     help_content.js, the ? pages
  panel    panel.js (the shell) and every file that imports i18n and is not in GROUPS
  setup, screens, health, devices
           the files GROUPS lists for each (a file's words go with its screen)
  server   the sentences the backend sends that the panel shows as they are:
           every send_error message and System Critics' title, message and
           action that is one whole sentence in the source (server_sentences).
           views/ui_error.js looks them up by their exact English (serverText).

The panel asks for every group but help at startup (panel.js
_loadPanelLanguage), so no screen waits for its words; each group file stays
under 60 KiB (tests/test_panel_i18n.py).

For each shipped language and group this prints how many of the keys have a
translation, and which files already ask for their words through t() (the
rest of the panel is still plain English text, not counted as keys).

    python scripts/i18n_coverage.py            # the table
    python scripts/i18n_coverage.py --missing  # and each key still English
"""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "custom_components" / "padspan_ha"
WWW = PKG / "www" / "padspan-ha"
HELPER = WWW / "views" / "i18n.js"
HELP = WWW / "help_content.js"

_JS_STR = r'"((?:[^"\\]|\\.)*)"'
T_RE = re.compile(r"(?<![\w.$])t\(\s*" + _JS_STR)
TN_RE = re.compile(r"(?<![\w.$])tn\(\s*[^,()]+,\s*" + _JS_STR + r"\s*,\s*" + _JS_STR)

# The files of each group but panel and help, relative to www/padspan-ha/.
GROUPS: dict[str, tuple[str, ...]] = {
    "setup": ("views/setup.js", "views/setup_status.js", "views/maps.js", "views/iphone_irk.js"),
    "screens": ("views/overview.js", "views/whos_where.js", "views/receiver_room.js", "views/map_text.js",
                "views/follow.js", "views/locate.js", "views/occupancy.js"),
    "health": ("views/health.js", "views/diagnostics.js"),
    "devices": ("views/bluetooth.js", "views/receivers.js", "views/devices.js", "views/objects.js",
                "views/device_name.js"),
}
SERVER = "server"


def unjs(s: str) -> str:
    return json.loads('"' + s + '"')


def shipped() -> list[str]:
    m = re.search(r"export const LANGUAGES = Object\.freeze\(\[([^\]]*)\]\);", HELPER.read_text(encoding="utf-8"))
    return re.findall(r'"([a-z]{2,3})"', m.group(1)) if m else []


def group_files() -> dict[str, list[Path]]:
    """The files whose t()/tn() strings make each group's keys (all but server)."""
    users = [p for p in sorted(WWW.rglob("*.js"))
             if p != HELPER and "vendor" not in p.parts and "i18n.js" in p.read_text(encoding="utf-8")]
    named = {g: [WWW / f for f in files] for g, files in GROUPS.items()}
    taken = {p for files in named.values() for p in files}
    out = {"help": [p for p in users if p == HELP],
           "panel": [p for p in users if p != HELP and p not in taken]}
    for g, files in named.items():
        out[g] = [p for p in users if p in files]
    return out


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


def _consts(trees: dict[Path, ast.Module]) -> tuple[dict[Path, dict[str, str]], dict[str, set[str]]]:
    """Module-level NAME = "sentence" in each backend file, and every value by name."""
    local: dict[Path, dict[str, str]] = {}
    anywhere: dict[str, set[str]] = {}
    for p, tree in trees.items():
        local[p] = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) \
                    and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                local[p][node.targets[0].id] = node.value.value
                anywhere.setdefault(node.targets[0].id, set()).add(node.value.value)
    return local, anywhere


def _whole(node: ast.AST, here: dict[str, str], anywhere: dict[str, set[str]]) -> list[str]:
    """The whole sentences a message expression can be: a literal, a constant
    by name, either side of an if/else or an `or`. An f-string or a sentence
    joined with something else is not one (it can't be looked up exactly)."""
    if isinstance(node, ast.Constant):
        return [node.value] if isinstance(node.value, str) else []
    if isinstance(node, ast.Name):
        return [here[node.id]] if node.id in here else sorted(anywhere.get(node.id, ()))
    if isinstance(node, ast.Attribute):
        return sorted(anywhere.get(node.attr, ()))
    if isinstance(node, ast.IfExp):
        return _whole(node.body, here, anywhere) + _whole(node.orelse, here, anywhere)
    if isinstance(node, ast.BoolOp):
        return [w for v in node.values for w in _whole(v, here, anywhere)]
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "str" and node.args:
        return _whole(node.args[0], here, anywhere)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and len(node.args) == 2:
        return _whole(node.args[1], here, anywhere)
    return []


# System Critics' words (ws_diagnostics.py), shown by Health: these keys of each critic.
CRITIC_FIELDS = ("title", "message", "action")


def server_sentences() -> dict[str, Path]:
    """English sentence -> the backend file that sends it: every send_error
    message, and each critic's title / message / action, that is one whole
    sentence in the source. Words a person reads (two or more of them)."""
    trees = {p: ast.parse(p.read_text(encoding="utf-8")) for p in sorted(PKG.glob("*.py"))}
    local, anywhere = _consts(trees)
    out: dict[str, Path] = {}
    for p, tree in trees.items():
        for node in ast.walk(tree):
            said: list[str] = []
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "send_error" \
                    and len(node.args) >= 3:
                said = _whole(node.args[2], local[p], anywhere)
            elif p.name == "ws_diagnostics.py" and isinstance(node, ast.Dict):
                for k, v in zip(node.keys, node.values):
                    if isinstance(k, ast.Constant) and k.value in CRITIC_FIELDS:
                        said += _whole(v, local[p], anywhere)
            for s in said:
                if len(s.split()) >= 2:
                    out.setdefault(s, p)
    return out


def group_keys() -> dict[str, dict[str, Path]]:
    """Every group's keys: help and the panel's groups from the code's t()/tn(), server from the backend."""
    out = {g: keys_in(files) for g, files in group_files().items()}
    out[SERVER] = server_sentences()
    return out


def coverage() -> dict[str, dict[str, dict]]:
    """{group: {lang: {"keys": n, "translated": n, "missing": [key, ...]}}}."""
    res: dict[str, dict[str, dict]] = {}
    for group, keys in group_keys().items():
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
            print(f"{group:7} {lang}: {c['translated']:4} of {c['keys']:4} keys translated ({pct:.0f}%)")
            if "--missing" in argv:
                for k in c["missing"]:
                    print(f"         still English: {k!r}")
    views = sorted(p for p in (WWW / "views").glob("*.js") if p != HELPER)
    asking = [p for g, files in group_files().items() if g != "help" for p in files]
    print(f"files asking for their words through t(): {len(asking)} "
          f"({', '.join(sorted(str(p.relative_to(WWW)).replace(chr(92), '/') for p in asking))}); "
          f"view files in all: {len(views)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
