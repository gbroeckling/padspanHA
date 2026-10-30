<?php
// pad.traks.ca — the dashboard's whole model (schema 1) for a browser signed in on index.php.
// The model is built every 5 minutes by pad_digest.py (root cron on this server) into
// /var/lib/pad-digest/model.json (root:www-data 0640); this file only checks the session and serves it.
// The session key is pad_ok, set only by this site's index.php: other sites on this server that
// keep an 'ok' key in their sessions don't open it.
// The contract is server/pad_report/DIGEST.md.

session_name('padspan_report');
session_start(['read_and_close' => true]);
header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
if (empty($_SESSION['pad_ok'])) {
    http_response_code(403);
    echo '{"ok":false}';
    exit;
}
$model = '/var/lib/pad-digest/model.json';
if (!is_readable($model)) {
    http_response_code(503);
    echo '{"ok":false,"error":"not ready"}';
    exit;
}
readfile($model);
