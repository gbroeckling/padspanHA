<?php
// PadSpan HA update-check endpoint.
// Returns the latest version manifest and appends one line per ping to a
// private log (timestamp, client IP, reported version). No cookies, no
// identifiers beyond the caller's IP. See the PadSpan README "Update check"
// section for the user-facing disclosure.

header('Content-Type: application/json');
header('Cache-Control: no-store');

$manifest_file = __DIR__ . '/latest.json';
$log_file = '/var/www/clients/client1/web10/private/padspan-pings.log';

$v = isset($_GET['v']) ? substr(preg_replace('/[^0-9A-Za-z.\-_]/', '', $_GET['v']), 0, 32) : '';
// Prefer Cloudflare's own header (this domain is CF-proxied) but fall back
// to the generic X-Forwarded-For, which virtually any reverse proxy sets,
// before REMOTE_ADDR — which alone would be the proxy's own shared edge IP,
// collapsing every distinct caller onto one address if CF-Connecting-IP
// ever stops being forwarded (a header-passthrough config on the origin,
// not something this endpoint controls).
$xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
$xff_first = $xff !== '' ? trim(explode(',', $xff)[0]) : '';
$ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? ($xff_first !== '' ? $xff_first : ($_SERVER['REMOTE_ADDR'] ?? '-'));

$line = sprintf("%s\t%s\t%s\n", gmdate('c'), $ip, $v !== '' ? $v : '-');
@file_put_contents($log_file, $line, FILE_APPEND | LOCK_EX);

$manifest = @file_get_contents($manifest_file);
if ($manifest === false) {
    $manifest = json_encode(array('latest_stable' => null, 'latest_beta' => null));
}
// The free-Pro offers' switches (private/padspan-offers.json, e.g.
// {"tester": true, "invite": true}), merged in as "offers". Kept apart from
// latest.json, which every release rewrites. An install from 0.38.133 on hides
// an offer switched off here; telemetry.php, tester.php and the licence
// server's invite_claim read the same file. Only these two names, as booleans.
$offers = json_decode((string)@file_get_contents('/var/www/clients/client1/web10/private/padspan-offers.json'), true);
$m = json_decode($manifest, true);
if (is_array($offers) && is_array($m)) {
    $out = array();
    foreach (array('tester', 'invite') as $k) {
        if (isset($offers[$k]) && is_bool($offers[$k])) { $out[$k] = $offers[$k]; }
    }
    if ($out) { $m['offers'] = $out; $manifest = json_encode($m, JSON_UNESCAPED_SLASHES); }
}
// The feature tips' ranking (private/padspan-tips.json, {"tips": ["audio", ...]}: tip ids, the most used among the
// opt-in reports' installs that have the feature first), merged in as "tips" the same way. The reports' machine
// writes it nightly (server/telemetry_summary.py --tips-out; server/pull_padspan_telemetry.sh puts it here). An
// install with feature tips breaks a tie between two tips with it (update_check._keep_tips keeps only ids it knows);
// older ones ignore the key. Only short lower-case ids, each once, at most 64: the file can reorder tips, never add one.
$tips = json_decode((string)@file_get_contents('/var/www/clients/client1/web10/private/padspan-tips.json'), true);
if (is_array($tips) && isset($tips['tips']) && is_array($tips['tips']) && is_array($m)) {
    $out = array();
    foreach ($tips['tips'] as $id) {
        if (is_string($id) && preg_match('/^[a-z0-9_]{1,40}$/', $id) && !in_array($id, $out, true)) { $out[] = $id; }
        if (count($out) >= 64) { break; }
    }
    if ($out) { $m['tips'] = $out; $manifest = json_encode($m, JSON_UNESCAPED_SLASHES); }
}
echo $manifest;
