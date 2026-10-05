// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Which way north is on the map. settings.fabric_bearing_deg is the compass
// bearing, clockwise from true north, that the fabric's +Y axis points toward.
//
// The fabric is y-DOWN: a map's metres are origin + frac × scale with
// positive scales, so +Y runs down the plan as it is drawn. A plan drawn
// north-up therefore has a bearing of 180: north is (0, -1), the top of the
// plan, and east is (1, 0), the right. (The GPS Bridge has the same maths in
// geo_bridge.py's fabric_compass; tests/test_geo_bridge.py holds them equal.)
//
// The one place the frontend turns the bearing into directions and back —
// the 3D house's sun and compass, and the Settings preview, all ask here. If
// the setting is ever redefined (say, as the bearing the TOP of the plan
// faces, which is fabric -Y), the change is the one marked constant below:
// both directions read it.

// What the setting is the bearing OF, as a turn from fabric +Y (degrees).
const OF_FABRIC_Y = 0;                                    // the setting's meaning: 0 = the bearing of fabric +Y

/** A bearing in degrees, 0 to under 360; anything unreadable is 0. */
export function normBearing(v){
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? 0 : ((n % 360) + 360) % 360;
}

/** North and east as unit vectors in fabric (plan) coordinates, x right
 *  and y down the plan. */
export function fabricCompass(bearingDeg){
  const b = (normBearing(bearingDeg) + OF_FABRIC_Y) * Math.PI / 180;
  return { north: [Math.sin(b), Math.cos(b)], east: [-Math.cos(b), Math.sin(b)] };
}

/** The inverse: the bearing that puts north along a plan direction. */
export function bearingOfNorth(dir){
  const x = Number(dir && dir[0]), y = Number(dir && dir[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return 0;
  return normBearing(Math.atan2(x, y) * 180 / Math.PI - OF_FABRIC_Y);
}

/** A compass direction (degrees clockwise from true north) in fabric coordinates. */
export function compassDir(azimuthDeg, bearingDeg){
  const { north, east } = fabricCompass(bearingDeg), a = Number(azimuthDeg) * Math.PI / 180;
  return [north[0] * Math.cos(a) + east[0] * Math.sin(a), north[1] * Math.cos(a) + east[1] * Math.sin(a)];
}

/** How far to turn an arrow drawn pointing up the plan (clockwise, degrees)
 *  so it points north. */
export function northArrowDeg(bearingDeg){
  const [x, y] = fabricCompass(bearingDeg).north;
  return ((Math.atan2(x, -y) * 180 / Math.PI) % 360 + 360) % 360;
}
