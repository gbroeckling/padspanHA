#!/usr/bin/env python
"""Tell the IndexNow search engines that pages on padspan.traks.ca changed.

    python scripts/indexnow.py              # every URL in site/sitemap.xml
    python scripts/indexnow.py URL [URL ...]

Bing, Yandex, Seznam, Naver and Yep take IndexNow: one request and they fetch
the pages within hours instead of whenever their crawler next comes by.
Google doesn't take it; it finds pages from the sitemap and from links.

The key is not a secret. IndexNow checks it by fetching
https://padspan.traks.ca/<key>.txt, which deploy_site.py uploads with the
other files beside the page (site/<key>.txt).
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

SITE = pathlib.Path(__file__).resolve().parents[1] / "site"
HOST = "padspan.traks.ca"
ENDPOINT = "https://api.indexnow.org/indexnow"


def key() -> str:
    keys = [p.stem for p in SITE.glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", p.stem)]
    if len(keys) != 1:
        raise SystemExit(f"expected one IndexNow key file in site/, found {len(keys)}")
    return keys[0]


def sitemap_urls() -> list[str]:
    return re.findall(r"<loc>([^<]+)</loc>", (SITE / "sitemap.xml").read_text(encoding="utf-8"))


def submit(urls: list[str]) -> tuple[int, str]:
    """(HTTP status, reason). 200 and 202 mean accepted; 202 while the key is
    still being checked. 403: the key file isn't live. 422: a URL isn't on HOST."""
    k = key()
    body = json.dumps({"host": HOST, "key": k, "keyLocation": f"https://{HOST}/{k}.txt",
                       "urlList": urls}).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body, method="POST",
                                 headers={"Content-Type": "application/json; charset=utf-8",
                                          "User-Agent": "padspan-deploy"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.reason
    except urllib.error.HTTPError as e:
        return e.code, e.reason


def main() -> None:
    urls = sys.argv[1:] or sitemap_urls()
    if any(not u.startswith(f"https://{HOST}/") for u in urls):
        raise SystemExit(f"only https://{HOST}/ URLs can be submitted with this key")
    status, reason = submit(urls)
    print(f"IndexNow: {status} {reason} for {len(urls)} URL(s)")
    if status not in (200, 202):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
