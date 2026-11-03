"""The Plans tool's vetting map by real clicks, over the fake server (plans_fixture.js).

    python -X utf8 pw_plans.py <out_dir> [desktop|phone]

Opens Edit → Plans, presses pins and verdict buttons with the mouse (or a finger
on phone), uses the keys, and prints what the page says after each step; a
screenshot per step goes to out_dir. check_log.py reads the error lists.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser import HARNESS, SLOT, launch, wait_ready   # the machine's browser (issue #95)

out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
out.mkdir(parents=True, exist_ok=True)
phone = len(sys.argv) > 2 and sys.argv[2] == "phone"
bad: list[str] = []


def expect(ok, text):
    print(("ok  " if ok else "BAD ") + text)
    if not ok:
        bad.append(text)


with sync_playwright() as p:
    b = launch(p)
    errs: list[str] = []
    ctx = b.new_context(viewport={"width": 390, "height": 844} if phone else {"width": 1400, "height": 900}, has_touch=phone)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(f"{HARNESS}index.html?display=0&edit=1&plans=1" + ("&w=370" if phone else ""))
    wait_ready(pg)
    pg.wait_for_timeout(600)

    def st():
        return pg.evaluate(f"async () => {{ {SLOT} return s._plans().state(); }}")

    def draft():
        return pg.evaluate(f"async () => {{ {SLOT} return s._state().edit ? s._state().edit : null; }}")

    def pins():
        return {x["n"]: x for x in st()["pins"]}

    def calls(t):
        return pg.evaluate("(t) => window.__plans.calls.filter(c => c.type === t)", t)

    def card():
        return pg.locator(".la3d-sheet.plans").inner_text()

    def press(name, **kw):
        loc = pg.locator(".la3d-sheet.plans button", has_text=name).first
        if phone:
            loc.tap(**kw)
        else:
            loc.click(**kw)
        pg.wait_for_timeout(350)

    def nof(sug):
        return next(q["n"] for q in st()["pins"] if q["id"] == sug)

    def pin_state(sug):
        return next(q["state"] for q in st()["pins"] if q["id"] == sug)

    def pin(sug):
        n = nof(sug)
        loc = pg.locator(f'.pl-pin[data-n="{n}"]')
        if phone:
            # Zoomed to one item, its neighbours can be off the map: the queue reaches them.
            box = loc.bounding_box() if loc.count() else None
            root = pg.locator(".pl-pins").bounding_box()
            sheet_top = pg.locator(".la3d-sheet.plans").bounding_box()["y"]
            if box and root["x"] <= box["x"] and box["x"] + box["width"] <= root["x"] + root["width"] and root["y"] <= box["y"] and box["y"] + box["height"] <= sheet_top:
                loc.tap()
            else:
                if st()["card"] != "item":
                    press("Stay here")
                while str(next((q["n"] for q in st()["pins"] if q["id"] == st()["cur"]), n)) != str(n):
                    press("›")
        else:
            loc.click()
        pg.wait_for_timeout(900)

    def shot(name):
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(out / f"{'phone' if phone else 'desktop'}_{name}.png"))

    def tool_button(name):
        loc = pg.get_by_role("button", name=name, exact=True).first
        if phone:
            loc.tap()
        else:
            loc.click()
        pg.wait_for_timeout(300)

    tool_button("Edit")
    tool_button("Plans")
    pg.wait_for_timeout(2500)
    s = st()
    print("opened", json.dumps(s))
    expect(s["onMap"], "the map opened")
    expect(s["textures"] == 1, "one texture")
    expect(s["cur"] == "d" and s["floor"] == "main", "starts on the first item, on one floor")
    expect(len(s["ghosts"]) >= 4, "ghosts drawn")
    shot("1_opened")
    # Two plans that disagree: it opens on one.
    expect("Electrical E-2 there" in card(), "both plans named on the card")
    tags = pg.locator(".pl-tag").all_inner_texts()
    expect(sorted(tags) == ["Electrical E-2", "Main floor"], f"both ghosts named on the map: {tags}")
    shot("6_disagree")
    press("Electrical E-2")
    pg.wait_for_timeout(600)
    s = st()
    expect(s["plan"] == "pm2" and s["textures"] == 1, "the switch: the other plan, still one texture")
    shot("7_switch")
    # A pin pressed by hand: jumps there; a hand-placed correction starts on Keep mine.
    pin("b")
    expect(st()["cur"] == "b" and "Den" in card(), "a pin jumps to its item")
    expect("Keep mine" in card() and "You placed this one" in card(), "a hand-placed correction says keep yours")
    focus = pg.evaluate("() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a ? a.textContent : ''; }")
    expect(focus.startswith("Keep mine"), f"Keep mine has the keyboard (focus: {focus})")
    shot("1_correction")
    pin("a")
    expect(st()["cur"] == "a" and "Hall" in card(), "back on the first")
    shot("2_new")
    n0 = len(calls("plan_ai_commit"))
    press("New")
    s = st()
    expect("a" not in s["ghosts"] and pin_state("a") == "new", "New: its pin is green, its ghost became the draft's piece")
    expect(s["cur"] == "r", "New: on to the next item, its railing hint")
    expect("Side:" in card(), "the railing asks a side")
    shot("3_railing")
    press("Left")
    press("New")
    expect(pin_state("r") == "new", "the railing kept in the draft")
    expect(st()["cur"] != "r", "on to the next item")
    pin("c")
    expect("climbs from" in card(), "stacked asks which floor")
    shot("4_stacked")
    press("Failure")
    shot("5_failure_chips")
    expect(all(w in card() for w in ("Wrong place", "Nothing there", "Already here", "Wrong kind", "Can't tell")), "five reason chips")
    press("Wrong place")
    v = calls("plan_ai_verdict")
    expect(v and v[-1]["sug_id"] == "c" and v[-1]["why"] == "wrong_place", "Failure written at click, with its reason")
    expect(pin_state("c") == "failure", "the pin goes grey")
    if not phone:
        pin("d")
        # The keys. (A phone has none.)
        pg.keyboard.press("l")
        pg.wait_for_timeout(350)
        expect(pin_state("d") == "later", "L: later")
        expect(st()["cur"] != "d", "L: on to the next")
        pg.keyboard.press("z")
        pg.wait_for_timeout(350)
        expect(pin_state("d") == "queued", "Z: a Later taken back at the server")
        pg.keyboard.press("p")
        pg.wait_for_timeout(250)
        expect(st()["planShown"] is False, "P: the plan off")
        shot("8_plan_off")
        pg.keyboard.press("p")
        pg.wait_for_timeout(250)
        expect(st()["planShown"] is True, "P: the plan on")
        at = st()["cur"]
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(500)
        moved = st()["cur"]
        pg.keyboard.press("Backspace")
        pg.wait_for_timeout(500)
        expect(moved != at and st()["cur"] == at, "Enter and Backspace step through the queue")
    # The correction: onion skin, take the AI's position, undo.
    pin("b")
    shot("9_onion")
    if not phone:
        press("Take the AI")
        expect(pin_state("b") == "correction", "C: the pin goes blue")
        expect(calls("plan_ai_commit") == [] or len(calls("plan_ai_commit")) == n0, "nothing sent until Save")
        pg.keyboard.press("z")
        pg.wait_for_timeout(500)
        expect(pin_state("b") == "queued", "Z: the draft's own Undo takes it back")
        # Move by hand: accept, then drag the pin.
        pin("b")
        press("Move by hand")
        expect(st()["moving"] is not None and "Drag" in card(), "Move by hand: asks for the drag")
        box = pg.locator(f'.pl-pin[data-n="{nof("b")}"]').bounding_box()
        pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        pg.mouse.down()
        pg.mouse.move(box["x"] + 60, box["y"] + 20, steps=6)
        pg.mouse.up()
        pg.wait_for_timeout(500)
        shot("10_moved")
        expect("from where the AI put it" in card(), "the move said in numbers")
        press("Done")
    # The one bulk action.
    press("More")
    shot("11_more")
    texts = pg.locator(".la3d-sheet.plans button").all_inner_texts()
    expect(not any(("accept" in t.lower() or "keep all" in t.lower() or "approve" in t.lower()) for t in texts), f"no accept-all: {texts}")
    if any(t == "Dismiss the rest" for t in texts):
        press("Dismiss the rest")
        press("Dismiss them")
        pg.wait_for_timeout(600)
        v = calls("plan_ai_verdict")
        expect(all(c["v"] != "failure" or c["sug_id"] == "c" for c in v), "Dismiss the rest marks nothing wrong")
    press("What's missing?")
    shot("12_missing")
    expect("what's missing" in card(), "the what's-missing pass")
    press("Done")
    # A floor by hand: the texture is released and the next one taken.
    if not phone:
        pg.locator(".la3d-bar button", has_text="▲").first.click()
        pg.wait_for_timeout(1500)
        s = st()
        expect(s["floor"] == "upper" and s["plan"] == "pu1" and s["textures"] == 1, f"a floor change: its plan, still one texture ({s['floor']}, {s['plan']}, {s['textures']})")
        shot("13_floor_change")
    # Save: the fake commit.
    keep = pg.locator(".la3d-sheet.plans .pl-keep")
    if keep.count():
        print("keep:", keep.inner_text())
        (keep.tap if phone else keep.click)()
        pg.wait_for_timeout(900)
        expect(len(calls("plan_ai_commit")) == n0 + 1, "Keep goes to plan_ai_commit once")
        shot("14_saved")
    # Hands on the map: never a turn. One finger does nothing, two move it; the mouse drags it.
    def pin_at():
        return pg.evaluate("() => { const out = []; const walk = (r) => { for (const e of r.querySelectorAll('.pl-pin')) out.push(e.style.transform); for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return out.join(); }")

    def drag(points, kind):
        pg.evaluate("""([pts, kind]) => { let cv = null; const walk = (r) => { cv = cv || r.querySelector('.la3d canvas'); for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document);
            const b = cv.getBoundingClientRect(), ev = (t, id, x, y) => cv.dispatchEvent(new PointerEvent(t, { clientX: b.left + b.width * x, clientY: b.top + b.height * y, bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: kind, isPrimary: id === 1, button: 0, buttons: t === 'pointerup' ? 0 : 1 }));
            pts.forEach(([x, y], i) => ev('pointerdown', i + 1, x, y));
            for (let s = 1; s <= 6; s++) pts.forEach(([x, y], i) => ev('pointermove', i + 1, x + 0.02 * s, y + 0.01 * s));
            pts.forEach(([x, y], i) => ev('pointerup', i + 1, x + 0.12, y + 0.06)); }""", [points, kind])
        pg.wait_for_timeout(500)

    if phone:
        a0 = pin_at()
        drag([[0.08, 0.32]], "touch")
        expect(pin_at() == a0, "phone: one finger on the map moves nothing")
        drag([[0.08, 0.3], [0.2, 0.34]], "touch")
        expect(pin_at() != a0, "phone: two fingers move the map")
    else:
        a0 = pin_at()
        drag([[0.02, 0.9]], "mouse")
        s = pg.evaluate(f"async () => {{ {SLOT} const t = s._state(); return t.cam ? t.cam.phi : null; }}")
        expect(pin_at() != a0, "the mouse drags the map")
        expect(s is None or s < 0.05, f"and never tilts it ({s})")
    # Idle costs no frame.
    frames0 = pg.evaluate(f"async () => {{ {SLOT} return s._state().frames; }}")
    pg.wait_for_timeout(1500)
    frames1 = pg.evaluate(f"async () => {{ {SLOT} return s._state().frames; }}")
    expect(frames1 - frames0 <= 2, f"no frames at rest ({frames1 - frames0} in 1.5 s)")
    # Off again: nothing of it left. (A phone: the other tools stand aside, Done is in the bar.)
    tool_button("Done" if phone else "Plans")
    pg.wait_for_timeout(600)
    s = st()
    expect(not s["onMap"] and s["textures"] == 0 and not s["ghosts"] and not s["pins"], "the tool closed: nothing left")
    # The wall screen's way in (no Edit) and a house with the switch off never ask for the module.
    for query, why in (("display=1&plans=1&kiosk=1", "a wall screen, the switch on"), ("display=0&edit=1", "Edit, the switch off")):
        pg.close()
        ctx2 = b.new_context(viewport={"width": 800, "height": 600})   # a page of its own: SwiftShader can't keep two 3D views at speed
        pg = pg2 = ctx2.new_page()
        asked: list[str] = []
        pg2.on("request", lambda r: asked.append(r.url))
        pg2.goto(f"{HARNESS}index.html?{query}")
        wait_ready(pg2)
        pg2.wait_for_timeout(1200)
        expect(not any("live_aboard_plans" in u for u in asked), f"{why}: the Plans module is never loaded")
    print("errors:", errs)
    print("bad:", bad)
    b.close()
