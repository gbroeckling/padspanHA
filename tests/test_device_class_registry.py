# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The device-class registry (light_codes.js DEVICE_CLASSES) — Phase 2a of
docs/PHASE2_STRATEGIC_REVIEW.md.

Adding the flood class cost ~25 edit sites across 4 files because "which
classes does X apply to" was hand-listed wherever it was needed, and the
copies had drifted: Automorph aura'd locks at 2 of 7 sites, the room sheet
painted a lock's code default green, door rows offered a Controls button
that could only end in a "read-only" toast, and the builder's "Preview as
sidebar" opened no control card for a lock the real sidebar did. One table
now answers all of it. These tests hold the table to its own contract and —
the architectural fitness function gap 4.4 asks for — fail the build if a
hand-written class list ever reappears anywhere in the frontend.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(tmp_path: Path, script: str) -> dict:
    (tmp_path / "light_codes.mjs").write_text((_VIEWS / "light_codes.js").read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "run.mjs").write_text("import * as LC from './light_codes.mjs';\n" + script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True, text=True,
                         encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


_ENTITIES = [
    {"entity_id": "light.plain"},
    {"entity_id": "light.strip", "effect_list": ["Rainbow"]},
    {"entity_id": "light.seg", "platform": "partition"},
    {"entity_id": "light.seg_fx", "platform": "partition", "effect_list": ["Chase"]},
    {"entity_id": "light.fan_switch", "type_override": "fan", "effect_list": ["x"]},
    {"entity_id": "fan.ceiling"},
    {"entity_id": "binary_sensor.pir", "device_class": "motion"},
    {"entity_id": "binary_sensor.door", "device_class": "door"},
    {"entity_id": "binary_sensor.leak", "device_class": "moisture"},
    {"entity_id": "sensor.co2", "device_class": "carbon_dioxide"},
    {"entity_id": "sensor.rh", "device_class": "humidity"},
    {"entity_id": "sensor.t", "device_class": "temperature"},
    {"entity_id": "lock.front"},
]


def test_every_row_is_complete_and_unique(tmp_path):
    out = _run(tmp_path, (
        "const C=LC.DEVICE_CLASSES;\n"
        "console.log(JSON.stringify({rows:C.map(c=>({key:c.key,flagKey:c.flagKey,code:c.code,hasTest:typeof c.test==='function',"
        "bools:['castsLight','controllable','fixedGlyph','controlCard'].every(k=>typeof c[k]==='boolean'),"
        "filterClass:c.filterClass,shape:c.shape,border:c.border})),"
        "shapes:LC.LIGHT_SHAPES.map(s=>s[0])}));\n"))
    rows = out["rows"]
    keys = [r["key"] for r in rows]
    assert len(set(keys)) == len(keys), keys
    codes = [r["code"] for r in rows if r["code"]]
    assert len(set(codes)) == len(codes), f"two classes share a code letter: {codes}"
    flags = [r["flagKey"] for r in rows if r["flagKey"]]
    assert len(set(flags)) == len(flags), flags
    assert rows[-1]["key"] == "light" and rows[-1]["flagKey"] is None, "the plain light is the fallback row, last"
    for r in rows:
        assert r["bools"], f"{r['key']}: every capability must be an explicit boolean, not left undefined"
        assert r["filterClass"], r
        if r["key"] != "light":
            assert r["hasTest"] and r["flagKey"] and r["code"] and r["border"], f"{r['key']} is missing a field"
        if r["shape"]:
            assert r["shape"] in out["shapes"], f"{r['key']}'s glyph {r['shape']!r} is not a shape the chooser knows"


def test_assign_light_codes_is_winner_takes_all_in_row_order(tmp_path):
    out = _run(tmp_path, (
        f"const L={json.dumps(_ENTITIES)};\nLC.assignLightCodes(L);\n"
        "const flags=LC.DEVICE_CLASSES.map(c=>c.flagKey).filter(Boolean);\n"
        "console.log(JSON.stringify(Object.fromEntries(L.map(l=>[l.entity_id,{code:l.code,"
        "on:flags.filter(f=>l[f]),cls:LC.deviceClassOf(l).key,shape:LC.deriveLightShape(l)}]))));\n"))
    want = {
        "light.plain": ("A", [], "light"),
        "light.strip": ("W", ["isWled"], "wled"),
        "light.seg": ("P", ["isPartition"], "partition"),
        # The more capable identity wins: a partition that also has effects is WLED.
        "light.seg_fx": ("W", ["isWled"], "wled"),
        # An override to "fan" beats the effects the entity also reports.
        "light.fan_switch": ("F", ["isFan"], "fan"),
        "fan.ceiling": ("F", ["isFan"], "fan"),
        "binary_sensor.pir": ("M", ["isMotion"], "motion"),
        "binary_sensor.door": ("D", ["isDoor"], "door"),
        "binary_sensor.leak": ("K", ["isFlood"], "flood"),
        "sensor.co2": ("Q", ["isAir"], "air"),
        "sensor.rh": ("H", ["isHumidity"], "humidity"),
        "sensor.t": ("T", ["isTemp"], "temp"),
        "lock.front": ("L", ["isLock"], "lock"),
    }
    for eid, (letter, on, cls) in want.items():
        got = out[eid]
        assert got["code"][0] == letter, (eid, got)
        assert got["on"] == on, f"{eid}: exactly one class flag may be true — {got}"
        assert got["cls"] == cls, (eid, got)
    assert out["binary_sensor.leak"]["shape"] == "flood", "a leak sensor must never reach the floodLIGHT name heuristic"
    assert out["lock.front"]["shape"] == "lock"


def test_the_generic_series_never_issues_a_class_letter(tmp_path):
    """The A01… run skips every letter a class owns — derived from the rows
    themselves now, so a new class's letter is reserved by adding its row."""
    out = _run(tmp_path, (
        "const L=Array.from({length:99*18},(_,i)=>({entity_id:'light.n'+String(i).padStart(5,'0')}));\n"
        "LC.assignLightCodes(L);\n"
        "console.log(JSON.stringify({letters:[...new Set(L.map(l=>l.code[0]))],"
        "taken:LC.DEVICE_CLASSES.map(c=>c.code).filter(Boolean)}));\n"))
    assert not set(out["letters"]) & set(out["taken"]), out


def test_the_capability_helpers_answer_from_the_table(tmp_path):
    out = _run(tmp_path, (
        "const r={};\n"
        "for(const c of LC.DEVICE_CLASSES){const l=c.flagKey?{[c.flagKey]:true}:{};\n"
        "  r[c.key]={casts:LC.castsLight(l),ctl:LC.isControllable(l),fixed:LC.hasFixedGlyph(l),"
        "card:LC.hasControlCard(l),border:LC.classBorder(l,'DEF')};}\n"
        "r._dimmablePlain=LC.hasControlCard({dimmable:true}); r._null=LC.castsLight(null);\n"
        "console.log(JSON.stringify(r));\n"))
    lights = {"light", "wled", "partition"}
    for key, got in out.items():
        if key.startswith("_"):
            continue
        assert got["casts"] == (key in lights), f"{key}: only a real light casts light"
    read_only = {"motion", "door", "flood", "air", "humidity", "temp"}
    for key in read_only:
        assert out[key]["ctl"] is False and out[key]["card"] is False, f"{key} is read-only"
    for key in ("light", "wled", "partition", "fan", "lock"):
        assert out[key]["ctl"] is True, key
    assert out["lock"]["card"] and out["fan"]["card"] and out["wled"]["card"] and out["partition"]["card"]
    assert out["light"]["card"] is False and out["_dimmablePlain"] is True, "a plain light earns a card only by being dimmable"
    # A door is never a point marker at all — not a "fixed glyph" carve-out.
    assert out["door"]["fixed"] is False and out["fan"]["fixed"] is False
    assert all(out[k]["fixed"] for k in ("motion", "flood", "air", "humidity", "temp", "lock"))
    assert out["light"]["border"] == "DEF" and out["lock"]["border"] != "DEF"
    assert out["_null"] is True


def test_the_filter_chips_cover_every_class_bucket(tmp_path):
    src = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    chips = set(re.findall(r'\["([a-z]+)","[^"]+"\]', src[src.index("export const LIGHT_CLASSES"):].split("\n", 1)[0]))
    out = _run(tmp_path, "console.log(JSON.stringify([...new Set(LC.DEVICE_CLASSES.map(c=>c.filterClass))]));\n")
    missing = set(out) - chips
    assert not missing, f"lights_map.js LIGHT_CLASSES has no chip for {missing} — that class could never be filtered to"


# ── The fitness function ────────────────────────────────────────────────────

def _flag_keys() -> list[str]:
    """The registry's own flagKeys — not a hand-typed enumeration of them.

    Found in the Phase 2a registry audit, 2026-09-19: a hand-typed list here
    is exactly the smell this test exists to catch, in the one place it
    would be most ironic to have one — a newly-added class's flag would
    silently evade this guard until someone remembered to update the regex
    by hand. Falls back to today's known set when node is unavailable
    (pytestmark already skips every test in this module in that case; this
    only has to not crash at import/collection time).
    """
    if _NODE is None:
        return ["isFan", "isMotion", "isDoor", "isTemp", "isAir", "isHumidity", "isLock", "isFlood", "isWled", "isPartition"]
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        return _run(Path(td), "console.log(JSON.stringify(LC.DEVICE_CLASSES.map(c=>c.flagKey).filter(Boolean)));\n")


_FLAG = re.compile(r"\bis(?:" + "|".join(k[2:] for k in _flag_keys()) + r")\b")


def _code_lines(src: str):
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    for i, line in enumerate(src.splitlines(), 1):
        yield i, re.sub(r"(?<![:'\"`])//.*$", "", line)


def test_no_frontend_file_hand_writes_a_class_list():
    """Three or more DISTINCT class flags on one line is a hand-written class
    list — the smell the registry retired. Every such line that existed
    (iso_lights.js x8, lights_map.js x4, maps.js x2, lights_panel.js x3) had
    a capability behind it that now lives in one DEVICE_CLASSES column; a
    new one should too. light_codes.js is the table itself and is exempt."""
    offenders = []
    for path in sorted(_WWW.rglob("*.js")):
        if path.name == "light_codes.js":
            continue
        for i, line in _code_lines(path.read_text(encoding="utf-8")):
            flags = set(_FLAG.findall(line))
            if len(flags) >= 3:
                offenders.append(f"{path.relative_to(_WWW)}:{i}: {sorted(flags)}")
    assert not offenders, (
        "hand-written device-class list(s) — add a column to DEVICE_CLASSES "
        "(light_codes.js) and ask it instead:\n  " + "\n  ".join(offenders))


# ── isAtlasEntity: the single admission predicate ───────────────────────────

_ADMISSION_CASES = [
    ("light.plain", {}, True),
    ("fan.ceiling", {}, True),
    ("switch.wall", {}, False),
    ("binary_sensor.pir", {"device_class": "motion"}, True),
    ("binary_sensor.occ", {"device_class": "occupancy"}, True),
    ("binary_sensor.door", {"device_class": "door"}, True),
    ("binary_sensor.win", {"device_class": "window"}, True),
    ("binary_sensor.leak", {"device_class": "moisture"}, True),
    ("binary_sensor.battery", {"device_class": "battery"}, False),
    ("binary_sensor.plain", {}, False),
    ("sensor.temp", {"device_class": "temperature"}, True),
    ("sensor.notype", {}, False),  # no device_class at all must never fall back to "temperature"
    ("sensor.rh", {"device_class": "humidity"}, True),
    ("sensor.co2", {"device_class": "carbon_dioxide"}, True),
    ("sensor.aq_word", {"device_class": "enum", "friendly_name": "Bath Outlet Air Quality"}, True),
    ("sensor.other_enum", {"device_class": "enum", "friendly_name": "Power On Behavior"}, False),
    ("sensor.battery", {"device_class": "battery"}, False),
    ("lock.front", {}, True),
]


def test_is_atlas_entity_matches_every_classifier_and_no_others(tmp_path):
    out = _run(tmp_path, (
        f"const CASES={json.dumps(_ADMISSION_CASES)};\n"
        "console.log(JSON.stringify(CASES.map(([eid,attrs])=>LC.isAtlasEntity(eid,attrs))));\n"
    ))
    got = {c[0]: v for c, v in zip(_ADMISSION_CASES, out)}
    want = {c[0]: c[2] for c in _ADMISSION_CASES}
    assert got == want, {k: (got[k], want[k]) for k in want if got[k] != want[k]}


def test_is_atlas_entity_excludes_the_occupancy_half_only_via_the_caller_not_itself(tmp_path):
    """isAtlasEntity alone admits every occupancy entity — the pairing
    exclusion (primaryFor) is gatherLights' own concern, layered on top,
    not something the admission predicate itself should know about."""
    out = _run(tmp_path, "console.log(JSON.stringify(LC.isAtlasEntity('binary_sensor.occ_secondary', {device_class:'occupancy'})));\n")
    assert out is True


def test_emergency_is_leaks_and_smoke_gas_co_alarms_each_in_its_own_words(tmp_path):
    """Garry, 2026-10-15: "Widen emergency". Smoke, gas and CO alarms are the
    Emergency class with leaks, each in its own words, and drawn as a detector,
    not the leak's puddle; anything else stays out."""
    out = _run(tmp_path, (
        "const b=(dc)=>({entity_id:'binary_sensor.x',device_class:dc});\n"
        "const r={};\n"
        "for(const dc of ['moisture','smoke','gas','carbon_monoxide','problem','safety']){const l=b(dc); LC.assignLightCodes([l]);\n"
        "  r[dc]={em:LC.isFloodSensor(l),key:LC.deviceClassOf(l).key,on:LC.emergencyWord(l,true,false),"
        "latched:LC.emergencyWord(l,false,true),quiet:LC.emergencyWord(l,false,false),shape:LC.resolveLightShape(l,null)};}\n"
        "console.log(JSON.stringify(r));\n"))
    assert out["moisture"] == {**out["moisture"], "em": True, "key": "flood", "on": "WET", "latched": "ALARM", "quiet": "DRY", "shape": "flood"}
    for dc, word in (("smoke", "SMOKE"), ("gas", "GAS"), ("carbon_monoxide", "CO")):
        assert out[dc]["em"] is True and out[dc]["key"] == "flood", dc
        assert (out[dc]["on"], out[dc]["latched"], out[dc]["quiet"]) == (word, "ALARM", "CLEAR"), dc
        assert out[dc]["shape"] == "smokealarm", dc
    assert out["problem"]["em"] is False and out["safety"]["em"] is False
