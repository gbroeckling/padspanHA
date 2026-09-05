<?php
// PadSpan HA — install-base dashboard feed (developer only).
// Deploy at https://padspan.traks.ca/api/stats.php beside telemetry.php.
//
// Aggregates two things nothing else reads together:
//   1. the opt-in usage reports in private/padspan-telemetry/*.jsonl
//      (counts, versions, flags — see telemetry.php), and
//   2. the update-check ping log private/padspan-pings.log, which is the only
//      signal from the installs that did NOT opt in. Its IP column is used
//      here solely to count distinct callers per day, and is never emitted:
//      what leaves this file is "N distinct installs pinged on this day on
//      this version", nothing that could name one.
//
// Access: the caller presents a PadSpan Pro key in the X-PadSpan-Key header.
// Its SHA-256 must appear in private/padspan-dev-keys (one hex hash per
// line). There is no "valid Pro key" path — a Pro customer is not the
// developer, and this is other people's installs. A missing or unknown key
// is a 403 with no detail. The integration shows the view only in Dev mode
// at Pro tier, but that is a courtesy; this check is the gate.
//
// The answer is cached for CACHE_S seconds in private/ so a panel polling
// every minute re-reads the spool once.

$PRIV  = __DIR__ . '/../../../private';
$DIR   = $PRIV . '/padspan-telemetry';
$PINGS = $PRIV . '/padspan-pings.log';
$KEYS  = $PRIV . '/padspan-dev-keys';
$CACHE = $PRIV . '/padspan-stats-cache.json';
$CACHE_S = 600;
$WINDOW_DAYS = 30;      // distributions and per-day series
$ACTIVE_DAYS = 7;       // "active" = reported within this many days
$LAPSED_DAYS = 14;      // "lapsed" = seen before, silent this long

header('Content-Type: application/json');
header('Cache-Control: no-store');

