// Who gets told about the paid half, and what they are told.
//
// Run:  node tests/js/pro_pitch.mjs <views dir>
// Prints one JSON line: { "checks": [...], "failures": [...] }.
//
// The rule that matters most is the one that cannot be seen by reading the
// card: a PadSpan Pro customer must never be pitched PadSpan Pro.
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const VIEWS_DIR = process.argv[2];
const { proPitch, BUY_URL, proPrice } =
  await import(pathToFileURL(join(VIEWS_DIR, "editions.js")).href);

const checks = [], failures = [];
const check = (name, ok, detail) => {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
};

// ── A paying customer is never sold what they already own ───────────────────
for (const st of [
  { tier: "pro", pro_has_key: true, pro_active: true },
  { tier: "pro", pro_has_key: true },
  { tier: "pro" },
  { tier: "PRO", pro_has_key: true, pro_active: true },   // case must not matter
]) {
  check(`pro tier gets no pitch (${JSON.stringify(st)})`, proPitch(st) === null, JSON.stringify(proPitch(st)));
}

// ── Bright: light placement is already theirs, so only Forensics is news ────
const bright = proPitch({ tier: "bright", pro_has_key: true, pro_active: true });
check("bright tier is pitched something", !!bright);
check("bright pitch names Forensics", /Forensics/.test(bright.text));
check("bright pitch names the 3D house and the wall screen", /3D house/.test(bright.text) && /wall screen/.test(bright.text), bright.text);
check("bright pitch does NOT sell light placement back to them",
  !/light placement/i.test(bright.text), bright.text);

// ── Free: has neither, so both are news ─────────────────────────────────────
const free = proPitch({ tier: "free" });
check("free tier is pitched something", !!free);
check("free pitch names Forensics", /Forensics/.test(free.text));
check("free pitch names light placement", /light placement/i.test(free.text));
check("free pitch names the 3D house and the wall screen", /3D house/.test(free.text) && /wall screen/.test(free.text), free.text);
check("free pitch carries the real price", free.cta.includes(proPrice()), free.cta);
check("free pitch links the purchase page", free.url === BUY_URL, free.url);

// An unknown or missing tier is treated as free — the safe side is telling
// somebody about a feature, never hiding one they paid for.
for (const st of [{}, { tier: "" }, { tier: "nonsense" }, null, undefined]) {
  const r = proPitch(st);
  check(`unknown tier falls back to the free pitch (${JSON.stringify(st)})`,
    r && r.kind === "free", r && r.kind);
}

// ── Lapsed: they PAID. Do not sell, explain, and promise nothing was lost ───
const lapsed = proPitch({ tier: "free", pro_has_key: true, pro_active: false });
check("a lapsed licence gets the lapsed message", lapsed && lapsed.kind === "lapsed", lapsed && lapsed.kind);
check("lapsed message says the work survives",
  /still here|still exportable/i.test(lapsed.text), lapsed.text);
check("lapsed message offers renewal, not a first purchase", /Renew/.test(lapsed.cta), lapsed.cta);
// Since 2026-10-28 Forensics stops recording when a licence lapses
// (forensics_store._recording_enabled); what it recorded stays searchable.
check("lapsed message says Forensics stopped recording", /Forensics has stopped recording/.test(lapsed.text), lapsed.text);
const lapsedBright = proPitch({ tier: "bright", pro_has_key: true, pro_active: false, edition: "bright" });
check("a lapsed Bright build is not told about Forensics", lapsedBright && lapsedBright.kind === "lapsed" && !/Forensics/.test(lapsedBright.text), lapsedBright && lapsedBright.text);
check("the lapsed message says history lasts its retention period", /retention period/.test(lapsed.text), lapsed.text);
check("lapsed beats tier: a lapsed pro key is not treated as pro",
  proPitch({ tier: "pro", pro_has_key: true, pro_active: false }) !== null);

// ── Every pitch is one short line with a link ───────────────────────────────
for (const st of [{ tier: "free" }, { tier: "bright" }, { tier: "free", pro_has_key: true, pro_active: false }]) {
  const r = proPitch(st);
  check(`pitch for ${r.kind} is short enough for a card`, r.text.length < 340, r.text.length);
  check(`pitch for ${r.kind} has a call to action`, !!r.cta && !!r.url);
}

