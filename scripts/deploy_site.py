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
import secrets
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
# The German page. It is built from SRC on every deploy (scripts/build_site_de.py),
# never kept by hand, so it can't fall behind the English one.
REMOTE_DE = REMOTE_DIR + "/de/index.html"
# Small files that live beside the page. robots.txt/sitemap.xml/.htaccess
# exist because the access log showed 404s for them: robots.txt was asked
# for 62 times in 15 days, and .htaccess redirects the URLs people GUESS —
# /pricing, /plans, /docs, /faq — which were 404ing visitors looking for the
# page that sells. showcase-themes.html is a standalone static page (no
# data-latest-version elements, so it never needs stamping) linked from the
# #lights section as a sneak peek — it rides along unmodified, same as the
# others.
SIDECARS = ("robots.txt", "sitemap.xml", ".htaccess", "showcase-themes.html")
# Guides: one standalone English page each, site/guides/<name>/index.html,
# served at /guides/<name>/. Like showcase-themes.html they state no version,
# so they ride along unmodified; unlike it, each needs its folder made first.
# They are written for search: someone asking "Bermuda or PadSpan?" lands on
# one, not on the release notes. tests/test_site_guides.py keeps each one in
# the sitemap and pointing at its own address.
GUIDES = tuple(sorted(p.relative_to(SRC.parent).as_posix()
                      for p in (SRC.parent / "guides").glob("*/index.html")))
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


def _build_site_de():
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import build_site_de  # noqa: E402

    return build_site_de


def build_german(html: str, version: str) -> tuple[str, dict]:
    """The German page for this English one, stamped like it. See build_site_de.py."""
    de, report = _build_site_de().build(html)
    de, _ = stamp(de, version)
    return de, report


def origin(path: str, country: str, cookie: str = "", accept_language: str = "") -> str:
    """What the origin answers a visitor from `country`, as "<code> <redirect URL>",
    plus " cookie=<value>" when it sets padspan_lang.

    Cloudflare sets CF-IPCountry from the visitor's real address, so from here
    the language rules can only be seen by asking the origin directly."""
    extra = (f" -H 'Cookie: {cookie}'" if cookie else "") + \
            (f" -H 'Accept-Language: {accept_language}'" if accept_language else "")
    r = subprocess.run(
        f"{SSH} {HOST} \"curl -s -o /dev/null -D - --max-time 10 -w 'RESULT %{{http_code}} %{{redirect_url}}' "
        f"--resolve padspan.traks.ca:80:127.0.0.1 -H 'CF-IPCountry: {country}'{extra} "
        f"'http://padspan.traks.ca{path}'\"",
        shell=True, capture_output=True, text=True)
    out = r.stdout or ""
    if "RESULT " not in out:
        return r.stderr.strip()[:80] or "no answer"
    answer = out.rsplit("RESULT ", 1)[1].strip()
    set_cookie = re.search(r"(?im)^set-cookie:\s*padspan_lang=(\w+)", out)
    return answer + (f" cookie={set_cookie.group(1)}" if set_cookie else "")


# (path, country, cookie, Accept-Language, the answer it must be)
LANGUAGE_CASES = (
    ("/", "CA", "", "", "200"),
    ("/", "DE", "", "", f"302 {URL}de/"),
    ("/", "CH", "", "fr-CH,fr;q=0.9", "200"),
    ("/", "DE", "padspan_lang=en", "", "200"),
    ("/", "US", "padspan_lang=de", "", f"302 {URL}de/"),
    ("/?hl=en", "AT", "", "", "200"),
    ("/?hl=en", "DE", "padspan_lang=de", "", "200"),   # the release notes, after choosing German
    # The language links: each one is remembered, and Deutsch goes straight to German.
    ("/?lang=en", "DE", "", "", "200 cookie=en"),
    ("/?lang=de", "US", "", "", f"302 {URL}de/?lang=de cookie=de"),
    ("/de", "US", "", "", f"301 {URL}de/"),
)


def preflight_htaccess() -> list[str]:
    """Try site/.htaccess in a scratch folder on the server before it replaces the
    live one. A broken .htaccess answers every request on the site with a 500,
    and wrong language rules would send everyone to /de/ or no one."""
    ht = (SRC.parent / ".htaccess").read_bytes()
    scratch = f"{REMOTE_DIR}/_deploy_check_{secrets.token_hex(4)}"
    base = "/" + scratch.rsplit("/", 1)[1]

    def put(path: str, data: bytes) -> bool:
        return subprocess.run(f'{SSH} {HOST} "sudo -n tee {path} > /dev/null"', shell=True,
                              input=data, capture_output=True).returncode == 0

    problems = []
    try:
        made = subprocess.run(f'{SSH} {HOST} "sudo -n mkdir -p {scratch}"', shell=True, capture_output=True)
        if made.returncode != 0 or not (put(scratch + "/.htaccess", ht) and put(scratch + "/index.html", b"<p>check</p>\n")):
            return ["could not set up the scratch folder on the server"]
        for path, country, cookie, lang, want in LANGUAGE_CASES + (("/missing.html", "CA", "", "", "404"),):
            got = origin(base + path, country, cookie, lang)
            if got != want:
                problems.append(f"{country} {cookie or 'no cookie'} {lang} {path}: got {got!r}, wanted {want!r}")
    finally:
        gone = subprocess.run(f'{SSH} {HOST} "sudo -n rm -rf {scratch}"', shell=True, capture_output=True)
        if gone.returncode != 0:
            print(f"  WARN the scratch folder {scratch} could not be removed: delete it by hand")
    return problems


