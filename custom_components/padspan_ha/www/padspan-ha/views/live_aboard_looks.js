// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's Look on this screen (Views ▾ → Look; View ▾ on a narrow screen):
//
//   the list     Same as Settings, then Live Aboard's own looks (Classic,
//                Studio), then the Showcase themes this house can use, dark
//                and light, each with a small swatch of its colours
//   this screen  the pick is this browser's, per screen (prefs look_<screen>),
//                as the ⋯ list's ticks are; Same as Settings forgets it, and
//                the screen follows Settings → Atlas → Live Aboard's Look
//                (and Mapping → Atlas builder's Showcase theme) again
//   by the sun   optionally a second look after sunset: sun.sun says when
//                (below_horizon), else the sun the view already works out.
//                Looked at only when the card's data comes in (no timer),
//                and the house is drawn again only when the look changes
//   Showcase     a Pro feature, as on the flat Atlas (lights_map.js
//                lightingUnlocked): the host hands in the themes only for a
//                tier that has them. Without them the list is Classic and
//                Studio and one plain line; a theme picked before is kept,
//                not drawn, and comes back with the key
//
// Pure: no three.js, no Home Assistant calls. The view (live_aboard.js) puts
// the pick over the card's data (lookP) and lists it in its menu (lookItems).

/** The pref this screen keeps its look in. */
// Its words in the panel's language (views/i18n.js; English is the key); loaded on its own, the English with its
// {placeholders} filled.
const _fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
const { t } = await import(`./i18n.js${new URL(import.meta.url).search}`)
  .catch(() => ({ t: _fill }));
export const lookPrefKey = (slotKey) => `look_${slotKey}`;
/** A pick: "settings" (Settings' own), "classic", "studio" or "theme:<key>". */
export const SETTINGS = "settings";
const OWN = ["classic", "studio"];
const isPick = (v) => typeof v === "string" && (v === SETTINGS || OWN.includes(v) || /^theme:[a-z0-9_]{1,40}$/.test(v));

/** What a screen keeps, from its pref: {day: pick, night: pick | null} (night null: no look of its own after sunset). */
export function readLook(raw){
  let o = null;
  try { o = typeof raw === "string" && raw ? JSON.parse(raw) : null; } catch (_) { o = null; }
  const day = o && isPick(o.day) ? o.day : SETTINGS;
  const night = o && isPick(o.night) ? o.night : null;
  return { day, night };
}
/** The pref to write for {day, night}: "" once it is Settings' own all day (forgotten). */
export function writeLook(o){
  const day = o && isPick(o.day) ? o.day : SETTINGS, night = o && isPick(o.night) ? o.night : null;
  return day === SETTINGS && night === null ? "" : JSON.stringify(night === null ? { day } : { day, night });
}
/** The pick that shows now: after sunset the night's (when there is one), else the day's. */
export const pickNow = (look, night) => (night && look.night !== null ? look.night : look.day);

/** After sunset? sun.sun's own state when it has one, else the sun's elevation
 *  below the horizon as Home Assistant counts sunset (-0.833°). elevation():
 *  the view's own sun (sun.sun's attributes, hass.config, or its default). */
export function afterSunset(states, elevation){
  const s = states && states["sun.sun"];
  if (s && (s.state === "below_horizon" || s.state === "above_horizon")) return s.state === "below_horizon";
  const e = typeof elevation === "function" ? Number(elevation()) : NaN;
  return Number.isFinite(e) && e < -0.833;
}

/** The card's data with this screen's pick over it. themes: the Showcase
 *  themes the host hands in (null: a tier without Showcase, so a theme pick
 *  shows Settings' own). Settings' own: p as it is. */
export function lookP(p, pick, themes){
  if (!p || !pick || pick === SETTINGS) return p;
  if (pick === "classic") return { ...p, look3d: "own", showcase3d: false };
  if (pick === "studio") return { ...p, look3d: "studio" };
  const key = pick.slice(6), t = themes && Object.prototype.hasOwnProperty.call(themes, key) ? themes[key] : null;
  if (!t) return p;
  return { ...p, look3d: "atlas", atlasLook: { on: true, key, theme: t }, showcase: { key, theme: t },
           codes: p.codes && typeof p.codes === "object" ? { ...p.codes, showcase: true } : p.codes };
}

/** What Settings gives this screen, in words: "the Atlas's look" (with its
 *  Showcase theme when on), "Live Aboard's own" or "Studio". p: the card's data. */
export function settingsWords(p, themes){
  const v = p && p.look3d;
  if (v === "studio") return t("Studio");
  if (v === "own") return t("Live Aboard's own");
  const a = p && p.atlasLook, theme = a && a.on && themes && themes[a.key];
  return theme && theme.label && a.key !== "classic" ? t("the Atlas's look, {theme}", { theme: theme.label }) : t("the Atlas's look");
}

/** A pick's name in the list ("Same as Settings", "Classic", a theme's label). */
export function pickWords(pick, themes){
  if (!pick || pick === SETTINGS) return t("Same as Settings");
  if (pick === "classic") return t("Classic");
  if (pick === "studio") return t("Studio");
  const theme = themes && themes[pick.slice(6)];
  return theme && theme.label ? String(theme.label) : pick.slice(6).replace(/_/g, " ");
}

/** A swatch for a pick: [background, ground, accent].
 *  rows: live_aboard_showcase.js SHOWCASE_LOOKS (null: none); studio: live_aboard_studio.js (its STUDIO_SKY.day; null: none). */
export function swatchOf(pick, rows, studio){
  const sky = studio && studio.STUDIO_SKY && studio.STUDIO_SKY.day;
  if (pick === "studio" && sky) return [sky.zenith, sky.pad, sky.glow];
  const r = rows && (pick === "classic" ? rows.classic : rows[String(pick).slice(6)]);
  return r ? [r.bg, r.ground, r.sky] : null;
}
const lightness = (h) => { const p = parseInt(String(h).slice(1), 16); return (0.2126 * (p >> 16 & 255) + 0.7152 * (p >> 8 & 255) + 0.0722 * (p & 255)) / 255; };

/** The list, grouped: [{head, items: [{pick, words, swatch}]}], and a note
 *  when Showcase themes are not this tier's. Classic is Live Aboard's own; the
 *  Showcase Classic theme (the flat Atlas's plain look) is not listed again. */
export function lookGroups(themes, rows, studio){
  const own = { head: t("Live Aboard"), items: OWN.map(pick => ({ pick, words: pickWords(pick, themes), swatch: swatchOf(pick, rows, studio) })) };
  if (!themes) return { groups: [own], note: t("Showcase themes come with a Pro key.") };
  const dark = [], light = [];
  for (const [key, t] of Object.entries(themes)) {
    if (key === "classic" || !t) continue;
    const pick = `theme:${key}`, sw = swatchOf(pick, rows, studio);
    (sw && lightness(sw[0]) > 0.5 ? light : dark).push({ pick, words: pickWords(pick, themes), swatch: sw });
  }
  const groups = [own];
  if (dark.length) groups.push({ head: t("Showcase themes, dark"), items: dark });
  if (light.length) groups.push({ head: t("Showcase themes, light"), items: light });
  return { groups, note: null };
}
