<?php
// PadSpan HA — opt-in usage report receiver.
// Deploy at https://padspan.traks.ca/api/telemetry.php beside version.php.
//
// Appends one JSON line per report to telemetry/YYYY-MM-DD.jsonl (a directory
// NEXT TO the api folder — put it outside the web root if you can; see $DIR).
// Stores the report as sent plus the server-side day. It does NOT store the
// client IP, user agent, or anything else from the request.
//
// The integration only ever sends counts/versions/flags (telemetry.py
// assert_shareable refuses anything identifier-shaped before sending) and this
// receiver applies the same shape checks again: a report is dropped if it is
// not JSON, is over 8 KB, has unexpected top-level keys, or contains a MAC,
// a UUID other than install_id, a 32-hex string, a licence key or an IP
// anywhere in it. Summarise with server/telemetry_summary.py.

$DIR = __DIR__ . '/../telemetry';   // adjust to taste; keep it out of the web root if possible
$MAX = 8192;

header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo '{"ok":false}'; exit; }
$raw = file_get_contents('php://input', false, null, 0, $MAX + 1);
if ($raw === false || strlen($raw) > $MAX) { http_response_code(413); echo '{"ok":false}'; exit; }
$r = json_decode($raw, true);
if (!is_array($r)) { http_response_code(400); echo '{"ok":false}'; exit; }

$allowed = array('schema','install_id','day','version','edition','tier','ha_version','python','env','features','usage','health','errors');
foreach (array_keys($r) as $k) {
    if (!in_array($k, $allowed, true)) { http_response_code(400); echo '{"ok":false,"why":"key"}'; exit; }
}
if (!isset($r['schema']) || (int)$r['schema'] !== 1) { http_response_code(400); echo '{"ok":false,"why":"schema"}'; exit; }
$id = isset($r['install_id']) ? (string)$r['install_id'] : '';
if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id)) {
    http_response_code(400); echo '{"ok":false,"why":"id"}'; exit;
}

// The same identifier shapes the client refuses — checked over everything but install_id.
$copy = $r; unset($copy['install_id']);
$flat = json_encode($copy);
$shapes = array(
    '/\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/',
    '/\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/',
    '/\b[0-9A-Fa-f]{32}\b/',
    '/\bPSPAN-[A-Z0-9-]{8,}\b/i',
    '/\b\d{1,3}(?:\.\d{1,3}){3}\b/',
);
foreach ($shapes as $rx) {
    if (preg_match($rx, $flat)) { http_response_code(400); echo '{"ok":false,"why":"shape"}'; exit; }
}

if (!is_dir($DIR) && !mkdir($DIR, 0750, true)) { http_response_code(500); echo '{"ok":false}'; exit; }
$line = json_encode(array('recv_day' => gmdate('Y-m-d'), 'report' => $r), JSON_UNESCAPED_SLASHES) . "\n";
$f = $DIR . '/' . gmdate('Y-m-d') . '.jsonl';
if (file_put_contents($f, $line, FILE_APPEND | LOCK_EX) === false) { http_response_code(500); echo '{"ok":false}'; exit; }
echo '{"ok":true}';