def verify_live(version: str) -> bool:
    """Fetch the deployed page and check the things that must not be wrong."""
    # ?lang=en: from Germany, Austria or Switzerland the bare URL would send this
    # check to /de/ (site/.htaccess), and it would fail on the wrong page.
    req = urllib.request.Request(URL + "?lang=en", headers={"User-Agent": "padspan-deploy"})
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
        "links to the German page": 'href="/de/?lang=de"' in live,
    }
    ok = True
    for name, passed in checks.items():
        print(f"    {'OK  ' if passed else 'FAIL'} {name}")
        ok = ok and passed

    # The German page: there, German, stamped, and selling the same things.
    try:
        rq = urllib.request.Request(URL + "de/", headers={"User-Agent": "padspan-deploy"})
        with urllib.request.urlopen(rq, timeout=20) as resp:
            de = resp.read().decode("utf-8", "replace")
        de_checks = {
            "de: German page served": '<html lang="de"' in de,
            f"de: stamped v{version}": f">v{version}<" in de,
            "de: paypal button intact": 'name="item_number" value="padspan-pro-annual"' in de,
            "de: paypal amount intact": 'name="amount" value="45.00"' in de,
            "de: links back to English": 'href="/?lang=en"' in de,
        }
    except Exception as e:  # noqa: BLE001
        de_checks = {f"de: page fetched ({e})": False}
    for name, passed in de_checks.items():
        print(f"    {'OK  ' if passed else 'FAIL'} {name}")
        ok = ok and passed
    # Who lands where, asked of the origin (see origin()).
    for path, country, cookie, lang, want in LANGUAGE_CASES:
        got = origin(path, country, cookie, lang)
        good = got == want
        print(f"    {'OK  ' if good else 'FAIL'} {country}{' ' + cookie if cookie else ''}"
              f"{' ' + lang if lang else ''} {path} -> {got}")
        ok = ok and good
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

    # Each guide is there, and says it is the page at its own address.
    for name in GUIDES:
        url = URL + name.rsplit("/", 1)[0] + "/"
        try:
            rq = urllib.request.Request(url, headers={"User-Agent": "padspan-deploy"})
            with urllib.request.urlopen(rq, timeout=20) as resp:
                good = f'<link rel="canonical" href="{url}">' in resp.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            print(f"      ({url}: {e})")
            good = False
        print(f"    {'OK  ' if good else 'FAIL'} guide {url}")
        ok = ok and good

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

    de_html, de_rep = build_german(html, version)
    print(f"  German page: {de_rep['translated']} of {de_rep['units']} text blocks in German "
          f"({100 * de_rep['coverage']:.0f}%)")
    if de_rep["missing"]:
        print("    still English on /de/ (add them to site/i18n/de.json; "
              "python scripts/build_site_de.py lists them all):")
        for key in de_rep["missing"][:8]:
            print("     ", re.sub(r"<[^>]+>", "", key)[:90])
    # Everything is checked before anything is uploaded: once the new .htaccess
    # is live, Germany, Austria and Switzerland are sent to whatever /de/ holds.
    # Gaps (English showing through on /de/) are reported but never hold a deploy.
    for gap in _build_site_de().gaps(de_rep):
        print(f"  WARN German page: {gap}")
    problems = _build_site_de().check(stamped, de_html, de_rep)
    if problems:
        raise SystemExit("the German page isn't ready, so nothing was uploaded:\n  - " + "\n  - ".join(problems))
    if dry:
        print("dry run: nothing uploaded.")
        print(f"  local bytes: {len(stamped.encode('utf-8'))} English, {len(de_html.encode('utf-8'))} German")
        return
    problems = preflight_htaccess()
    if problems:
        raise SystemExit("site/.htaccess failed its check in a scratch folder, so nothing was uploaded:\n  - "
                         + "\n  - ".join(problems))
    print("  site/.htaccess checked in a scratch folder on the server")

    # German first: once the new .htaccess is up, visitors from Germany, Austria
    # and Switzerland are sent to /de/, so it has to be there already.
    subprocess.run(
        f'{SSH} {HOST} "sudo -n mkdir -p {REMOTE_DIR}/de && '
        f'(sudo -n test ! -f {REMOTE_DE} || sudo -n test -f {REMOTE_DE}.bak-$(date +%Y%m%d) || '
        f'sudo -n cp -p {REMOTE_DE} {REMOTE_DE}.bak-$(date +%Y%m%d))"',
        shell=True, check=False)
    r = subprocess.run(f'{SSH} {HOST} "sudo -n tee {REMOTE_DE} > /dev/null"',
                       shell=True, input=de_html.encode("utf-8"), capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f"German page upload failed: {r.stderr.decode('utf-8', 'replace').strip()}")
    print(f"  uploaded {len(de_html.encode('utf-8'))} bytes to {REMOTE_DE}")

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
    print(f"  uploaded {len(stamped.encode('utf-8'))} bytes to {REMOTE}")

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

    # mkdir and tee run as root, so new folders and files would be root's; chown
    # gives them the page's own owner (www-data:client1), like the rest of the site.
    for name in GUIDES:
        folder = f"{REMOTE_DIR}/{name.rsplit('/', 1)[0]}"
        r = subprocess.run(f'{SSH} {HOST} "sudo -n mkdir -p {folder} && sudo -n tee {REMOTE_DIR}/{name} > /dev/null'
                           f' && sudo -n chown -R --reference={REMOTE} {REMOTE_DIR}/guides"',
                           shell=True, input=(SRC.parent / name).read_bytes(), capture_output=True)
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
