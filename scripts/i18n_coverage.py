# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""How much of the panel is translated, per language.

English is the source text and the key (views/i18n.js): a string the code
asks for with t("...") or tn(n, "...", "...") is a key. The groups, each
i18n/<lang>/<group>.json:

  help     help_content.js, the ? pages
  panel    panel.js (the shell) and every file that imports i18n and is not in GROUPS
  setup, mapping, stack, plans, calibration, beacon, screens, health, devices, bluetooth, settings, tracking
           the files GROUPS lists for each (a file's words go with its screen;
           a big file's named part with its own group, see Part)
  server   the sentences the backend sends that the panel shows as they are:
           every send_error message and System Critics' title, message and
           action that is one whole sentence in the source, and the template of
           each refusal(...) and critic that puts a value in (server_sentences).
           views/ui_error.js looks them up by the template a sentence came with,
           else by their exact English (serverText).

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

# The files of each group but panel and help, relative to www/padspan-ha/. "views/maps.js#stack" is one named part
# of a file (Part); "views/maps.js" is then that file without its named parts.
GROUPS: dict[str, tuple[str, ...]] = {
    "setup": ("views/setup.js", "views/setup_status.js", "views/iphone_irk.js"),
    "mapping": ("views/maps.js",),
    "stack": ("views/maps.js#stack",),
    "plans": ("views/scale_nudge.js", "views/plan_measure.js", "views/wizard_build.js", "views/rough_plan.js",
              "views/ai_wizard_offer.js"),
    "calibration": ("views/calibration.js", "views/calibration_results.js", "views/calibration_walk.js"),
    "beacon": ("views/calibration.js#beacon",),
    "screens": ("views/overview.js", "views/whos_where.js", "views/receiver_room.js", "views/map_text.js",
                "views/follow.js", "views/locate.js", "views/occupancy.js", "views/plan_viewer.js"),
    "health": ("views/health.js", "views/diagnostics.js"),
    "devices": ("views/receivers.js", "views/devices.js", "views/objects.js", "views/device_name.js"),
    "bluetooth": ("views/bluetooth.js",),
    "settings": ("views/settings.js",),
    "tracking": ("views/settings.js#tracking",),
    "tracking2": ("views/settings.js#tracking2",),
    "features": ("views/settings.js#features",),
    "ai": ("views/settings.js#ai",),
    "atlas": ("views/settings.js#atlas",),
    "manage": ("views/manage.js",),
    "manage2": ("views/manage.js#manage2",),
    "training": ("views/training.js",),
}
SERVER = "server"


def unjs(s: str) -> str:
    return json.loads('"' + s + '"')


def shipped() -> list[str]:
    m = re.search(r"export const LANGUAGES = Object\.freeze\(\[([^\]]*)\]\);", HELPER.read_text(encoding="utf-8"))
    return re.findall(r'"([a-z]{2,3})"', m.group(1)) if m else []


_PART_RE = re.compile(r"^\s*// i18n part: (\S+)")


class Part(type(Path())):
    """A file in GROUPS, or one named part of it, so a big file's words can be split between groups and each group
    file stays under its budget. In the file a line "// i18n part: stack" starts the part named stack, and
    "// i18n part: -" goes back to the rest; a part may come back further down. read_text gives the part's lines
    only, the others blank, so a line number said is still the file's. part None: the file without its named parts."""
    part: str | None = None

    def read_text(self, *args, **kwargs) -> str:
        cur, out = None, []
        for line in super().read_text(*args, **kwargs).split("\n"):
            m = _PART_RE.match(line)
            if m:
                cur = None if m.group(1) == "-" else m.group(1)
            out.append(line if cur == self.part else "")
        return "\n".join(out)


def _part(entry: str) -> Part:
    path, _, name = entry.partition("#")
    p = Part(WWW / path)
    p.part = name or None
    return p


def group_files() -> dict[str, list[Path]]:
    """The files whose t()/tn() strings make each group's keys (all but server)."""
    users = [p for p in sorted(WWW.rglob("*.js"))
             if p != HELPER and "vendor" not in p.parts and "i18n.js" in p.read_text(encoding="utf-8")]
    named = {g: [_part(f) for f in files] for g, files in GROUPS.items()}
    taken = {Path(p) for files in named.values() for p in files}
    out = {"help": [p for p in users if p == HELP],
           "panel": [p for p in users if p != HELP and p not in taken]}
    for g, files in named.items():
        out[g] = [p for u in users for p in files if Path(p) == u]
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
            elif isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", "")) == "refusal" \
                    and node.args:
                said = _whole(node.args[0], local[p], anywhere)   # const.refusal(template, **values)
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
