// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Editions and tiers, on the frontend side — a mirror of licence.py, read
// from the settings payload (settings.tier / settings.edition / tier_floor)
// and never re-derived here.
//
//   EDITION  which build was downloaded: "full" (PadSpan HA / PadSpan Pro)
//            or "bright" (PadSpan Bright / PadSpan Bright Pro).  Visibility.
//   TIER     what the key says: free < bright < pro.  Capability.
//
// Every navigable surface is classified below, once. A Bright build renders
// the `lighting` surfaces only. The map is asserted TOTAL by
// tests/test_editions_map.py: add a view to panel.js and forget to classify
// it, and the suite goes red — that is the entire mechanism by which "the
// rest just flows" without anyone remembering Bright.

// ── Where a licence comes from, and where it goes ───────────────────────────
// A gate that names a product without saying where to buy one or where to put
// the key is a dead end, and until 2026-08-24 every gate in PadSpan was one:
// the light-placement refusal said "needs PadSpan Bright Pro or PadSpan Pro"
// with no price and no link, and the ONLY key-entry field in the whole panel
// was a prompt() hidden inside the Forensics toggle — so a customer who bought
// Pro to place lights had to enable an unrelated recording feature to activate
// it. These four constants are the single source for every gate message, so a
// refusal can always answer "then what?".
export const BUY_URL = "https://padspan.traks.ca/#pro";
export const LIGHTS_URL = "https://padspan.traks.ca/#lights";
// Suggest an idea: GitHub Discussions → Ideas (where ideas are voted on), or
// by email for anyone without GitHub. release_notes.js has its own copy of
// IDEAS_NEW_URL (it imports nothing); tests/test_suggest_idea.py holds them equal.
export const IDEAS_URL = "https://github.com/gbroeckling/padspanHA/discussions/categories/ideas";
export const IDEAS_NEW_URL = "https://github.com/gbroeckling/padspanHA/discussions/new?category=ideas";
export const IDEAS_MAIL = "mailto:hello@traks.ca?subject=PadSpan%20idea";
// Something wrong (2026-11-21): Diagnostics' "Email support" and "Open an
// issue", the two places its report has always said to send it.
export const SUPPORT_MAIL = "mailto:hello@traks.ca?subject=PadSpan%20problem&body=What%20happened%3A%0A%0A%0AThe%20report%20from%20PadSpan%27s%20Diagnostics%20(paste%20it%20here)%3A%0A";
export const ISSUES_NEW_URL = "https://github.com/gbroeckling/padspanHA/issues/new";
// PadSpan Pro's prices, by date (the owner, 2026-11-24). Until the end of
// December 15, 2026 a year is $45 and Pro for life is on sale ($89 until
// November 30, then $168). From PRO_PASS_FROM lifetime is no longer sold, a
// year is $49, and there's a two-year pass at $85. The site and the licence
// server switch at the same moment (tests/test_site_claims.py pins them).
// PRO_PRICE is the year until then: say a price with proPrice(), never this.
export const PRO_PRICE = "$45 CAD/year";
export const PRO_PRICE_FROM_PASS = "$49 CAD/year";
export const PRO_PASS_PRICE = "$85 CAD";
export const PRO_PASS_FROM = "2026-12-16T08:00:00Z";
export function proPassOpen(now = Date.now()) { return now >= Date.parse(PRO_PASS_FROM); }
/** What a year of Pro costs now: "$45 CAD/year", or "$49 CAD/year" from PRO_PASS_FROM. */
export function proPrice(now = Date.now()) { return proPassOpen(now) ? PRO_PRICE_FROM_PASS : PRO_PRICE; }
// The other two SKUs padspan.traks.ca#editions actually sells — pinned exactly
// against the site's own PayPal forms by tests/test_site_claims.py. Added so
// anything quoting the Bright ladder (the tiers help card, the onboarding
// wizard) has one source too, the same discipline PRO_PRICE already gives Pro.
export const BRIGHT_PRICE = "$35 CAD/year";
export const BRIGHT_UPGRADE_PRICE = "$12 CAD";
// Bright Pro is retired at PRO_PASS_FROM (the owner, 2026-11-24; nobody holds a
// Bright key). From then a Bright build's buy button offers PadSpan Pro, whose
// key unlocks light placement there too.
export function brightProOpen(now = Date.now()) { return !proPassOpen(now); }
// What a new tester gets (the licence server's plan 'tester'): two years of
// Pro until PRO_PASS_FROM, one year from then (the owner, 2026-11-24).
export function testerTerm(now = Date.now()) { return proPassOpen(now) ? "one year" : "two years"; }
// PadSpan Pro for life: $89 CAD at the launch price until November 30, 2026,
// then $168 CAD until December 15, then no longer sold (2026-10-22; the end,
// the owner, 2026-11-24). The site switches its PayPal form at each moment; the
// licence server honours a payment made before each one for a week after,
// for late payment notices. Pinned to the site like the rest.
export const PRO_LIFETIME_LAUNCH_PRICE = "$89 CAD";
export const PRO_LIFETIME_FULL_PRICE = "$168 CAD";
export const PRO_LIFETIME_LAUNCH_UNTIL = "2026-12-01T08:00:00Z";
export function proLifetimeLaunch(now = Date.now()) { return now < Date.parse(PRO_LIFETIME_LAUNCH_UNTIL); }
/** What lifetime costs now, said one way everywhere: "$89 CAD, once, until
 *  November 30 (then $168 until December 15)", "$168 CAD, once, until
 *  December 15", or "" once it's no longer sold. */
