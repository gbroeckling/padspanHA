"""No links to shops or product pages in the app or on the website (2026-11-10: the Home Assistant forum flagged
PadSpan's product links). Recommend the kind of thing to look for instead; documentation, standards, research and
open-source project links are fine."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOP = re.compile(
    r"https?://(?:[a-z0-9-]+\.)*(?:aliexpress\.[a-z.]+|amazon\.[a-z.]+|amzn\.to|a\.co/|ebay\.[a-z.]+|temu\.com|"
    r"banggood\.com|bestbuy\.[a-z]+|newegg\.[a-z]+|walmart\.[a-z]+|feasystore\.com|minewstore\.com|"
    r"bluecharmbeacons\.com/product|pawscout\.com/shop|tindie\.com)"
    r"|https?://(?:shop|store)\.[a-z0-9.-]+"
    r"|https?://[a-z0-9.-]+/(?:products?|shop|collections|item)/",
    re.I)
WHERE = [ROOT / "custom_components" / "padspan_ha", ROOT / "site"]
KINDS = {".js", ".mjs", ".py", ".html", ".json", ".md"}


def offenders():
    out = []
    for base in WHERE:
        for p in base.rglob("*"):
            if p.suffix not in KINDS or "__pycache__" in p.parts or "lib" in p.parts:
                continue
            for n, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                m = SHOP.search(line)
                if m:
                    out.append(f"{p.relative_to(ROOT)}:{n}: {m.group(0)}")
    return out


def test_no_shop_or_product_links():
    assert offenders() == [], "shop/product links (recommend the kind of thing instead):\n" + "\n".join(offenders())


def test_the_pattern_catches_the_links_that_were_flagged():
    for url in ("https://www.aliexpress.com/item/1005003443721023.html", "https://www.feasystore.com/product/fsc-bp103c/",
                "https://pawscout.com/shop/pawscout-tag/", "https://www.eufy.com/products/t87b0011",
                "https://tycotouch.com/collections/large-touch-screen-overlays", "https://shop.moen.com/pages/x"):
        assert SHOP.search(url), url
    for url in ("https://www.home-assistant.io/integrations/ibeacon/#known-working-devices", "https://github.com/agittins/bermuda/pull/863",
                "https://www.petpoisonhelpline.com/poison/batteries/", "https://www.fully-kiosk.com/"):
        assert not SHOP.search(url), url
