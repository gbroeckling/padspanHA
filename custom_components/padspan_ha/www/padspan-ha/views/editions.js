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
// without Pro: one payment
// covers ADDON_TERM, no subscription, up to three homes, the key entered in the
// licence card. A buyer's add-ons share one key (tier "free", each add-on with
// its own end); PadSpan Pro includes them all. One entry per add-on: its name
// (licence.ADDONS, the licence server's $PSPAN_ADDONS), words, price and one
// line on what it unlocks. tests/test_site_claims.py pins every entry on sale
// to the site's #addons box and its PayPal form; settings.js says the words in
// the panel's language (ADDON_WORDS). A new add-on is a line here and there.
// on_sale_from (the owner, 2026-11-25): not sold before that moment, so
// nothing offers it until then (the licence card, the site); Pro includes it
// meanwhile, and a feature that was free and moves into it stays everyone's
// until it is (addonGate). licence.ADDON_ON_SALE_FROM says the same for the
// backend. on_sale: false with no moment: not sold until one is set
// (licence.NOT_ON_SALE; the specialty c4local until it is published).
export const ADDON_TERM = "2 years";
// December 1, 2026, 00:00 Pacific (the owner, 2026-11-25): the free basics (licence.free_basics; the panel reads the
// backend's word, settings.free_basics), the "3D house is now free" card, and maps and vacuum on sale. The backend's
// const.FREE_BASICS_FROM_TS is the same moment (tests/test_free_basics_dec1.py).
export const FREE_BASICS_FROM = "2026-12-01T08:00:00Z";
export const ADDONS_URL = "https://padspan.traks.ca/#addons";
export const ADDONS = Object.freeze([
  { name: "audio", words: "Audio", price: "$6.45 CAD", desc: "Each room's players on the map: now playing, volume, source and sound mode, tone and surround, music shared to other rooms, and Room off" },
  { name: "alarm", words: "Alarm & security", price: "$6.45 CAD", desc: "Arm and disarm, open and close garage doors and gates in their card, and test the emergency lights. A triggered alarm, locks, shades and Alert pulse stay free" },
  { name: "wifi", words: "Wi-Fi coverage", price: "$6.45 CAD", desc: "The UniFi Wi-Fi coverage map" },
  { name: "climate", words: "Climate & air quality", price: "$8.65 CAD", desc: "The ♨ Heatmap: rooms by temperature, humidity and CO₂, and each room's thermostats in its card" },
  { name: "timetravel", words: "Full house activity", price: "$7.55 CAD", desc: "The day replayed in Traceback on your Atlas map: lights, doors, sensors and who was where" },
  { name: "vacation", words: "Vacation Mode & presets", price: "$4.25 CAD", desc: "Vacation Mode and Whole house presets" },
  { name: "looks", words: "Looks pack", price: "$4.25 CAD", desc: "Four panel themes, 20 Showcase looks for the map including the West Coast Forest, and saved look presets. The light glow (Automorph) is Advanced smart lighting's" },
  // Forensics is part of Presence insights (the owner, 2026-11-26: merged): never sold on its own (on_sale: false), and
  // a key holding either has both (licence.ADDON_PART_OF; the backend's addons_licensed says so).
  { name: "forensics", words: "Forensics", price: "$5.56 CAD", on_sale: false, part_of: "insights", desc: "Which Bluetooth devices were near a receiver in any time window" },
  { name: "insights", words: "Presence insights", price: "$5.56 CAD", desc: "Locate walks you to a lost tag room by room; Busy Times shows each room's busy hours; Forensics shows which Bluetooth devices were near a receiver in any time window" },
  // maps and vacuum go on sale with the free 3D house (the December 1 free basics, FREE_BASICS_FROM).
  { name: "maps", words: "Advanced map creation", price: "$8.65 CAD", on_sale_from: FREE_BASICS_FROM,
    desc: "AI plan reading, a LiDAR scan's doors, windows, furniture and stairs in the 3D house, Furniture from scans, and floor plans from a LiDAR scan" },
  { name: "lighting", words: "Advanced smart lighting", price: "$8.65 CAD", desc: "Smart bulbs behind a wall switch work as one light that follows the day, dims for sleep and wakes you; WLED's Advanced controls; a glow from each light into its room; fixture shapes with their size and angle, the type override, Hide untouched and Showcase's Classic theme" },
  { name: "vacuum", words: "Robot vacuum", price: "$6.45 CAD", on_sale_from: FREE_BASICS_FROM,
    desc: "Your robot vacuum's map as a floor plan, the robot on the Atlas map and in 3D, room location runs, the mistake finder, and Wi-Fi while it cleans (with Wi-Fi coverage)" },
  // Energy (the owner, 2026-11-26): each room's power on the Atlas and in its card, the watts in empty rooms, standby
  // while everyone is out and who was home at spikes, from Home Assistant's own Energy setup (energy.py, views/energy.js,
  // views/energy_map.js). Not sold until the owner publishes it (on_sale: false, licence.NOT_ON_SALE), so nothing offers
  // it; PadSpan Pro includes it, and a key holding it uses it.
  { name: "energy", words: "Energy", price: "$8.65 CAD", on_sale: false,
    desc: "Each room's power on the Atlas map and in its card, the watts in rooms nobody is in, standby while you're out, and who was home at spikes" },
  // Specialty (the owner, 2026-11-25): a product of its own, sold beside the add-ons and never in their list or their
  // sale. OS 2 Local for Control4 is a separate Home Assistant integration (domain control4) PadSpan can install
  // (views/c4local.js, c4local_install.py); one payment, good for life (lifetime). on_sale: false until it is
  // published (licence.NOT_ON_SALE); on_sale_from, an ISO moment, puts it on sale by itself from then (addonOnSale).
  // The site's #c4local box shows exactly while it is on sale (tests/test_site_claims.py).
  { name: "c4local", words: "OS 2 Local for Control4", price: "$26 CAD", on_sale: false, on_sale_from: "", category: "specialty",
    lifetime: true, url: "https://padspan.traks.ca/#c4local",
    desc: "Home Assistant's Control4 integration for OS 2 controllers: a local login with the controller's system password, and room volume, mute and off" },
]);
/** Whether add-on `name` is sold at `now`: a known add-on whose on_sale_from, if any, has come; without one, an
 *  entry that is not on_sale: false. */
