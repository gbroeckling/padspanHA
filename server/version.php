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
echo $manifest;
