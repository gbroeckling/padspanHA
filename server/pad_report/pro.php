<?php
// pad.traks.ca — the free-Pro push at a glance, for a browser signed in on
// index.php. The invite list (private/padspan-invites.json, written with
// private/pro_invites.py) with its tokens left out, and how many testers have
// signed up. Never an email, a token or a tester's details.

session_name('padspan_report');
session_start(['read_and_close' => true]);
header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
if (empty($_SESSION['pad_ok'])) { http_response_code(403); echo '{"ok":false}'; exit; }

$private = __DIR__ . '/../../private';
function read_json($f) {
    if (!is_readable($f)) return null;
    $d = json_decode((string)@file_get_contents($f), true);
    return is_array($d) ? $d : null;
}

$invites = array();
foreach ((read_json($private . '/padspan-invites.json') ?: array()) as $id => $e) {
    if (!is_array($e)) continue;
    $invites[] = array(
        'id' => substr((string)$id, 0, 8),
        'wave' => isset($e['wave']) ? (int)$e['wave'] : 0,
        'status' => isset($e['status']) ? (string)$e['status'] : '',
        'until' => isset($e['until']) ? (string)$e['until'] : '',
        'delivered' => isset($e['delivered']) ? (string)$e['delivered'] : '',
        'answered' => isset($e['answered']) ? (string)$e['answered'] : '',
    );
}
usort($invites, function ($a, $b) { return [$a['wave'], $a['id']] <=> [$b['wave'], $b['id']]; });

$testers = read_json($private . '/padspan-testers/testers.json');
$tester_count = ($testers && isset($testers['testers']) && is_array($testers['testers'])) ? count($testers['testers']) : 0;

echo json_encode(array('ok' => true, 'invites' => $invites, 'testers' => $tester_count), JSON_UNESCAPED_SLASHES);
