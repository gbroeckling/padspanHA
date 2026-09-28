<?php
// PadSpan HA — "Become a tester" sign-ups.
// Deploy at https://padspan.traks.ca/api/tester.php beside telemetry.php.
//
// The one PadSpan endpoint that takes contact details, and it is kept apart
// from the anonymous usage report (telemetry.php) on purpose: its own file,
// its own directory, its own id. Nothing here reads or writes the report
// spool, and telemetry.php never reads anything here.
//
// WHAT IS KEPT, in private/padspan-testers/testers.json (outside the web
// root), one record per tester_id — a random UUID the person's own Home
// Assistant made, never the report's install id:
//   contact           email (required); github and name only if given
//   interests         what they would like to test, from $INTERESTS below
//   interests_other, notes, timezone      only if given
//   setup             the "About your setup" counts/versions they left ticked
//   version           their PadSpan version
//   link_install_id   ONLY if they ticked "Link my anonymous usage reports"
//   created, updated  when this server received it (UTC)
// WHY: to contact them about testing, and to know what they can test on.
// HOW LONG: until they press "Stop being a tester". That deletes the record
//   and appends only {tester_id, withdrawn_at} to withdrawals.log — enough to
//   show it was deleted, nothing that says who. An update replaces the whole
//   record, so whatever they untick or clear is gone too.
// NEVER KEPT: the IP address, the user agent, any other request header, or
//   any key not listed above (unknown keys are dropped). Never shared or sold.
//
// Refused with a clear error and not stored: free text that looks like a
// secret — a PadSpan licence key, a 32+ digit hex string, a JWT, a long
// token. Abuse guard: at most 500 records, at most 100 new sign-ups per UTC
// day. Only the person's own button presses ever send here; nothing retries.
//
// tests/test_tester.py ports these checks to Python (there is no PHP where
// the tests run) and holds the lists and patterns below equal to
// custom_components/padspan_ha/tester.py — change one, change the other.

// ISPConfig layout on padspan.traks.ca, as telemetry.php: this file lives at
// web/padspan/api/, so three levels up is the site root, whose private/ is
// outside the web root. server/pull_padspan_telemetry.sh pulls testers.json
// home read-only.
$DIR = __DIR__ . '/../../../private/padspan-testers';
$MAX = 4096;
$MAX_RECORDS = 500;
$MAX_NEW_PER_DAY = 100;

$INTERESTS = array('findmy', 'wled', 'floors', 'calibration', 'iphone_irk', 'bermuda', 'esphome_proxies', 'other');
$SETUP_KEYS = array('ha_version', 'padspan_version', 'edition', 'tier', 'scanners', 'floors', 'rooms',
                    'placed_lights', 'wled_devices', 'wled_outputs', 'findmy_on_air', 'integrations');
// Characters (not bytes), as the integration counts them.
$LIMITS = array('email' => 254, 'name' => 64, 'interests_other' => 80, 'notes' => 500, 'timezone' => 64);

$EMAIL_RX = '/^[A-Za-z0-9._%+\'-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/D';
$GITHUB_RX = '/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/D';
$TIMEZONE_RX = '#^[A-Za-z][A-Za-z0-9_+-]*(?:/[A-Za-z0-9_+-]+){0,2}$#D';
$UUID_RX = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D';
$SECRETS = array(
    'a PadSpan licence key' => '/\b[Pp][Ss][Pp][Aa][Nn]-[A-Za-z0-9-]{8,}/',
    'a long hex string (a key or an IRK)' => '/\b[0-9A-Fa-f]{32,}\b/',
    'a login token' => '/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/',
    'a long key or token' => '/(?=[A-Za-z0-9+=_]*[0-9])(?=[A-Za-z0-9+=_]*[A-Za-z])[A-Za-z0-9+=_]{40,}/',
);

function reply($code, $why = '', $error = '') {
    http_response_code($code);
    $out = array('ok' => $code === 200);
    if ($why !== '') { $out['why'] = $why; }
    if ($error !== '') { $out['error'] = $error; }
    echo json_encode($out);
    exit;
}

function chars($s) {
    return preg_match_all('/./su', $s);
}

function secret_in($s, $secrets) {
    foreach ($secrets as $what => $rx) {
        if (preg_match($rx, $s)) { return $what; }
    }
    return '';
}

