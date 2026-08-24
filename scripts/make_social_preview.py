#!/usr/bin/env python
"""Generate images/social-preview.png — the og:image every shared link uses.

    python scripts/make_social_preview.py            # write images/social-preview.png
    python scripts/make_social_preview.py --deploy   # ...and upload it to the site

WHY THIS EXISTS
The og:image is the first thing anyone sees when a link to PadSpan is pasted into
Reddit, the Home Assistant forum, Discord, Slack or X. The copy that was live until
2026-08-24 was dated 28 July — it predated the entire metres/fabric rework and the
multi-floor fix, so every share advertised the software as it looked a month and
several stable releases ago.

It went stale for the same reason the landing page and the update manifest did:
nothing regenerated it. This script does, from a screenshot in the repo and the
version in manifest.json, so it can be re-run at any release and never drift.

1200x630 is the size Open Graph consumers crop to; Twitter/X reads the same tag.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "custom_components" / "padspan_ha" / "manifest.json"
SOURCE = ROOT / "images" / "overview-3d-multifloor.jpg"
OUT = ROOT / "images" / "social-preview.png"

W, H = 1200, 630
ACC = (52, 211, 153)      # --acc, the site's green
INK = (232, 245, 236)     # --fg
MUT = (147, 169, 155)     # --mut

_FONT_DIRS = [pathlib.Path(r"C:\Windows\Fonts"), pathlib.Path("/usr/share/fonts")]
_BOLD = ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
_REG = ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]


def font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    for d in _FONT_DIRS:
        for n in names:
            p = d / n
            if p.exists():
                try:
                    return ImageFont.truetype(str(p), size)
                except OSError:
                    pass
        # fonts can also sit one level down on linux
        if d.exists():
            for p in d.rglob(names[-1]):
                try:
                    return ImageFont.truetype(str(p), size)
                except OSError:
                    pass
    return ImageFont.load_default()


def build(version: str) -> Image.Image:
    src = Image.open(SOURCE).convert("RGB")

    # Cover-fit the screenshot to 1200x630, biased to the upper-left where the
    # multi-floor stack actually is rather than the empty floor below it.
    scale = max(W / src.width, H / src.height)
    src = src.resize((int(src.width * scale), int(src.height * scale)), Image.LANCZOS)
    left = int((src.width - W) * 0.42)
    top = int((src.height - H) * 0.30)
    card = src.crop((left, top, left + W, top + H))

    # Darken so text is legible at thumbnail size, and blur the bottom band the
    # copy sits on so a busy screenshot cannot fight the words.
    card = Image.blend(card, Image.new("RGB", (W, H), (7, 16, 9)), 0.42)
    band_h = 250
    band = card.crop((0, H - band_h, W, H)).filter(ImageFilter.GaussianBlur(9))
    card.paste(band, (0, H - band_h))
    shade = Image.new("L", (1, H), 0)
    for y in range(H):
        t = max(0.0, (y - (H - band_h)) / band_h)
        shade.putpixel((0, y), int(215 * (t ** 1.25)))
    card = Image.composite(Image.new("RGB", (W, H), (5, 12, 7)), card, shade.resize((W, H)))

    d = ImageDraw.Draw(card)
    x = 62

    f_title = font(_BOLD, 82)
    f_sub = font(_REG, 33)
    f_meta = font(_BOLD, 23)

    d.text((x, H - 214), "PadSpan™ HA", font=f_title, fill=INK)
    d.text((x, H - 116), "Room-level Bluetooth presence for Home Assistant",
           font=f_sub, fill=(200, 220, 205))

    meta = f"v{version}   ·   3D FLOOR PLANS   ·   CALIBRATION   ·   100% LOCAL"
    d.text((x, H - 62), meta, font=f_meta, fill=ACC)

    # A thin accent rule anchors the block to the site's visual language.
    d.rectangle([x, H - 238, x + 96, H - 233], fill=ACC)
    return card


def main() -> None:
    version = json.loads(MANIFEST.read_text(encoding="utf-8"))["version"]
    if not SOURCE.exists():
        raise SystemExit(f"source screenshot missing: {SOURCE}")
    img = build(version)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT.relative_to(ROOT)}  {img.width}x{img.height}  {kb:.0f} KB  (v{version})")

    if "--deploy" not in sys.argv:
        print("not deployed (pass --deploy to upload)")
        return

    host = "administrator@75.157.233.12"
    remote = "/var/www/clients/client1/web10/web/padspan/images/social-preview.png"
    ssh = "ssh -o BatchMode=yes -o ConnectTimeout=20"
    subprocess.run(
        f'{ssh} {host} "sudo -n test -f {remote}.bak || sudo -n cp -p {remote} {remote}.bak"',
        shell=True, check=False)
    res = subprocess.run(f'{ssh} {host} "sudo -n tee {remote} > /dev/null"',
                         shell=True, input=OUT.read_bytes(), capture_output=True)
    if res.returncode != 0:
        raise SystemExit(f"upload failed: {res.stderr.decode('utf-8','replace').strip()}")
    print(f"uploaded to {remote}")


if __name__ == "__main__":
    main()