export function addonOnSale(name, now = Date.now()) {
  const a = ADDONS.find(x => x.name === name);
  if (!a) return false;
  return a.on_sale_from ? now >= Date.parse(a.on_sale_from) : a.on_sale !== false;
}
/** Whether add-on `name`'s features may be used: always on Pro, else the
 *  backend's own answer for the key (settings.addons_licensed, licence.addon_allowed). */
export function addonAllowed(settings, name) {
  const s = settings || {};
  return currentTier(s) === "pro" || (Array.isArray(s.addons_licensed) && s.addons_licensed.includes(name));
}
/** The gate of a feature that was free and moves into add-on `name`: everyone's while the add-on is not on sale
 *  (nobody could buy it), then addonAllowed. licence.hass_addon_gate is its twin. Whether it is on sale is the
 *  backend's word (settings.addons_on_sale, licence.addons_on_sale, every settings read), so the panel and the
 *  backend switch on one clock, with the next poll; not said (settings not in yet) reads "not on sale". */
export function addonGate(settings, name) {
  const s = settings || {};
  return !(Array.isArray(s.addons_on_sale) && s.addons_on_sale.includes(name)) || addonAllowed(s, name);
}
/** The robot vacuum's features (the Robot vacuum add-on): addonGate, and a Bright key, which has had them all along
 *  (never demoted). vacuum_import.licensed is its twin. */
export function vacuumAllowed(settings) {
  return addonGate(settings, "vacuum") || tierAtLeast(currentTier(settings), "bright");
}
// Black Friday (the owner, 2026-11-25): every add-on on sale at HALF its price, rounded down to the cent, from
// ADDON_HALF_FROM (Friday November 27, 2026, 00:00 Pacific) until ADDON_HALF_UNTIL (the end of January 1, 2027,
// Pacific). Every price an add-on is quoted at comes from addonPrice / addonPriceParts, so the panel switches by
// itself at the two moments; the site's #addons forms switch at the same two (tests/test_site_claims.py pins them),
// and the licence server takes the half price by the payment's date.
export const ADDON_HALF_FROM = "2026-11-27T08:00:00Z";
export const ADDON_HALF_UNTIL = "2027-01-02T08:00:00Z";
export function addonHalfOff(now = Date.now()) {
  return now >= Date.parse(ADDON_HALF_FROM) && now < Date.parse(ADDON_HALF_UNTIL);
}
/** Half of a price ("$6.45 CAD"), rounded down to the cent: "$3.22 CAD". */
export function halfPrice(price) {
  const cents = Math.round(Number(String(price).replace(/[^\d.]/g, "")) * 100);
  return `$${(Math.floor(cents / 2) / 100).toFixed(2)} CAD`;
}
/** What add-on `name` costs at `now`: { price ("$3.22 CAD" in the sale, else "$6.45 CAD"), normal ("$6.45"), half
 *  (true in the sale) }, or null for no such add-on. One that isn't on sale yet, or a specialty, is never half off. */
