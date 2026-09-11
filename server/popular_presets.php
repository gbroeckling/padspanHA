<?php
// PadSpan HA — "Popular presets" feed (public, no key required).
// Deploy at https://padspan.traks.ca/api/popular_presets.php beside
// telemetry.php and stats.php.
//
// Reads the SAME opt-in report spool stats.php reads (private/padspan-
// telemetry/*.jsonl — see telemetry.php for what a report contains) and
// answers a different question: not "how is the fleet doing" (stats.php,
// developer-only), but "what Showcase-preset combinations do people
// actually save" — a top-10 list ANY install can pull into its own
// "Popular presets" pulldown (Mapping -> Lights). Unlike stats.php this
// carries no per-install rows and needs no key: every value in the
// output is already something an install chose to share as a saved
// preset (telemetry.py's `presets` field sends VALUES only, never the
// preset's own name), and the response is exactly that data reshuffled
// by popularity, not attributed to anyone.
//
// WHY "SIMILAR, NOT IDENTICAL" (Garry, 2026-09-11, on why this needed real
// thought): three of a preset's fields are continuous sliders (room %,
// hardness, subtlety), so two people's near-identical presets essentially
// never byte-match. Exact-match counting would report a "top 10" that is
// really just noise. Fix: bin the continuous fields into a few buckets
// each to get a discrete SIGNATURE (the categorical fields — theme, style,
// booleans — already compare exactly), group every reported preset by
// signature, and count INSTALLS per signature (not raw presets — one
// install re-saving five variants must not outrank five different
// installs agreeing once, the same discipline stats.php already applies
// to feature adoption). The pulldown entry for a signature is never a
// synthesized average: it is the one REAL saved preset in that group
// whose exact slider values sit closest to the group's own median (its
// medoid) — "most like other choices made by users" made concrete. With
// very few installs reporting (today's case), every signature is its own
// group of one or two, and the "top 10" degenerates gracefully into "the
// most recently reported distinct presets" — no special-casing needed for
// the small-N case to make sense.

$PRIV = __DIR__ . '/../../../private';
$DIR  = $PRIV . '/padspan-telemetry';
$CACHE = $PRIV . '/padspan-popular-presets-cache.json';
$CACHE_S = 600;          // same window stats.php uses for its own cache
$SPOOL_DAYS = 90;        // the spool itself is trimmed to this by the puller
$TOP_N = 10;

header('Content-Type: application/json');
header('Cache-Control: no-store');

if (is_readable($CACHE) && (time() - filemtime($CACHE)) < $CACHE_S && empty($_GET['fresh'])) {
    readfile($CACHE); exit;
}

function as_map($v) { return is_array($v) ? $v : array(); }

// The same whitelist telemetry.py's _PRESET_VALUE_KEYS sends — anything
// else on a preset object is ignored rather than trusted, the same
// "shape checked again on receipt" discipline telemetry.php applies to
// the whole report.
$KEYS = array(
    'lights_showcase', 'lights_showcase_theme', 'lights_fit_rooms',
    'lights_isolux', 'lights_show_beacons', 'lights_hide_device_codes',
    'lights_hide_untouched', 'lights_automorph_enabled',
    'lights_automorph_room_pct', 'lights_automorph_hardness',
    'lights_automorph_style', 'lights_automorph_subtlety',
);
$BOOL_KEYS = array('lights_showcase', 'lights_fit_rooms', 'lights_isolux',
    'lights_show_beacons', 'lights_hide_device_codes', 'lights_hide_untouched',
    'lights_automorph_enabled');

// Continuous fields, binned to a few buckets each so two near-identical
// presets land in the same signature instead of never matching at all.
// Bucket edges are deliberately coarse — this groups "roughly what kind of
// look", not "the exact slider position".
function bin_pct($v) {                 // 0-100, four even quartile-ish bands
    $v = (float)$v;
    if ($v <= 25) { return 'q1'; }
    if ($v <= 50) { return 'q2'; }
    if ($v <= 75) { return 'q3'; }
    return 'q4';
}
function bin_hardness($v) {            // -100..100, centered at 0
    $v = (float)$v;
    if ($v <= -34) { return 'sharp'; }
    if ($v >= 34) { return 'soft'; }
    return 'neutral';
}
function bin_subtlety($v) {            // 0-100, 0 = full presence
    $v = (float)$v;
    if ($v <= 25) { return 'full'; }
    if ($v <= 60) { return 'moderate'; }
    return 'faded';
}

function signature($vals) {
    global $BOOL_KEYS;
    $parts = array(
        isset($vals['lights_showcase_theme']) ? (string)$vals['lights_showcase_theme'] : '',
        isset($vals['lights_automorph_style']) ? (string)$vals['lights_automorph_style'] : '',
        bin_pct(isset($vals['lights_automorph_room_pct']) ? $vals['lights_automorph_room_pct'] : 0),
        bin_hardness(isset($vals['lights_automorph_hardness']) ? $vals['lights_automorph_hardness'] : 0),
        bin_subtlety(isset($vals['lights_automorph_subtlety']) ? $vals['lights_automorph_subtlety'] : 0),
    );
    foreach ($BOOL_KEYS as $k) { $parts[] = !empty($vals[$k]) ? '1' : '0'; }
    return implode('|', $parts);
}