export function proLifetimeWords(now = Date.now()) {
  if (proLifetimeLaunch(now)) return PRO_LIFETIME_LAUNCH_PRICE + ", once, until November 30 (then $168 until December 15)";
  return proPassOpen(now) ? "" : PRO_LIFETIME_FULL_PRICE + ", once, until December 15";
}
// Lifetime is on sale until PRO_PASS_FROM, then never again.
export function proLifetimeOpen(now = Date.now()) { return !proPassOpen(now); }
// PadSpan add-ons (the owner, 2026-11-25): one feature each, for an install
// without Pro, structured like NeonPlan's Sound & Cinema add-on: one payment
// covers ADDON_TERM, no subscription, up to three homes, the key entered in the
// licence card. A buyer's add-ons share one key (tier "free", each add-on with
// its own end); PadSpan Pro includes them all. One entry per add-on: its name
// (licence.ADDONS, the licence server's $PSPAN_ADDONS), words, price and one
// line on what it unlocks. tests/test_site_claims.py pins every entry to the
// site's #addons box and its PayPal form; settings.js says the words in the
// panel's language (ADDON_WORDS). A new add-on is a line here and there.
export const ADDON_TERM = "2 years";
export const ADDONS_URL = "https://padspan.traks.ca/#addons";
export const ADDONS = Object.freeze([
  { name: "audio", words: "Audio", price: "$6.45 CAD", desc: "Volume, mute and off for each room's players on the map" },
  { name: "alarm", words: "Alarm & security", price: "$6.45 CAD", desc: "Arm and disarm in the emergency button, locks, garage and gate openers on the map, and Alert pulse. A triggered alarm always shows, free" },
  { name: "wifi", words: "Wi-Fi coverage", price: "$6.45 CAD", desc: "The UniFi Wi-Fi coverage map" },
  { name: "climate", words: "Climate map", price: "$8.65 CAD", desc: "The Heatmap: rooms by temperature, humidity and CO₂" },
  { name: "timetravel", words: "Time travel", price: "$7.55 CAD", desc: "The day replayed on the Atlas map (Playback on the Atlas)" },
  { name: "vacation", words: "Vacation Mode & presets", price: "$4.25 CAD", desc: "Vacation Mode and Whole House Presets" },
  { name: "looks", words: "Looks pack", price: "$4.25 CAD", desc: "Day and three more themes, Showcase and the forest" },
  { name: "forensics", words: "Forensics", price: "$5.56 CAD", desc: "Which Bluetooth devices were near a scanner in any time window" },
  { name: "insights", words: "Insights", price: "$5.56 CAD", desc: "Busy Times and Locate" },
]);
/** Whether add-on `name`'s features may be used: always on Pro, else the
 *  backend's own answer for the key (settings.addons_licensed, licence.addon_allowed). */
