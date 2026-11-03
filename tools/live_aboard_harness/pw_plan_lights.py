"""The Plans tool's lights by real clicks, over the fake server (plans_fixture.js, plans=lights).

    python -X utf8 pw_plan_lights.py <out_dir> [desktop|phone]

Opens Edit → Plans on a session of lights alone: a kind correction, a room group,
symbols with no placed light. Presses pins and verdict buttons, keeps a kind, then
reads the plans' sheet for the fixture question. A screenshot per step goes to
out_dir. check_log.py reads the error lists.
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
    pg.goto(f"{HARNESS}index.html?display=0&edit=1&plans=lights" + ("&w=370" if phone else ""))
    wait_ready(pg)
    pg.wait_for_timeout(600)

    def st():
        return pg.evaluate(f"async () => {{ {SLOT} return s._plans().state(); }}")

    def card():
        return pg.locator(".la3d-sheet.plans").inner_text()

    def press(name):
        loc = pg.locator(".la3d-sheet.plans button", has_text=name).first
        (loc.tap if phone else loc.click)()
        pg.wait_for_timeout(450)

    def shot(name):
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(out / f"{'phone' if phone else 'desktop'}_lights_{name}.png"))

    def tool_button(name):
        loc = pg.get_by_role("button", name=name, exact=True).first
        (loc.tap if phone else loc.click)()
        pg.wait_for_timeout(300)

    def pending():
        return pg.evaluate(f"async () => {{ {SLOT} const f = window.__plans; return f.calls.filter(c => c.type === 'plan_ai_commit').map(c => c.items); }}")

    tool_button("Edit")
    tool_button("Plans")
    pg.wait_for_timeout(2500)
    s = st()
    print("opened", json.dumps(s))
    expect(s["onMap"] and s["textures"] == 1, "the map opened, one texture")
    expect(sorted(q["id"] for q in s["pins"]) == ["l1", "l2", "l3", "l4"], "a pin per light; none for one already there")
    expect(all(i in s["ghosts"] for i in ("l1", "l2", "l3", "l4")), "ghosts drawn")
    shot("1_opened")
    while st()["cur"] != "l1":
        press("›")
    pg.wait_for_timeout(600)
    c = card()
    expect("Light" in c and "is drawn as" in c and "Take the kind" in c and "Keep mine" in c, "the card: what the plan draws, what the light is drawn as")
    expect("Move by hand" not in c and "New" not in c.split("Take the kind")[0], "no New, no Move by hand")
    shot("2_correction")
    if not phone:
        pg.keyboard.press("n")
        pg.wait_for_timeout(300)
        expect(next(q["state"] for q in st()["pins"] if q["id"] == "l1") == "queued", "N does nothing on a light")
    press("Take the kind")
    expect(next(q["state"] for q in st()["pins"] if q["id"] == "l1") == "correction", "taken: its pin says correction")
    shot("3_taken")
    while st()["cur"] != "l2":
        press("›")
    c = card()
    expect("placed as a group: kind only?" in c, "a room group says so")
    shot("4_group")
    while st()["cur"] != "l3":
        press("›")
    c = card()
    expect("no placed light here" in c and "Open Mapping" in c and "Failure" not in c, "unmatched: the Atlas button, no verdict")
    shot("5_unmatched")
    press("Open Mapping")
    opened = pg.evaluate("() => window.__plans.calls.filter(c => c.type === 'open_atlas')")
    expect(len(opened) == 1 and opened[0]["floor"] == "main" and opened[0]["room"], f"the button opens Mapping → Atlas on that room: {opened}")
    press("Keep 1 correction")
    pg.wait_for_timeout(900)
    items = pending()
    expect(items and items[-1][0]["v"] == "correction" and "final" not in items[-1][0], "Save: the suggestion alone goes to the one writer")
    shot("6_saved")
    # The fixture question.
    press("More")
    press("Read again")
    pg.wait_for_timeout(600)
    tick = pg.locator(".la3d-sheet.plans label.pl-tick", has_text="only on a plan that draws").locator("input")
    tick.click()
    pg.wait_for_timeout(400)
    c = card()
    expect("Does this plan draw light fixtures" in c and "Most architect's plans don't" in c, "the question, under Lights")
    pg.locator(".la3d-sheet.plans .pl-choose", has_text="Electrical E-2").locator("button", has_text="Yes").click()
    pg.wait_for_timeout(400)
    expect("on a plan with fixtures 6-12 lights" in card(), "what to expect counts it")
    pg.locator(".la3d-sheet.plans").evaluate("(e) => { e.scrollTop = 200; }")
    shot("7_question")
    print("errors:", errs)
    print("bad:", bad)
    b.close()