// Normalized distance between two presets' CONTINUOUS fields only — the
// categorical fields already agree exactly within one signature group, so
// they carry no distance information here. Each axis scaled to 0..1 first
// so no single slider's raw range (hardness spans 200, subtlety spans 100)
// dominates the sum just by having bigger numbers.
function dist($a, $b) {
    $pa = ((float)(isset($a['lights_automorph_room_pct']) ? $a['lights_automorph_room_pct'] : 0)) / 100.0;
    $pb = ((float)(isset($b['lights_automorph_room_pct']) ? $b['lights_automorph_room_pct'] : 0)) / 100.0;
    $ha = (((float)(isset($a['lights_automorph_hardness']) ? $a['lights_automorph_hardness'] : 0)) + 100.0) / 200.0;
    $hb = (((float)(isset($b['lights_automorph_hardness']) ? $b['lights_automorph_hardness'] : 0)) + 100.0) / 200.0;
    $sa = ((float)(isset($a['lights_automorph_subtlety']) ? $a['lights_automorph_subtlety'] : 0)) / 100.0;
    $sb = ((float)(isset($b['lights_automorph_subtlety']) ? $b['lights_automorph_subtlety'] : 0)) / 100.0;
    return sqrt(pow($pa - $pb, 2) + pow($ha - $hb, 2) + pow($sa - $sb, 2));
}

// The real saved preset in the group whose values sit closest to everyone
// else's — an actual instance, never a synthesized blend. Ties broken by
// whichever was reported first (deterministic, not by insertion-order
// accident): candidates are already appended in file-glob (date) order.
function medoid($candidates) {
    $n = count($candidates);
    if ($n === 1) { return $candidates[0]['values']; }
    $best = 0; $best_sum = INF;
    for ($i = 0; $i < $n; $i++) {
        $sum = 0.0;
        for ($j = 0; $j < $n; $j++) {
            if ($i === $j) { continue; }
            $sum += dist($candidates[$i]['values'], $candidates[$j]['values']);
        }
        if ($sum < $best_sum) { $best_sum = $sum; $best = $i; }
    }
    return $candidates[$best]['values'];
}

// ── load: latest report per install, same "last report of the day wins,
//    then most recent day wins" rule stats.php uses ──────────────────────────
$cutoff = gmdate('Y-m-d', time() - $SPOOL_DAYS * 86400);
$latest_day = array();   // install_id => day
$latest = array();       // install_id => report
foreach (glob($DIR . '/*.jsonl') as $f) {
    $day = basename($f, '.jsonl');
    if ($day < $cutoff) { continue; }
    $fh = fopen($f, 'r');
    if (!$fh) { continue; }
    while (($line = fgets($fh)) !== false) {
        $rec = json_decode($line, true);
        if (!is_array($rec) || !isset($rec['report']['install_id'])) { continue; }
        $r = $rec['report'];
        $id = (string)$r['install_id'];
        $d = isset($rec['recv_day']) ? (string)$rec['recv_day'] : $day;
        if (!isset($latest_day[$id]) || $d >= $latest_day[$id]) { $latest_day[$id] = $d; $latest[$id] = $r; }
    }
    fclose($fh);
}

// ── group every reported preset by signature, counting installs once each,
//    keeping every candidate instance for the medoid pass ───────────────────
$groups = array();   // signature => array('installs' => array(id=>1), 'candidates' => array())
foreach ($latest as $id => $r) {
    foreach (as_map(isset($r['presets']) ? $r['presets'] : null) as $p) {
        if (!is_array($p)) { continue; }
        $vals = array();
        foreach ($KEYS as $k) { if (array_key_exists($k, $p)) { $vals[$k] = $p[$k]; } }
        if (!isset($vals['lights_showcase_theme']) || !isset($vals['lights_automorph_style'])) { continue; }
        $sig = signature($vals);
        if (!isset($groups[$sig])) { $groups[$sig] = array('installs' => array(), 'candidates' => array()); }
        $groups[$sig]['installs'][$id] = 1;
        $groups[$sig]['candidates'][] = array('values' => $vals);
    }
}

$ranked = array();
foreach ($groups as $sig => $g) {
    $ranked[] = array(
        'signature' => $sig,
        'installs' => count($g['installs']),
        'values' => medoid($g['candidates']),
    );
}
usort($ranked, function ($a, $b) { return $b['installs'] - $a['installs']; });
$top = array_slice($ranked, 0, $TOP_N);
// Drop the internal signature from the public response — it exists only to
// group on the server side, and leaking the exact bin boundaries buys
// nothing for a consumer that just wants to apply a preset.
$out_list = array();
foreach ($top as $row) { $out_list[] = array('installs' => $row['installs'], 'values' => $row['values']); }

$out = array('ok' => true, 'generated' => gmdate('c'), 'presets' => $out_list);
$json = json_encode($out, JSON_UNESCAPED_SLASHES);
@file_put_contents($CACHE, $json, LOCK_EX);
echo $json;
