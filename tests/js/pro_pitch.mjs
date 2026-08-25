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
const { proPitch, BUY_URL, PRO_PRICE } =
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
check("bright pitch does NOT sell light placement back to them",
  !/light placement/i.test(bright.text), bright.text);

// ── Free: has neither, so both are news ─────────────────────────────────────
const free = proPitch({ tier: "free" });
check("free tier is pitched something", !!free);
check("free pitch names Forensics", /Forensics/.test(free.text));
check("free pitch names light placement", /light placement/i.test(free.text));
check("free pitch carries the real price", free.cta.includes(PRO_PRICE), free.cta);
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
check("lapsed beats tier: a lapsed pro key is not treated as pro",
  proPitch({ tier: "pro", pro_has_key: true, pro_active: false }) !== null);

// ── Every pitch is one short line with a link ───────────────────────────────
for (const st of [{ tier: "free" }, { tier: "bright" }, { tier: "free", pro_has_key: true, pro_active: false }]) {
  const r = proPitch(st);
  check(`pitch for ${r.kind} is short enough for a card`, r.text.length < 340, r.text.length);
  check(`pitch for ${r.kind} has a call to action`, !!r.cta && !!r.url);
}

console.log(JSON.stringify({ checks, failures }));
process.exit(failures.length ? 1 : 0);