// A setup value: a count, a short version or word, or a small {word: count}
// table. Anything else is dropped, not stored.
function setup_value($v) {
    if (is_bool($v)) { return null; }
    if (is_int($v)) { return ($v >= 0 && $v <= 1000000) ? $v : null; }
    if (is_string($v)) { return preg_match('/^[A-Za-z0-9 ._+-]{1,32}$/D', $v) ? $v : null; }
    if (is_array($v)) {
        if (count($v) > 12) { return null; }
        $out = array();
        foreach ($v as $k => $n) {
            if (!is_string($k) || !preg_match('/^[a-z0-9_]{1,24}$/D', $k)) { return null; }
            if (!is_int($n) || $n < 0 || $n > 1000000) { return null; }
            $out[$k] = $n;
        }
        return $out ? $out : new stdClass();
    }
    return null;
}

// One read-change-write of testers.json under an exclusive lock. $mutate gets
// the list by reference and returns array(result, changed). A file that cannot
// be read as JSON is never overwritten, nor truncated for a list that could
// not be encoded: null, and nothing changes.
function with_store($dir, $mutate) {
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) { return null; }
    $file = $dir . '/testers.json';
    $h = @fopen($file, 'c+');
    if (!$h) { return null; }
    if (!flock($h, LOCK_EX)) { fclose($h); return null; }
    $cur = stream_get_contents($h);
    $db = json_decode(($cur === false || $cur === '') ? '{}' : $cur, true);
    if (!is_array($db)) { flock($h, LOCK_UN); fclose($h); return null; }
    if (!isset($db['testers']) || !is_array($db['testers'])) { $db['testers'] = array(); }
    if (!isset($db['guard']) || !is_array($db['guard'])) { $db['guard'] = array('day' => '', 'new' => 0); }
    list($result, $changed) = $mutate($db);
    if ($changed) {
        $out = $db;
        $out['schema'] = 1;
        if (!$out['testers']) { $out['testers'] = new stdClass(); }
        $json = json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if ($json === false) { flock($h, LOCK_UN); fclose($h); return null; }
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, $json);
        fflush($h);
    }
    flock($h, LOCK_UN);
    fclose($h);
    @chmod($file, 0640);
    return $result;
}

header('Content-Type: application/json');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { reply(405, 'method', 'POST only.'); }
$raw = file_get_contents('php://input', false, null, 0, $MAX + 1);
if ($raw === false || strlen($raw) > $MAX) { reply(413, 'size', 'That is too long (over 4 KB).'); }
if (!(json_decode($raw) instanceof stdClass)) { reply(400, 'json', 'That is not a JSON object.'); }
$r = json_decode($raw, true);
if (!isset($r['schema']) || $r['schema'] !== 1) { reply(400, 'schema', 'Unknown schema.'); }
$action = (isset($r['action']) && is_string($r['action'])) ? $r['action'] : '';
if (!in_array($action, array('signup', 'update', 'withdraw'), true)) { reply(400, 'action', 'Unknown action.'); }
$id = (isset($r['tester_id']) && is_string($r['tester_id'])) ? strtolower($r['tester_id']) : '';
if (!preg_match($UUID_RX, $id)) { reply(400, 'id', 'The tester ID is not a UUID.'); }

// ── Stop being a tester ──────────────────────────────────────────────────────
// Deleted whole. ok also when there was nothing to delete: the person's goal
// — no record here — holds either way.
if ($action === 'withdraw') {
    $deleted = with_store($DIR, function (&$db) use ($id) {
        if (!isset($db['testers'][$id])) { return array(false, false); }
        unset($db['testers'][$id]);
        return array(true, true);
    });
    if ($deleted === null) { reply(500, 'store', 'The server could not open its list. Nothing was changed - please try again later.'); }
    if ($deleted === true) {
        @file_put_contents($DIR . '/withdrawals.log',
            json_encode(array('tester_id' => $id, 'withdrawn_at' => gmdate('c'))) . "\n", FILE_APPEND | LOCK_EX);
    }
    reply(200);
}