export function addonAllowed(settings, name) {
  const s = settings || {};
  return currentTier(s) === "pro" || (Array.isArray(s.addons_licensed) && s.addons_licensed.includes(name));
}
/** Whether this install's key is an add-on key (not a Pro key), lapsed or
 *  not: the backend's own answer (settings.addon_key, licence.is_addon_key).
 *  pro_has_key stays "a licence key is on this install". */
export function addonKey(settings) {
  return !!settings && settings.addon_key === true;
}
// "Pro for life ends Dec 15", the one Overview card about it (panel.js
// _launchPriceCard; the owner, 2026-11-24). It took the place of the launch
// price's card, with its own flag, so an administrator who saw that one sees
// this once more. Shown once, to an administrator, while lifetime is on sale
// (proLifetimeOpen); from December 1 its words drop the $89. Due where the
// licence card offers lifetime too (no key, a trial, a lapsed key) and to a
// running key for a year (Pro or Bright Pro): paid with the same email, the
// licence server makes that key lifetime (issue_lifetime). A lifetime key
// runs to 2099, so "under ten years left" is a year's key. Only once the
// backend says it was never shown (lifetime_card_done: a key an older backend
// does not send reads as "not known", never as "due").
export const LIFETIME_CARD_TITLE = "Pro for life ends Dec 15";
export function lifetimeCardText(now = Date.now()) {
  return (proLifetimeLaunch(now)
      ? "Pro for life is $89 until Nov 30. Then it's $168 until Dec 15, and after that"
      : "Pro for life is $168 until Dec 15, and after that")
    + " there's no lifetime: Pro is $85 for two years or $49 a year. Keys already sold stay lifetime.";
}
export function launchCardAnnual(settings) {
  const s = settings || {};
  return s.pro_has_key === true && s.pro_active === true && !s.license_is_trial
    && typeof s.pro_days_left === "number" && s.pro_days_left < 3650;
}
export function lifetimeCardDue(settings, now = Date.now()) {
  const s = settings || {};
  if (!proLifetimeOpen(now) || !("lifetime_card_done" in s) || s.lifetime_card_done) return false;
  if (typeof s.pro_has_key !== "boolean") return false;            // not loaded yet: no flash
  return !s.pro_has_key || s.pro_active === false || !!s.license_is_trial || launchCardAnnual(s);
}
export const EDITIONS_URL = "https://padspan.traks.ca/#editions";
// Where "what changed" lives. The same page the update-check manifest
// points at (release.py sets notes_url to it), so the notification and the
// in-panel card cannot disagree about where the release notes are. ?hl=en
// because the notes are English only: without it, a visitor from Germany,
// Austria or Switzerland lands on the German page (site/.htaccess) instead.
export const WHATSNEW_URL = "https://padspan.traks.ca/?hl=en#whatsnew";

// ── What to say about the paid half, to whom ────────────────────────────────
// Most free installs have never seen the paid features — the only place they
// are named is a refusal you hit by trying to use them. The what's-new card
// is a fair place to say what they are: once per release, one line, no badge
// and no banner.
//
// What it says depends on what the licence already covers, because pitching
// somebody a thing they have already bought is an insult:
//
//   pro     -> null. They have it all. Say nothing.
//   bright  -> what Pro adds: the 3D house, the wall screen and Forensics;
//              light placement is already theirs.
//   free    -> the main paid features, light placement first.
//   lapsed  -> what stopped (Forensics stops recording; what it recorded
//              stays searchable), and that nothing was lost.
//
// An add-on key is not a Pro licence: it is pitched as free, lapsed or not.
//
// Pure on purpose: it takes the settings payload and returns text, so the rule
// can be tested without a browser (tests/js/pro_pitch.mjs).
export function proPitch(settings) {
  const st = settings || {};
  const tier = String(st.tier || "free").toLowerCase();
  const hasKey = !!st.pro_has_key && !addonKey(st);
  const lapsed = st.pro_active === false;

  if (hasKey && lapsed) {
    // A Bright build shows no Forensics, Locate or Busy Times: name only what it shows.
    const off = currentEdition(st) === "bright"
      ? "light placement is read-only and the 3D house and the wall screen are off. "
      : "light placement is read-only, Forensics has stopped recording (what it recorded stays searchable "
        + "for its retention period), and the 3D house, the wall screen, Locate and Busy Times are off. ";
    return {
      kind: "lapsed",
      text: "Your licence has lapsed, so " + off
          + "Everything you set up is still here and comes back as you left it when you renew. ",
      cta: `Renew PadSpan Pro — ${proPrice()}`,
      url: BUY_URL,
    };
  }
  if (tier === "pro") return null;
  if (tier === "bright") {
    return {
      kind: "bright",
      text: "Your key covers the lighting half. PadSpan Pro adds the 3D house (Live Aboard), the wall "
          + "screen and Forensics — which Bluetooth devices were near a given scanner in any time window, "
          + "with dwell time and CSV export. ",
      cta: `PadSpan Pro — ${proPrice()}`,
      url: BUY_URL,
    };
  }
  return {
    kind: "free",
    text: "What a licence adds, in case you have never hit it: light placement, which puts every "
        + "light exactly where it hangs instead of clustered in the middle of its room; the 3D house "
        + "(Live Aboard); the wall screen; and Forensics, which answers which Bluetooth devices were "
        + "near a scanner in any time window. ",
    cta: `PadSpan Pro — ${proPrice()}`,
    url: BUY_URL,
  };
}
// The one true path to the licence card. If this moves, it moves here.
export const LICENCE_PATH = "Settings \u2192 Features \u2192 PadSpan licence";

