# pad.traks.ca digest — data contract (schema 1)

The page fetches **`GET /digest.php`** (same origin, `pad.traks.ca`), with the `padspan_report`
session cookie that index.php sets on sign-in.

| Answer | When |
|---|---|
| `200` + the model below | signed in, model present |
| `403 {"ok":false}` | no session (same gate as data.php) |
| `503 {"ok":false,"error":"not ready"}` | the model file doesn't exist yet |

The model is rebuilt **every 5 minutes** by a root cron on bcmail
(`/usr/local/lib/pad-digest/pad_digest.py` → `private/pad-digest/model.json`). The page should show
`generated` and treat a model older than `stale_after_s` as stale ("data is N min old").

All days are **BC days** (UTC−7, no DST). "Homes" = distinct addresses that sent an update check
(all installs, not just opt-in). "Opt-in homes" = installs that send the usage report (~1 in 3).
Nothing in the model is an IP, email, licence key or install id; perf outliers are "home A…E".

Everything the mockup (`index.html`, `const M`) uses is kept with the same name and shape.
New fields are marked **NEW**.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `ok` | bool | **NEW** always `true` on 200 |
| `schema` | int | **NEW** `1` |
| `generated` | str | "Fri Oct 30, 11:23 BC" |
| `generated_iso` | str | **NEW** ISO 8601 with offset, e.g. `2026-10-30T11:23:05-07:00` |
| `stale_after_s` | int | **NEW** `900`: older than this, show the model as stale |
| `need` | int | count shown in the header pill ("2 worth a look"). **Now = `needs_attention.length`** (0 → "All normal") |
| `tiles` | Tile[6] | headline strip |
| `needs_attention` | Attention[] | **NEW** empty when all is fine |
| `health` | HealthRow[3] | opt-in homes, **last 7 days**, latest stable / previous / the one before (as in the mockup) |
| `health_same_age` | object | **NEW** latest vs previous stable at the same age (preferred for "Release health") |
| `watch` | Watch[] | significant regressions in `health` (7-day), as in the mockup |
| `latest`, `prev`, `prev2` | str | the three newest stable versions, newest first |
| `hours_out` | int | hours since `latest` was published |
| `issues` | Issue[≤12] | top issues (new, regressed, ongoing, quiet order) |
| `new_issues` | Issue[] | status `new` or `regressed` |
| `perf` | object | performance, last 7 days |
| `adopt`, `adopt_versions` | — | version-share lines, last 21 days (as mockup) |
| `versions_top` | object | **NEW** top 5 versions by share of the last 24 h + Other |
| `setup_fail` | object | **NEW** failing setups against a threshold, with splits |
| `digest` | object | "Today and yesterday" lines by group |
| `feed` | Event[] | events yesterday and today, newest first |
| `series`, `series_all` | Day[] | homes per day: last 45 days / since the log began |
| `markers` | object | chart markers (stables, campaign ranges, content) |
| `ba` | object | before/after verdict for the latest push |
| `ns` | object | north star numbers |
| `small` | object | small multiples, same days as `series_all` |
| `funnel` | Step[5] | last 15 days |
| `sources`, `src_days` | — | page views by people by source; days covered |
| `setup28`, `new15`, `new15_stage` | — | setup stages of new installs (as mockup) |
| `versions24`, `l24_total` | — | every version seen in the last 24 h |
| `tiers` | [str,int][] | opt-in homes by tier, last 7 days |
| `lic_totals` | object | all-time key counts by plan, `paid` = with payment |
| `stars_total` | int | GitHub stars |
| `reports` | object | `lifetime` installs ever reported, `active7` |
| `lag_series` | object[30] | opt-in homes with lag ≥ 1 s per day |
| `archive` | object | **NEW** longer history from the daily archive |