export function addonPriceParts(name, now = Date.now()) {
  const a = ADDONS.find(x => x.name === name);
  if (!a) return null;
  const half = addonHalfOff(now) && addonOnSale(name, now) && a.category !== "specialty";   // a specialty is never in a sale
  return { price: half ? halfPrice(a.price) : a.price, normal: a.price.replace(/ CAD$/, ""), half };
}
/** An add-on's price now, as the site sells it ("$8.65 CAD"; "$4.32 CAD" in the sale), "" for no such add-on: what a
 *  refusal says beside the add-on's name ("PadSpan Pro or the Climate & air quality add-on ($8.65 CAD)"), never written out
 *  there. */
export function addonPrice(name, now = Date.now()) {
  const p = addonPriceParts(name, now);
  return p ? p.price : "";
}
/** The price in full, in English: "$3.22 CAD — half off through January 1 (normally $6.45)" in the sale, the price
 *  otherwise. settings.js says the same in the panel's language (addonPriceSaid). */
export function addonPriceWords(name, now = Date.now()) {
  const p = addonPriceParts(name, now);
  if (!p) return "";
  return p.half ? `${p.price} — half off through January 1 (normally ${p.normal})` : p.price;
}
// Cross discount (the owner, 2026-11-25): an install that holds Advanced map creation pays 30% off Robot vacuum,
// and one that holds Robot vacuum pays 30% off Advanced map creation, rounded down to the cent ($8.65 -> $6.05,
// $6.45 -> $4.51). The better of that and the Black Friday half price, never both. The site can't know who holds
// what, so it says the rule in words and charges the public price; the discounted purchase is the licence card's own
// link (addonBuyUrl), and the licence server takes the lower amount only from an email whose key holds the other.
export const ADDON_CROSS = Object.freeze({ maps: "vacuum", vacuum: "maps" });
export const ADDON_CROSS_PERCENT = 30;
const _cents = (price) => Math.round(Number(String(price).replace(/[^\d.]/g, "")) * 100);
/** A price ("$6.45 CAD") less ADDON_CROSS_PERCENT, rounded down to the cent: "$4.51 CAD". */
export function crossPrice(price) {
  return `$${(Math.floor(_cents(price) * (100 - ADDON_CROSS_PERCENT) / 100) / 100).toFixed(2)} CAD`;
}
/** What add-on `name` costs THIS install at `now`: addonPriceParts, plus cross (true when the 30% is the better
 *  price, `with` the add-on held), from the add-ons the backend says it holds (settings.addons_licensed; on Pro,
 *  none: Pro includes them all and buys none), once `name` is on sale. null for no such add-on. The licence card's
 *  one price. */
export function addonPriceFor(settings, name, now = Date.now()) {
  const p = addonPriceParts(name, now);
  if (!p) return null;
  const s = settings || {};
  const other = ADDON_CROSS[name];
  const held = !!other && addonOnSale(name, now) && currentTier(s) !== "pro" && Array.isArray(s.addons_licensed)
    && s.addons_licensed.includes(other);
  const cross = held ? crossPrice(ADDONS.find(x => x.name === name).price) : "";
  if (!cross || _cents(cross) >= _cents(p.price)) return { ...p, cross: false };
  return { price: cross, normal: p.normal, half: false, cross: true, with: other };
}
// The PayPal payment the licence card's link makes, field for field the site's #addons forms (site/index.html).
const PAYPAL_URL = "https://www.paypal.com/cgi-bin/webscr";
const PAYPAL_FIELDS = { cmd: "_xclick", business: "garry@bcmail.net", currency_code: "CAD", no_shipping: "1",
  notify_url: "https://traks.ca/license/?action=ipn", return: "https://padspan.traks.ca/?bought=1" };
