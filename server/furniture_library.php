<?php
// PadSpan HA — Live Aboard's shared furniture library.
// Deploy at https://padspan.traks.ca/api/furniture_library.php beside
// tester.php — but only on Garry's word, and only after the lawyer's review of
// the terms that the plan requires (docs/IDEA_ATLAS_3D_HOUSE.md, "The shared
// furniture library"). There is no PHP where PadSpan's tests run, so run
//   php -l furniture_library.php
// on the server before deploying it. tests/test_furniture_library_server.py
// ports this file to Python line for line, reading its lists and patterns out
// of this source, and runs tests/fixtures/furniture_library/ against the port.
// The install checks the same things before anything is sent, with the same
// lists and patterns: custom_components/padspan_ha/house3d_library.py and
// views/live_aboard_library.js. Change one, change all three (tests hold
// them equal).
//
// Any PadSpan house with Live Aboard's "Shared library" switch on can browse
// it. A piece is added only by a house that accepted the library's terms.
//
// WHAT IS KEPT, in private/padspan-furniture/library.json (outside the web
// root), one entry per shared piece:
//   recipe          kind, builder settings, colours, width / depth / height (m)
//   details         the details sheet: closed lists, plus an optional title,
//                   brand and model
//   submission_id   the random id the sharing house made (never shown)
//   owner_hash      SHA-256 of the random owner token that house keeps; only
//                   the token can change the details or withdraw the piece
//   version, terms_version   its PadSpan version, and the terms it was shared under
//   created, updated, placed  dates (UTC), and an anonymous count of placements
//   reports         up to 20 report reasons, keyed by the reporter's random
//                   6-hex prefix (nothing more is ever sent)
// WHY: so other PadSpan houses can find the piece and place it.
// HOW LONG: until its house withdraws it ("Withdraw my shared furniture") or
//   the library's owner removes it. A withdrawal deletes the entry and appends
//   only {submission_id, withdrawn_at} to withdrawals.log.
// NEVER KEPT: the IP address, the user agent, any other request header, where
//   the piece sits in a house, its name there, a photo, a device it is linked
//   to, or anything else. A key outside the recipe or the details sheet is
//   refused, not stored.
//
// Refused with a reason and not stored: a missing required detail, a value
// outside its closed list, a number out of range, and free text (title,
// brand, model) holding an email address, a web address, a phone number, a
// street address, something that looks like a key or a token (as tester.php),
// or a word from $WORDS.
//
// Abuse guard: at most 5000 pieces; at most 200 new pieces a UTC day, and 20
// per submission-id prefix (one house's ids share a random prefix); at most
// 1000 reports and 5000 counted placements a day. Reports from three
// different prefixes hide a piece's free text until the owner checks it (the
// admin "edit" or "unhide"); the recipe stays usable.
//
// The owner's tools (list reported pieces, edit details, unhide, remove) need
// the admin secret, read from private/padspan-furniture/admin_secret.txt (24
// characters or more, created by hand on the server, never in the
// repository). Without that file they are refused.

// ISPConfig layout on padspan.traks.ca, as tester.php: this file lives at
// web/padspan/api/, so three levels up is the site root, whose private/ is
// outside the web root.
$DIR = __DIR__ . '/../../../private/padspan-furniture';
$MAX = 8192;
$MAX_ENTRIES = 5000;
$MAX_NEW_PER_DAY = 200;
$MAX_NEW_PER_PREFIX = 20;
$MAX_REPORTS_PER_DAY = 1000;
$MAX_PLACED_PER_DAY = 5000;
$HIDE_AT = 3;
$MAX_REPORTERS = 20;
$PAGE_MAX = 60;
$PAGE_DEFAULT = 30;
$MAX_WITHDRAW = 80;      // 80 items of ~90 bytes fit in $MAX
$MAX_PARAMS = 40;
$MAX_COLORS = 6;
$MAX_TEXT = 60;
$FIT_MARGIN_M = 0.05;
// A piece's width, depth and height: a rug can be a few millimetres thin.
$DIM_MIN_M = 0.001;
$DIM_MAX_M = 8.0;

// The details sheet's closed lists (extended by PadSpan releases only).
$CATEGORIES = array('seating', 'sleeping', 'tables', 'storage', 'lighting', 'media', 'decor', 'outdoor',
                    'appliance', 'kids', 'pets', 'office', 'bath', 'kitchen', 'device', 'other');
$ROOMS = array('living', 'bedroom', 'kids-room', 'kitchen', 'dining', 'office', 'bathroom', 'hallway',
               'garage', 'patio', 'any');
$STYLES = array('modern', 'mid-century', 'traditional', 'rustic', 'industrial', 'scandinavian', 'farmhouse',
                'minimalist', 'boho', 'coastal', 'glam', 'retro', 'other');
$MATERIALS = array('wood', 'fabric', 'leather', 'metal', 'glass', 'plastic', 'stone', 'rattan', 'mixed');
$COLOR_FAMILIES = array('white', 'cream', 'beige', 'brown', 'black', 'grey', 'red', 'orange', 'yellow',
                        'green', 'teal', 'blue', 'purple', 'pink');
$SIZE_CLASSES = array('small', 'medium', 'large', 'extra-large');
$BED_SIZES = array('twin', 'double', 'queen', 'king', 'crib', 'bunk');
$FEATURES = array('has_arms', 'reclines', 'sectional', 'sofa_bed', 'storage', 'on_wheels', 'foldable',
                  'adjustable_height', 'wall_mounted');
$FIXTURES = array('floor', 'table', 'desk', 'pendant', 'wall', 'strip');
$FORMS = array('puck', 'card', 'fob', 'phone', 'box', 'board');
$SORTS = array('placed', 'newest', 'size', 'name', 'fit');
$REASONS = array('details', 'title');
$ADMIN_OPS = array('reported', 'edit', 'unhide', 'remove');

