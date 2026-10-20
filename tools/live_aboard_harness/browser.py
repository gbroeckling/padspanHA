"""The browser the harness scripts run in, and the wait for Live Aboard to start.

Every pw_*.py launches through launch() so the choice lives in one place
(issue #95):

  * Windows: Edge with SwiftShader software GL, as the harness always ran.
  * macOS / Linux: Chrome on the machine's own GPU. Under SwiftShader on a Mac
    the 3D editor never comes up. Headless Chrome there paces frames unevenly
    (40-70 in 6 s), which makes Live Aboard's start-up frame-time check call
    the GPU slow ("slow_gpu") and drop to the flat Atlas in 3-5 of 8 loads;
    without vsync and the frame-rate limit it kept 3D in 24 of 24.

PADSPAN_HARNESS_BROWSER=msedge|chrome|chromium overrides the choice.
PADSPAN_HARNESS_CDP=http://127.0.0.1:9333 drives a browser that is already
running instead (another machine's, through an SSH tunnel: a wall screen's
own GPU). Its page must reach the harness on 127.0.0.1:<port> too (ssh -R).
PADSPAN_HARNESS_PORT (default 8765) is where the harness is served; run_all.py
picks a free one when 8765 is taken by something else.

wait_ready() replaces a fixed sleep after page load: it returns once the 3D
view is drawing, and exits with code 2 and the reason (slow_gpu, no WebGL...)
when it never will, which run_all.py reads as "worth another try".
"""

import os
import sys
import time

SWIFTSHADER = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
STEADY_FRAMES = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--disable-renderer-backgrounding",
                 "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"]
PORT = int(os.environ.get("PADSPAN_HARNESS_PORT", "8765"))
HARNESS = f"http://127.0.0.1:{PORT}/tools/live_aboard_harness/"
SLOT = ("const LA = await import('../../custom_components/padspan_ha/www/padspan-ha/views/live_aboard.js');"
        " const s = LA.liveAboardSlot('atlas');")


def channel() -> str:
    want = os.environ.get("PADSPAN_HARNESS_BROWSER", "").strip()
    if want:
        return want
    return "msedge" if sys.platform.startswith("win") else "chrome"


def launch(p, **kwargs):
    """p.chromium.launch with this machine's browser and flags."""
    cdp = os.environ.get("PADSPAN_HARNESS_CDP", "").strip()
    if cdp:
        return p.chromium.connect_over_cdp(cdp)
    ch = channel()
    args = list(kwargs.pop("args", []))
    args += SWIFTSHADER if ch == "msedge" else STEADY_FRAMES
    kwargs.setdefault("headless", True)
    return p.chromium.launch(channel=None if ch == "chromium" else ch, args=args, **kwargs)


def wait_ready(pg, timeout: float = 25.0) -> dict:
    """Wait for Live Aboard's 3D view to be up and measured, or exit 2 saying why not."""
    deadline = time.monotonic() + timeout
    st: dict = {}
    while time.monotonic() < deadline:
        try:
            st = pg.evaluate(f"async () => {{ {SLOT} const t = s._state(); "
                             "return {failed: t.failed || null, profile: t.profile || null, measuring: !!t.measuring, frames: t.frames || 0}; }")
        except Exception:  # noqa: BLE001 — the page is still loading its modules
            st = {}
        if st.get("failed"):
            print(f"didn't start: Live Aboard says {st['failed']}")
            sys.exit(2)
        # `profile` is set once the start-up frame-time check has decided.
        if st.get("profile") and not st.get("measuring") and st.get("frames", 0) > 0:
            time.sleep(0.5)   # one more beat for the first tool bar paint
            return st
        time.sleep(0.25)
    print(f"didn't start: no 3D view after {timeout:.0f} s ({st or 'no state'})")
    sys.exit(2)
