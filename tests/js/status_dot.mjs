// The top bar's status dot (views/status_dot.js), run for real:
//   issues   statusIssues — what counts as red, amber and nothing
//   persist  trackIssues — shown after 2 polls in a row (red: 3), gone after 2 without
//   view     dotView — the level, the count, the words; a wall shows red only
//
// usage: status_dot.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: status_dot.mjs <www/padspan-ha dir>"); process.exit(2); }
const D = await import(pathToFileURL(join(WWW, "views", "status_dot.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

const R = (source, last_heard_s, extra = {}) => ({ source, name: source.toUpperCase() + " proxy", last_heard_s, ...extra });
const snap = (radios, extra = {}) => ({ ble: { radios }, ...extra });
const ids = (list) => list.map(i => i.level + ":" + i.id).join(",");
const issues = (o) => D.statusIssues({ live: true, failed: false, ...o });

// ── issues ──
const fine = snap([R("aa", 3), R("bb", 40)]);
check("healthy house: nothing", issues({ snapshot: fine }).length === 0, issues({ snapshot: fine }));
check("sample mode: nothing, even when failing", D.statusIssues({ live: false, failed: true, snapshot: snap([]) }).length === 0);
check("no snapshot yet: nothing", issues({ snapshot: null }).length === 0);
{
  const got = issues({ failed: true, snapshot: snap([], { suspended: true }) });
  check("no answer: red, and only that (the snapshot is stale)", ids(got) === "red:no_answer", ids(got));
}
check("no radios: red", ids(issues({ snapshot: snap([]) })) === "red:no_receivers");
check("every radio silent over 10 min: red", ids(issues({ snapshot: snap([R("aa", 601), R("bb", 4000)]) })) === "red:no_receivers");
check("exactly 10 min is not silent", issues({ snapshot: snap([R("aa", 600)]) }).length === 0);
check("not heard yet (null) is not silent", issues({ snapshot: snap([R("aa", null), R("bb", null)]) }).length === 0);
{
  const one = issues({ snapshot: snap([R("aa", 700), R("bb", 2)]) });
  check("one silent of two: amber", ids(one) === "amber:receivers_silent", ids(one));
  check("one silent: singular words", one[0] && one[0].text === "1 receiver hasn't been heard from in over 10 minutes", one[0]);
  const two = issues({ snapshot: snap([R("aa", 700), R("bb", 900), R("cc", 1)]) });
  check("two silent: plural words", two[0] && two[0].text === "2 receivers haven't been heard from in over 10 minutes", two[0]);
}
{
  const got = issues({ snapshot: snap([R("aa", 2, { adv_rate_low: true }), R("bb", 2)]) });
  check("hearing less than usual: amber", ids(got) === "amber:hearing_less" && got[0].text.startsWith("1 receiver is hearing"), got);
}
{
  // Only receivers in use count: lost, disabled or excluded ones are left out.
  const lost = snap([R("aa", 2), R("bb", 5000, { lost: true }), R("cc", 5000, { disabled: true }), R("dd", 5000)]);
  check("a lost or disabled receiver never keeps the dot amber", ids(issues({ snapshot: lost, excluded: ["dd"] })) === "", ids(issues({ snapshot: lost, excluded: ["dd"] })));
  check("an excluded receiver is left out too", ids(issues({ snapshot: lost })) === "amber:receivers_silent");
  const onlyLost = snap([R("bb", 5000, { lost: true })]);
  check("the only receiver listed is marked lost: no red silence", ids(issues({ snapshot: onlyLost })) === "red:no_receivers");
  check("...that's no receivers in use, which is red only after the warm-up", ids(issues({ snapshot: onlyLost, warmup: true })) === "");
  check("warm-up keeps no-receivers quiet, not the rest", ids(issues({ snapshot: snap([], { positioning_failed: true }), warmup: true })) === "red:positioning_failed");
  // The Bluetooth screen's "scanning" / "listening" are never silent here.
  check("scanning: not silent", issues({ snapshot: snap([R("aa", 5000, { scanning: true }), R("bb", 2)]) }).length === 0);
  const withAds = { ble: { radios: [R("aa", 5000), R("bb", 2)], advertisements: [{ source: "aa" }] } };
  check("advertisements from it in this snapshot: not silent", issues({ snapshot: withAds }).length === 0);
  check("no floor-plan check any more", D.missingReceivers === undefined);
}
check("learning suspended: amber", ids(issues({ snapshot: snap([R("aa", 1)], { suspended: true }) })) === "amber:learning_suspended");
check("positioning failed: red", ids(issues({ snapshot: snap([R("aa", 1)], { positioning_failed: true }) })) === "red:positioning_failed");
check("only a true flag counts", issues({ snapshot: snap([R("aa", 1)], { positioning_failed: "yes", suspended: 1 }) }).length === 0);

// ── persist ──
{
  const t = new Map();
  const red = [{ id: "no_receivers", level: "red", text: "x" }];
  check("one poll: not yet", D.trackIssues(t, red).length === 0);
  check("red, two polls: not yet", D.trackIssues(t, red).length === 0);
  check("red, three polls in a row: shown", D.trackIssues(t, red).length === 1);
  check("one poll without: still shown", D.trackIssues(t, []).length === 1);
  check("back again: still shown", D.trackIssues(t, red).length === 1);
  D.trackIssues(t, []);
  check("two polls without: gone", D.trackIssues(t, []).length === 0 && t.size === 0);
  const am = new Map(), amber = [{ id: "learning_suspended", level: "amber", text: "x" }];
  D.trackIssues(am, amber);
  check("amber, two polls in a row: shown", D.trackIssues(am, amber).length === 1);
  const blink = new Map();
  let ever = false;
  for (let i = 0; i < 10; i++) ever = ever || D.trackIssues(blink, i % 2 ? [] : red).length > 0;
  check("a condition that comes and goes every poll never shows", !ever);
  const words = new Map();
  D.trackIssues(words, [{ id: "receivers_silent", level: "amber", text: "1 receiver" }]);
  const w = D.trackIssues(words, [{ id: "receivers_silent", level: "amber", text: "2 receivers" }]);
  check("the count changing is the same issue, newest words", w.length === 1 && w[0].text === "2 receivers", w);
  const mix = new Map();
  const both = [{ id: "a", level: "amber", text: "a" }, { id: "r", level: "red", text: "r" }];
  D.trackIssues(mix, both); D.trackIssues(mix, both);
  check("worst first", ids(D.trackIssues(mix, both)) === "red:r,amber:a");
}

// ── view ──
{
  check("nothing active: no dot", D.dotView([]) === null && D.dotView(null) === null);
  const a = [{ id: "a", level: "amber", text: "Learning is suspended" }];
  const va = D.dotView(a);
  check("amber", va && va.level === "amber" && va.count === 1, va);
  check("amber words", va && va.label === "Something needs attention: 1 issue. Learning is suspended. Open Health.", va);
  check("a wall: amber hidden", D.dotView(a, { wall: true }) === null);
  const ar = [{ id: "r", level: "red", text: "No Bluetooth receivers are reporting" }, ...a];
  const vr = D.dotView(ar);
  check("red wins, both counted", vr && vr.level === "red" && vr.count === 2 && vr.label.startsWith("Something is broken: 2 issues."), vr);
  const vw = D.dotView(ar, { wall: true });
  check("a wall: red only, red named only", vw && vw.count === 1 && !vw.label.includes("suspended"), vw);
}

console.log(JSON.stringify({ cases, failures }));
