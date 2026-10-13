<?php
// PadSpan HA — the Install Base view (opt-in report totals) on its own page,
// behind a password, for a browser that has no Home Assistant to hand.
//
// Deployed at https://pad.traks.ca/ (vhost /etc/apache2/sites-available/
// pad.traks.ca.conf on bcmail, docroot web10/web/pad/) with, beside it:
//   data.php        this folder's data.php (stats.php's numbers, signed in only)
//   pro.php         this folder's pro.php (the free-Pro invite list and tester count, signed in only)
//   installbase.js  custom_components/padspan_ha/www/padspan-ha/views/installbase.js, unchanged
//   styles.css      custom_components/padspan_ha/www/padspan-ha/styles.css, unchanged
//   robots.txt      Disallow everything
//   favicon.png     custom_components/padspan_ha/brand/icon.png
// Copy installbase.js and styles.css again when they change.
//
// The password's hash (password_hash) is the one line of
// private/padspan-report-pass. This page is the gate; the view's own PIN is
// skipped. Failed sign-ins are counted across all callers in
// private/padspan-report-fails.json: each costs a second, and 20 in 15 minutes
// stop all sign-ins until the oldest ages out.

$PRIV  = __DIR__ . '/../../private';
$PASS  = $PRIV . '/padspan-report-pass';
$FAILS = $PRIV . '/padspan-report-fails.json';
$FAIL_WINDOW_S = 900;
$FAIL_MAX = 20;

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');

// The session cookie is Secure, so a plain-http visit could never sign in.
if (strpos($_SERVER['HTTP_CF_VISITOR'] ?? '', '"http"') !== false) {
    header('Location: https://pad.traks.ca/', true, 301);
    exit;
}

session_name('padspan_report');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict']);
session_start();

if (isset($_GET['logout'])) {
    $_SESSION = [];
    session_destroy();
    header('Location: /', true, 303);
    exit;
}

function recent_fails($file, $window) {
    $t = is_readable($file) ? json_decode((string)file_get_contents($file), true) : [];
    $now = time();
    return array_values(array_filter(is_array($t) ? $t : [], fn($x) => is_int($x) && $now - $x < $window));
}

$msg = '';
if (empty($_SESSION['ok']) && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $fails = recent_fails($FAILS, $FAIL_WINDOW_S);
    $hash = is_readable($PASS) ? trim((string)file_get_contents($PASS)) : '';
    if (count($fails) >= $FAIL_MAX) {
        $msg = 'Too many wrong passwords. Try again in a few minutes.';
    } elseif ($hash !== '' && password_verify((string)($_POST['password'] ?? ''), $hash)) {
        session_regenerate_id(true);
        $_SESSION['ok'] = 1;
        header('Location: /', true, 303);
        exit;
    } else {
        $fails[] = time();
        @file_put_contents($FAILS, json_encode($fails), LOCK_EX);
        sleep(1);
        $msg = 'Wrong password.';
    }
}