$RECIPE_KEYS = array('kind', 'params', 'colors', 'width_m', 'depth_m', 'height_m', 'details');
$DETAIL_KEYS = array('category', 'kind', 'rooms', 'style', 'material', 'color_family', 'size_class',
                     'seats', 'bed_size', 'features', 'drawers', 'doors', 'shelves', 'fixture', 'shades',
                     'form', 'antenna', 'outdoor', 'title', 'brand', 'model', 'checked');
$REQUIRED = array('category', 'kind', 'rooms', 'style', 'material', 'color_family', 'size_class');
$FILTER_KEYS = array('category', 'kind', 'room', 'style', 'material', 'color_family', 'size_class', 'seats',
                     'features', 'outdoor', 'fits');
// Counts, inclusive.
$COUNTS = array('seats' => array(1, 8), 'drawers' => array(0, 50), 'doors' => array(0, 50),
                'shelves' => array(0, 50), 'shades' => array(0, 12));
// Free text, in characters (not bytes), inclusive.
$TEXT = array('title' => array(3, 60), 'brand' => array(2, 40), 'model' => array(1, 60));
$ACTION_KEYS = array(
    'search' => array('schema', 'action', 'text', 'filters', 'sort', 'offset', 'limit'),
    'get' => array('schema', 'action', 'library_id', 'placed'),
    'share' => array('schema', 'action', 'submission_id', 'owner_token', 'terms_version', 'version', 'recipe'),
    'withdraw' => array('schema', 'action', 'items'),
    'report' => array('schema', 'action', 'library_id', 'reason', 'reporter'),
    'admin' => array('schema', 'action', 'secret', 'op', 'library_id', 'details'),
);

$KIND_RX = '/^[a-z][a-z0-9_]{0,31}$/D';
$PARAM_KEY_RX = '/^[a-z][a-z0-9_]{0,31}$/D';
$PARAM_STR_RX = '/^[a-z0-9][a-z0-9_-]{0,23}$/D';
$COLOR_RX = '/^#[0-9a-f]{6}$/D';
$SUB_RX = '/^sub_[0-9a-f]{16}$/D';
$TOKEN_RX = '/^[0-9a-f]{32}$/D';
$LIB_RX = '/^lib_[0-9a-f]{12}$/D';
$PREFIX_RX = '/^[0-9a-f]{6}$/D';
$VERSION_RX = '/^[A-Za-z0-9._+-]{1,32}$/D';

// Free text that looks like a secret: tester.php's own patterns.
$SECRETS = array(
    'a PadSpan licence key' => '/\b[Pp][Ss][Pp][Aa][Nn]-[A-Za-z0-9-]{8,}/',
    'a long hex string (a key or an IRK)' => '/\b[0-9A-Fa-f]{32,}\b/',
    'a login token' => '/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/',
    'a long key or token' => '/(?=[A-Za-z0-9+=_]*[0-9])(?=[A-Za-z0-9+=_]*[A-Za-z])[A-Za-z0-9+=_]{40,}/',
);
// Free text that says who or where someone is, checked in this order. ASCII
// rules on purpose (no /u), so this file, the Python port, the install's
// Python and its JavaScript all read a text the same way.
$PERSONAL = array(
    'email' => '/[A-Za-z0-9._%+\'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/',
    'url' => '/(?:https?:\/\/|www\.)|\b[A-Za-z0-9-]{2,}\.(?:com|net|org|info|biz|io|co|ca|us|uk|de|fr|nl|eu|au|nz|app|dev|shop|store|online|site|xyz|me|tv|ly)\b/i',
    'phone' => '/(?:\+?\d[\s.\/()-]*){9,}|\b\d{3}[\s.-]\d{4}\b/',
    'address' => '/\b\d{1,6}[A-Za-z]?\s+(?:[A-Za-z][A-Za-z\'.-]*\s+){1,4}(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|court|ct|crescent|cres|place|pl|terrace|highway|hwy|close|parkway|pkwy|circle|cir|trail|square|sq)\b|\b[A-Za-z]+(?:strasse|straße|str\.|weg|allee|gasse|platz)\s*\d{1,5}\b|\b(?:p\.?\s?o\.?\s?box|apt)\.?\s*#?\s*\d+|\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b/i',
);
// A short list on purpose; the report button is the backstop.
$WORDS = array('fuck', 'fucking', 'fucker', 'shit', 'shitty', 'cunt', 'bitch', 'bastard', 'asshole',
               'dickhead', 'cock', 'pussy', 'whore', 'slut', 'wank', 'wanker', 'twat', 'porn', 'nazi', 'rape');
$SAY = array('control' => 'a control character', 'secret' => 'something that looks like a key or a token',
             'email' => 'an email address', 'url' => 'a web address', 'phone' => 'a phone number',
             'address' => 'a street address', 'word' => 'a word the library does not take');

