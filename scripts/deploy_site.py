#!/usr/bin/env python
"""Deploy padspan.traks.ca from the repo.

    python scripts/deploy_site.py            # stamp version, upload, verify
    python scripts/deploy_site.py --dry-run  # stamp and verify locally, upload nothing

WHY THIS EXISTS
The landing page used to be a hand-edited file living only on the colo. Nothing
tied it to a release, so it drifted: on 2026-08-23, hours after v0.37.0 shipped,
it still advertised v0.21.4 in the hero badge and still told buyers to enable
"Show beta versions" in HACS "until 0.22.x reaches stable" — on the page that
takes their money. That is the same failure as the update-check manifest, which
sat at 0.21.13 for nineteen days after 0.35.0 went stable.

The fix is not to retype the number. It is to remove the place where a human has
to remember:

  * the page lives in the repo (site/index.html), so it is reviewed and versioned
    like the code it describes;
  * every version string on it is marked `data-latest-version` and STAMPED here
    from manifest.json, so there is one source of truth;
  * at runtime the page also reads /api/version.php — the endpoint release.py
    already publishes — so even a page that was deployed late corrects itself in
    the browser. The stamped value is the no-JavaScript fallback.

Deploying writes as root and pipes through `tee`, which truncates the existing
file in place and so preserves its www-data:client1 ownership. A dated backup is
kept the first time each day.
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "site" / "index.html"
# manifest.json is the canonical version: it is what HACS reads and what
# release.py stamps. VERSION.txt is prose ("padspanHA package version: X.Y.Z").
MANIFEST = ROOT / "custom_components" / "padspan_ha" / "manifest.json"

HOST = "administrator@75.157.233.12"
REMOTE_DIR = "/var/www/clients/client1/web10/web/padspan"
REMOTE = REMOTE_DIR + "/index.html"
# Small files that live beside the page. Each exists because the access log
# showed 404s for it: robots.txt was asked for 62 times in 15 days, and
# .htaccess redirects the URLs people GUESS — /pricing, /plans, /docs, /faq —
# which were 404ing visitors looking for the page that sells.
SIDECARS = ("robots.txt", "sitemap.xml", ".htaccess")
URL = "https://padspan.traks.ca/"
MANIFEST_URL = "https://padspan.traks.ca/api/version.php"
SSH = "ssh -o BatchMode=yes -o ConnectTimeout=20"

# Every element carrying data-latest-version has its text replaced with vX.Y.Z.
_VER_TAG = re.compile(r"(<[a-z]+[^>]*\sdata-latest-version[^>]*>)\s*v?[0-9][^<]*(</)", re.I)
# The same elements, read back out of the deployed page, to confirm what they claim.
_VER_TAG_CLAIM = re.compile(r"<[a-z]+[^>]*\sdata-latest-version[^>]*>\s*v?(\d+\.\d+\.\d+)\s*<", re.I)


def _manifest_version() -> str:
    v = str(json.loads(MANIFEST.read_text(encoding="utf-8")).get("version") or "").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", v):
        raise SystemExit(f"manifest.json version does not look like a version: {v!r}")
    return v


def read_version() -> str:
    """The version the PAGE should state — the current STABLE release.

    NOT the version in the working tree. Those differ constantly: the tree sits
    on a pre-release for days at a time. Stamping the build version put
    "the current stable release is v0.37.1" on the live page while 0.37.1 was a
    pre-release and 0.37.0 was still the stable — the page told buyers to expect
    something the stable channel does not serve.

    `latest_stable` from the live manifest is the authority, and release.py
    publishes that BEFORE it deploys the site, so a stable release stamps its own
    new number correctly. `--version X.Y.Z` overrides for a repair.
    """
    for i, a in enumerate(sys.argv):
        if a == "--version" and i + 1 < len(sys.argv):
            return sys.argv[i + 1].lstrip("v")
    try:
        req = urllib.request.Request(MANIFEST_URL, headers={"User-Agent": "padspan-deploy"})
        with urllib.request.urlopen(req, timeout=15) as r:
            v = str(json.loads(r.read().decode("utf-8")).get("latest_stable") or "").strip()
        if re.fullmatch(r"\d+\.\d+\.\d+", v):
            return v
        print(f"  WARN manifest latest_stable is {v!r}; falling back to manifest.json")
    except Exception as e:  # noqa: BLE001
        print(f"  WARN could not read {MANIFEST_URL} ({e}); falling back to manifest.json")
    return _manifest_version()


def stamp(html: str, version: str) -> tuple[str, int]:
    out, n = _VER_TAG.subn(rf"\1v{version}\2", html)
    return out, n


def verify_live(version: str) -> bool:
    """Fetch the deployed page and check the things that must not be wrong."""
    req = urllib.request.Request(URL, headers={"User-Agent": "padspan-deploy"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        live = resp.read().decode("utf-8", "replace")

    # Every element that CLAIMS to state the current version must state this one.
    # Historical mentions in prose (the release history cites v0.21.13 on purpose)
    # are not claims, so the invariant is about the marked elements, not about
    # whether a version string appears anywhere on the page.
    claimed = _VER_TAG_CLAIM.findall(live)
    checks = {
        f"stamped v{version}": f">v{version}<" in live,
        f"every version claim reads v{version} ({len(claimed)} found)":
            bool(claimed) and all(c == version for c in claimed),
        "no beta-channel instruction": "Show beta versions" not in live,
        "paypal button intact": 'name="item_number" value="padspan-pro-annual"' in live,
        "paypal amount intact": 'name="amount" value="45.00"' in live,
        "lighting section present": 'id="lights"' in live,
        "editions section present": 'id="editions"' in live,
        "whats-new section present": 'id="whatsnew"' in live,
        "runtime version fetch present": "/api/version.php" in live,
    }
    ok = True
    for name, passed in checks.items():
        print(f"    {'OK  ' if passed else 'FAIL'} {name}")
        ok = ok and passed

    # The manifest the page reads at runtime should agree with what we stamped.
    try:
        mreq = urllib.request.Request(MANIFEST_URL, headers={"User-Agent": "padspan-deploy"})
        with urllib.request.urlopen(mreq, timeout=20) as r:
            served = json.loads(r.read().decode("utf-8"))
        agree = served.get("latest_stable") == version
        print(f"    {'OK  ' if agree else 'WARN'} version.php latest_stable={served.get('latest_stable')}")
        if not agree:
            print("      (not fatal: the page will show whatever the manifest says. If that is"
                  " wrong, run: python scripts/release.py --manifest-only <version> --stable)")
    except Exception as e:  # noqa: BLE001
        print(f"    WARN could not read version.php: {e}")

    # The redirects are the whole point of .htaccess. A file that Apache copied
    # but ignores is worse than none, because nothing would ever say so.
    # (urllib.error is imported at module level: importing it HERE would make
    # `urllib` a local name and shadow urllib.request for the whole function.)
    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, hdrs, newurl):
            raise urllib.error.HTTPError(req.full_url, code, msg, hdrs, None)

    for path, want in (("pricing", "#pro"), ("docs", "#docs")):
        try:
            rq = urllib.request.Request(URL + path, headers={"User-Agent": "padspan-deploy"})
            urllib.request.build_opener(_NoRedirect).open(rq, timeout=15)
            print(f"    WARN /{path} did not redirect")
        except urllib.error.HTTPError as e:
            loc = (e.headers.get("Location", "") if e.headers else "")
            good = e.code in (301, 302) and want in loc
            print(f"    {'OK  ' if good else 'WARN'} /{path} -> {e.code} {loc or '(no Location)'}")
        except Exception as e:  # noqa: BLE001
            print(f"    WARN /{path} check failed: {e}")

    return ok


def main() -> None:
    dry = "--dry-run" in sys.argv
    version = read_version()
    html = SRC.read_text(encoding="utf-8")
    stamped, n = stamp(html, version)
    print(f"\n=== deploy_site: v{version} · {n} version string(s) stamped ===\n")
    if n == 0:
        raise SystemExit("no data-latest-version elements found — refusing to deploy a page "
                         "whose version cannot be kept current")

    if dry:
        print("dry run: nothing uploaded.")
        print(f"  local bytes: {len(stamped)}")
        return

    # Keep one backup per day, then truncate in place so ownership survives.
    subprocess.run(
        f'{SSH} {HOST} "sudo -n test -f {REMOTE}.bak-$(date +%Y%m%d) || '
        f'sudo -n cp -p {REMOTE} {REMOTE}.bak-$(date +%Y%m%d)"',
        shell=True, check=False)

    # Send BYTES, not text. With text=True, Python encodes stdin using the
    # console locale — cp1252 on this machine — which cannot represent the
    # page's own characters (the ✓ in the purchase banner, the em dashes) and
    # kills the writer thread mid-upload. The file is UTF-8; ship it as UTF-8.
    res = subprocess.run(f'{SSH} {HOST} "sudo -n tee {REMOTE} > /dev/null"',
                         shell=True, input=stamped.encode("utf-8"), capture_output=True)
    if res.returncode != 0:
        raise SystemExit(f"upload failed: {res.stderr.decode('utf-8', 'replace').strip()}")
    print(f"  uploaded {len(stamped)} bytes to {REMOTE}")

    for name in SIDECARS:
        side = SRC.parent / name
        if not side.exists():
            continue
        r = subprocess.run(f'{SSH} {HOST} "sudo -n tee {REMOTE_DIR}/{name} > /dev/null"',
                           shell=True, input=side.read_bytes(), capture_output=True)
        if r.returncode != 0:
            print(f"  WARN {name} not uploaded: {r.stderr.decode('utf-8', 'replace').strip()}")
        else:
            print(f"  uploaded {name}")

    print("\nVerifying the live page...")
    if not verify_live(version):
        raise SystemExit("the deployed page failed verification — look at it before leaving it")
    print(f"\n=== {URL} is live on v{version} ===\n")


if __name__ == "__main__":
    main()
