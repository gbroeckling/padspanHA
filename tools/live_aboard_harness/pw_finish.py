"""Floors and walls chosen in Furnish (views/live_aboard_finish.js), drawn in a real browser (real time).

usage: python pw_finish.py [outprefix]

The fixture house with finish=1 in Classic and Studio, on High (PBR) and Low: the floors' materials and
their lines drawn, the walls in two colours on their own program, no shader or page error; with a
Showcase theme none of it is drawn. Prints each state, and bad [...] for anything off. outprefix: a
screenshot of each look.
"""
import sys
from playwright.sync_api import sync_playwright
from browser import HARNESS, SLOT, launch, wait_ready   # the machine's browser (issue #95)

pre = sys.argv[1] if len(sys.argv) > 1 else None
LOOKS = [("own", "high"), ("own", "low"), ("studio", "high"), ("studio", "low")]
STATE = ("const f = s._state().finish; return {failed: s._state().failed || null, profile: s._state().profile, key: s._state().look.key,"
         " shown: f.shown, laid: f.laid.map(l => l.material).sort(), two: f.two.filter(x => x.on).map(x => x.floor),"
         " walls: f.walls.length, program: f.program};")

with sync_playwright() as p:
    b = launch(p)
    errs, bad = [], []
    for look, quality in LOOKS + [("atlas", "high")]:
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
        pg.on("console", lambda m: errs.append(m.type + ": " + m.text[:240]) if m.type == "error" or "Shader" in m.text or "WebGLProgram" in m.text else None)
        theme = "&theme=neo_hud" if look == "atlas" else ""
        pg.goto(f"{HARNESS}index.html?one=1&sky=sunny&finish=1&look={look}&quality={quality}{theme}"); wait_ready(pg)
        st = pg.evaluate(f"async () => {{ {SLOT} {STATE} }}")
        print(look, quality, st)
        if look == "atlas":
            if st["shown"] or st["laid"] or st["two"] or st["walls"]:
                bad.append(f"a Showcase theme drew floors or walls: {st}")
        elif not (st["shown"] and st["laid"] == ["light_wood", "tile", "wood"] and st["two"] == ["main"] and st["walls"] > 0
                  and "la3d-walltop-two" in st["program"]):
            bad.append(f"{look} {quality} did not draw them: {st}")
        if pre:
            # The first-visit card out of the way, the roof off, from above the front corner.
            for label in ("Got it", "Roof"):
                btn = pg.get_by_role("button", name=label, exact=True)
                if btn.count():
                    btn.first.click()
            pg.evaluate(f"async () => {{ {SLOT} const c = s._state().cam; s._look(0.6, 0.85, c.target, c.radius * 0.8); return 1; }}")
            pg.wait_for_timeout(1500)
            pg.screenshot(path=f"{pre}-{look}-{quality}.png")
        pg.close()
    print("errs", errs[:10])
    print("bad", bad)
    b.close()