## Tile
`{label, value:int, unit:str, cmp:str, delta:number|null, state, spark:int[]|null, help:str}` —
`state` ∈ `normal | above | below | good | bad | watch | info`. `above/below` = beyond 3σ of the
typical (median of the previous 7 days; noise from the data's own spread, MAD × 1.4826).
Order: Homes checking in (yesterday) · Today so far (same hour) · On `<latest>` · New or regressed
issues (3 days) · Opt-in homes with lag over 1 s (yesterday) · Keys issued (yesterday).

## Attention (NEW)
```
{ key, kind, title, detail, homes:int|null, of:int|null, first_seen:"YYYY-MM-DD",
  days_listed:int, growing:bool }
```
- `kind` ∈ `issue` (new/regressed error, log warning or 3D fallback) · `regression` (latest-vs-previous
  significant, from `health_same_age`, else 7-day `watch`) · `setup` (`setup_fail.over`) ·
  `growth` (yesterday's homes below the 3σ band).
- An item first listed more than **7 days** ago is dropped unless `growing` (homes affected rose vs
  the 3 days before). First-seen dates persist in `private/pad-digest/attention-state.json`.
- Sorted: regression, issue, setup, growth; then by `homes` desc.

## HealthRow (as mockup)
`{v, homes, ui_err, warn, lag_1s, unclean, fallback, lag_p50:ms|null, lag_p95:ms|null, too_early:bool}` —
counts are **opt-in homes** (each counted once per version in the window). `too_early` = `homes < 20`.

## health_same_age (NEW)
```
{ age_days:int,                 // days since `latest` first appeared in the update checks
  latest: HealthRow + {first_day, window:[from,to]},
  prev:   HealthRow + {first_day, window:[from,to]},   // previous stable, its first age_days+1 days
  watch:  Watch[],              // same test as `watch`: 95% two-proportion, worse only
  too_early: bool,              // latest.homes < 20
  note: str }                   // plain-language summary, e.g. "Too early: 1 opt-in home on 0.38.199 after 1 day"
```

## Watch (as mockup)
`{what, a:[n, of], b:[n, of]}` — `a` = the newer version, `b` = the older.

## Issue (as mockup)
`{key, status, first, last, homes7, homes30, per_day:{date:int}, versions7:[[ver,n]…]}` —
`key` like `panel error: calibration`, `log:custom_components.padspan_ha.x`, `3D fell back: no_webgl`.
`status` ∈ `new` (only in the last 3 days) · `regressed` (back after ≥ 7 quiet days) · `ongoing` · `quiet`.

## perf (as mockup)
`{homes, lag_p50:ms, lag_p95:ms, homes_lag_1s, worst:[{home:"home A", lag:ms, snap:ms, unclean:int, version, scanners, rooms}]}`

## versions_top (NEW)
```
{ total:int,                    // homes that checked in during the last 24 h
  rows:[{v, n, share:pct(0-100, 1 dp), adopted:bool, stable:bool}],   // top 5 by n
  other:{n, share, versions:int} }                                  // everything else
```
`adopted` = share ≥ 10% (Sentry's rule). `stable` = a non-prerelease on GitHub.

## setup_fail (NEW)
```
{ window_days:28, grace_days:3, threshold_pct:40,
  total:int,                    // new opt-in installs first seen in the window, at least grace_days old
  failing:int,                  // of those: stopped reporting before "rooms", or still at none/map after grace_days
  rate:pct|null, over:bool,     // over = rate ≥ threshold and total ≥ 10
  by:{ ha_version:[{k, failing, of}], install_type:[…], hardware:[…] },   // top 6 each, by `of`
  definition:str }
```
Show counts, not just %, when `of` < 30.

## markers
```
{ stables:[{d, tag}],                                   // stable releases inside `series`
  campaign:{from, to, label},                           // the latest outreach push (kept for the mockup)
  ranges:[{from, to, label, kind}],                     // NEW: every campaign/wave as a date range;
                                                        //   kind ∈ outreach | campaign | launch
  content:[{d, items:[str]}] }                          // guides, site and demo pieces that went live
```

## ba (as mockup)
`{push, after_days, after, before, sig, diff, band, verdict}` — means of homes/day, 14 days before vs up
to 14 after `push`; `band` = 3σ for those window sizes; `verdict` ∈ `too early | lift | drop | no detectable change`.

## Day (series)
`{d, v, avg, lo, hi}` — `v` homes that day, `avg` 7-day average, `lo/hi` the 3σ noise band.

## small
`new|stars:[{d, v}]`, `keys:[{d, v, paid}]`, `site:[{d, v|null}]` (null = no site log for that day;
the archive extends this back from Oct 30 2026 on).

## Step (funnel)
`{step, n, note}` — 15 days. Visitors and homes aren't linked: label site→install as a ratio.

## archive (NEW)
```
{ since:"YYYY-MM-DD"|null,
  ha_optin:[{d, n}],                                    // HA analytics' padspan_ha count, daily
  github_traffic:[{d, views, uniques, clones, clone_uniques}],
  github_referrers:[[source, count]] }                  // latest 14-day snapshot
```

## digest / feed (as mockup)
`digest = {Releases:[str], Problems:[str], Growth:[str], Money:[str], Marketing:[str]}` — only events and
out-of-band values; the page adds "Everything else is within its normal range."
`feed = [{t:"Oct 30 09:12" | "Oct 30", kind, text}]`, kind ∈ Release · Marketing · Email · Keys · Installs.