export const TIERS = ["free", "bright", "pro"];

export function tierAtLeast(tier, want) {
  const r = t => { const i = TIERS.indexOf(String(t || "").toLowerCase()); return i < 0 ? 0 : i; };
  return r(tier) >= r(want);
}

/** The effective tier the backend computed, off the settings payload. */
export function currentTier(settings) {
  const t = String((settings && settings.tier) || "").toLowerCase();
  return TIERS.includes(t) ? t : "free";
}

export function currentEdition(settings) {
  return String((settings && settings.edition) || "").toLowerCase() === "bright" ? "bright" : "full";
}

// The classification. `lighting` is what PadSpan Bright is; `presence` is
// everything the lighting product does not show. Health and Settings are
// lighting because a Bright install still has to be diagnosed and configured
// — both trim themselves by edition inside, as Rooms does (no receivers or
// people in Bright: views/rooms.js).
export const SURFACE_CLASS = Object.freeze({
  overview:    "presence",
  purelive:    "presence",
  follow:      "presence",
  objects:     "presence",
  devices:     "presence",
  bluetooth:   "presence",
  presence:    "presence",
  history:     "presence",
  monitor:     "presence",
  maps:        "lighting",
  rooms:       "lighting",      // the Rooms page (2026-10-30); in Bright it trims itself to the lighting fields
  events:      "presence",
  health:      "lighting",
  settings:    "lighting",
  manage:      "presence",
  debug:       "presence",
  diagnostics: "presence",
  qa:          "presence",
  training:    "presence",
  calibration: "presence",
  receivers:   "presence",    // Bluetooth receivers: the presence build's
  traceback:   "presence",
  forensics:   "presence",
  sandbox:     "presence",
  occupancy:   "presence",
  guests:      "presence",      // guest tags (0.38.178): a tag lent to a guest is presence
  setup:       "presence",      // the guided Setup: receivers and calibration are presence
  ai_wizard:   "presence",      // Let Claude draw your rooms: rooms for presence (never offered in Bright)
  // The developer's install-base dashboard is about BOTH builds' installs,
  // but it is a presence-build surface: Bright has no Pro key to present.
  installbase: "presence",
  wifi: "presence",           // Wi-Fi coverage: needs the presence side's tracked phones and its floor model
});

/**
 * Which of `ids` a build shows. The full edition shows everything it is
 * handed. Bright shows the lighting surfaces — and the presence ones too when
 * the reveal switch is on (settings.bright_reveal_presence): hide-by-default,
 * never hidden for good.
 */
export function surfacesForEdition(ids, settings) {
  const edition = currentEdition(settings);
  if (edition !== "bright") return ids.slice();
  const reveal = !!(settings && settings.bright_reveal_presence);
  return ids.filter(id => reveal || SURFACE_CLASS[id] === "lighting");
}
