<?php
// pad.traks.ca — the stats.php numbers for a browser signed in on index.php.
// stats.php is included, not fetched: it reads the same private/ spool and
// cache, and ?fresh=1 passes straight through to it.

session_name('padspan_report');
session_start(['read_and_close' => true]);
if (empty($_SESSION['ok'])) {
    http_response_code(403);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo '{"ok":false}';
    exit;
}
header('X-Robots-Tag: noindex, nofollow');
define('PADSPAN_STATS_TRUSTED', true);
require __DIR__ . '/../padspan/api/stats.php';