// ── gate ─────────────────────────────────────────────────────────────────────
$presented = isset($_SERVER['HTTP_X_PADSPAN_KEY']) ? trim((string)$_SERVER['HTTP_X_PADSPAN_KEY']) : '';
$ok = false;
if ($presented !== '' && is_readable($KEYS)) {
    $want = hash('sha256', $presented);
    foreach (file($KEYS, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') { continue; }
        if (hash_equals(strtolower($line), $want)) { $ok = true; break; }
    }
}
if (!$ok) { http_response_code(403); echo '{"ok":false}'; exit; }

// ── cache ────────────────────────────────────────────────────────────────────
if (is_readable($CACHE) && (time() - filemtime($CACHE)) < $CACHE_S && empty($_GET['fresh'])) {
    readfile($CACHE); exit;
}

// ── helpers ──────────────────────────────────────────────────────────────────
// The per-day chart and "today" read in the developer's own timezone, not
// the server's UTC clock — a day genuinely starts and ends when it does for
// the one person reading this dashboard. Only these two (the chart's own
// buckets, and "today" which is the chart's last bucket restated as a
// headline number) — the window cutoffs below stay UTC, since those are
// N-days-back arithmetic, not a calendar boundary anyone is looking at.
$PACIFIC_TZ = new DateTimeZone('America/Vancouver');
function pacific_day($ts) {
    global $PACIFIC_TZ;
    // Accepts a Unix timestamp (int, from time()) or anything DateTime parses
    // natively — gmdate('c') (ISO-8601 with offset) is what both the report
    // spool's recv_ts and the ping log's own timestamp are stored as.
    $dt = is_int($ts) ? new DateTime('@' . $ts) : new DateTime($ts);
    $dt->setTimezone($PACIFIC_TZ);
    return $dt->format('Y-m-d');
}
function bucket($v, $edges) {
    foreach ($edges as $e) { if ($v <= $e) { return '<= ' . $e; } }
    return '> ' . $edges[count($edges) - 1];
}
function incr(&$arr, $k, $n = 1) { $arr[$k] = (isset($arr[$k]) ? $arr[$k] : 0) + $n; }
function as_map($v) { return is_array($v) ? $v : array(); }   // PHP re-encodes {} as []

$today = pacific_day(time());
$cutoff = gmdate('Y-m-d', time() - $WINDOW_DAYS * 86400);
$active_cut = gmdate('Y-m-d', time() - $ACTIVE_DAYS * 86400);
$lapsed_cut = gmdate('Y-m-d', time() - $LAPSED_DAYS * 86400);

// ── load the reports: one row per install per day, last report of the day wins
$rows = array();            // "$id|$day" => report
$first_seen = array();      // id => earliest day in the spool
$last_seen = array();       // id => latest day
$days_reported = array();   // id => count of distinct days
$spool_first_day = null;
foreach (glob($DIR . '/*.jsonl') as $f) {
    $day = basename($f, '.jsonl');
    if ($spool_first_day === null || $day < $spool_first_day) { $spool_first_day = $day; }
    $fh = fopen($f, 'r');
    if (!$fh) { continue; }
    while (($line = fgets($fh)) !== false) {
        $rec = json_decode($line, true);
        if (!is_array($rec) || !isset($rec['report']['install_id'])) { continue; }
        $r = $rec['report'];
        $id = (string)$r['install_id'];
        // recv_ts (added alongside recv_day) carries real time-of-day, so a
        // report can be bucketed into the day it actually landed in Pacific
        // time. Older records (before recv_ts existed) have no time-of-day
        // to convert — recv_day is already a bare UTC calendar day, and
        // there's no way to recover which Pacific day that really was, so
        // it's used as-is rather than guessed at.
        $d = isset($rec['recv_ts']) ? pacific_day($rec['recv_ts'])
           : (isset($rec['recv_day']) ? (string)$rec['recv_day'] : $day);
        $rows[$id . '|' . $d] = $r;
        if (!isset($first_seen[$id]) || $d < $first_seen[$id]) { $first_seen[$id] = $d; }
        if (!isset($last_seen[$id]) || $d > $last_seen[$id]) { $last_seen[$id] = $d; }
    }
    fclose($fh);
}
foreach (array_keys($rows) as $k) { incr($days_reported, substr($k, 0, strpos($k, '|'))); }

// The ledger outlives the spool (telemetry.php keeps it): lifetime counts come
// from there, so trimming the spool at 90 days does not make installs vanish.
$ledger = array();
if (is_readable($DIR . '/installs.json')) {
    $ledger = as_map(json_decode((string)file_get_contents($DIR . '/installs.json'), true));
}
foreach ($ledger as $id => $e) {
    if (!isset($first_seen[$id]) || (isset($e['first']) && $e['first'] < $first_seen[$id])) { $first_seen[$id] = isset($e['first']) ? $e['first'] : (isset($first_seen[$id]) ? $first_seen[$id] : null); }
    if (!isset($last_seen[$id]) || (isset($e['last']) && $e['last'] > $last_seen[$id])) { $last_seen[$id] = isset($e['last']) ? $e['last'] : (isset($last_seen[$id]) ? $last_seen[$id] : null); }
    if (isset($e['days']) && (!isset($days_reported[$id]) || $e['days'] > $days_reported[$id])) { $days_reported[$id] = (int)$e['days']; }
}

// ── latest report per install ────────────────────────────────────────────────
$latest = array();          // id => report (most recent day)
$latest_day = array();
foreach ($rows as $k => $r) {
    list($id, $d) = explode('|', $k, 2);
    if (!isset($latest_day[$id]) || $d > $latest_day[$id]) { $latest_day[$id] = $d; $latest[$id] = $r; }
}

// ── installs ─────────────────────────────────────────────────────────────────
$installs = array('lifetime' => count($first_seen), 'active' => 0, 'reporting_window' => 0,
                  'new_window' => 0, 'lapsed' => 0, 'pro' => 0, 'bright' => 0);
foreach ($first_seen as $id => $fd) {
    $ld = isset($last_seen[$id]) ? $last_seen[$id] : $fd;
    if ($ld >= $active_cut) { $installs['active']++; }
    if ($ld >= $cutoff) { $installs['reporting_window']++; }
    if ($fd >= $cutoff) { $installs['new_window']++; }
    if ($ld < $lapsed_cut) { $installs['lapsed']++; }
}
foreach ($latest as $r) {
    if (isset($r['tier']) && $r['tier'] === 'pro') { $installs['pro']++; }
    if (isset($r['edition']) && $r['edition'] === 'bright') { $installs['bright']++; }
}

// ── per-day series (reports, distinct installs) over the window ──────────────
$per_day = array();
for ($i = $WINDOW_DAYS - 1; $i >= 0; $i--) {
    $d = pacific_day(time() - $i * 86400);
    $per_day[$d] = array('day' => $d, 'reports' => 0, 'installs' => 0, 'pings' => 0);
}
foreach ($rows as $k => $r) {
    list($id, $d) = explode('|', $k, 2);
    if (isset($per_day[$d])) { $per_day[$d]['reports']++; $per_day[$d]['installs']++; }
}

// ── update-check pings: distinct callers per day and per version, IPs hashed
//    on the way through and discarded. This is the whole install base, not
//    the opted-in slice. ────────────────────────────────────────────────────
$ping = array('distinct_window' => 0, 'distinct_today' => 0, 'by_version' => array(),
              'first_day' => null, 'lines_window' => 0);
if (is_readable($PINGS)) {
    $seen_window = array(); $seen_today = array(); $seen_day = array(); $ver_seen = array();
    $fh = fopen($PINGS, 'r');
    while (($line = fgets($fh)) !== false) {
        $p = explode("\t", rtrim($line, "\n"));
        if (count($p) < 3) { continue; }
        // $p[0] is gmdate('c') (version.php) — full ISO-8601 with offset, so
        // every ping ever logged can be re-bucketed into its real Pacific
        // day, not just ones logged going forward.
        $d = pacific_day($p[0]);
        if ($ping['first_day'] === null || $d < $ping['first_day']) { $ping['first_day'] = $d; }
        if ($d < $cutoff) { continue; }
        $h = hash('sha256', $p[1]);          // never stored, never emitted
        $v = $p[2] !== '' ? $p[2] : '-';
        $ping['lines_window']++;
        $seen_window[$h] = 1;
        if ($d === $today) { $seen_today[$h] = 1; }
        $seen_day[$d][$h] = 1;
        // last version seen per caller wins, so an upgrade moves the caller
        $ver_seen[$h] = $v;
    }
    fclose($fh);
    $ping['distinct_window'] = count($seen_window);
    $ping['distinct_today'] = count($seen_today);
    foreach ($ver_seen as $h => $v) { incr($ping['by_version'], $v); }
    arsort($ping['by_version']);
    foreach ($seen_day as $d => $hs) { if (isset($per_day[$d])) { $per_day[$d]['pings'] = count($hs); } }
}

// ── distributions from the latest report of each install ─────────────────────
$dist = array('version' => array(), 'ha_version' => array(), 'python' => array(), 'tier' => array(),
              'scanners' => array(), 'floors' => array(), 'rooms' => array(), 'maps' => array(),
              'calibration_points' => array(), 'irks' => array(), 'walls' => array(),
              'placed_lights' => array(), 'objects_total' => array());
$edges = array(
    'scanners' => array(2, 4, 8, 16, 32), 'floors' => array(1, 2, 3, 5), 'rooms' => array(4, 8, 12, 24, 48),
    'maps' => array(0, 1, 2, 3, 6), 'calibration_points' => array(0, 10, 50, 200, 1000),
    'irks' => array(0, 1, 2, 4, 8), 'walls' => array(0, 20, 60, 200), 'placed_lights' => array(0, 10, 40, 100),
    'objects_total' => array(200, 1000, 3000, 10000),
);
$integrations = array(); $features = array(); $flags = array(); $scanner_kinds = array();
// BLE scan mode. HA 2026.6 flipped the default for every ESPHome proxy from
// active to auto, so most installs are now scanning passively without having
// chosen to. Radio-level counts say how much of the fleet is in each mode;
// the install-level tallies say how many PEOPLE deliberately pinned one, which
// is the question worth answering. `requested` is the choice, `mode` is the
// momentary state - an auto scanner reads passive nearly all the time.
$scan_modes = array(); $scan_modes_requested = array();
$scan_mode_installs = array('any_active' => 0, 'any_passive_pinned' => 0, 'all_auto' => 0, 'no_data' => 0);
$env_sum = array('scanners' => 0, 'floors' => 0, 'rooms' => 0, 'calibration_points' => 0, 'irks' => 0);
$identity = array('with_irks' => 0, 'resolving' => 0, 'silent' => 0, 'private_ble_device' => 0);
// Advanced-feature adoption: installs (not raw item counts — one house with
// 20 motion sensors should not outweigh 20 houses with one each) that have
// placed at least one of the newer classes, or touched the pro-only type
// override. `placed_by_domain`/`light_type_overrides_by_kind` are per-domain
// counts (never entity ids), added the day these features needed a way to
// answer "is anyone actually using this" instead of just "how many lights".
$adoption = array('motion_sensors' => 0, 'temp_sensors' => 0, 'fans' => 0, 'type_overrides' => 0);
$type_override_kinds = array();
$geometry = array('faulted' => 0, 'anchor_faulted' => 0, 'no_anchor' => 0, 'no_anchor_known' => 0,
                  'floors_default' => 0, 'z_uniform' => 0, 'cal_no_floor' => 0, 'multi_floor' => 0);
foreach ($latest as $id => $r) {
    $e = as_map(isset($r['env']) ? $r['env'] : null);
    $h = as_map(isset($r['health']) ? $r['health'] : null);
    incr($dist['version'], isset($r['version']) ? (string)$r['version'] : '?');
    incr($dist['ha_version'], isset($r['ha_version']) ? (string)$r['ha_version'] : '?');
    incr($dist['python'], isset($r['python']) ? (string)$r['python'] : '?');
    incr($dist['tier'], (isset($r['edition']) ? $r['edition'] : '?') . '/' . (isset($r['tier']) ? $r['tier'] : '?'));
    foreach ($edges as $k => $ed) { incr($dist[$k], bucket((int)(isset($e[$k]) ? $e[$k] : 0), $ed)); }
    foreach ($env_sum as $k => $_) { $env_sum[$k] += (int)(isset($e[$k]) ? $e[$k] : 0); }
    $pbd = as_map(isset($e['placed_by_domain']) ? $e['placed_by_domain'] : null);
    if ((int)(isset($pbd['motion_sensor']) ? $pbd['motion_sensor'] : 0) > 0) { $adoption['motion_sensors']++; }
    if ((int)(isset($pbd['temp_sensor']) ? $pbd['temp_sensor'] : 0) > 0) { $adoption['temp_sensors']++; }
    if ((int)(isset($pbd['fan']) ? $pbd['fan'] : 0) > 0) { $adoption['fans']++; }
    $tob = as_map(isset($e['light_type_overrides_by_kind']) ? $e['light_type_overrides_by_kind'] : null);
    if (count($tob)) {
        $adoption['type_overrides']++;
        foreach ($tob as $k => $n) { incr($type_override_kinds, $k, (int)$n); }
    }
    foreach (as_map(isset($e['integrations']) ? $e['integrations'] : null) as $k => $n) { if ((int)$n > 0) { incr($integrations, $k); } }
    foreach (as_map(isset($e['scanner_kinds']) ? $e['scanner_kinds'] : null) as $k => $n) { incr($scanner_kinds, $k, (int)$n); }
    foreach (as_map(isset($e['scan_modes']) ? $e['scan_modes'] : null) as $k => $n) { incr($scan_modes, $k, (int)$n); }
    $req = as_map(isset($e['scan_modes_requested']) ? $e['scan_modes_requested'] : null);
    foreach ($req as $k => $n) { incr($scan_modes_requested, $k, (int)$n); }
    // One install counted once, by what it deliberately pinned. An install
    // reporting nothing here is an older PadSpan, not an install with no
    // radios - keep it separate so 'all_auto' is not inflated by silence.
    if (!count($req)) {
        $scan_mode_installs['no_data']++;
    } else {
        $act = (int)(isset($req['active']) ? $req['active'] : 0);
        $pas = (int)(isset($req['passive']) ? $req['passive'] : 0);
        if ($act > 0) { $scan_mode_installs['any_active']++; }
        if ($pas > 0) { $scan_mode_installs['any_passive_pinned']++; }
        if ($act === 0 && $pas === 0) { $scan_mode_installs['all_auto']++; }
    }
    foreach (as_map(isset($r['features']) ? $r['features'] : null) as $k => $v) { if ($v === true) { incr($features, $k); } }

    // Health flags — installs where the flag is BAD. Each is only counted
    // when the report carries the field (older versions don't), so a zero
    // here means "none bad among those that can say", not "nobody says".
    $bad = array();
    if (isset($h['crypto_ok']) && $h['crypto_ok'] === false) { $bad[] = 'crypto_missing'; }
    if (isset($h['ble_callback_active']) && $h['ble_callback_active'] === false) { $bad[] = 'ble_callback_dead'; }
    if (isset($h['ble_diag_ok']) && $h['ble_diag_ok'] === false) { $bad[] = 'ble_diag_bad'; }
    if (!empty($h['maps_geometry_faulted'])) { $bad[] = 'geometry_faulted'; $geometry['faulted']++; }
    if (!empty($h['geometry_anchor_faulted'])) { $bad[] = 'anchor_faulted'; $geometry['anchor_faulted']++; }
    if (!empty($h['stack_desync'])) { $bad[] = 'stack_desync'; }
    if (!empty($h['irks_silent'])) { $bad[] = 'irks_silent'; }
    if (isset($h['has_metre_anchor'])) { $geometry['no_anchor_known']++; if ($h['has_metre_anchor'] === false) { $bad[] = 'no_metre_anchor'; $geometry['no_anchor']++; } }
    if (!empty($h['floors_all_default'])) { $bad[] = 'floors_all_default'; $geometry['floors_default']++; }
    if (!empty($h['scanner_z_uniform'])) { $bad[] = 'scanner_z_uniform'; $geometry['z_uniform']++; }
    if (!empty($h['radios_ambiguous'])) { $bad[] = 'radios_ambiguous'; }
    if (!empty($h['radios_unresolved'])) { $bad[] = 'radios_unresolved'; }
    if (!empty($e['calibration_no_floor'])) { $bad[] = 'calibration_no_floor'; $geometry['cal_no_floor']++; }
    if ((int)(isset($e['floors']) ? $e['floors'] : 0) > 1) { $geometry['multi_floor']++; }
    foreach ($bad as $b) { incr($flags, $b); }

    $nirk = (int)(isset($e['irks']) ? $e['irks'] : 0);
    if ($nirk > 0) {
        $identity['with_irks']++;
        if ((int)(isset($h['irk_devices_resolving']) ? $h['irk_devices_resolving'] : 0) > 0) { $identity['resolving']++; }
        elseif (isset($h['irk_devices_resolving'])) { $identity['silent']++; }
    }
    $ints = as_map(isset($e['integrations']) ? $e['integrations'] : null);
    if ((int)(isset($ints['private_ble_device']) ? $ints['private_ble_device'] : 0) > 0) { $identity['private_ble_device']++; }

    $latest[$id]['_bad'] = $bad;
}
foreach ($dist as $k => $_) { arsort($dist[$k]); }
arsort($integrations); arsort($features); arsort($flags);

// ── window sums: usage, errors, ui errors ────────────────────────────────────
$usage = array(); $tabs = array(); $ui_errors = array(); $errors = array(); $errors_installs = array();
$usage_installs = array();
foreach ($rows as $k => $r) {
    list($id, $d) = explode('|', $k, 2);
    if ($d < $cutoff) { continue; }
    foreach (as_map(isset($r['usage']) ? $r['usage'] : null) as $ev => $n) {
        $n = (int)$n;
        if (strpos($ev, 'tab:') === 0) { incr($tabs, substr($ev, 4), $n); }
        elseif (strpos($ev, 'ui_error:') === 0) { incr($ui_errors, substr($ev, 9), $n); }
        else { incr($usage, $ev, $n); }
        $usage_installs[$ev][$id] = 1;
    }
    foreach (as_map(isset($r['errors']) ? $r['errors'] : null) as $mod => $n) {
        incr($errors, $mod, (int)$n);
        $errors_installs[$mod][$id] = 1;
    }
}
arsort($usage); arsort($tabs); arsort($ui_errors); arsort($errors);
$errors_out = array();
foreach ($errors as $mod => $n) { $errors_out[$mod] = array('lines' => $n, 'installs' => count($errors_installs[$mod])); }
$usage_out = array();
foreach ($usage as $ev => $n) { $usage_out[$ev] = array('count' => $n, 'installs' => count($usage_installs[$ev])); }
$tabs_out = array();
foreach ($tabs as $t => $n) { $tabs_out[$t] = array('count' => $n, 'installs' => count($usage_installs['tab:' . $t])); }

// ── the per-install table (anonymous: the random id's first 8 chars) ─────────
$table = array();
foreach ($latest as $id => $r) {
    $e = as_map(isset($r['env']) ? $r['env'] : null);
    $h = as_map(isset($r['health']) ? $r['health'] : null);
    $ints = as_map(isset($e['integrations']) ? $e['integrations'] : null);
    $table[] = array(
        'id' => substr($id, 0, 8),
        'first' => isset($first_seen[$id]) ? $first_seen[$id] : null,
        'last' => $latest_day[$id],
        'days' => isset($days_reported[$id]) ? $days_reported[$id] : 0,
        'version' => isset($r['version']) ? $r['version'] : '?',
        'ha' => isset($r['ha_version']) ? $r['ha_version'] : '?',
        'tier' => (isset($r['edition']) ? $r['edition'] : '?') . '/' . (isset($r['tier']) ? $r['tier'] : '?'),
        'scanners' => (int)(isset($e['scanners']) ? $e['scanners'] : 0),
        'floors' => (int)(isset($e['floors']) ? $e['floors'] : 0),
        'rooms' => (int)(isset($e['rooms']) ? $e['rooms'] : 0),
        'maps' => (int)(isset($e['maps']) ? $e['maps'] : 0),
        'cal' => (int)(isset($e['calibration_points']) ? $e['calibration_points'] : 0),
        'irks' => (int)(isset($e['irks']) ? $e['irks'] : 0),
        'irks_resolving' => (int)(isset($h['irk_devices_resolving']) ? $h['irk_devices_resolving'] : 0),
        'objects' => (int)(isset($e['objects_total']) ? $e['objects_total'] : 0),
        'identified' => (int)(isset($e['objects_identified']) ? $e['objects_identified'] : 0),
        'bermuda' => (int)(isset($ints['bermuda']) ? $ints['bermuda'] : 0) > 0,
        'pbd' => (int)(isset($ints['private_ble_device']) ? $ints['private_ble_device'] : 0),
        'uptime' => isset($h['uptime']) ? $h['uptime'] : '?',
        'flags' => $r['_bad'],
    );
}
usort($table, function ($a, $b) { return strcmp($b['last'], $a['last']) ?: strcmp($b['first'], $a['first']); });

$out = array(
    'ok' => true,
    'generated' => gmdate('c'),
    'window_days' => $WINDOW_DAYS,
    'active_days' => $ACTIVE_DAYS,
    'lapsed_days' => $LAPSED_DAYS,
    'spool_first_day' => $spool_first_day,
    'installs' => $installs,
    'pings' => $ping,
    'per_day' => array_values($per_day),
    'dist' => $dist,
    'env_sum' => $env_sum,
    'integrations' => $integrations,
    'scanner_kinds' => $scanner_kinds,
    'scan_modes' => $scan_modes,
    'scan_modes_requested' => $scan_modes_requested,
    'scan_mode_installs' => $scan_mode_installs,
    'features' => $features,
    'flags' => $flags,
    'identity' => $identity,
    'geometry' => $geometry,
    'adoption' => $adoption,
    'type_override_kinds' => $type_override_kinds,
    'usage' => $usage_out,
    'tabs' => $tabs_out,
    'ui_errors' => $ui_errors,
    'errors' => $errors_out,
    'table' => $table,
);
$json = json_encode($out, JSON_UNESCAPED_SLASHES);
@file_put_contents($CACHE, $json, LOCK_EX);
echo $json;