// ── Sign up, or update ───────────────────────────────────────────────────────
if (!isset($r['consent']) || $r['consent'] !== true) { reply(400, 'consent', 'Consent is required to sign up.'); }
$c = (isset($r['contact']) && is_array($r['contact'])) ? $r['contact'] : array();
$email = (isset($c['email']) && is_string($c['email'])) ? $c['email'] : '';
if ($email === '' || strlen($email) > $LIMITS['email'] || !preg_match($EMAIL_RX, $email)) {
    reply(400, 'email', "That email address doesn't look right.");
}
$contact = array('email' => $email);
if (isset($c['github']) && $c['github'] !== '') {
    if (!is_string($c['github']) || !preg_match($GITHUB_RX, $c['github'])) {
        reply(400, 'github', "That GitHub username doesn't look right.");
    }
    $contact['github'] = $c['github'];
}
if (isset($c['name']) && $c['name'] !== '') {
    if (!is_string($c['name']) || chars($c['name']) > $LIMITS['name'] || preg_match('/[\x00-\x1f\x7f]/', $c['name'])) {
        reply(400, 'name', 'The name is too long, or not plain text.');
    }
    $contact['name'] = $c['name'];
}
$given = (isset($r['interests']) && is_array($r['interests'])) ? $r['interests'] : array();
$interests = array();
foreach ($INTERESTS as $k) {
    if (in_array($k, $given, true)) { $interests[] = $k; }
}
$rec = array('tester_id' => $id, 'contact' => $contact, 'interests' => $interests);
if (in_array('other', $interests, true) && isset($r['interests_other']) && $r['interests_other'] !== '') {
    $o = $r['interests_other'];
    if (!is_string($o) || chars($o) > $LIMITS['interests_other'] || preg_match('/[\x00-\x1f\x7f]/', $o)) {
        reply(400, 'interests_other', "'Other' is too long, or not plain text.");
    }
    $rec['interests_other'] = $o;
}
if (isset($r['notes']) && $r['notes'] !== '') {
    $n = $r['notes'];
    if (!is_string($n) || chars($n) > $LIMITS['notes'] || preg_match('/[\x00-\x08\x0b-\x1f\x7f]/', $n)) {
        reply(400, 'notes', 'The notes are too long (500 characters at most), or not plain text.');
    }
    $rec['notes'] = $n;
}
if (isset($r['timezone']) && $r['timezone'] !== '') {
    $tz = $r['timezone'];
    if (!is_string($tz) || strlen($tz) > $LIMITS['timezone'] || !preg_match($TIMEZONE_RX, $tz)) {
        reply(400, 'timezone', "That time zone doesn't look right.");
    }
    $rec['timezone'] = $tz;
}
$checked = array(
    'your name' => isset($contact['name']) ? $contact['name'] : '',
    'the GitHub username' => isset($contact['github']) ? $contact['github'] : '',
    "'Other'" => isset($rec['interests_other']) ? $rec['interests_other'] : '',
    'your notes' => isset($rec['notes']) ? $rec['notes'] : '',
);
foreach ($checked as $where => $text) {
    $what = secret_in($text, $SECRETS);
    if ($what !== '') {
        reply(400, 'secret', "That looks like $what in $where - please take it out. A sign-up never needs one.");
    }
}
$setup = array();
if (isset($r['setup']) && is_array($r['setup'])) {
    foreach ($SETUP_KEYS as $k) {
        if (!array_key_exists($k, $r['setup'])) { continue; }
        $v = setup_value($r['setup'][$k]);
        if ($v !== null) { $setup[$k] = $v; }
    }
}
$rec['setup'] = $setup ? $setup : new stdClass();
if (isset($r['version']) && is_string($r['version']) && preg_match('/^[A-Za-z0-9._+-]{1,32}$/D', $r['version'])) {
    $rec['version'] = $r['version'];
}
if (isset($r['link_install_id']) && is_string($r['link_install_id'])
        && preg_match($UUID_RX, strtolower($r['link_install_id']))) {
    $rec['link_install_id'] = strtolower($r['link_install_id']);
}

$today = gmdate('Y-m-d');
$now = gmdate('c');
$result = with_store($DIR, function (&$db) use ($id, $rec, $today, $now, $MAX_RECORDS, $MAX_NEW_PER_DAY) {
    $old = (isset($db['testers'][$id]) && is_array($db['testers'][$id])) ? $db['testers'][$id] : null;
    if ($old === null) {
        if (count($db['testers']) >= $MAX_RECORDS) { return array('full', false); }
        $g = $db['guard'];
        if (!isset($g['day']) || $g['day'] !== $today || !isset($g['new'])) { $g = array('day' => $today, 'new' => 0); }
        if ((int)$g['new'] >= $MAX_NEW_PER_DAY) { return array('busy', false); }
        $g['new'] = (int)$g['new'] + 1;
        $db['guard'] = $g;
    }
    $rec['created'] = ($old !== null && isset($old['created'])) ? $old['created'] : $now;
    $rec['updated'] = $now;
    $db['testers'][$id] = $rec;   // replaced whole: whatever was left out is gone
    return array('ok', true);
});
if ($result === null) { reply(500, 'store', 'The server could not save it right now. Nothing was kept - please try again later.'); }
if ($result === 'full') { reply(503, 'full', 'The tester list is full at the moment. Thank you - please try again later.'); }
if ($result === 'busy') { reply(429, 'busy', 'Too many sign-ups today. Please try again tomorrow.'); }
reply(200);