$v = fn($f) => @filemtime(__DIR__ . '/' . $f) ?: 0;
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>PadSpan Install Base</title>
<link rel="stylesheet" href="styles.css?v=<?= $v('styles.css') ?>">
<link rel="icon" href="favicon.png">
<style>
  /* styles.css puts its colours on :host (the panel's shadow root); a plain page needs them here. */
  body{--accent:#52b788;--bg:#0a150e;--panel:#0f1a12;--line:#1b3526;--text:#e2e8f0;
    margin:0;padding:16px;background:var(--bg);color:var(--text);font-family:Inter,system-ui,Arial,sans-serif}
  .pad-top{max-width:1280px;margin:0 auto;display:flex;justify-content:flex-end}
  .pad-top a{color:rgba(226,240,232,.6);font-size:12px;text-decoration:none}
  .pad-top a:hover{color:#e8f0ea}
  .pad-login{max-width:340px;margin:18vh auto 0;display:flex;flex-direction:column;gap:12px}
  .pad-login h1{margin:0;font-size:28px;font-weight:800;letter-spacing:-.01em;text-transform:uppercase}
  .pad-login .k{font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:#45a878}
  .pad-login input{padding:10px 12px;border-radius:10px;border:1px solid #2a4a36;background:#0f1a12;color:#e8f0ea;font-size:15px}
  .pad-login button{padding:10px 12px;border-radius:10px;border:1px solid #45a878;background:#183a27;color:#e8f0ea;font-weight:700;cursor:pointer}
  .pad-login .m{min-height:1.2em;color:#f87171;font-size:13px}
  .pro{max-width:1280px;margin:8px auto 16px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
  .pro .k{font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:#45a878;margin-bottom:8px}
  .pro-nums{font-size:14px;color:#cbd5e1}
  .pro-t{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  .pro-t th,.pro-t td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)}
  .pro-t th{color:#94a3b8;font-weight:600}
  .pro-t td:first-child{font-family:ui-monospace,Consolas,monospace}
  .pro-t .s-claimed td{color:#8ee5b4}.pro-t .s-declined td{color:#94a3b8}.pro-t .s-delivered td{color:#fbbf24}
  .pro-key{margin-top:10px;font-size:13px;color:#cbd5e1;line-height:1.55}
  .pro-key summary{cursor:pointer;color:var(--accent);font-weight:700}
  .pro-key code{font-size:12px;background:#0a150e;padding:1px 4px;border-radius:4px}
</style>
</head>
<body>
<?php if (empty($_SESSION['ok'])): ?>
<form class="pad-login" method="post" action="/">
  <div class="k">PadSpan opt-in reports</div>
  <h1>Install Base</h1>
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required aria-label="Password">
  <button type="submit">Sign in</button>
  <div class="m" role="status"><?= htmlspecialchars($msg) ?></div>
</form>
<?php else: ?>
<div class="pad-top"><a href="?logout=1">Sign out</a></div>
<section class="pro" id="pro" aria-label="Free Pro push">
  <div class="k">Free Pro push · 2026</div>
  <div class="pro-nums" id="pro-nums">Loading…</div>
  <table class="pro-t" id="pro-t" hidden><thead><tr><th>Install</th><th>Wave</th><th>Status</th><th>Delivered</th><th>Answered</th><th>Until</th></tr></thead><tbody></tbody></table>
  <details class="pro-key"><summary>Key info</summary>
    <ul>
      <li><b>Invites (a free year of Pro).</b> Shown only to installs on the list, running 0.38.124 or later, after their next daily report. Overview card + Settings &rarr; PadSpan licence, administrators only, never with a working paid key, never in Bright.</li>
      <li><b>Statuses.</b> invited = on the list, not reached yet &middot; delivered = the card can show &middot; claimed = key issued &middot; declined = No thanks (never sent again).</li>
      <li><b>Claims.</b> A one-year Pro key emailed to them; garry@bcmail.net gets their address. New keys are tagged <code>invite-&hellip;</code> in the licence table. The list never holds an email.</li>
      <li><b>Add a wave.</b> On bcmail: <code>sudo -u www-data python3 /var/www/clients/client1/web10/private/pro_invites.py add &lt;8-char ids&gt; --until 2026-12-31 --wave N</code> (ids from the Pro Candidates tab, marketing-engagement.xlsx on 5810).</li>
      <li><b>Testers.</b> Two years of Pro free while the usage report stays on; keys issued by hand (licence API, plan <code>tester</code>). Overview offers it once per install.</li>
      <li><b>Also running.</b> GitHub discussion #92: first 20 who email hello@traks.ca get a year (by hand, plan pro, 365 days), until December 31. Pro for life $89 CAD until December 31.</li>
    </ul>
  </details>
</section>
<div id="app"></div>
<script>
(async () => {
  const nums = document.getElementById("pro-nums"), t = document.getElementById("pro-t");
  try {
    const r = await fetch("pro.php", { cache: "no-store" });
    const d = await r.json();
    if (!d.ok) throw new Error("answered " + r.status);
    const c = { invited: 0, delivered: 0, claimed: 0, declined: 0 };
    for (const i of d.invites) if (i.status in c) c[i.status]++;
    nums.textContent = `${d.invites.length} invited in all · ${c.invited} waiting for an update · ${c.delivered} seeing the card · ` +
      `${c.claimed} claimed · ${c.declined} declined · ${d.testers} tester sign-up${d.testers === 1 ? "" : "s"}`;
    const body = t.querySelector("tbody");
    for (const i of d.invites) {
      const tr = document.createElement("tr");
      for (const v of [i.id, i.wave, i.status, i.delivered, i.answered, i.until]) {
        const td = document.createElement("td"); td.textContent = v === "" ? "–" : String(v); tr.appendChild(td);
      }
      tr.className = "s-" + i.status;
      body.appendChild(tr);
    }
    t.hidden = !d.invites.length;
  } catch (e) { nums.textContent = "Couldn't load the invite list: " + e.message; }
})();
</script>
<script type="module">
import { render } from "./installbase.js?v=<?= $v('installbase.js') ?>";

// panel.js's el(), which the view builds everything with.
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "id") n.id = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined) continue;
    if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}

// Signed in already, so skip the view's own PIN.
try { sessionStorage.setItem("padspan_installbase_unlocked", "1"); } catch (_) { /* blocked: the view asks for its PIN */ }

const ctx = {
  helpers: { el, helpBtn: () => null },
  state: { settings: { tier: "pro" } },
  actions: {
    // Stands in for the padspan_ha/install_base WS call, which answers { cached, stats }.
    wsCall: async (_type, msg) => {
      const r = await fetch("data.php" + (msg && msg.fresh ? "?fresh=1" : ""), { cache: "no-store" });
      if (r.status === 403) { location.reload(); throw new Error("Signed out"); }
      const stats = await r.json().catch(() => null);
      if (!r.ok || !stats || !stats.ok) throw new Error("Stats answered " + r.status);
      return { cached: false, stats };
    },
  },
};
document.getElementById("app").appendChild(render(ctx));
</script>
<?php endif; ?>
</body>
</html>