// ── "Pro for life ends Dec 15" (lifetimeCardDue): once, while lifetime is sold ──
// Who the licence card offers lifetime to (no key, a trial, a lapsed key), until
// lifetime ends (PRO_PASS_FROM), never after it; from December 1 its words drop the $89.
{
  const E = await import(pathToFileURL(join(VIEWS_DIR, "editions.js")).href);
  const end = Date.parse(E.PRO_PASS_FROM), dec1 = Date.parse(E.PRO_LIFETIME_LAUNCH_UNTIL);
  const before = Date.parse("2026-11-24T18:00:00Z"), lastMinute = end - 60e3;
  const FREE = { tier: "free", pro_has_key: false, lifetime_card_done: false };
  const due = (s, now = before) => E.lifetimeCardDue(s, now);
  check("lifetime card: due for a free install before the end, in November and December", due(FREE) && due(FREE, dec1 + 86400e3));
  check("lifetime card: due on the last minute of December 15, Pacific", due(FREE, lastMinute) && new Date(lastMinute).toISOString() === "2026-12-16T07:59:00.000Z");
  check("lifetime card: never from the end on, or after", !due(FREE, end) && !due(FREE, end + 86400e3 * 30));
  check("lifetime card: due for a trial and a lapsed key", due({ ...FREE, pro_has_key: true, license_is_trial: true, tier: "pro" })
    && due({ ...FREE, pro_has_key: true, pro_active: false }));
  check("lifetime card: never for a paid key that is running (Pro, Bright Pro, lifetime)",
    !due({ ...FREE, tier: "pro", pro_has_key: true, pro_active: true }) && !due({ ...FREE, tier: "bright", pro_has_key: true, pro_active: true }));
  check("lifetime card: never once shown", !due({ ...FREE, lifetime_card_done: true }));
  check("lifetime card: shown once more where the November 30 card was seen", due({ ...FREE, launch_card_done: true }));
  const old = { ...FREE }; delete old.lifetime_card_done;
  const unloaded = { ...FREE }; delete unloaded.pro_has_key;
  check("lifetime card: never before the settings say (an older backend, or not loaded yet)", !due(old) && !due(unloaded) && !due(null));
  check("lifetime card: its words, before and from December 1", E.LIFETIME_CARD_TITLE === "Pro for life ends Dec 15"
    && E.lifetimeCardText(before) === "Pro for life is $89 until Nov 30. Then it's $168 until Dec 15, and after that there's no lifetime: Pro is $85 for two years or $49 a year. Keys already sold stay lifetime."
    && E.lifetimeCardText(dec1) === "Pro for life is $168 until Dec 15, and after that there's no lifetime: Pro is $85 for two years or $49 a year. Keys already sold stay lifetime.",
    E.lifetimeCardText(before) + " | " + E.lifetimeCardText(dec1));
  check("prices by date: lifetime $89, $168, then none; the year $45, then $49; the pass $85",
    E.proLifetimeWords(before) === "$89 CAD, once, until November 30 (then $168 until December 15)"
    && E.proLifetimeWords(dec1) === "$168 CAD, once, until December 15" && E.proLifetimeWords(end) === ""
    && E.proLifetimeOpen(lastMinute) && !E.proLifetimeOpen(end) && !E.proPassOpen(lastMinute) && E.proPassOpen(end)
    && E.proPrice(lastMinute) === "$45 CAD/year" && E.proPrice(end) === "$49 CAD/year" && E.PRO_PASS_PRICE === "$85 CAD",
    [E.proLifetimeWords(before), E.proLifetimeWords(dec1), E.proPrice(end)].join(" | "));
  check("Bright Pro and the tester's two years end at the same moment",
    E.brightProOpen(lastMinute) && !E.brightProOpen(end) && E.testerTerm(lastMinute) === "two years" && E.testerTerm(end) === "one year");
  check("from the end, every pitch says $49", (() => { const r = Date.now; try { Date.now = () => end; return proPitch({ tier: "free" }).cta.includes("$49 CAD/year"); } finally { Date.now = r; } })());
}

process.stdout.write(JSON.stringify({ checks, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));   // exit only once the result is written (a pipe holds 64 KiB)