/** Where the licence card's link for add-on `name` goes: at the cross discount, PayPal for that amount (item
 *  padspan-addon-<name>, named as the site names it); at the public price, the site's #addons, which sells it so. */
export function addonBuyUrl(settings, name, now = Date.now()) {
  const p = addonPriceFor(settings, name, now);
  if (!p || !p.cross) return ADDONS_URL;
  const a = ADDONS.find(x => x.name === name);
  const q = new URLSearchParams({ ...PAYPAL_FIELDS, item_name: `PadSpan add-on: ${a.words} \u2014 ${ADDON_TERM}`,
    item_number: `padspan-addon-${name}`, amount: p.price.replace(/[^\d.]/g, "") });
  return `${PAYPAL_URL}?${q.toString()}`;
}
/** Whether this install's key is an add-on key (not a Pro key), lapsed or
 *  not: the backend's own answer (settings.addon_key, licence.is_addon_key).
 *  pro_has_key stays "a licence key is on this install". */
export function addonKey(settings) {
  return !!settings && settings.addon_key === true;
}
// "Half off every add-on through January 1", the one Overview card about the
// sale (panel.js _addonSaleCard; the owner, 2026-11-25), held to the lifetime
// card's discipline: once, to an administrator, never on a wall, only while
// addonHalfOff, and only once the backend says it was never shown
// (addon_sale_card_done: a key an older backend does not send reads as "not
// known", never as "due"). Due to an install without paid Pro: no key, a
// trial, a lapsed key, Bright, or an add-on key that lacks an add-on on sale.
// A running Pro key (bought or given) includes every add-on, so never there.
export function addonSaleCardDue(settings, now = Date.now()) {
  const s = settings || {};
  if (!addonHalfOff(now) || !("addon_sale_card_done" in s) || s.addon_sale_card_done) return false;
  if (typeof s.pro_has_key !== "boolean") return false;            // not loaded yet: no flash
  if (!addonSaleCardPicks(s, now).length) return false;            // it names what it offers: never an empty list
  if (s.license_is_trial && s.pro_active !== false) return true;
  return ADDONS.some(a => addonOnSale(a.name, now) && a.category !== "specialty" && !addonAllowed(s, a.name));   // never in the sale
}
// The few the card names with their half price: the first three on sale this
// install can't use yet, in this order.
const SALE_CARD_PICKS = ["audio", "lighting", "climate", "timetravel", "looks", "alarm", "insights", "vacation", "wifi"];
export function addonSaleCardPicks(settings, now = Date.now()) {
  const s = settings || {};
  const trial = !!s.license_is_trial;
  return SALE_CARD_PICKS.filter(n => addonOnSale(n, now) && (trial || !addonAllowed(s, n))).slice(0, 3);
}
// An add-on offered where it is refused or sold (the usage report, only when it
// is on: the send is the panel's _telemetryEvent): once per page load per
// place, because the views draw again every few seconds. telemetry.py
// ADDON_OFFER_PLACES lists the places; a click is counted each time.
const _offersSeen = new Set();
export function addonOfferSeen(send, place, name) {
  const k = place + ":" + name;
  if (typeof send !== "function" || _offersSeen.has(k)) return;
  _offersSeen.add(k);
  try { send("addon_offer:" + k); } catch (_) { /* the report is a courtesy */ }
}
// A feature tip's feature used (views/tips.js noteUse), said to the page as an event so a view need import nothing
// more: Locate, Busy Times, WLED's Advanced tab. Only on the house's own data (live), never the sample house's.
// Nothing is sent anywhere; the panel or the Atlas page writes it down with the tips' state.
export function tipUsed(id, live = true) {
  if (!live) return;
  try {
    if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent === "function")
      globalThis.dispatchEvent(new CustomEvent("padspan-tip-used", { detail: String(id) }));
  } catch (_) { /* a tip is never the error */ }
}
export function addonUsedSeen(send, name) {
  const k = "used:" + name;
  if (typeof send !== "function" || _offersSeen.has(k)) return;
  _offersSeen.add(k);
  try { send("addon_used:" + name); } catch (_) { /* the report is a courtesy */ }
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
  return s.pro_has_key === true && s.pro_active === true && !s.license_is_trial && !addonKey(s)
    && typeof s.pro_days_left === "number" && s.pro_days_left < 3650;
}
export function lifetimeCardDue(settings, now = Date.now()) {
  const s = settings || {};
  if (!proLifetimeOpen(now) || !("lifetime_card_done" in s) || s.lifetime_card_done) return false;
  if (typeof s.pro_has_key !== "boolean") return false;            // not loaded yet: no flash
  return !s.pro_has_key || s.pro_active === false || !!s.license_is_trial || launchCardAnnual(s);
}
// "The 3D house is now free", the one Overview card about the free basics
// (panel.js _freeHouseCard; the owner, 2026-11-25): once, to an administrator,
// never on a wall, from the moment the backend says the basics are free
// (settings.free_basics, licence.free_basics: December 1), to an install
// without Pro (Pro had it all along). Its own flag (house3d_free_card_done),
// saved the moment it first shows; a key an older backend does not send reads
// as "not known", never as "due".
export function freeHouseCardDue(settings) {
  const s = settings || {};
  if (!freeBasics(s) || !("house3d_free_card_done" in s) || s.house3d_free_card_done) return false;
  return currentTier(s) !== "pro";
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
// From the free basics (freeBasics: placement, the plain wall and the 3D house
// free), each names only what a key adds on top of them.
//
// Pure on purpose: it takes the settings payload and returns text, so the rule
// can be tested without a browser (tests/js/pro_pitch.mjs).
export function proPitch(settings) {
  const st = settings || {};
  const tier = String(st.tier || "free").toLowerCase();
  const hasKey = !!st.pro_has_key && !addonKey(st);
  const lapsed = st.pro_active === false;
  const fb = freeBasics(st);

  if (hasKey && lapsed) {
    // A Bright build shows no Forensics, Locate or Busy Times: name only what it shows.
    const off = fb
      ? (currentEdition(st) === "bright"
        ? "fixture shapes, Showcase, the 3D editor, Furnish and the wall's night dimming are off; lights stay where you placed them. "
        : "fixture shapes, Showcase, the 3D editor, Furnish, people in 3D, the wall's night dimming, Locate and Busy Times are off, "
          + "and Forensics has stopped recording (what it recorded stays searchable for its retention period). ")
      : currentEdition(st) === "bright"
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
      text: fb
        ? "Your key covers the lights' looks. PadSpan Pro adds the 3D editor, Furnish and people in the 3D house, "
          + "the wall screen's night dimming and burn-in protection, and Forensics — which Bluetooth devices were "
          + "near a given scanner in any time window, with dwell time and CSV export. "
        : "Your key covers the lighting half. PadSpan Pro adds the 3D house (Live Aboard), the wall "
          + "screen and Forensics — which Bluetooth devices were near a given scanner in any time window, "
          + "with dwell time and CSV export. ",
      cta: `PadSpan Pro — ${proPrice()}`,
      url: BUY_URL,
    };
  }
  return {
    kind: "free",
    text: fb
      ? "What a licence adds, in case you have never hit it: each light's shape, size and Showcase look "
        + "(placing it is free); the 3D editor, Furnish and people in the 3D house; the wall screen's night "
        + "dimming; and Forensics, which answers which Bluetooth devices were near a scanner in any time window. "
      : "What a licence adds, in case you have never hit it: light placement, which puts every "
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

// ── Features that move down the ladder (licence.py FREE_BASICS) ─────────────
// Exact placement of lights and devices, the plain wall mode and the 3D
// house's basics move to the free tier together. The backend sends
// settings.free_basics only while its switch is on; absent, each rung below is
// where it always was. Each takes the settings payload, or a host's boolean
// (host.freeBasics) where a view has no settings to hand.
export function freeBasics(s) { return s === true || (!!s && typeof s === "object" && s.free_basics === true); }
export function placementTier(s) { return freeBasics(s) ? "free" : "bright"; }
export function wallTier(s) { return freeBasics(s) ? "free" : "pro"; }
export function house3dTier(s) { return freeBasics(s) ? "free" : "pro"; }

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
  energy: "presence",         // Energy (the add-on): empty rooms and who was home come from the presence side
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