function reply($code, $why = '', $error = '', $more = array()) {
    http_response_code($code);
    $out = array('ok' => $code === 200);
    if ($why !== '') { $out['why'] = $why; }
    if ($error !== '') { $out['error'] = $error; }
    foreach ($more as $k => $v) { $out[$k] = $v; }
    echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function chars($s) {
    return preg_match_all('/./su', $s);
}

// A JSON list. json_decode makes [] and {} both array(), so an empty one is
// either; a list with anything in it has the keys 0, 1, 2…
function is_list_of($v) {
    return is_array($v) && array_values($v) === $v;
}

// A JSON object: array() (empty), or keys that are not 0, 1, 2…
function is_object_of($v) {
    return is_array($v) && (!$v || array_values($v) !== $v);
}

// A finite number (is_int(true) is false, so true and false are not numbers).
function num($v) {
    return (is_int($v) || is_float($v)) && is_finite((float)$v);
}

function count_in($v, $lo, $hi) {
    return is_int($v) && $v >= $lo && $v <= $hi;
}

// Lower case for ASCII letters only, the same in every copy of these rules.
function lower($s) {
    return strtr($s, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
}

// Free text: '' when it may be kept, else what it looks like.
function text_problem($s) {
    global $SECRETS, $PERSONAL, $WORDS;
    if (preg_match('/[\x00-\x1f\x7f]/', $s)) { return 'control'; }
    foreach ($SECRETS as $what => $rx) {
        if (preg_match($rx, $s)) { return 'secret'; }
    }
    foreach ($PERSONAL as $what => $rx) {
        if (preg_match($rx, $s)) { return $what; }
    }
    if (preg_match('/\b(?:' . implode('|', $WORDS) . ')\b/i', $s)) { return 'word'; }
    return '';
}

// A closed-list set: every value in $list, none twice, kept in $list's order.
function set_of($v, $list, $min) {
    if (!is_list_of($v) || count($v) < $min || count($v) > count($list)) { return null; }
    foreach ($v as $x) {
        if (!is_string($x) || !in_array($x, $list, true)) { return null; }
    }
    if (count(array_unique($v)) !== count($v)) { return null; }
    $out = array();
    foreach ($list as $x) {
        if (in_array($x, $v, true)) { $out[] = $x; }
    }
    return $out;
}

// The details sheet: array(clean, '', '') or array(null, field, problem).
function check_details($d, $kind) {
    global $DETAIL_KEYS, $REQUIRED, $CATEGORIES, $ROOMS, $STYLES, $MATERIALS, $COLOR_FAMILIES, $SIZE_CLASSES,
           $BED_SIZES, $FEATURES, $FIXTURES, $FORMS, $COUNTS, $TEXT;
    if (!is_object_of($d)) { return array(null, 'details', 'value'); }
    foreach (array_keys($d) as $k) {
        if (!in_array($k, $DETAIL_KEYS, true)) { return array(null, (string)$k, 'key'); }
    }
    foreach ($REQUIRED as $k) {
        if (!array_key_exists($k, $d) || $d[$k] === null || $d[$k] === '' || $d[$k] === array()) {
            return array(null, $k, 'missing');
        }
    }
    $lists = array('category' => $CATEGORIES, 'style' => $STYLES, 'material' => $MATERIALS,
                   'color_family' => $COLOR_FAMILIES, 'size_class' => $SIZE_CLASSES, 'bed_size' => $BED_SIZES,
                   'fixture' => $FIXTURES, 'form' => $FORMS);
    $out = array();
    foreach ($DETAIL_KEYS as $k) {
        if (!array_key_exists($k, $d)) { continue; }
        $v = $d[$k];
        if (isset($lists[$k])) {
            if (!is_string($v) || !in_array($v, $lists[$k], true)) { return array(null, $k, 'value'); }
            $out[$k] = $v;
        } elseif ($k === 'kind') {
            if (!is_string($v) || ($v !== $kind && $v !== 'other')) { return array(null, $k, 'value'); }
            $out[$k] = $v;
        } elseif ($k === 'rooms' || $k === 'features') {
            $s = set_of($v, $k === 'rooms' ? $ROOMS : $FEATURES, $k === 'rooms' ? 1 : 0);
            if ($s === null) { return array(null, $k, 'value'); }
            $out[$k] = $s;
        } elseif (isset($COUNTS[$k])) {
            if (!count_in($v, $COUNTS[$k][0], $COUNTS[$k][1])) { return array(null, $k, 'value'); }
            $out[$k] = $v;
        } elseif (isset($TEXT[$k])) {
            if (!is_string($v)) { return array(null, $k, 'value'); }
            $t = trim($v);
            if ($t === '') { continue; }
            $n = chars($t);
            if ($n === false || $n < $TEXT[$k][0] || $n > $TEXT[$k][1]) { return array(null, $k, 'length'); }
            $p = text_problem($t);
            if ($p !== '') { return array(null, $k, $p); }
            $out[$k] = $t;
        } else {   // antenna, outdoor, checked
            if (!is_bool($v)) { return array(null, $k, 'value'); }
            $out[$k] = $v;
        }
    }
    return array($out, '', '');
}

// A shared recipe: array(recipe, details, '', '') or array(null, null, field, problem).
function check_recipe($r) {
    global $RECIPE_KEYS, $KIND_RX, $PARAM_KEY_RX, $PARAM_STR_RX, $COLOR_RX, $MAX_PARAMS, $MAX_COLORS, $DIM_MIN_M, $DIM_MAX_M;
    if (!is_object_of($r) || !$r) { return array(null, null, 'recipe', 'value'); }
    foreach (array_keys($r) as $k) {
        if (!in_array($k, $RECIPE_KEYS, true)) { return array(null, null, (string)$k, 'key'); }
    }
    $kind = isset($r['kind']) ? $r['kind'] : null;
    if (!is_string($kind) || !preg_match($KIND_RX, $kind)) { return array(null, null, 'kind', 'value'); }
    $p = array_key_exists('params', $r) ? $r['params'] : array();
    if (!is_object_of($p) || count($p) > $MAX_PARAMS) { return array(null, null, 'params', 'value'); }
    foreach ($p as $k => $v) {
        if (!is_string($k) || !preg_match($PARAM_KEY_RX, $k)) { return array(null, null, 'params', 'key'); }
        $fine = is_bool($v) || (num($v) && abs($v) <= 1000) || (is_string($v) && preg_match($PARAM_STR_RX, $v));
        if (!$fine) { return array(null, null, 'params', 'value'); }
    }
    $c = isset($r['colors']) ? $r['colors'] : null;
    if (!is_list_of($c) || count($c) < 1 || count($c) > $MAX_COLORS) { return array(null, null, 'colors', 'value'); }
    $colors = array();
    foreach ($c as $x) {
        if (!is_string($x) || !preg_match($COLOR_RX, lower($x))) { return array(null, null, 'colors', 'value'); }
        $colors[] = lower($x);
    }
    $out = array('kind' => $kind, 'params' => $p, 'colors' => $colors);
    foreach (array('width_m', 'depth_m', 'height_m') as $k) {
        $v = isset($r[$k]) ? $r[$k] : null;
        if (!num($v) || $v < $DIM_MIN_M || $v > $DIM_MAX_M) { return array(null, null, $k, 'value'); }
        $out[$k] = $v;
    }
    if (!array_key_exists('details', $r)) { return array(null, null, 'details', 'missing'); }
    list($details, $field, $problem) = check_details($r['details'], $kind);
    if ($details === null) { return array(null, null, $field, $problem); }
    return array($out, $details, '', '');
}

// The search filters: array(clean, '') or array(null, the filter that is wrong).
function check_filters($f) {
    global $FILTER_KEYS, $CATEGORIES, $ROOMS, $STYLES, $MATERIALS, $COLOR_FAMILIES, $SIZE_CLASSES, $FEATURES,
           $KIND_RX;
    if (!is_object_of($f)) { return array(null, 'filters'); }
    $lists = array('category' => $CATEGORIES, 'room' => $ROOMS, 'style' => $STYLES, 'material' => $MATERIALS,
                   'color_family' => $COLOR_FAMILIES, 'size_class' => $SIZE_CLASSES);
    $out = array();
    foreach ($f as $k => $v) {
        if (!in_array($k, $FILTER_KEYS, true)) { return array(null, (string)$k); }
        if (isset($lists[$k])) {
            if (!is_string($v) || !in_array($v, $lists[$k], true)) { return array(null, $k); }
        } elseif ($k === 'kind') {
            if (!is_string($v) || !preg_match($KIND_RX, $v)) { return array(null, $k); }
        } elseif ($k === 'seats') {
            if (!count_in($v, 1, 8)) { return array(null, $k); }
        } elseif ($k === 'features') {
            if (set_of($v, $FEATURES, 1) === null) { return array(null, $k); }
        } elseif ($k === 'outdoor') {
            if (!is_bool($v)) { return array(null, $k); }
        } else {   // fits: the free floor space, width and depth in metres
            if (!is_object_of($v) || count($v) !== 2 || !isset($v['width_m']) || !isset($v['depth_m'])) {
                return array(null, $k);
            }
            foreach (array('width_m', 'depth_m') as $m) {
                if (!num($v[$m]) || $v[$m] < 0.05 || $v[$m] > 100) { return array(null, $k); }
            }
        }
        $out[$k] = $v;
    }
    return array($out, '');
}

function fresh_db() {
    return array('entries' => array(), 'guard' => array());
}

function shaped($db) {
    if (!isset($db['entries']) || !is_array($db['entries'])) { $db['entries'] = array(); }
    if (!isset($db['guard']) || !is_array($db['guard'])) { $db['guard'] = array(); }
    return $db;
}

// Today's counters, started again on a new UTC day.
function guard_today($g, $today) {
    if (!isset($g['day']) || $g['day'] !== $today) {
        $g = array('day' => $today, 'new' => 0, 'prefixes' => array(), 'reports' => 0, 'placed' => 0);
    }
    return $g;
}

// One read-change-write of library.json under an exclusive lock, as
// tester.php. $mutate gets the store by reference and returns
// array(result, changed). A file that cannot be read as JSON is never
// overwritten: null, and nothing changes.
function with_store($dir, $mutate) {
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) { return null; }
    $file = $dir . '/library.json';
    $h = @fopen($dir . '/library.lock', 'c');
    if (!$h) { return null; }
    if (!flock($h, LOCK_EX)) { fclose($h); return null; }
    $cur = is_file($file) ? @file_get_contents($file) : '';
    $db = json_decode(($cur === false || $cur === '') ? '{}' : $cur, true);
    if (!is_array($db)) { flock($h, LOCK_UN); fclose($h); return null; }
    $db = shaped($db);
    list($result, $changed) = $mutate($db);
    if ($changed) {
        $out = $db;
        $out['schema'] = 1;
        if (!$out['entries']) { $out['entries'] = new stdClass(); }
        $json = json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
        $tmp = $file . '.tmp';
        if ($json === false || @file_put_contents($tmp, $json) !== strlen($json) || !@rename($tmp, $file)) {
            @unlink($tmp);
            flock($h, LOCK_UN); fclose($h); return null;
        }
    }
    flock($h, LOCK_UN);
    fclose($h);
    @chmod($file, 0640);
    return $result;
}

// A read under a shared lock: the store, or null.
function read_store($dir) {
    $file = $dir . '/library.json';
    if (!is_file($file)) { return fresh_db(); }
    $h = @fopen($dir . '/library.lock', 'c');
    if (!$h) { return null; }
    if (!flock($h, LOCK_SH)) { fclose($h); return null; }
    $cur = @file_get_contents($file);
    flock($h, LOCK_UN);
    fclose($h);
    $db = json_decode(($cur === false || $cur === '') ? '{}' : $cur, true);
    return is_array($db) ? shaped($db) : null;
}

// ── Grouping: near-identical recipes show as one entry, as popular_presets.php
// The signature bins sizes to 10 cm, numbers to 0.1 and each colour channel to
// eight levels; choices and switches compare exactly.
function bin_num($v) {
    return (string)(int)floor($v * 10 + 0.5);
}

function bin_color($c) {
    return (hexdec(substr($c, 1, 2)) >> 5) . '.' . (hexdec(substr($c, 3, 2)) >> 5) . '.' . (hexdec(substr($c, 5, 2)) >> 5);
}

function signature($e) {
    $r = $e['recipe'];
    $parts = array($r['kind'], bin_num($r['width_m']), bin_num($r['depth_m']), bin_num($r['height_m']));
    $p = $r['params'];
    ksort($p, SORT_STRING);
    foreach ($p as $k => $v) {
        if (is_bool($v)) { $parts[] = $k . '=' . ($v ? 'yes' : 'no'); }
        elseif (is_string($v)) { $parts[] = $k . '=' . $v; }
        else { $parts[] = $k . '=' . bin_num($v); }
    }
    foreach ($r['colors'] as $c) { $parts[] = bin_color($c); }
    return implode('|', $parts);
}

// Sizes and colours only: everything else already agrees within a signature.
function dist($a, $b) {
    $s = 0.0;
    foreach (array('width_m', 'depth_m', 'height_m') as $k) {
        $s += abs($a['recipe'][$k] - $b['recipe'][$k]);
    }
    foreach ($a['recipe']['colors'] as $i => $c) {
        $o = $b['recipe']['colors'][$i];
        for ($j = 1; $j < 7; $j += 2) {
            $s += abs(hexdec(substr($c, $j, 2)) - hexdec(substr($o, $j, 2))) / 765.0;
        }
    }
    return $s;
}

// Oldest first, then by id: the order every tie below is settled in.
function by_age($a, $b) {
    $c = strcmp($a['created'], $b['created']);
    return $c !== 0 ? $c : strcmp($a['id'], $b['id']);
}

// The most common value among the members (lists compare whole); a tie goes
// to the value seen first.
function mode_of($vals) {
    $count = array();
    $first = array();
    foreach ($vals as $v) {
        $key = json_encode($v);
        if (!isset($count[$key])) { $count[$key] = 0; $first[$key] = $v; }
        $count[$key]++;
    }
    $best = null;
    $best_n = 0;
    foreach ($count as $key => $n) {
        if ($n > $best_n) { $best_n = $n; $best = $key; }
    }
    return $first[$best];
}

// A group as the library shows it: the medoid's recipe, the most common value
// of each detail, and how many houses have it (its sharers and placements).
function group_view($members) {
    global $DETAIL_KEYS, $TEXT;
    usort($members, 'by_age');
    $n = count($members);
    $best = 0;
    if ($n > 1) {
        $best_sum = INF;
        for ($i = 0; $i < $n; $i++) {
            $sum = 0.0;
            for ($j = 0; $j < $n; $j++) {
                if ($i !== $j) { $sum += dist($members[$i], $members[$j]); }
            }
            if ($sum < $best_sum) { $best_sum = $sum; $best = $i; }
        }
    }
    $details = array();
    foreach ($DETAIL_KEYS as $k) {
        if ($k === 'checked') { continue; }
        $vals = array();
        foreach ($members as $m) {
            if (isset($TEXT[$k]) && !empty($m['hidden'])) { continue; }
            if (array_key_exists($k, $m['details'])) { $vals[] = $m['details'][$k]; }
        }
        if ($vals) { $details[$k] = mode_of($vals); }
    }
    $checked = false;
    $houses = 0;
    $created = '';
    $ids = array();
    foreach ($members as $m) {
        if (!empty($m['details']['checked'])) { $checked = true; }
        $houses += 1 + (int)$m['placed'];
        if (strcmp($m['created'], $created) > 0) { $created = $m['created']; }
        $ids[] = $m['id'];
    }
    $details['checked'] = $checked;
    $recipe = $members[$best]['recipe'];
    $recipe['details'] = $details;
    return array('library_id' => $members[$best]['id'], 'recipe' => $recipe, 'houses' => $houses,
                 'copies' => $n, 'checked' => $checked, 'created' => $created, 'members' => $ids);
}

function groups($entries) {
    $by = array();
    foreach ($entries as $e) {
        $by[signature($e)][] = $e;
    }
    $out = array();
    foreach ($by as $members) { $out[] = group_view($members); }
    return $out;
}

// Free floor space left around a piece that fits there (either way round,
// with a small margin), or null when it does not fit.
function leftover($r, $fits) {
    global $FIT_MARGIN_M;
    $w = $r['width_m'] + $FIT_MARGIN_M;
    $d = $r['depth_m'] + $FIT_MARGIN_M;
    $W = $fits['width_m'];
    $D = $fits['depth_m'];
    if (($w <= $W && $d <= $D) || ($d <= $W && $w <= $D)) { return $W * $D - $r['width_m'] * $r['depth_m']; }
    return null;
}

// Search reads words, ASCII lower case, with - and _ as spaces.
function words_of($s) {
    $s = trim(strtr(lower($s), '-_', '  '));
    return $s === '' ? array() : preg_split('/\s+/', $s);
}

function haystack($g) {
    $d = $g['recipe']['details'];
    $parts = array();
    foreach (array('title', 'brand', 'model', 'kind', 'style', 'material') as $k) {
        if (isset($d[$k])) { $parts[] = $d[$k]; }
    }
    return implode(' ', words_of(implode(' ', $parts)));
}

function matches($g, $f, $words) {
    $d = $g['recipe']['details'];
    foreach (array('category', 'kind', 'style', 'material', 'color_family', 'size_class', 'seats') as $k) {
        if (isset($f[$k]) && (!isset($d[$k]) || $d[$k] !== $f[$k])) { return false; }
    }
    if (isset($f['room'])) {
        $rooms = isset($d['rooms']) ? $d['rooms'] : array();
        if (!in_array($f['room'], $rooms, true) && !in_array('any', $rooms, true)) { return false; }
    }
    if (isset($f['features'])) {
        $have = isset($d['features']) ? $d['features'] : array();
        foreach ($f['features'] as $x) {
            if (!in_array($x, $have, true)) { return false; }
        }
    }
    if (isset($f['outdoor'])) {
        $o = isset($d['outdoor']) ? $d['outdoor'] : false;
        if ($o !== $f['outdoor']) { return false; }
    }
    if (isset($f['fits']) && leftover($g['recipe'], $f['fits']) === null) { return false; }
    if ($words) {
        $hay = ' ' . haystack($g) . ' ';
        foreach ($words as $w) {
            if (strpos($hay, $w) === false) { return false; }
        }
    }
    return true;
}

function name_of($g) {
    $d = $g['recipe']['details'];
    return lower(isset($d['title']) ? $d['title'] : strtr($g['recipe']['kind'], '_', ' '));
}

function cmp_num($a, $b) {
    return $a < $b ? -1 : ($a > $b ? 1 : 0);
}

// Each sort, then details checked by a person before AI-only sheets, then id.
function cmp_groups($a, $b, $sort, $fits) {
    if ($sort === 'placed') {
        $c = cmp_num($b['houses'], $a['houses']);
        if ($c === 0) { $c = strcmp($b['created'], $a['created']); }
    } elseif ($sort === 'newest') {
        $c = strcmp($b['created'], $a['created']);
    } elseif ($sort === 'size') {
        $c = cmp_num($a['recipe']['width_m'] * $a['recipe']['depth_m'], $b['recipe']['width_m'] * $b['recipe']['depth_m']);
        if ($c === 0) { $c = cmp_num($a['recipe']['height_m'], $b['recipe']['height_m']); }
    } elseif ($sort === 'name') {
        $c = strcmp(name_of($a), name_of($b));
    } else {   // fit: least floor left over first
        $c = cmp_num(leftover($a['recipe'], $fits), leftover($b['recipe'], $fits));
    }
    if ($c === 0) { $c = cmp_num($b['checked'] ? 1 : 0, $a['checked'] ? 1 : 0); }
    return $c !== 0 ? $c : strcmp($a['library_id'], $b['library_id']);
}

// What a house sees of a group: never a submission id, an owner hash or a report.
function public_view($g) {
    $r = $g['recipe'];
    if (!$r['params']) { $r['params'] = new stdClass(); }
    return array('library_id' => $g['library_id'], 'recipe' => $r, 'houses' => $g['houses'],
                 'copies' => $g['copies'], 'checked' => $g['checked'], 'created' => $g['created']);
}

function admin_ok($dir, $given) {
    $f = $dir . '/admin_secret.txt';
    $s = is_file($f) ? trim((string)@file_get_contents($f)) : '';
    return strlen($s) >= 24 && is_string($given) && hash_equals($s, $given);
}

header('Content-Type: application/json');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { reply(405, 'method', 'POST only.'); }
$raw = file_get_contents('php://input', false, null, 0, $MAX + 1);
if ($raw === false || strlen($raw) > $MAX) { reply(413, 'size', 'That is too long (over 8 KB).'); }
if (!(json_decode($raw) instanceof stdClass)) { reply(400, 'json', 'That is not a JSON object.'); }
$r = json_decode($raw, true);
if (!isset($r['schema']) || $r['schema'] !== 1) { reply(400, 'schema', 'Unknown schema.'); }
$action = (isset($r['action']) && is_string($r['action'])) ? $r['action'] : '';
if (!isset($ACTION_KEYS[$action])) { reply(400, 'action', 'Unknown action.'); }
foreach (array_keys($r) as $k) {
    if (!in_array($k, $ACTION_KEYS[$action], true)) { reply(400, 'key', 'Unknown key: ' . substr((string)$k, 0, 40)); }
}
$today = gmdate('Y-m-d');
$now = gmdate('c');

// ── Browse and search ────────────────────────────────────────────────────────
if ($action === 'search') {
    $text = array_key_exists('text', $r) ? $r['text'] : '';
    if (!is_string($text) || chars($text) === false || chars($text) > $MAX_TEXT || preg_match('/[\x00-\x1f\x7f]/', $text)) {
        reply(400, 'text', 'The search text is too long, or not plain text.');
    }
    list($f, $bad) = check_filters(array_key_exists('filters', $r) ? $r['filters'] : array());
    if ($f === null) { reply(400, 'filter', 'That filter is not one the library knows.', array('field' => $bad)); }
    $sort = array_key_exists('sort', $r) ? $r['sort'] : 'placed';
    if (!is_string($sort) || !in_array($sort, $SORTS, true) || ($sort === 'fit' && !isset($f['fits']))) {
        reply(400, 'sort', 'Unknown sort.');
    }
    $offset = array_key_exists('offset', $r) ? $r['offset'] : 0;
    $limit = array_key_exists('limit', $r) ? $r['limit'] : $PAGE_DEFAULT;
    if (!count_in($offset, 0, $MAX_ENTRIES) || !count_in($limit, 1, $PAGE_MAX)) { reply(400, 'page', 'Bad page.'); }
    $db = read_store($DIR);
    if ($db === null) { reply(500, 'store', 'The library could not be read right now. Please try again later.'); }
    $words = words_of($text);
    $list = array();
    foreach (groups($db['entries']) as $g) {
        if (matches($g, $f, $words)) { $list[] = $g; }
    }
    $fits = isset($f['fits']) ? $f['fits'] : null;
    usort($list, function ($a, $b) use ($sort, $fits) { return cmp_groups($a, $b, $sort, $fits); });
    $page = array();
    foreach (array_slice($list, $offset, $limit) as $g) { $page[] = public_view($g); }
    reply(200, '', '', array('total' => count($list), 'entries' => $page));
}

// ── One piece; placing it counts it (anonymous +1) ───────────────────────────
if ($action === 'get') {
    $id = (isset($r['library_id']) && is_string($r['library_id'])) ? $r['library_id'] : '';
    if (!preg_match($LIB_RX, $id)) { reply(400, 'id', 'That is not a library id.'); }
    $placed = array_key_exists('placed', $r) ? $r['placed'] : false;
    if (!is_bool($placed)) { reply(400, 'placed', 'placed is true or false.'); }
    if ($placed) {
        // Counting is best effort: a full day or a busy store still shows the piece.
        with_store($DIR, function (&$db) use ($id, $today, $MAX_PLACED_PER_DAY) {
            if (!isset($db['entries'][$id])) { return array(false, false); }
            $g = guard_today($db['guard'], $today);
            if ((int)$g['placed'] >= $MAX_PLACED_PER_DAY) { return array(false, false); }
            $g['placed'] = (int)$g['placed'] + 1;
            $db['guard'] = $g;
            $db['entries'][$id]['placed'] = (int)$db['entries'][$id]['placed'] + 1;
            return array(true, true);
        });
    }
    $db = read_store($DIR);
    if ($db === null) { reply(500, 'store', 'The library could not be read right now. Please try again later.'); }
    foreach (groups($db['entries']) as $g) {
        if (in_array($id, $g['members'], true)) { reply(200, '', '', array('entry' => public_view($g))); }
    }
    reply(404, 'not_found', 'That piece is not in the library (it may have been withdrawn).');
}

// ── Share a piece, or change the details of one this house shared ────────────
if ($action === 'share') {
    $sid = (isset($r['submission_id']) && is_string($r['submission_id'])) ? $r['submission_id'] : '';
    if (!preg_match($SUB_RX, $sid)) { reply(400, 'id', 'That is not a submission id.'); }
    $tok = (isset($r['owner_token']) && is_string($r['owner_token'])) ? $r['owner_token'] : '';
    if (!preg_match($TOKEN_RX, $tok)) { reply(400, 'token', 'That is not an owner token.'); }
    $tv = isset($r['terms_version']) ? $r['terms_version'] : null;
    if (!count_in($tv, 1, 1000)) { reply(400, 'terms', 'The terms must be accepted before sharing.'); }
    $version = '';
    if (array_key_exists('version', $r)) {
        if (!is_string($r['version']) || !preg_match($VERSION_RX, $r['version'])) { reply(400, 'version', 'Bad version.'); }
        $version = $r['version'];
    }
    list($recipe, $details, $field, $problem) = check_recipe(isset($r['recipe']) ? $r['recipe'] : null);
    if ($recipe === null) {
        if (isset($SAY[$problem])) {
            reply(400, 'text', "That looks like {$SAY[$problem]} in the $field - please take it out.",
                  array('field' => $field, 'problem' => $problem));
        }
        reply(400, 'details', "The $field is missing, too long or short, or not one the library knows.",
              array('field' => $field, 'problem' => $problem));
    }
    $hash = hash('sha256', $tok);
    $prefix = substr($sid, 4, 6);
    $result = with_store($DIR, function (&$db) use ($sid, $hash, $prefix, $recipe, $details, $tv, $version, $today,
                                                    $now, $MAX_ENTRIES, $MAX_NEW_PER_DAY, $MAX_NEW_PER_PREFIX) {
        foreach ($db['entries'] as $id => $e) {
            if ($e['submission_id'] !== $sid) { continue; }
            if (!hash_equals($e['owner_hash'], $hash)) { return array(array('owner', ''), false); }
            // Only the latest details are kept; the recipe stays as first shared.
            if ($details['kind'] !== $e['recipe']['kind'] && $details['kind'] !== 'other') {
                return array(array('kind', ''), false);
            }
            $db['entries'][$id]['details'] = $details;
            $db['entries'][$id]['terms_version'] = $tv;
            $db['entries'][$id]['version'] = $version;
            $db['entries'][$id]['updated'] = $now;
            return array(array('edited', $id), true);
        }
        if (count($db['entries']) >= $MAX_ENTRIES) { return array(array('full', ''), false); }
        $g = guard_today($db['guard'], $today);
        $mine = isset($g['prefixes'][$prefix]) ? (int)$g['prefixes'][$prefix] : 0;
        if ((int)$g['new'] >= $MAX_NEW_PER_DAY || $mine >= $MAX_NEW_PER_PREFIX) { return array(array('busy', ''), false); }
        $g['new'] = (int)$g['new'] + 1;
        $g['prefixes'][$prefix] = $mine + 1;
        $db['guard'] = $g;
        do { $id = 'lib_' . bin2hex(random_bytes(6)); } while (isset($db['entries'][$id]));
        $db['entries'][$id] = array('id' => $id, 'submission_id' => $sid, 'owner_hash' => $hash, 'recipe' => $recipe,
                                    'details' => $details, 'version' => $version, 'terms_version' => $tv,
                                    'created' => $now, 'updated' => $now, 'placed' => 0,
                                    'reports' => array(), 'hidden' => false);
        return array(array('added', $id), true);
    });
    if ($result === null) { reply(500, 'store', 'The library could not save it right now. Nothing was kept - please try again later.'); }
    if ($result[0] === 'owner') { reply(403, 'owner', 'That piece was shared by another house.'); }
    if ($result[0] === 'kind') {
        reply(400, 'details', 'The kind is not the one first shared.', array('field' => 'kind', 'problem' => 'value'));
    }
    if ($result[0] === 'full') { reply(503, 'full', 'The library is full at the moment. Please try again later.'); }
    if ($result[0] === 'busy') { reply(429, 'busy', 'Too many new pieces today. It will go another day.'); }
    reply(200, '', '', array('library_id' => $result[1], 'edited' => $result[0] === 'edited'));
}

// ── Withdraw: this house's pieces, deleted whole ─────────────────────────────
// ok also for an id that is not there: the house's goal — no copy here —
// holds either way. An id whose token does not match is refused, not deleted.
if ($action === 'withdraw') {
    $items = isset($r['items']) ? $r['items'] : null;
    if (!is_list_of($items) || count($items) < 1 || count($items) > $MAX_WITHDRAW) { reply(400, 'items', 'Bad list.'); }
    $want = array();
    foreach ($items as $it) {
        if (!is_object_of($it) || count($it) !== 2 || !isset($it['submission_id']) || !isset($it['owner_token'])
                || !is_string($it['submission_id']) || !preg_match($SUB_RX, $it['submission_id'])
                || !is_string($it['owner_token']) || !preg_match($TOKEN_RX, $it['owner_token'])) {
            reply(400, 'items', 'Each item is a submission id and its owner token.');
        }
        $want[$it['submission_id']] = hash('sha256', $it['owner_token']);
    }
    $result = with_store($DIR, function (&$db) use ($want) {
        $gone = array();
        $refused = array();
        foreach ($db['entries'] as $id => $e) {
            if (!isset($want[$e['submission_id']])) { continue; }
            if (hash_equals($e['owner_hash'], $want[$e['submission_id']])) {
                unset($db['entries'][$id]);
                $gone[] = $e['submission_id'];
            } else {
                $refused[] = $e['submission_id'];
            }
        }
        return array(array($gone, $refused), count($gone) > 0);
    });
    if ($result === null) { reply(500, 'store', 'The library could not open its list. Nothing was changed - please try again later.'); }
    foreach ($result[0] as $sid) {
        @file_put_contents($DIR . '/withdrawals.log',
            json_encode(array('submission_id' => $sid, 'withdrawn_at' => $now)) . "\n", FILE_APPEND | LOCK_EX);
    }
    $withdrawn = array();
    foreach (array_keys($want) as $sid) {
        if (!in_array($sid, $result[1], true)) { $withdrawn[] = $sid; }
    }
    reply(200, '', '', array('withdrawn' => $withdrawn, 'refused' => $result[1]));
}

// ── Report a piece: counted only ─────────────────────────────────────────────
if ($action === 'report') {
    $id = (isset($r['library_id']) && is_string($r['library_id'])) ? $r['library_id'] : '';
    if (!preg_match($LIB_RX, $id)) { reply(400, 'id', 'That is not a library id.'); }
    $reason = isset($r['reason']) ? $r['reason'] : null;
    if (!is_string($reason) || !in_array($reason, $REASONS, true)) { reply(400, 'reason', 'Unknown reason.'); }
    $who = (isset($r['reporter']) && is_string($r['reporter'])) ? $r['reporter'] : '';
    if (!preg_match($PREFIX_RX, $who)) { reply(400, 'reporter', 'Bad reporter.'); }
    $result = with_store($DIR, function (&$db) use ($id, $reason, $who, $today, $MAX_REPORTS_PER_DAY, $MAX_REPORTERS, $HIDE_AT) {
        if (!isset($db['entries'][$id])) { return array('not_found', false); }
        $g = guard_today($db['guard'], $today);
        if ((int)$g['reports'] >= $MAX_REPORTS_PER_DAY) { return array('busy', false); }
        $g['reports'] = (int)$g['reports'] + 1;
        $db['guard'] = $g;
        $rep = is_array($db['entries'][$id]['reports']) ? $db['entries'][$id]['reports'] : array();
        if (isset($rep[$who]) || count($rep) < $MAX_REPORTERS) { $rep[$who] = $reason; }
        $db['entries'][$id]['reports'] = $rep;
        if (count($rep) >= $HIDE_AT) { $db['entries'][$id]['hidden'] = true; }
        return array('ok', true);
    });
    if ($result === null) { reply(500, 'store', 'The library could not save it right now. Please try again later.'); }
    if ($result === 'not_found') { reply(404, 'not_found', 'That piece is not in the library.'); }
    if ($result === 'busy') { reply(429, 'busy', 'Too many reports today. Please try again tomorrow.'); }
    reply(200);
}

// ── The library owner's tools ────────────────────────────────────────────────
if (!admin_ok($DIR, isset($r['secret']) ? $r['secret'] : null)) { reply(403, 'admin', 'Not allowed.'); }
$op = (isset($r['op']) && is_string($r['op'])) ? $r['op'] : '';
if (!in_array($op, $ADMIN_OPS, true)) { reply(400, 'op', 'Unknown op.'); }
if ($op === 'reported') {
    $db = read_store($DIR);
    if ($db === null) { reply(500, 'store', 'The library could not be read.'); }
    $list = array();
    foreach ($db['entries'] as $e) {
        if (!$e['reports']) { continue; }
        $why = array_count_values(array_values($e['reports']));
        $row = array('library_id' => $e['id'], 'reports' => count($e['reports']), 'reasons' => $why,
                     'hidden' => !empty($e['hidden']));
        foreach (array('title', 'brand', 'model') as $k) {
            if (isset($e['details'][$k])) { $row[$k] = $e['details'][$k]; }
        }
        $list[] = $row;
    }
    usort($list, function ($a, $b) { $c = $b['reports'] - $a['reports']; return $c !== 0 ? $c : strcmp($a['library_id'], $b['library_id']); });
    reply(200, '', '', array('entries' => array_slice($list, 0, 200)));
}
$id = (isset($r['library_id']) && is_string($r['library_id'])) ? $r['library_id'] : '';
if (!preg_match($LIB_RX, $id)) { reply(400, 'id', 'That is not a library id.'); }
$given = array_key_exists('details', $r) ? $r['details'] : array();
if ($op === 'edit' && (!is_object_of($given) || !$given)) { reply(400, 'details', 'Nothing to change.'); }
$result = with_store($DIR, function (&$db) use ($op, $id, $given, $now) {
    if (!isset($db['entries'][$id])) { return array(array('not_found', '', ''), false); }
    if ($op === 'remove') {
        unset($db['entries'][$id]);
        return array(array('ok', '', ''), true);
    }
    if ($op === 'edit') {
        $merged = $db['entries'][$id]['details'];
        foreach ($given as $k => $v) { $merged[$k] = $v; }
        list($details, $field, $problem) = check_details($merged, $db['entries'][$id]['recipe']['kind']);
        if ($details === null) { return array(array('bad', $field, $problem), false); }
        $db['entries'][$id]['details'] = $details;
        $db['entries'][$id]['updated'] = $now;
    }
    // An edit or an unhide means the owner has checked it.
    $db['entries'][$id]['reports'] = array();
    $db['entries'][$id]['hidden'] = false;
    return array(array('ok', '', ''), true);
});
if ($result === null) { reply(500, 'store', 'The library could not save it.'); }
if ($result[0] === 'not_found') { reply(404, 'not_found', 'No such piece.'); }
if ($result[0] === 'bad') { reply(400, 'details', 'That detail is not right.', array('field' => $result[1], 'problem' => $result[2])); }
if ($op === 'remove') {
    @file_put_contents($DIR . '/removals.log',
        json_encode(array('library_id' => $id, 'removed_at' => $now)) . "\n", FILE_APPEND | LOCK_EX);
}
reply(200);
