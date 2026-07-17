// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Traceback — NVR-style playback of object movement history on the 3D iso map.
 * Extracted from overview.js into its own dedicated tab.
 */

// Shared stack transform (P2-5); query inherited from our own module URL so
// the ?b= cache-buster propagates (see docs/06_UI_CACHE_BUSTING.md).
const { makeStackXform, imageAr } =
  await import(`./stack_transform.js${new URL(import.meta.url).search}`);

export function render(ctx) {
  const { el, esc: _esc } = ctx.helpers;
  const roomColorFn = ctx.helpers.roomColor;
  const liveSnap = ctx.state.live?.snapshot || null;
  const radios = (liveSnap?.ble?.radios) || [];

  const outer = document.createElement("div");
  outer.style.cssText = "padding:0";

  // ── 3D Iso map setup (mirrors overview) ────────────────────────────────
  const maps_list = (ctx.state.maps?.list) || [];
  if (!maps_list.length) {
    const msg = document.createElement("div");
    msg.className = "card";
    msg.style.cssText = "text-align:center;padding:30px;color:#94a3b8";
    msg.textContent = "No maps uploaded yet. Go to Maps to add floor plans, then use Traceback to replay object movement.";
    outer.appendChild(msg);
    return outer;
  }

  const TILE = 220, CX = 380, CY = 590, W = 760, BASE_H = 940;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];

  if(ctx.state._overviewFloorGap===undefined) ctx.state._overviewFloorGap = ctx.state.settings?.overview_iso_floor_gap ?? 150;
  if(ctx.state._overviewHorizGap===undefined) ctx.state._overviewHorizGap = ctx.state.settings?.overview_iso_horiz_gap ?? 0;
  let _ovFG = ctx.state._overviewFloorGap, _ovHG = ctx.state._overviewHorizGap;

  const iso = (wx, wy, wz) => [CX + (wx - wy) * TILE * 0.866 + wz * _ovHG, CY + (wx + wy) * TILE * 0.5 - wz * _ovFG];
  const pt  = c => `${Math.round(c[0])},${Math.round(c[1])}`;
  const pts = cs => cs.map(pt).join(" ");

  // Filter hidden maps
  const hiddenIds = ctx.state.maps._hiddenMapIds || new Set();
  const sorted = [...maps_list].filter(m => !hiddenIds.has(m.id)).sort((a, b) => (a.stack?.z_level || 0) - (b.stack?.z_level || 0));

  // Group maps by z_level
  const byLevel = new Map();
  for (const m of sorted) {
    const z = m.stack?.z_level ?? 0;
    if (!byLevel.has(z)) byLevel.set(z, []);
    byLevel.get(z).push(m);
  }
  const sortedIsoLevels = [...byLevel.keys()].sort((a, b) => a - b);
  const levelColor = (z) => LAYER_PAL[sortedIsoLevels.indexOf(z) % LAYER_PAL.length];
  const LEGEND_H = 30;  // single-row compact legend (matches overview)

  // Build per-map coordinate transforms (matches overview.js mapTransforms)
  const mapTransforms = {};
  for (const m of sorted) {
    const stk = m.stack || {};
    mapTransforms[m.id] = { z: stk.z_level || 0, mapPt: makeStackXform(stk, imageAr(m)).mapPt };
  }

  // Build room centroid iso positions (rebuilt when sliders change)
  // Uses full map transform (rotation, affine, ref_ar, scale_x_adj)
  const roomIsoPos = {};
  const _roomLower = {}; // lowercase → original case for case-insensitive lookup
  function _rebuildRoomPositions() {
    for (const k of Object.keys(roomIsoPos)) delete roomIsoPos[k];
    for (const k of Object.keys(_roomLower)) delete _roomLower[k];
    for (const m of sorted) {
      const tf = mapTransforms[m.id];
      if (!tf) continue;
      for (const [room, b] of Object.entries(m.room_bounds || {})) {
        if (!b) continue;
        if (roomIsoPos[room]) continue; // first map wins
        let cx, cy;
        if (b.type === "poly" && Array.isArray(b.points) && b.points.length >= 3) {
          cx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
          cy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
        } else if (b.type === "circle" && b.cx != null && b.cy != null) {
          cx = b.cx; cy = b.cy;
        } else {
          continue;
        }
        const [wx, wy] = tf.mapPt(cx, cy);
        roomIsoPos[room] = iso(wx, wy, tf.z);
        _roomLower[room.toLowerCase()] = room;
      }
    }
  }
  _rebuildRoomPositions();

  /**
   * Get ISO screen position for a traceback object entry.
   * Priority: 1) k-NN map position (x,y,m fields), 2) room centroid (case-insensitive)
   */
  function _getObjPos(o) {
    // k-NN precise position (from new traceback fields)
    if (o.x != null && o.y != null && o.m && mapTransforms[o.m]) {
      const tf = mapTransforms[o.m];
      const [wx, wy] = tf.mapPt(o.x, o.y);
      return iso(wx, wy, tf.z);
    }
    // Room centroid — exact match first, then case-insensitive
    if (o.r) {
      if (roomIsoPos[o.r]) return roomIsoPos[o.r];
      const canonical = _roomLower[(o.r || "").toLowerCase()];
      if (canonical && roomIsoPos[canonical]) return roomIsoPos[canonical];
    }
    return null;
  }

  // Slider positions for floor focus
  const _isoPos = [null];
  for (let i = 0; i < sortedIsoLevels.length; i++) {
    _isoPos.push(sortedIsoLevels[i]);
    if (i < sortedIsoLevels.length - 1) _isoPos.push([sortedIsoLevels[i], sortedIsoLevels[i + 1]]);
  }
  if(ctx.state._overviewIsoFocusIdx === undefined)
    ctx.state._overviewIsoFocusIdx = Math.max(0, Math.min(ctx.state.settings?.overview_iso_focus ?? 0, _isoPos.length-1));
  let focusZ = _isoPos[Math.max(0, Math.min(ctx.state._overviewIsoFocusIdx, _isoPos.length - 1))];

  function _getFocusLbl(idx) {
    const fz = _isoPos[Math.max(0, Math.min(idx, _isoPos.length-1))];
    if (fz === null) return "All floors";
    if (Array.isArray(fz)) return `Floors ${sortedIsoLevels.indexOf(fz[0])+1}–${sortedIsoLevels.indexOf(fz[1])+1}`;
    return `Floor ${sortedIsoLevels.indexOf(fz)+1}`;
  }

  // ── Traceback state ────────────────────────────────────────────────────
  if (!ctx.state._traceback) ctx.state._traceback = {
    mode: "playback",     // "playback" | "discovery"
    playing: false,
    playDurationS: 300,   // how long full playback takes (1 min to 1 hr slider)
    frameIdx: 0,
    frames: [],
    range: null,
    objKeys: [],
    filterKey: null,
    filterName: "All objects",
    rangePreset: 300,
    startTs: null,
    endTs: null,
    _animTimer: null,
    // Discovery mode state
    discoFromMin: 60,     // search from X minutes ago
    discoToMin: 0,        // search to Y minutes ago (0 = now)
    discoResults: [],     // filtered objects
    discoSelected: null,  // selected object key for highlighting
  };
  if (!ctx.state._traceback.mode) ctx.state._traceback.mode = "playback";
  const tb = ctx.state._traceback;

  // ── Clear stale timer from previous render ──────────────────────────
  // If we're re-rendering while a timer is running, kill it so it doesn't
  // write to detached DOM nodes.  We'll restart below if tb.playing is true.
  if (tb._animTimer) { cancelAnimationFrame(tb._animTimer); tb._animTimer = null; }

  function _fmtTime(ts) {
    if (!ts) return "--";
    return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function _fmtDate(ts) {
    if (!ts) return "--";
    const d = new Date(ts * 1000);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function _fmtDuration(sec) {
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
    return `${(sec / 86400).toFixed(1)}d`;
  }

  // ── Data loading ───────────────────────────────────────────────────────
  async function _loadTracebackData() {
    try {
      const now = Date.now() / 1000;
      const startTs = tb.startTs || (now - tb.rangePreset);
      const endTs = tb.endTs || now;
      const res = await ctx.actions.wsCall("padspan_ha/traceback_get", {
        start_ts: startTs,
        end_ts: endTs,
        obj_key: tb.filterKey || undefined,
        max_frames: 4000,
      });
      tb.frames = res.frames || [];
      tb.range = res.range || { start: 0, end: 0, count: 0 };
      tb.frameIdx = 0;
      tb._staticKeys = null;  // recompute on next render
      tb._colorMap = null;
      tb._scannerSet = null;

      // If filtering by object and no frames found, auto-expand to full data range
      if (tb.filterKey && !tb.frames.length && tb.range && tb.range.start > 0) {
        const fullRes = await ctx.actions.wsCall("padspan_ha/traceback_get", {
          start_ts: tb.range.start,
          end_ts: tb.range.end || now,
          obj_key: tb.filterKey,
          max_frames: 4000,
        });
        tb.frames = fullRes.frames || [];
        tb._staticKeys = null;  // recompute on next render
      tb._colorMap = null;
      tb._scannerSet = null;
        if (tb.frames.length) {
          tb._autoExpanded = true;
        }
      } else {
        tb._autoExpanded = false;
      }

      const objRes = await ctx.actions.wsCall("padspan_ha/traceback_objects", {});
      tb.objKeys = objRes.objects || [];
      tb.range = objRes.range || tb.range;
    } catch (e) {
      console.error("Traceback load error:", e);
      tb.frames = [];
    }
  }

  // ── SVG builder ────────────────────────────────────────────────────────
  function _buildTracebackSVG(frameIdx) {
    const maxIsoZ = sortedIsoLevels.length ? sortedIsoLevels[sortedIsoLevels.length - 1] : 0;
    const viewY = Math.min(0, CY - maxIsoZ * _ovFG - 50);
    const HTOTAL = BASE_H + LEGEND_H - viewY;
    let s = `<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
    s += `<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

    // Defs — floor surface patterns (matches overview)
    s += `<defs>`;
    sortedIsoLevels.forEach((z2, li) => {
      const c2 = levelColor(z2);
      if(li === 0){
        s += `<pattern id="tbpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
        s += `<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.14"/>`;
        s += `<path d="M12,2 C13.5,0 15.5,0.5 14.5,2.5 C13.5,1.5 12,2 12,2 Z" fill="${c2}" opacity="0.11"/>`;
        s += `<circle cx="12" cy="15" r="1.4" fill="${c2}" opacity="0.1"/>`;
        s += `</pattern>`;
      } else if(li === 1){
        s += `<pattern id="tbpat_${li}" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">`;
        s += `<rect x="2" y="2" width="7" height="16" rx="1" fill="none" stroke="${c2}" stroke-width="0.5" opacity="0.13"/>`;
        s += `<rect x="11" y="2" width="7" height="16" rx="1" fill="none" stroke="${c2}" stroke-width="0.5" opacity="0.13"/>`;
        s += `</pattern>`;
      } else if(li === 2){
        s += `<pattern id="tbpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
        s += `<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
        s += `</pattern>`;
      } else {
        s += `<pattern id="tbpat_${li}" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">`;
        s += `<circle cx="8" cy="8" r="2" fill="none" stroke="${c2}" stroke-width="0.5" opacity="0.15"/>`;
        s += `</pattern>`;
      }
    });
    s += `</defs>`;

    // Floor slabs + room polygons + receivers (dim)
    for (const [z, group] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      const isFocused = focusZ === null || (Array.isArray(focusZ) ? focusZ.includes(z) : focusZ === z);
      const go = isFocused ? 0.7 : 0.08;
      const lyrColor = levelColor(z);
      const lidx = sortedIsoLevels.indexOf(z);

      let x0 = Infinity, y0_ = Infinity, x1 = -Infinity, y1_ = -Infinity;
      for (const m of group) {
        const bbPt = makeStackXform(m.stack, imageAr(m)).mapPt;
        for (const [cx, cy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const [wx, wy] = bbPt(cx, cy); x0 = Math.min(x0, wx); y0_ = Math.min(y0_, wy); x1 = Math.max(x1, wx); y1_ = Math.max(y1_, wy); }
      }
      if (!isFinite(x0)) { x0 = 0; y0_ = 0; x1 = 1; y1_ = 0.75; }
      const TL = iso(x0, y0_, z), TR = iso(x1, y0_, z), BR = iso(x1, y1_, z), BL = iso(x0, y1_, z);
      s += `<g opacity="${go}">`;
      s += `<polygon points="${pts([TL, TR, BR, BL])}" fill="url(#tbpat_${lidx})" stroke="${lyrColor}" stroke-width="1.2" stroke-dasharray="10,5" opacity="0.5"/>`;

      // Room polygons
      for (const m of group) {
        const mapPt = makeStackXform(m.stack, imageAr(m)).mapPt;
        for (const [room, b] of Object.entries(m.room_bounds || {})) {
          if (!b || b.type !== "poly" || !Array.isArray(b.points) || b.points.length < 3) continue;
          const color = roomColorFn(room);
          const pp = b.points.map(p => { const [wx, wy] = mapPt(p[0], p[1]); return pt(iso(wx, wy, z)); }).join(" ");
          s += `<polygon points="${pp}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.2" opacity="0.85"/>`;
          const cx2 = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
          const cy2 = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
          const [lwx, lwy] = mapPt(cx2, cy2);
          const [lix, liy] = iso(lwx, lwy, z);
          s += `<text x="${Math.round(lix)}" y="${Math.round(liy)}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="9" font-weight="600" opacity="0.85">${_esc(room)}</text>`;
        }
        // Receivers
        for (const r of (m.receivers || [])) {
          const [wx, wy] = mapPt(r.x || 0, r.y || 0);
          const [px2, py2] = iso(wx, wy, z);
          s += `<circle cx="${Math.round(px2)}" cy="${Math.round(py2)}" r="4" fill="#52b788" opacity="0.3"/>`;
        }
      }
      // Layer index
      s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="12" fill="${lyrColor}" opacity="0.7"/>`;
      s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1]) + 5}" text-anchor="middle" fill="#071008" font-size="11" font-weight="700">${lidx + 1}</text>`;
      s += `</g>`;
    }

    // ── End of static base — cache this part for fast re-renders ──
    // When frameIdx < 0, return just the static SVG (no object overlay)
    if (frameIdx < 0) { s += `</svg>`; return s; }

    s += `<!-- TB_OVERLAY_START -->`;

    // Overlay: playback objects at this frame
    if (tb.frames.length && frameIdx >= 0 && frameIdx < tb.frames.length) {
      const frame = tb.frames[frameIdx];
      // Cache scanner set — doesn't change during playback
      if (!tb._scannerSet) {
        tb._scannerSet = new Set(((ctx.state.live?.snapshot?.ble?.radios) || []).map(r => String(r.source || "").toUpperCase()).filter(Boolean));
        for (const r of ((ctx.state.live?.snapshot?.ble?.radios) || [])) {
          if (r.name) tb._scannerSet.add(String(r.name).toUpperCase());
        }
      }
      const _scannerSrcSet = tb._scannerSet;
      // Build set of objects that never change rooms (static — useless in movement playback).
      if (!tb._staticKeys) {
        const _roomByKey = {};
        for (const f of tb.frames) {
          for (const o of (f.o || [])) {
            if (!o.k || !o.r) continue;
            if (!_roomByKey[o.k]) _roomByKey[o.k] = new Set();
            _roomByKey[o.k].add(o.r);
          }
        }
        tb._staticKeys = new Set();
        for (const [k, rooms] of Object.entries(_roomByKey)) {
          if (rooms.size <= 1) tb._staticKeys.add(k);
        }
      }
      // Count how many objects actually move between rooms
      const _movingCount = (frame.o || []).filter(o => {
        const ku = String(o.k || "").toUpperCase();
        if (_scannerSrcSet.has(ku)) return false;
        return !tb._staticKeys.has(o.k);
      }).length;
      // Only hide static objects if there are enough moving ones to make it useful
      // (otherwise show everything so playback isn't empty)
      const _hideStatic = _movingCount >= 2;
      const objs = (frame.o || []).filter(o => {
        const ku = String(o.k || "").toUpperCase();
        if (_scannerSrcSet.has(ku)) return false;
        if (tb.filterKey && o.k === tb.filterKey) return true;
        if (_hideStatic && tb._staticKeys.has(o.k)) return false;
        return true;
      });
      const _roomCount = {};
      const TB_COLORS = ["#fbbf24", "#60a5fa", "#f87171", "#34d399", "#c4b5fd", "#fb923c", "#5eead4", "#f472b6", "#a3e635", "#818cf8"];
      // Cache color map on tb so it's computed once per data load, not per frame
      if (!tb._colorMap) {
        tb._colorMap = {};
        let _ci = 0;
        for (const f of tb.frames) {
          for (const o of (f.o || [])) {
            if (!tb._colorMap[o.k]) { tb._colorMap[o.k] = TB_COLORS[_ci % TB_COLORS.length]; _ci++; }
          }
        }
      }
      const _colorMap = tb._colorMap;
      // Friendly label helper — strips entity:, ble:, sensor., device_tracker. prefixes
      const _friendlyLabel = (o) => {
        const raw = o.n || o.k || "?";
        return raw.replace(/^entity:/, "").replace(/^ble:/, "").replace(/^sensor\./, "").replace(/^device_tracker\./, "").replace(/_/g, " ").substring(0, 16);
      };

      // ── Trail: connected lines + fading dots showing recent path ──
      const trailLen = Math.min(12, frameIdx);
      const trailStart = Math.max(0, frameIdx - trailLen);
      // Build per-object trail paths: { key: [ {x,y,room,ti} ... ] }
      const _trails = {};
      for (let ti = trailStart; ti <= frameIdx; ti++) {
        const tf = tb.frames[ti];
        for (const to of (tf.o || [])) {
          if (_scannerSrcSet.has(String(to.k || "").toUpperCase())) continue;
          if (_hideStatic && tb._staticKeys && tb._staticKeys.has(to.k) && to.k !== tb.filterKey) continue;
          const _tpos = _getObjPos(to);
          if (!_tpos) continue;
          if (!_trails[to.k]) _trails[to.k] = [];
          _trails[to.k].push({ x: _tpos[0], y: _tpos[1], room: to.r, ti });
        }
      }
      // Draw trail lines with animated arrows showing movement direction
      for (const [key, trail] of Object.entries(_trails)) {
        const col = _colorMap[key] || "#fbbf24";
        if (trail.length >= 2) {
          for (let j = 1; j < trail.length; j++) {
            if (trail[j].room !== trail[j - 1].room) {
              const fade = 0.15 + 0.4 * ((trail[j].ti - trailStart) / Math.max(1, trailLen));
              const x1 = trail[j-1].x, y1 = trail[j-1].y;
              const x2 = trail[j].x, y2 = trail[j].y;
              const dx = x2 - x1, dy = y2 - y1;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len < 5) continue;
              const ux = dx / len, uy = dy / len;

              // Glowing trail line (faint background)
              s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="4" opacity="${(fade * 0.2).toFixed(2)}" stroke-linecap="round"/>`;
              // Main trail line with animated dash (marching ants effect)
              s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="2" stroke-dasharray="8,6" opacity="${fade.toFixed(2)}" stroke-linecap="round">`;
              s += `<animate attributeName="stroke-dashoffset" values="0;-28" dur="0.8s" repeatCount="indefinite"/>`;
              s += `</line>`;

              // Animated arrow that travels along the path
              const arrowSize = 6;
              // Arrow polygon centered at origin, pointing right
              const ap = `0,0 ${-arrowSize},${ arrowSize * 0.6} ${-arrowSize},${-arrowSize * 0.6}`;
              const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
              s += `<g opacity="${Math.min(0.9, fade + 0.2).toFixed(2)}">`;
              // Arrow travels from start to end repeatedly
              s += `<polygon points="${ap}" fill="${col}">`;
              s += `<animateMotion dur="1.2s" repeatCount="indefinite" path="M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}" rotate="auto"/>`;
              s += `</polygon>`;
              s += `</g>`;

              // Static arrowhead at destination (always visible)
              const tipX = x2 - ux * 3, tipY = y2 - uy * 3;
              const bx = tipX - ux * 10, by = tipY - uy * 10;
              s += `<polygon points="${tipX.toFixed(1)},${tipY.toFixed(1)} ${(bx - uy*6).toFixed(1)},${(by + ux*6).toFixed(1)} ${(bx + uy*6).toFixed(1)},${(by - ux*6).toFixed(1)}" fill="${col}" opacity="${fade.toFixed(2)}"/>`;
            }
          }
        }
        // Trail dots at previous positions (not current frame)
        for (let j = 0; j < trail.length - 1; j++) {
          const fade = 0.15 + 0.3 * ((trail[j].ti - trailStart) / Math.max(1, trailLen));
          s += `<circle cx="${Math.round(trail[j].x)}" cy="${Math.round(trail[j].y)}" r="5" fill="${col}" opacity="${fade.toFixed(2)}" stroke="#071008" stroke-width="0.8"/>`;
          // Pulse ring on trail dots
          s += `<circle cx="${Math.round(trail[j].x)}" cy="${Math.round(trail[j].y)}" r="5" fill="none" stroke="${col}" stroke-width="1" opacity="${(fade * 0.4).toFixed(2)}">`;
          s += `<animate attributeName="r" values="5;12;5" dur="2s" repeatCount="indefinite"/>`;
          s += `<animate attributeName="opacity" values="${(fade*0.4).toFixed(2)};0;${(fade*0.4).toFixed(2)}" dur="2s" repeatCount="indefinite"/>`;
          s += `</circle>`;
        }
      }

      // ── Current frame objects: BIG prominent markers ──
      for (const o of objs) {
        const pos = _getObjPos(o);
        if (!pos) continue;
        const idx = (_roomCount[o.r] || 0);
        _roomCount[o.r] = idx + 1;
        const angle = idx * 2.0;
        const radius = 8 + idx * 8;
        const offX = Math.cos(angle) * Math.min(radius, 45);
        const offY = Math.sin(angle) * Math.min(radius, 30);
        const px = Math.round(pos[0] + offX);
        const py = Math.round(pos[1] + offY);
        const col = _colorMap[o.k] || "#fbbf24";
        const lbl = _friendlyLabel(o);
        const tip = `${lbl} | Room: ${o.r}${o.rssi ? " | RSSI: " + o.rssi + " dBm" : ""}`;

        // Outer glow ring (pulsing)
        s += `<circle cx="${px}" cy="${py}" r="26" fill="none" stroke="${col}" stroke-width="2" opacity="0.35">`;
        s += `<animate attributeName="r" values="22;28;22" dur="1.8s" repeatCount="indefinite"/>`;
        s += `<animate attributeName="opacity" values="0.35;0.15;0.35" dur="1.8s" repeatCount="indefinite"/>`;
        s += `</circle>`;
        // Solid glow halo
        s += `<circle cx="${px}" cy="${py}" r="20" fill="${col}" opacity="0.12"/>`;
        // Main marker — big solid circle
        s += `<circle cx="${px}" cy="${py}" r="14" fill="${col}" stroke="#071008" stroke-width="2" opacity="0.95"/>`;
        // Inner dot
        s += `<circle cx="${px}" cy="${py}" r="4" fill="#071008" opacity="0.7"/>`;
        // Label background — bigger, more readable
        const lblW = Math.min(lbl.length * 7 + 14, 130);
        s += `<rect x="${px - lblW / 2}" y="${py - 34}" width="${lblW}" height="18" rx="4" fill="#071008" stroke="${col}" stroke-width="1" opacity="0.9"/>`;
        s += `<text x="${px}" y="${py - 21}" text-anchor="middle" fill="${col}" font-size="12" font-weight="700">${_esc(lbl)}</text>`;
        // Room label below
        const roomLbl = o.r.substring(0, 18);
        const roomW = Math.min(roomLbl.length * 6 + 10, 120);
        s += `<rect x="${px - roomW / 2}" y="${py + 16}" width="${roomW}" height="14" rx="3" fill="#071008" opacity="0.75"/>`;
        s += `<text x="${px}" y="${py + 27}" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="500">${_esc(roomLbl)}</text>`;
      }
    }

    // ── Timestamp + progress bar overlay ──
    if (tb.frames.length && frameIdx >= 0 && frameIdx < tb.frames.length) {
      const ts = tb.frames[frameIdx].ts;
      const timeStr = _fmtDate(ts);
      // Large time badge top-right
      s += `<rect x="${W - 230}" y="${viewY + 4}" width="226" height="28" rx="6" fill="#071008" stroke="#fbbf24" stroke-width="1" opacity="0.9"/>`;
      s += `<text x="${W - 117}" y="${viewY + 23}" text-anchor="middle" fill="#fbbf24" font-size="16" font-weight="700" font-family="monospace">${_esc(timeStr)}</text>`;
      // Frame counter top-left
      const frameTxt = `${frameIdx + 1} / ${tb.frames.length}`;
      s += `<rect x="4" y="${viewY + 4}" width="100" height="22" rx="4" fill="#071008" opacity="0.8"/>`;
      s += `<text x="54" y="${viewY + 19}" text-anchor="middle" fill="#94a3b8" font-size="11" font-weight="600" font-family="monospace">${frameTxt}</text>`;
      // Progress bar at bottom of map area
      const barY = BASE_H - 6;
      const barW = W - 20;
      const progress = tb.frames.length > 1 ? frameIdx / (tb.frames.length - 1) : 0;
      s += `<rect x="10" y="${barY}" width="${barW}" height="4" rx="2" fill="#1b3526" opacity="0.8"/>`;
      s += `<rect x="10" y="${barY}" width="${Math.round(barW * progress)}" height="4" rx="2" fill="#fbbf24" opacity="0.9"/>`;
      // Playhead indicator
      const phX = 10 + Math.round(barW * progress);
      s += `<circle cx="${phX}" cy="${barY + 2}" r="6" fill="#fbbf24" stroke="#071008" stroke-width="1.5"/>`;
    }

    // Legend — compact single row (matches overview)
    s += `<line x1="10" y1="${BASE_H + 4}" x2="${W - 10}" y2="${BASE_H + 4}" stroke="#1b3526" stroke-width="0.8"/>`;
    {
      const ly = BASE_H + 10;
      let lx = 12;
      sortedIsoLevels.forEach((z, i) => {
        const color = levelColor(z);
        const groupLabel = byLevel.get(z).map(m => m.name || m.id).join("+");
        s += `<circle cx="${lx+7}" cy="${ly+7}" r="7" fill="${color}" opacity="0.9"/>`;
        s += `<text x="${lx+7}" y="${ly+10}" text-anchor="middle" fill="#071008" font-size="9" font-weight="700">${i+1}</text>`;
        s += `<text x="${lx+18}" y="${ly+10}" fill="${color}" font-size="11" font-weight="500">${_esc(groupLabel)}</text>`;
        lx += 22 + groupLabel.length * 6;
        if (i < sortedIsoLevels.length - 1) {
          s += `<text x="${lx}" y="${ly+10}" fill="#4a6052" font-size="10">\u00B7</text>`;
          lx += 10;
        }
      });
    }

    s += `</svg>`;
    return s;
  }

  // ── Discovery SVG builder ──────────────────────────────────────────────
  // Renders the same iso map but plots discovered objects instead of playback frames.
  // Each object gets a data-disco attribute for click handling.
  function _buildDiscoverySVG(results) {
    const maxIsoZ = sortedIsoLevels.length ? sortedIsoLevels[sortedIsoLevels.length - 1] : 0;
    const viewY = Math.min(0, CY - maxIsoZ * _ovFG - 50);
    const HTOTAL = BASE_H + LEGEND_H - viewY;
    let s = `<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
    s += `<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

    // Defs — reuse same patterns
    s += `<defs>`;
    sortedIsoLevels.forEach((z2, li) => {
      const c2 = levelColor(z2);
      if(li === 0){
        s += `<pattern id="dpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
        s += `<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.14"/>`;
        s += `<circle cx="12" cy="15" r="1.4" fill="${c2}" opacity="0.1"/>`;
        s += `</pattern>`;
      } else if(li === 1){
        s += `<pattern id="dpat_${li}" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">`;
        s += `<rect x="2" y="2" width="7" height="16" rx="1" fill="none" stroke="${c2}" stroke-width="0.5" opacity="0.13"/>`;
        s += `<rect x="11" y="2" width="7" height="16" rx="1" fill="none" stroke="${c2}" stroke-width="0.5" opacity="0.13"/>`;
        s += `</pattern>`;
      } else if(li === 2){
        s += `<pattern id="dpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
        s += `<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
        s += `</pattern>`;
      } else {
        s += `<pattern id="dpat_${li}" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">`;
        s += `<circle cx="8" cy="8" r="2" fill="none" stroke="${c2}" stroke-width="0.5" opacity="0.15"/>`;
        s += `</pattern>`;
      }
    });
    s += `</defs>`;

    // Floor slabs + room polygons (same as playback)
    for (const [z, group] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      const isFocused = focusZ === null || (Array.isArray(focusZ) ? focusZ.includes(z) : focusZ === z);
      const go = isFocused ? 0.7 : 0.08;
      const lyrColor = levelColor(z);
      const lidx = sortedIsoLevels.indexOf(z);

      let x0 = Infinity, y0_ = Infinity, x1 = -Infinity, y1_ = -Infinity;
      for (const m of group) {
        const bbPt = makeStackXform(m.stack, imageAr(m)).mapPt;
        for (const [cx2, cy2] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const [wx, wy] = bbPt(cx2, cy2); x0 = Math.min(x0, wx); y0_ = Math.min(y0_, wy); x1 = Math.max(x1, wx); y1_ = Math.max(y1_, wy); }
      }
      if (!isFinite(x0)) { x0 = 0; y0_ = 0; x1 = 1; y1_ = 0.75; }
      const TL = iso(x0, y0_, z), TR = iso(x1, y0_, z), BR = iso(x1, y1_, z), BL = iso(x0, y1_, z);
      s += `<g opacity="${go}">`;
      s += `<polygon points="${pts([TL, TR, BR, BL])}" fill="url(#dpat_${lidx})" stroke="${lyrColor}" stroke-width="1.2" stroke-dasharray="10,5" opacity="0.5"/>`;

      for (const m of group) {
        const mapPt = makeStackXform(m.stack, imageAr(m)).mapPt;
        for (const [room, b] of Object.entries(m.room_bounds || {})) {
          if (!b || b.type !== "poly" || !Array.isArray(b.points) || b.points.length < 3) continue;
          const color = roomColorFn(room);
          const pp = b.points.map(p => { const [wx, wy] = mapPt(p[0], p[1]); return pt(iso(wx, wy, z)); }).join(" ");
          s += `<polygon points="${pp}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.2" opacity="0.85"/>`;
          const ccx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
          const ccy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
          const [lwx, lwy] = mapPt(ccx, ccy);
          const [lix, liy] = iso(lwx, lwy, z);
          s += `<text x="${Math.round(lix)}" y="${Math.round(liy)}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="9" font-weight="600" opacity="0.85">${_esc(room)}</text>`;
        }
      }
      s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="12" fill="${lyrColor}" opacity="0.7"/>`;
      s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1]) + 5}" text-anchor="middle" fill="#071008" font-size="11" font-weight="700">${lidx + 1}</text>`;
      s += `</g>`;
    }

    // Overlay: discovered objects at their room positions
    // Objects with a valid room go to that room's iso position.
    // Objects without a room (common for new/unidentified BLE) go to an
    // "unplaced" floating cluster so they're still visible on the map.
    const DISCO_COLORS = ["#e879f9", "#60a5fa", "#f87171", "#34d399", "#fbbf24", "#fb923c", "#5eead4", "#f472b6", "#a3e635", "#818cf8"];
    const _roomCount = {};
    let unplacedCount = 0;

    // Try to resolve room from source scanner's area if obj.room is missing
    const _radioAreaMap = {};
    for (const r of ((liveSnap?.ble?.radios) || [])) {
      if (r.source && r.area_name) _radioAreaMap[r.source] = r.area_name;
      if (r.name && r.area_name) _radioAreaMap[r.name] = r.area_name;
    }

    const _resolveRoom = (obj) => {
      // 1. Direct room field
      if (obj.room && obj.room !== "unknown" && obj.room !== "not_home") return obj.room;
      // 2. Try to get room from strongest source scanner
      const sources = obj.sources || [];
      for (const src of sources) {
        const srcName = typeof src === "string" ? src : (src.source || "");
        if (srcName && _radioAreaMap[srcName]) return _radioAreaMap[srcName];
      }
      if (obj.source && _radioAreaMap[obj.source]) return _radioAreaMap[obj.source];
      return null;
    };

    // Unplaced cluster position — above the top-left of the map
    const unplacedBaseX = 80;
    const unplacedBaseY = viewY + 50;

    for (let di = 0; di < results.length; di++) {
      const obj = results[di];
      const room = _resolveRoom(obj);
      let px, py;

      const _rPos = room ? (_getObjPos({r: room}) || null) : null;
      if (_rPos) {
        const pos = _rPos;
        const idx = (_roomCount[room] || 0);
        _roomCount[room] = idx + 1;
        const angle = idx * 2.4;
        const radius = 6 + idx * 5;
        px = Math.round(pos[0] + Math.cos(angle) * Math.min(radius, 35));
        py = Math.round(pos[1] + Math.sin(angle) * Math.min(radius, 22));
      } else {
        // Unplaced: arrange in a grid cluster
        const col2 = unplacedCount % 6;
        const row2 = Math.floor(unplacedCount / 6);
        px = unplacedBaseX + col2 * 80;
        py = unplacedBaseY + row2 * 40;
        unplacedCount++;
      }

      const col = DISCO_COLORS[di % DISCO_COLORS.length];
      const isSelected = tb.discoSelected === (obj.key || obj.address);
      const lbl = (obj.user_label || obj.name || obj.address || "?").substring(0, 14);
      const kindBadge = obj.kind === "ibeacon" ? "iB" : obj.kind === "private_ble" ? "pBLE" : obj.kind === "entity" ? "ent" : "BLE";

      // Glow ring for selected
      if (isSelected) {
        s += `<circle cx="${px}" cy="${py}" r="22" fill="none" stroke="${col}" stroke-width="2" opacity="0.6">`;
        s += `<animate attributeName="r" values="18;24;18" dur="1.5s" repeatCount="indefinite"/>`;
        s += `</circle>`;
      }
      s += `<g data-disco="${di}" style="cursor:pointer">`;
      s += `<circle cx="${px}" cy="${py}" r="18" fill="${col}" opacity="0.12" pointer-events="all"/>`;
      s += `<circle cx="${px}" cy="${py}" r="10" fill="${col}" stroke="#071008" stroke-width="1.5" opacity="0.95" pointer-events="all"/>`;
      s += `<text x="${px}" y="${py + 3}" text-anchor="middle" fill="#071008" font-size="6" font-weight="700" pointer-events="none">${kindBadge}</text>`;
      const lblW = Math.min(lbl.length * 5.5 + 10, 100);
      s += `<rect x="${px - lblW / 2}" y="${py - 26}" width="${lblW}" height="14" rx="3" fill="#071008" opacity="0.85" pointer-events="all"/>`;
      s += `<text x="${px}" y="${py - 16}" text-anchor="middle" fill="${col}" font-size="9" font-weight="700" pointer-events="none">${_esc(lbl)}</text>`;
      s += `</g>`;
    }

    // Unplaced label
    if (unplacedCount > 0) {
      s += `<text x="${unplacedBaseX}" y="${unplacedBaseY - 14}" fill="#94a3b8" font-size="10" font-weight="600">Unplaced (${unplacedCount})</text>`;
    }

    // Count badge
    const placedCount = results.length - unplacedCount;
    if (results.length) {
      const badgeW = 240;
      s += `<rect x="6" y="${viewY + 4}" width="${badgeW}" height="22" rx="4" fill="#071008" opacity="0.85"/>`;
      const badgeTxt = placedCount === results.length
        ? `${results.length} new object${results.length !== 1 ? "s" : ""} discovered`
        : `${results.length} discovered (${placedCount} placed, ${unplacedCount} unplaced)`;
      s += `<text x="${badgeW / 2 + 6}" y="${viewY + 19}" text-anchor="middle" fill="#e879f9" font-size="11" font-weight="700">${badgeTxt}</text>`;
    }

    // Legend
    s += `<line x1="10" y1="${BASE_H + 4}" x2="${W - 10}" y2="${BASE_H + 4}" stroke="#1b3526" stroke-width="0.8"/>`;
    {
      const ly = BASE_H + 10;
      let lx = 12;
      sortedIsoLevels.forEach((z, i) => {
        const color = levelColor(z);
        const groupLabel = byLevel.get(z).map(m => m.name || m.id).join("+");
        s += `<circle cx="${lx+7}" cy="${ly+7}" r="7" fill="${color}" opacity="0.9"/>`;
        s += `<text x="${lx+7}" y="${ly+10}" text-anchor="middle" fill="#071008" font-size="9" font-weight="700">${i+1}</text>`;
        s += `<text x="${lx+18}" y="${ly+10}" fill="${color}" font-size="11" font-weight="500">${_esc(groupLabel)}</text>`;
        lx += 22 + groupLabel.length * 6;
        if (i < sortedIsoLevels.length - 1) {
          s += `<text x="${lx}" y="${ly+10}" fill="#4a6052" font-size="10">\u00B7</text>`;
          lx += 10;
        }
      });
    }
    s += `</svg>`;
    return s;
  }

  // ── Discovery search ────────────────────────────────────────────────────
  function _runDiscoverySearch() {
    const nowTs = Date.now() / 1000;
    const fromMin = Math.max(tb.discoFromMin, tb.discoToMin);
    const toMin = Math.min(tb.discoFromMin, tb.discoToMin);
    const startTs = nowTs - (fromMin * 60);
    const endTs = nowTs - (toMin * 60);

    const allObjs = liveSnap?.objects?.list || [];
    const results = allObjs.filter(o => {
      if (!o.first_seen) return false;
      const fs = new Date(o.first_seen).getTime() / 1000;
      return fs >= startTs && fs <= endTs;
    });
    // Sort newest first
    results.sort((a, b) => {
      const fa = new Date(a.first_seen).getTime();
      const fb = new Date(b.first_seen).getTime();
      return fb - fa;
    });
    tb.discoResults = results;
    tb.discoSelected = null;
  }

  // ── Map display div ────────────────────────────────────────────────────
  const mapDiv = document.createElement("div");
  mapDiv.style.cssText = "overflow:auto;border-radius:8px;background:#071008;padding:8px;margin-bottom:10px";

  // ── Playback helpers ───────────────────────────────────────────────────
  // ── Static base SVG (built once — maps, rooms, receivers) ──────────────
  let _staticBase = null;
  let _overlayDiv = null;
  function _ensureStaticBase() {
    if (_staticBase) return;
    _staticBase = _buildStaticSVG();
  }

  function _buildStaticSVG() {
    const maxIsoZ = sortedIsoLevels.length ? sortedIsoLevels[sortedIsoLevels.length - 1] : 0;
    const viewY = Math.min(0, CY - maxIsoZ * _ovFG - 50);
    const HTOTAL = BASE_H + LEGEND_H - viewY;
    // Build just the static layers (defs + floor slabs + rooms + receivers)
    const full = _buildTracebackSVG(-1); // -1 = no frame overlay
    return { svg: full, viewY, HTOTAL };
  }

  function _renderFrame() {
    if (!tb.frames.length) {
      mapDiv.innerHTML = `<div style="text-align:center;padding:40px;color:#64748b;font-size:14px">No traceback frames loaded. Select a time range and press Play.</div>`;
      return;
    }
    if (!_staticBase || !_overlayDiv) {
      // First render: build static base SVG (no overlay), then inject overlay via <g>
      mapDiv.innerHTML = _buildTracebackSVG(-1);
      _staticBase = true;
      const svgEl = mapDiv.querySelector("svg");
      if (svgEl) {
        _overlayDiv = document.createElementNS("http://www.w3.org/2000/svg", "g");
        _overlayDiv.setAttribute("id", "tb-overlay");
        svgEl.appendChild(_overlayDiv);
      }
      // Immediately populate the overlay with current frame content
      if (_overlayDiv) {
        const dynSvg = _buildDynamicOverlay(tb.frameIdx);
        if (dynSvg) {
          const tmp = document.createElement("div");
          tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${dynSvg}</svg>`;
          const tmpSvg = tmp.querySelector("svg");
          if (tmpSvg) {
            while (tmpSvg.firstChild) _overlayDiv.appendChild(tmpSvg.firstChild);
          }
        }
      }
    } else {
      // Fast path: only rebuild the dynamic overlay (trails + objects)
      if (_overlayDiv) {
        // Remove old overlay content
        while (_overlayDiv.firstChild) _overlayDiv.removeChild(_overlayDiv.firstChild);
        // Build just the dynamic part as a temporary SVG, extract its children
        const dynSvg = _buildDynamicOverlay(tb.frameIdx);
        if (dynSvg) {
          const tmp = document.createElement("div");
          tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${dynSvg}</svg>`;
          const tmpSvg = tmp.querySelector("svg");
          if (tmpSvg) {
            while (tmpSvg.firstChild) _overlayDiv.appendChild(tmpSvg.firstChild);
          }
        }
      }
    }
  }

  // Reset static base when focus/params change
  function _resetStaticBase() {
    _staticBase = null;
    _overlayDiv = null;
  }

  // Build ONLY the dynamic overlay (trails + current-frame objects) as SVG fragment
  function _buildDynamicOverlay(frameIdx) {
    if (!tb.frames.length || frameIdx < 0 || frameIdx >= tb.frames.length) return "";
    // Reuse the full builder but extract just the overlay portion
    // by building the full SVG and stripping the static prefix.
    // This is still faster than innerHTML on the full SVG because
    // we only insert into the existing DOM tree, not reparse it all.
    const full = _buildTracebackSVG(frameIdx);
    // The overlay starts after the static marker comment (or after the last </g> of floor slabs)
    // For simplicity, just return the trail + object portion.
    // We know the static part ends with the floor legend, and the dynamic part follows.
    // Since full rebuild is fast (string ops), the perf gain comes from NOT reparsing
    // the entire SVG DOM — we only update the <g id="tb-overlay"> contents.
    const marker = "<!-- TB_OVERLAY_START -->";
    const idx = full.indexOf(marker);
    if (idx < 0) return "";
    const end = full.lastIndexOf("</svg>");
    if (end < 0) return "";
    return full.substring(idx + marker.length, end);
  }

  function _updateScrubber() {
    const scrubber = ctrlCard.querySelector('#tb-scrubber');
    if (scrubber) scrubber.value = String(tb.frameIdx);
    _updateTimeLbl();
  }

  function _updateTimeLbl() {
    const timeLbl = ctrlCard.querySelector("#tb-time-lbl");
    if (timeLbl && tb.frames[tb.frameIdx]) {
      timeLbl.textContent = _fmtDate(tb.frames[tb.frameIdx].ts);
    }
    const progLbl = ctrlCard.querySelector("#tb-progress-lbl");
    if (progLbl) progLbl.textContent = `${tb.frameIdx + 1} / ${tb.frames.length}`;
  }

  function _startPlayback() {
    if (tb._animTimer) cancelAnimationFrame(tb._animTimer);
    tb.playing = true;
    tb._playStartTs = performance.now();
    tb._playStartFrame = tb.frameIdx;
    const totalFrames = tb.frames.length;
    const msPerFrame = Math.max(16, (tb.playDurationS * 1000) / totalFrames);

    function _tick(now) {
      if (!tb.playing) return;
      const elapsed = now - tb._playStartTs;
      const targetFrame = tb._playStartFrame + Math.floor(elapsed / msPerFrame);
      if (targetFrame >= totalFrames - 1) {
        tb.frameIdx = totalFrames - 1;
        _renderFrame();
        _updateScrubber();
        _stopPlayback();
        _buildControls();
        return;
      }
      if (targetFrame > tb.frameIdx) {
        tb.frameIdx = targetFrame;
        _renderFrame();
        _updateScrubber();
      }
      tb._animTimer = requestAnimationFrame(_tick);
    }
    tb._animTimer = requestAnimationFrame(_tick);
  }

  function _stopPlayback() {
    tb.playing = false;
    if (tb._animTimer) { cancelAnimationFrame(tb._animTimer); tb._animTimer = null; }
  }

  // ── Controls card ──────────────────────────────────────────────────────
  const ctrlCard = document.createElement("div");
  ctrlCard.className = "card";
  ctrlCard.style.cssText = "border-color:#92400e;background:#0f0a00";

  function _buildControls() {
    ctrlCard.innerHTML = "";

    // Header
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap";
    const title = document.createElement("span");
    title.style.cssText = "font-weight:700;font-size:15px;color:#fbbf24";
    title.textContent = "Traceback Playback";
    hdr.appendChild(title);
    hdr.appendChild(ctx.helpers.helpBtn("traceback_overview"));
    ctrlCard.appendChild(hdr);

    // Range preset buttons
    const rangeRow = document.createElement("div");
    rangeRow.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px";
    const rangeLbl = document.createElement("span");
    rangeLbl.style.cssText = "font-size:12px;color:#94a3b8";
    rangeLbl.textContent = "Time range:";
    rangeRow.appendChild(rangeLbl);

    const presets = [
      { label: "5 min", s: 300 }, { label: "15 min", s: 900 }, { label: "30 min", s: 1800 },
      { label: "1 hr", s: 3600 }, { label: "4 hr", s: 14400 }, { label: "12 hr", s: 43200 },
      { label: "1 day", s: 86400 }, { label: "3 days", s: 259200 }, { label: "7 days", s: 604800 },
    ];
    for (const p of presets) {
      const btn = document.createElement("button");
      btn.className = "btn inline";
      const isActive = tb.rangePreset === p.s;
      btn.style.cssText = isActive
        ? "font-size:11px;padding:2px 8px;background:#92400e;color:#fbbf24;border-color:#fbbf24;font-weight:700"
        : "font-size:11px;padding:2px 8px;color:#94a3b8";
      btn.textContent = p.label;
      btn.addEventListener("click", async () => {
        _stopPlayback();
        tb.rangePreset = p.s;
        tb.startTs = null;
        tb.endTs = null;
        await _loadTracebackData();
        _buildControls();
        _renderFrame();
      });
      rangeRow.appendChild(btn);
    }
    // Custom minutes input
    const _customInput = document.createElement("input");
    _customInput.type = "number"; _customInput.min = "1"; _customInput.max = "99999"; _customInput.step = "1";
    _customInput.placeholder = "min";
    _customInput.style.cssText = "width:55px;padding:2px 6px;border:1px solid #334155;border-radius:4px;background:#1e293b;color:#e2e8f0;font-size:10px";
    const _customBtn = document.createElement("button");
    _customBtn.className = "btn inline";
    _customBtn.style.cssText = "font-size:10px;padding:2px 8px;color:#94a3b8";
    _customBtn.textContent = "Go";
    _customBtn.addEventListener("click", async () => {
      const v = parseInt(_customInput.value);
      if (v && v > 0) {
        _stopPlayback();
        tb.rangePreset = v * 60;
        tb.startTs = null; tb.endTs = null;
        await _loadTracebackData();
        _buildControls(); _renderFrame();
      }
    });
    rangeRow.appendChild(_customInput);
    rangeRow.appendChild(_customBtn);
    ctrlCard.appendChild(rangeRow);

    // Specific date/time pickers
    const dtRow = document.createElement("div");
    dtRow.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px";
    const dtLbl = document.createElement("span");
    dtLbl.style.cssText = "font-size:12px;color:#94a3b8";
    dtLbl.textContent = "Custom range:";
    dtRow.appendChild(dtLbl);

    const _toLocalISO = (ts) => {
      const d = new Date(ts * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const _dtStyle = "background:#071008;color:#e2e8f0;border:1px solid #2d6a4f;border-radius:4px;padding:3px 6px;font-size:11px";

    const startInput = document.createElement("input");
    startInput.type = "datetime-local";
    startInput.style.cssText = _dtStyle;
    const now = Date.now() / 1000;
    startInput.value = _toLocalISO(tb.startTs || (now - tb.rangePreset));
    dtRow.appendChild(startInput);

    const toSpan = document.createElement("span");
    toSpan.style.cssText = "font-size:12px;color:#64748b";
    toSpan.textContent = "to";
    dtRow.appendChild(toSpan);

    const endInput = document.createElement("input");
    endInput.type = "datetime-local";
    endInput.style.cssText = _dtStyle;
    endInput.value = _toLocalISO(tb.endTs || now);
    dtRow.appendChild(endInput);

    const dtGoBtn = document.createElement("button");
    dtGoBtn.className = "btn inline";
    dtGoBtn.style.cssText = "font-size:11px;padding:3px 12px;color:#fbbf24;border-color:#92400e;font-weight:600";
    dtGoBtn.textContent = "Load";
    dtGoBtn.addEventListener("click", async () => {
      const sVal = startInput.value, eVal = endInput.value;
      if (!sVal || !eVal) return;
      _stopPlayback();
      tb.startTs = new Date(sVal).getTime() / 1000;
      tb.endTs = new Date(eVal).getTime() / 1000;
      tb.rangePreset = Math.round(tb.endTs - tb.startTs);
      await _loadTracebackData();
      _resetStaticBase();
      _buildControls();
      _renderFrame();
    });
    dtRow.appendChild(dtGoBtn);
    ctrlCard.appendChild(dtRow);

    // Object filter
    const filterRow = document.createElement("div");
    filterRow.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px";
    const filterLbl = document.createElement("span");
    filterLbl.style.cssText = "font-size:12px;color:#94a3b8";
    filterLbl.textContent = "Object:";
    filterRow.appendChild(filterLbl);

    const filterSelect = document.createElement("select");
    filterSelect.style.cssText = "background:#071008;color:#e2e8f0;border:1px solid #2d6a4f;border-radius:4px;padding:3px 8px;font-size:12px;max-width:280px";
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "All objects";
    if (!tb.filterKey) allOpt.selected = true;
    filterSelect.appendChild(allOpt);

    const _tbScannerSet = new Set(((ctx.state.live?.snapshot?.ble?.radios) || []).map(r => String(r.source || "").toUpperCase()).filter(Boolean));
    const byKind = {};
    for (const obj of tb.objKeys) {
      // Hide scanners — they're infrastructure, not trackable devices
      if (_tbScannerSet.has(String(obj.key || "").toUpperCase())) continue;
      const kind = obj.kind || "other";
      if (!byKind[kind]) byKind[kind] = [];
      byKind[kind].push(obj);
    }
    const _cleanName = (n) => (n || "").replace(/^entity:/, "").replace(/^ble:/, "").replace(/^sensor\./, "").replace(/^device_tracker\./, "").replace(/_/g, " ");
    for (const [kind, items] of Object.entries(byKind).sort()) {
      const grp = document.createElement("optgroup");
      grp.label = kind === "ble" ? "BLE Devices" : kind === "entity" ? "HA Entities" : kind === "ibeacon" ? "iBeacons" : kind === "private_ble" ? "Private BLE" : kind;
      for (const item of items.sort((a, b) => (a.name || "").localeCompare(b.name || ""))) {
        const opt = document.createElement("option");
        opt.value = item.key;
        opt.textContent = _cleanName(item.name || item.key);
        if (tb.filterKey === item.key) opt.selected = true;
        grp.appendChild(opt);
      }
      filterSelect.appendChild(grp);
    }
    filterSelect.addEventListener("change", async () => {
      _stopPlayback();
      tb.filterKey = filterSelect.value || null;
      tb.filterName = filterSelect.options[filterSelect.selectedIndex]?.textContent || "All objects";
      await _loadTracebackData();
      _buildControls();
      _renderFrame();
    });
    filterRow.appendChild(filterSelect);

    const infoLbl = document.createElement("span");
    infoLbl.style.cssText = "font-size:11px;color:#64748b;margin-left:auto";
    if (tb.frames.length) {
      const rangeNote = tb._autoExpanded ? "auto-expanded to full range" : `${_fmtDuration(tb.rangePreset)} window`;
      infoLbl.textContent = `${tb.frames.length} frames | ${rangeNote}`;
    } else {
      infoLbl.textContent = tb.filterKey ? "No data for this object" : "No data in range";
    }
    filterRow.appendChild(infoLbl);
    ctrlCard.appendChild(filterRow);

    if (!tb.frames.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "text-align:center;padding:20px;color:#64748b;font-size:13px";
      if (tb.filterKey) {
        empty.textContent = `No traceback data found for "${tb.filterName}". This object may not have been seen recently or may not be identified/followed. Only identified and followed objects are recorded.`;
      } else {
        empty.textContent = "No traceback data in this time range. Only identified and followed objects are recorded (~10s intervals). Try a longer time range or check back after some time.";
      }
      ctrlCard.appendChild(empty);
      return;
    }

    // Transport controls
    const transport = document.createElement("div");
    transport.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap";

    // Rewind
    const rewBtn = document.createElement("button");
    rewBtn.className = "btn inline";
    rewBtn.style.cssText = "font-size:14px;padding:2px 8px;color:#fbbf24";
    rewBtn.innerHTML = "&#9198;";
    rewBtn.title = "Jump to start";
    rewBtn.addEventListener("click", () => { tb.frameIdx = 0; _renderFrame(); _updateScrubber(); });
    transport.appendChild(rewBtn);

    // Step back
    const stepBackBtn = document.createElement("button");
    stepBackBtn.className = "btn inline";
    stepBackBtn.style.cssText = "font-size:14px;padding:2px 8px;color:#fbbf24";
    stepBackBtn.innerHTML = "&#124;&#9664;";
    stepBackBtn.title = "Previous frame";
    stepBackBtn.addEventListener("click", () => {
      if (tb.frameIdx > 0) { tb.frameIdx--; _renderFrame(); _updateScrubber(); }
    });
    transport.appendChild(stepBackBtn);

    // Play/Pause
    const playBtn = document.createElement("button");
    playBtn.className = "btn inline";
    playBtn.style.cssText = tb.playing
      ? "font-size:16px;padding:3px 12px;background:#92400e;color:#fbbf24;border-color:#fbbf24;font-weight:700"
      : "font-size:16px;padding:3px 12px;color:#fbbf24;border-color:#92400e";
    playBtn.innerHTML = tb.playing ? "&#9646;&#9646;" : "&#9654;";
    playBtn.title = tb.playing ? "Pause" : "Play";
    playBtn.addEventListener("click", () => {
      if (tb.playing) { _stopPlayback(); } else { _startPlayback(); }
      _buildControls();
    });
    transport.appendChild(playBtn);

    // Step forward
    const stepFwdBtn = document.createElement("button");
    stepFwdBtn.className = "btn inline";
    stepFwdBtn.style.cssText = "font-size:14px;padding:2px 8px;color:#fbbf24";
    stepFwdBtn.innerHTML = "&#9654;&#124;";
    stepFwdBtn.title = "Next frame";
    stepFwdBtn.addEventListener("click", () => {
      if (tb.frameIdx < tb.frames.length - 1) { tb.frameIdx++; _renderFrame(); _updateScrubber(); }
    });
    transport.appendChild(stepFwdBtn);

    // Jump to end
    const endBtn = document.createElement("button");
    endBtn.className = "btn inline";
    endBtn.style.cssText = "font-size:14px;padding:2px 8px;color:#fbbf24";
    endBtn.innerHTML = "&#9197;";
    endBtn.title = "Jump to end";
    endBtn.addEventListener("click", () => { tb.frameIdx = tb.frames.length - 1; _renderFrame(); _updateScrubber(); });
    transport.appendChild(endBtn);

    // Run time slider (1 min to 60 min)
    const rtWrap = document.createElement("span");
    rtWrap.style.cssText = "display:flex;align-items:center;gap:6px;margin-left:8px";
    const rtLbl = document.createElement("span");
    rtLbl.style.cssText = "font-size:11px;color:#94a3b8;white-space:nowrap";
    rtLbl.textContent = "Run time:";
    rtWrap.appendChild(rtLbl);

    const rtSlider = document.createElement("input");
    rtSlider.type = "range";
    rtSlider.min = "60";
    rtSlider.max = "3600";
    rtSlider.step = "30";
    rtSlider.value = String(tb.playDurationS);
    rtSlider.style.cssText = "width:100px;accent-color:#fbbf24;cursor:pointer;height:20px";
    rtSlider.title = "How long the full playback takes";

    const rtValLbl = document.createElement("span");
    rtValLbl.style.cssText = "font-size:11px;color:#fbbf24;font-weight:600;min-width:36px;font-family:monospace";
    rtValLbl.textContent = _fmtDuration(tb.playDurationS);

    rtSlider.addEventListener("input", () => {
      tb.playDurationS = parseInt(rtSlider.value, 10);
      rtValLbl.textContent = _fmtDuration(tb.playDurationS);
      if (tb.playing) { _stopPlayback(); _startPlayback(); }
    });
    rtWrap.appendChild(rtSlider);
    rtWrap.appendChild(rtValLbl);
    transport.appendChild(rtWrap);

    // Current time display
    const timeLbl = document.createElement("span");
    timeLbl.id = "tb-time-lbl";
    timeLbl.style.cssText = "font-size:12px;color:#fbbf24;font-weight:600;margin-left:auto;font-family:monospace";
    const curTs = tb.frames[tb.frameIdx]?.ts;
    timeLbl.textContent = curTs ? _fmtDate(curTs) : "--";
    transport.appendChild(timeLbl);

    ctrlCard.appendChild(transport);

    // Timeline scrubber
    const scrubberWrap = document.createElement("div");
    scrubberWrap.style.cssText = "position:relative;margin-bottom:6px";

    const scrubber = document.createElement("input");
    scrubber.id = "tb-scrubber";
    scrubber.type = "range";
    scrubber.min = "0";
    scrubber.max = String(Math.max(0, tb.frames.length - 1));
    scrubber.value = String(tb.frameIdx);
    scrubber.style.cssText = "width:100%;accent-color:#fbbf24;cursor:pointer;height:24px";
    scrubber.addEventListener("input", () => {
      tb.frameIdx = parseInt(scrubber.value, 10);
      _renderFrame();
      _updateTimeLbl();
    });
    scrubberWrap.appendChild(scrubber);

    // Time markers
    const markerRow = document.createElement("div");
    markerRow.style.cssText = "display:flex;justify-content:space-between;font-size:10px;color:#64748b;padding:0 2px";
    const startStr = tb.frames.length ? _fmtDate(tb.frames[0].ts) : "--";
    const endStr = tb.frames.length ? _fmtDate(tb.frames[tb.frames.length - 1].ts) : "--";
    markerRow.appendChild(document.createTextNode(startStr));
    const progLbl = document.createElement("span");
    progLbl.id = "tb-progress-lbl";
    progLbl.style.cssText = "color:#94a3b8";
    progLbl.textContent = `${tb.frameIdx + 1} / ${tb.frames.length}`;
    markerRow.appendChild(progLbl);
    markerRow.appendChild(document.createTextNode(endStr));
    scrubberWrap.appendChild(markerRow);

    ctrlCard.appendChild(scrubberWrap);
  }

  // ── Iso controls (Floor / Spacing / L/R / Save / Reset) ────────────────
  const isoCtrlRow = document.createElement("div");
  isoCtrlRow.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px";

  // Floor focus slider
  const floorLbl = document.createElement("span");
  floorLbl.style.cssText = "font-size:12px;color:#94a3b8";
  floorLbl.textContent = "Floor:";
  isoCtrlRow.appendChild(floorLbl);

  const focusLbl = document.createElement("span");
  focusLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:80px;display:inline-block";
  focusLbl.textContent = _getFocusLbl(ctx.state._overviewIsoFocusIdx);

  const focusSlider = document.createElement("input");
  focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(_isoPos.length-1);
  focusSlider.style.cssText = "width:130px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  focusSlider.value = String(ctx.state._overviewIsoFocusIdx);
  focusSlider.addEventListener("input", ()=>{
    ctx.state._overviewIsoFocusIdx = parseInt(focusSlider.value, 10);
    focusZ = _isoPos[Math.max(0, Math.min(ctx.state._overviewIsoFocusIdx, _isoPos.length-1))];
    focusLbl.textContent = _getFocusLbl(ctx.state._overviewIsoFocusIdx);
    _rebuildRoomPositions();
    _resetStaticBase();
    _renderFrame();
  });
  isoCtrlRow.appendChild(focusSlider);
  isoCtrlRow.appendChild(focusLbl);

  // Spacing slider
  const ovSpacingLbl = document.createElement("span");
  ovSpacingLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
  ovSpacingLbl.textContent = "Spacing:";
  isoCtrlRow.appendChild(ovSpacingLbl);

  const ovGapLbl = document.createElement("span");
  ovGapLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
  ovGapLbl.textContent = String(ctx.state._overviewFloorGap);
  const ovGapSlider = document.createElement("input");
  ovGapSlider.type="range"; ovGapSlider.min="60"; ovGapSlider.max="340"; ovGapSlider.step="10";
  ovGapSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  ovGapSlider.value = String(ctx.state._overviewFloorGap);
  ovGapSlider.addEventListener("input",()=>{
    ctx.state._overviewFloorGap = parseInt(ovGapSlider.value, 10);
    _ovFG = ctx.state._overviewFloorGap;
    ovGapLbl.textContent = String(ctx.state._overviewFloorGap);
    _rebuildRoomPositions();
    _resetStaticBase();
    _renderFrame();
  });
  isoCtrlRow.appendChild(ovGapSlider);
  isoCtrlRow.appendChild(ovGapLbl);

  // L/R horizontal offset slider
  const ovLRLbl = document.createElement("span");
  ovLRLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
  ovLRLbl.textContent = "L/R:";
  isoCtrlRow.appendChild(ovLRLbl);

  const ovHorizLbl = document.createElement("span");
  ovHorizLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
  ovHorizLbl.textContent = String(ctx.state._overviewHorizGap);
  const ovHorizSlider = document.createElement("input");
  ovHorizSlider.type="range"; ovHorizSlider.min="-120"; ovHorizSlider.max="120"; ovHorizSlider.step="10";
  ovHorizSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  ovHorizSlider.value = String(ctx.state._overviewHorizGap);
  ovHorizSlider.addEventListener("input",()=>{
    ctx.state._overviewHorizGap = parseInt(ovHorizSlider.value, 10);
    _ovHG = ctx.state._overviewHorizGap;
    ovHorizLbl.textContent = String(ctx.state._overviewHorizGap);
    _rebuildRoomPositions();
    _resetStaticBase();
    _renderFrame();
  });
  isoCtrlRow.appendChild(ovHorizSlider);
  isoCtrlRow.appendChild(ovHorizLbl);

  // Save button
  const ovSaveLbl = document.createElement("span");
  ovSaveLbl.style.cssText = "font-size:11px;color:#94a3b8;min-width:50px";
  const ovSaveBtn = document.createElement("button");
  ovSaveBtn.className = "btn inline";
  ovSaveBtn.style.cssText = "padding:2px 10px;font-size:12px";
  ovSaveBtn.title = "Save these slider positions so both Overview and Traceback use the same layout";
  ovSaveBtn.textContent = "Save";
  ovSaveBtn.addEventListener("click", async ()=>{
    ovSaveBtn.disabled = true;
    try{
      await ctx.actions.settingsSet({
        overview_iso_floor_gap: ctx.state._overviewFloorGap,
        overview_iso_horiz_gap: ctx.state._overviewHorizGap,
        overview_iso_focus:     ctx.state._overviewIsoFocusIdx,
      });
      ovSaveLbl.textContent = "Saved \u2713";
      setTimeout(()=>{ ovSaveLbl.textContent = ""; }, 2000);
    }catch(e){ ovSaveLbl.textContent = "Error"; }
    ovSaveBtn.disabled = false;
  });

  // Reset button
  const ovResetBtn = document.createElement("button");
  ovResetBtn.className = "btn inline";
  ovResetBtn.style.cssText = "padding:2px 10px;font-size:12px";
  ovResetBtn.title = "Reset sliders to default values";
  ovResetBtn.textContent = "Reset";
  ovResetBtn.addEventListener("click", async ()=>{
    ctx.state._overviewFloorGap = 150; _ovFG = 150;
    ctx.state._overviewHorizGap = 0;   _ovHG = 0;
    ctx.state._overviewIsoFocusIdx = 0;
    focusZ = _isoPos[0];
    ovGapSlider.value   = "150"; ovGapLbl.textContent   = "150";
    ovHorizSlider.value = "0";   ovHorizLbl.textContent = "0";
    focusSlider.value   = "0";   focusLbl.textContent   = "All floors";
    _rebuildRoomPositions();
    _renderFrame();
    ovResetBtn.disabled = true;
    try{
      await ctx.actions.settingsSet({ overview_iso_floor_gap:150, overview_iso_horiz_gap:0, overview_iso_focus:0 });
      ovSaveLbl.textContent = "Reset \u2713";
      setTimeout(()=>{ ovSaveLbl.textContent = ""; }, 2000);
    }catch(e){ ovSaveLbl.textContent = "Error"; }
    ovResetBtn.disabled = false;
  });
  isoCtrlRow.appendChild(ovSaveBtn);
  isoCtrlRow.appendChild(ovResetBtn);
  isoCtrlRow.appendChild(ovSaveLbl);

  // ── Discovery controls card ───────────────────────────────────────────
  const discoCard = document.createElement("div");
  discoCard.className = "card";
  discoCard.style.cssText = "border-color:#7c3aed;background:#0f000f";

  function _renderDiscoMap() {
    mapDiv.innerHTML = _buildDiscoverySVG(tb.discoResults);
    // Attach click handlers via event delegation
    mapDiv.addEventListener("click", _discoMapClick);
  }

  function _discoMapClick(e) {
    let node = e.target;
    while (node && node !== mapDiv) {
      if (node.tagName === "g" || node.tagName === "G") {
        const idx = node.getAttribute("data-disco");
        if (idx !== null) {
          const obj = tb.discoResults[parseInt(idx, 10)];
          if (obj) {
            tb.discoSelected = obj.key || obj.address;
            ctx.actions.showObjectDetail(obj);
            _renderDiscoMap();
          }
          return;
        }
      }
      node = node.parentNode;
    }
  }

  function _buildDiscoControls() {
    discoCard.innerHTML = "";

    // Header
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap";
    const title = document.createElement("span");
    title.style.cssText = "font-weight:700;font-size:15px;color:#e879f9";
    title.textContent = "New Objects Heard";
    hdr.appendChild(title);
    const desc = document.createElement("span");
    desc.style.cssText = "font-size:11px;color:#94a3b8";
    desc.textContent = "Find objects first discovered in a time window";
    hdr.appendChild(desc);
    discoCard.appendChild(hdr);

    // Time range inputs
    const rangeRow = document.createElement("div");
    rangeRow.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px";

    const fromLbl = document.createElement("span");
    fromLbl.style.cssText = "font-size:12px;color:#94a3b8";
    fromLbl.textContent = "From";
    rangeRow.appendChild(fromLbl);

    const fromInput = document.createElement("input");
    fromInput.type = "number";
    fromInput.min = "0";
    fromInput.max = "10080"; // 7 days in minutes
    fromInput.value = String(tb.discoFromMin);
    fromInput.style.cssText = "width:70px;background:#071008;color:#e2e8f0;border:1px solid #7c3aed;border-radius:4px;padding:4px 6px;font-size:13px;text-align:center";
    fromInput.addEventListener("change", () => { tb.discoFromMin = Math.max(0, parseInt(fromInput.value, 10) || 0); });
    rangeRow.appendChild(fromInput);

    const fromUnit = document.createElement("span");
    fromUnit.style.cssText = "font-size:12px;color:#94a3b8";
    fromUnit.textContent = "min ago";
    rangeRow.appendChild(fromUnit);

    const toLbl = document.createElement("span");
    toLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:6px";
    toLbl.textContent = "to";
    rangeRow.appendChild(toLbl);

    const toInput = document.createElement("input");
    toInput.type = "number";
    toInput.min = "0";
    toInput.max = "10080";
    toInput.value = String(tb.discoToMin);
    toInput.style.cssText = "width:70px;background:#071008;color:#e2e8f0;border:1px solid #7c3aed;border-radius:4px;padding:4px 6px;font-size:13px;text-align:center";
    toInput.addEventListener("change", () => { tb.discoToMin = Math.max(0, parseInt(toInput.value, 10) || 0); });
    rangeRow.appendChild(toInput);

    const toUnit = document.createElement("span");
    toUnit.style.cssText = "font-size:12px;color:#94a3b8";
    toUnit.textContent = "min ago";
    rangeRow.appendChild(toUnit);

    // Search button
    const searchBtn = document.createElement("button");
    searchBtn.className = "btn inline";
    searchBtn.style.cssText = "margin-left:8px;padding:4px 16px;font-size:12px;font-weight:600;background:#2d1854;border-color:#7c3aed;color:#e879f9";
    searchBtn.textContent = "Search";
    searchBtn.addEventListener("click", () => {
      tb.discoFromMin = Math.max(0, parseInt(fromInput.value, 10) || 0);
      tb.discoToMin = Math.max(0, parseInt(toInput.value, 10) || 0);
      _runDiscoverySearch();
      _buildDiscoControls();
      _renderDiscoMap();
    });
    rangeRow.appendChild(searchBtn);

    discoCard.appendChild(rangeRow);

    // Quick presets
    const presetRow = document.createElement("div");
    presetRow.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px";
    const presetLbl = document.createElement("span");
    presetLbl.style.cssText = "font-size:11px;color:#64748b";
    presetLbl.textContent = "Quick:";
    presetRow.appendChild(presetLbl);

    const presets = [
      { label: "Last 5 min", from: 5, to: 0 },
      { label: "Last 15 min", from: 15, to: 0 },
      { label: "Last 30 min", from: 30, to: 0 },
      { label: "Last 1 hr", from: 60, to: 0 },
      { label: "Last 4 hr", from: 240, to: 0 },
      { label: "30-60 min ago", from: 60, to: 30 },
      { label: "1-2 hr ago", from: 120, to: 60 },
      { label: "2-4 hr ago", from: 240, to: 120 },
    ];
    for (const p of presets) {
      const btn = document.createElement("button");
      btn.className = "btn inline";
      const isActive = tb.discoFromMin === p.from && tb.discoToMin === p.to;
      btn.style.cssText = isActive
        ? "font-size:10px;padding:2px 8px;background:#7c3aed;color:#fff;border-color:#e879f9;font-weight:700"
        : "font-size:10px;padding:2px 8px;color:#94a3b8";
      btn.textContent = p.label;
      btn.addEventListener("click", () => {
        tb.discoFromMin = p.from;
        tb.discoToMin = p.to;
        fromInput.value = String(p.from);
        toInput.value = String(p.to);
        _runDiscoverySearch();
        _buildDiscoControls();
        _renderDiscoMap();
      });
      presetRow.appendChild(btn);
    }
    discoCard.appendChild(presetRow);

    // Results
    if (!tb.discoResults.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "text-align:center;padding:16px;color:#64748b;font-size:13px";
      empty.textContent = "No new objects discovered in this time window. Try a wider range or check that objects are within scanner range.";
      discoCard.appendChild(empty);
      return;
    }

    // Results summary
    const summRow = document.createElement("div");
    summRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap";
    const summLbl = document.createElement("span");
    summLbl.style.cssText = "font-size:13px;font-weight:600;color:#e879f9";
    summLbl.textContent = `${tb.discoResults.length} object${tb.discoResults.length !== 1 ? "s" : ""} found`;
    summRow.appendChild(summLbl);
    // Kind breakdown
    const kindCounts = {};
    for (const o of tb.discoResults) { kindCounts[o.kind || "ble"] = (kindCounts[o.kind || "ble"] || 0) + 1; }
    const kindStr = Object.entries(kindCounts).map(([k, v]) => `${v} ${k}`).join(", ");
    const kindLbl = document.createElement("span");
    kindLbl.style.cssText = "font-size:11px;color:#94a3b8";
    kindLbl.textContent = "(" + kindStr + ")";
    summRow.appendChild(kindLbl);
    discoCard.appendChild(summRow);

    // Results table
    const table = document.createElement("div");
    table.style.cssText = "max-height:300px;overflow-y:auto;border:1px solid #2d1854;border-radius:6px";

    const tbl = document.createElement("table");
    tbl.className = "table";
    tbl.style.cssText = "width:100%;font-size:12px";
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr><th style="width:50px">Kind</th><th>Name / Address</th><th>Room</th><th>First Seen</th><th>RSSI</th><th>Source</th></tr>`;
    tbl.appendChild(thead);

    const tbody = document.createElement("tbody");
    const DISCO_COLORS = ["#e879f9", "#60a5fa", "#f87171", "#34d399", "#fbbf24", "#fb923c", "#5eead4", "#f472b6", "#a3e635", "#818cf8"];
    for (let i = 0; i < tb.discoResults.length; i++) {
      const obj = tb.discoResults[i];
      const col = DISCO_COLORS[i % DISCO_COLORS.length];
      const isSelected = tb.discoSelected === (obj.key || obj.address);
      const tr = document.createElement("tr");
      tr.style.cssText = "cursor:pointer;" + (isSelected ? "background:#1a0a2e;" : "") + "border-bottom:1px solid #1a0a2e";
      tr.addEventListener("click", () => {
        tb.discoSelected = obj.key || obj.address;
        ctx.actions.showObjectDetail(obj);
        _renderDiscoMap();
        // Re-highlight in table
        for (const row of tbody.children) {
          row.style.background = "";
        }
        tr.style.background = "#1a0a2e";
      });
      // Hover
      tr.addEventListener("mouseenter", () => { if (!isSelected) tr.style.background = "#0f051f"; });
      tr.addEventListener("mouseleave", () => { if (tb.discoSelected !== (obj.key || obj.address)) tr.style.background = ""; });

      // Kind
      const kindTd = document.createElement("td");
      const kindBadge = document.createElement("span");
      kindBadge.style.cssText = "font-size:9px;padding:1px 5px;border-radius:3px;font-weight:600;" +
        "background:" + col + "22;color:" + col + ";border:1px solid " + col + "44";
      kindBadge.textContent = obj.kind === "ibeacon" ? "iBeacon" : obj.kind === "private_ble" ? "pBLE" : obj.kind === "entity" ? "Entity" : "BLE";
      kindTd.appendChild(kindBadge);
      tr.appendChild(kindTd);

      // Name/Address
      const nameTd = document.createElement("td");
      nameTd.style.cssText = "max-width:200px;overflow:hidden;text-overflow:ellipsis";
      const nameMain = document.createElement("div");
      nameMain.style.cssText = "font-weight:600;color:" + col;
      nameMain.textContent = obj.user_label || obj.name || obj.address || "?";
      nameTd.appendChild(nameMain);
      if (obj.address && obj.address !== (obj.user_label || obj.name)) {
        const addrSub = document.createElement("div");
        addrSub.style.cssText = "font-size:10px;color:#64748b;font-family:monospace";
        addrSub.textContent = obj.address;
        nameTd.appendChild(addrSub);
      }
      if (obj.company_name) {
        const compSub = document.createElement("div");
        compSub.style.cssText = "font-size:10px;color:#94a3b8";
        compSub.textContent = obj.company_name;
        nameTd.appendChild(compSub);
      }
      tr.appendChild(nameTd);

      // Room
      const roomTd = document.createElement("td");
      roomTd.style.cssText = "color:" + (obj.room ? roomColorFn(obj.room) : "#64748b");
      roomTd.textContent = obj.room || "—";
      tr.appendChild(roomTd);

      // First Seen
      const fsTd = document.createElement("td");
      fsTd.style.cssText = "font-size:11px;white-space:nowrap";
      if (obj.first_seen) {
        const fsDate = new Date(obj.first_seen);
        const agoMs = Date.now() - fsDate.getTime();
        const agoMin = Math.round(agoMs / 60000);
        fsTd.textContent = agoMin < 1 ? "just now" : agoMin < 60 ? `${agoMin}m ago` : `${(agoMin / 60).toFixed(1)}h ago`;
        fsTd.title = fsDate.toLocaleString();
      } else {
        fsTd.textContent = "—";
      }
      tr.appendChild(fsTd);

      // RSSI
      const rssiTd = document.createElement("td");
      rssiTd.style.cssText = "font-family:monospace;font-size:11px";
      rssiTd.textContent = obj.rssi != null ? `${obj.rssi}` : "—";
      tr.appendChild(rssiTd);

      // Source scanner
      const srcTd = document.createElement("td");
      srcTd.style.cssText = "font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis";
      const sources = obj.sources || [];
      if (sources.length) {
        const srcName = typeof sources[0] === "string" ? sources[0] : (sources[0].source || "");
        // Try to find friendly name from radios
        const radio = radios.find(r => r.source === srcName);
        srcTd.textContent = radio?.name || srcName || "—";
        if (sources.length > 1) srcTd.textContent += ` +${sources.length - 1}`;
      } else {
        srcTd.textContent = obj.source || "—";
      }
      tr.appendChild(srcTd);

      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    table.appendChild(tbl);
    discoCard.appendChild(table);

    // Tip
    const tip = document.createElement("div");
    tip.style.cssText = "font-size:10px;color:#64748b;margin-top:8px";
    tip.textContent = "Click any row or map pin to view full object details (manufacturer data, services, signal sources, etc.)";
    discoCard.appendChild(tip);
  }

  // ── Mode toggle ─────────────────────────────────────────────────────────
  const modeRow = document.createElement("div");
  modeRow.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:8px";

  const _makeModeBtn = (label, mode, color) => {
    const btn = document.createElement("button");
    btn.className = "btn inline";
    const isActive = tb.mode === mode;
    btn.style.cssText = isActive
      ? `font-size:12px;padding:4px 14px;font-weight:700;background:${color}22;color:${color};border-color:${color}`
      : "font-size:12px;padding:4px 14px;color:#94a3b8;border-color:#1b3526";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      tb.mode = mode;
      _stopPlayback();
      // Show/hide the right controls card
      ctrlCard.style.display = mode === "playback" ? "" : "none";
      discoCard.style.display = mode === "discovery" ? "" : "none";
      // Update mode button styles
      for (const c of modeRow.children) {
        const m = c.getAttribute("data-mode");
        if (m === mode) {
          const mCol = m === "playback" ? "#fbbf24" : "#e879f9";
          c.style.cssText = `font-size:12px;padding:4px 14px;font-weight:700;background:${mCol}22;color:${mCol};border-color:${mCol}`;
        } else {
          c.style.cssText = "font-size:12px;padding:4px 14px;color:#94a3b8;border-color:#1b3526";
        }
      }
      // Re-render map for current mode
      if (mode === "playback") {
        _renderFrame();
      } else {
        _runDiscoverySearch();
        _buildDiscoControls();
        _renderDiscoMap();
      }
    });
    btn.setAttribute("data-mode", mode);
    return btn;
  };

  modeRow.appendChild(_makeModeBtn("Playback", "playback", "#fbbf24"));
  modeRow.appendChild(_makeModeBtn("New Objects", "discovery", "#e879f9"));

  // ── Assemble ───────────────────────────────────────────────────────────
  outer.appendChild(modeRow);
  outer.appendChild(isoCtrlRow);
  outer.appendChild(mapDiv);

  // Both cards are appended but only the active mode's card is visible
  ctrlCard.style.display = tb.mode === "playback" ? "" : "none";
  discoCard.style.display = tb.mode === "discovery" ? "" : "none";
  outer.appendChild(ctrlCard);
  outer.appendChild(discoCard);

  // Mark traceback as active to suppress poll re-renders (panel.js checks this)
  tb.active = true;

  // Auto-load data on tab open
  const _wasPlaying = tb.playing;
  if (tb.mode === "playback") {
    _loadTracebackData().then(() => {
      _buildControls();
      _renderFrame();
      // Restart playback if it was interrupted by a re-render
      if (_wasPlaying && tb.frames.length) {
        _startPlayback();
        _buildControls();
      }
    }).catch(err => {
      console.error("Traceback load failed:", err);
      mapDiv.innerHTML = `<div style="text-align:center;padding:40px;color:#f87171;font-size:14px">Failed to load traceback data: ${String(err).substring(0, 100)}</div>`;
    });
  } else {
    _runDiscoverySearch();
    _buildDiscoControls();
    _renderDiscoMap();
  }

  // ── Distance Traveled panel (self-contained, auto-loads data) ────────────
  {
    const distCard = el("div",{class:"card",style:"margin-top:12px"});
    distCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
      el("div",{style:"font-weight:700;font-size:14px;color:#5eead4"},"\ud83d\udeb6 Distance Traveled"),
    ]));
    distCard.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:10px"},
      "Select a time window and click Load to see how far each object has moved."));

    // Time window selector + load button
    const windowRow = el("div",{style:"display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center"});
    const windows = [
      {label:"15 min", mins:15}, {label:"1 hour", mins:60}, {label:"4 hours", mins:240},
      {label:"24 hours", mins:1440}, {label:"7 days", mins:10080},
    ];
    if (!ctx.state._distWindow) ctx.state._distWindow = 240;
    const _distBtns = [];
    const _activeStyle = "font-size:10px;padding:2px 8px;background:#134e4a;color:#5eead4;border-color:#5eead4;font-weight:700";
    const _inactiveStyle = "font-size:10px;padding:2px 8px;color:#94a3b8";
    const _updateDistBtnStyles = () => {
      for (const {btn: b, mins: m} of _distBtns) {
        b.style.cssText = ctx.state._distWindow === m ? _activeStyle : _inactiveStyle;
      }
    };
    for (const w of windows) {
      const btn = el("button",{class:"btn inline"});
      btn.style.cssText = ctx.state._distWindow === w.mins ? _activeStyle : _inactiveStyle;
      btn.textContent = w.label;
      btn.addEventListener("click", () => { ctx.state._distWindow = w.mins; _updateDistBtnStyles(); _updateDistWindowLbl(); _loadDist(); });
      _distBtns.push({btn, mins: w.mins});
      windowRow.appendChild(btn);
    }
    // Custom minutes input
    const customInput = document.createElement("input");
    customInput.type = "number"; customInput.min = "1"; customInput.max = "99999"; customInput.step = "1";
    customInput.placeholder = "min";
    customInput.style.cssText = "width:60px;padding:2px 6px;border:1px solid #334155;border-radius:4px;background:#1e293b;color:#e2e8f0;font-size:10px";
    customInput.value = ctx.state._distWindow && !windows.some(w => w.mins === ctx.state._distWindow) ? ctx.state._distWindow : "";
    const customBtn = el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px"});
    customBtn.textContent = "Go";
    customBtn.addEventListener("click", () => {
      const v = parseInt(customInput.value);
      if (v && v > 0) { ctx.state._distWindow = v; _updateDistBtnStyles(); _updateDistWindowLbl(); _loadDist(); }
    });
    windowRow.appendChild(customInput);
    windowRow.appendChild(customBtn);
    distCard.appendChild(windowRow);

    // Active window label
    const _distWindowLbl = el("div",{style:"font-size:11px;color:#5eead4;margin-bottom:10px;font-weight:600"});
    const _updateDistWindowLbl = () => {
      const mins = ctx.state._distWindow;
      const preset = windows.find(w => w.mins === mins);
      _distWindowLbl.textContent = preset ? `Showing: ${preset.label}` : `Showing: ${mins < 60 ? mins + " min" : (mins/60) + " hours"}`;
    };
    _updateDistWindowLbl();
    distCard.appendChild(_distWindowLbl);

    // Results container
    const distResults = el("div",{});
    distCard.appendChild(distResults);

    // Object filter
    if (!ctx.state._distFilter) ctx.state._distFilter = "";

    // Helper functions
    const centroids = ctx.state.model?.room_geometry_m || {};
    const _centroid = (room) => {
      const g = centroids[room];
      if (!g) return null;
      if (g.type === "poly" && g.points_m?.length >= 3) {
        return [g.points_m.reduce((s,p)=>s+p[0],0)/g.points_m.length, g.points_m.reduce((s,p)=>s+p[1],0)/g.points_m.length];
      }
      if (g.type === "circle") return [g.cx_m, g.cy_m];
      return null;
    };
    const transforms = ctx.state.model?.map_transforms || {};
    const _toMetres = (x, y, mid) => {
      const t = transforms[mid]; if (!t) return null;
      const sx = t.scale_x_m||1, sy = t.scale_y_m||1, rot = t.rotation_rad||0;
      let dx = x*sx, dy = y*sy;
      if (Math.abs(rot)>1e-9){const c=Math.cos(rot),s=Math.sin(rot);return[(t.origin_x_m||0)+dx*c-dy*s,(t.origin_y_m||0)+dx*s+dy*c];}
      return [(t.origin_x_m||0)+dx,(t.origin_y_m||0)+dy];
    };

    async function _loadDist() {
      distResults.innerHTML = "";
      distResults.appendChild(el("div",{style:"text-align:center;color:#94a3b8;padding:12px"},"Loading\u2026"));
      try {
        const now = Date.now() / 1000;
        const mins = ctx.state._distWindow || 240;
        const res = await ctx.actions.wsCall("padspan_ha/traceback_get", {
          start_ts: now - mins * 60, end_ts: now, max_frames: 4000,
        });
        const frames = res.frames || [];
        distResults.innerHTML = "";

        if (frames.length < 2) {
          distResults.appendChild(el("div",{style:"color:#64748b;font-size:12px;padding:8px"}, `No traceback data in the last ${mins < 60 ? mins+" min" : (mins/60)+" hr"}.`));
          return;
        }

        // Compute distances with velocity-based stillness detection.
        //
        // k-NN position noise (~0.2-1m per poll) causes stationary objects to
        // accumulate phantom distance.  The old approach (flat 0.5m threshold)
        // missed accumulated micro-jitter.  New approach:
        //
        //   1. Track a rolling window of recent step sizes (last 5 frames)
        //   2. If the median step is < 0.8m AND room hasn't changed → device
        //      is "still" → ignore ALL steps in this window (noise floor)
        //   3. Same-room cap lowered to 2m (was 3m) to reject boundary bounce
        //   4. Time-gap scaling: large gaps require proportionally larger steps
        //   5. Steps > 30m are teleport errors (was 50m)
        //
        // This means a TV jittering ±0.3m every poll accumulates 0m, while a
        // person walking 1.5m per poll accumulates correctly.

        const _stationarySet = new Set((ctx.state.settings?.distance_stationary_devices || []).map(s => String(s).toUpperCase()));
        const STILL_WINDOW = 5;    // frames to assess stillness
        const STILL_MEDIAN = 0.8;  // m — median step below this = stationary
        const objDist = {};
        let prevTs = 0;
        for (const frame of frames) {
          const ts = frame.ts || 0;
          const dt = prevTs ? (ts - prevTs) : 10;
          prevTs = ts;
          for (const o of (frame.o || [])) {
            if (!o.k) continue;
            const _isRef = _stationarySet.has(String(o.k).toUpperCase());
            if (!objDist[o.k]) objDist[o.k] = {dist_m:0, transitions:0, lastPos:null, lastRoom:null, lastTs:0, label:o.n||o.k, steps:0, jitter_steps:0, max_step:0, isRef: _isRef, _recentSteps: []};
            let pos = null;
            if (o.x!=null && o.y!=null && o.m) pos = _toMetres(o.x, o.y, o.m);
            if (!pos && o.r) pos = _centroid(o.r);
            const od = objDist[o.k];
            if (pos && od.lastPos) {
              const dx=pos[0]-od.lastPos[0], dy=pos[1]-od.lastPos[1];
              const step=Math.sqrt(dx*dx+dy*dy);
              od.steps++;

              const sameRoom = o.r && o.r === od.lastRoom;

              // Push to rolling window
              od._recentSteps.push(step);
              if (od._recentSteps.length > STILL_WINDOW) od._recentSteps.shift();

              // Stillness detection: if median of recent steps is below threshold
              // AND room hasn't changed, device is stationary → skip step
              const _sorted = [...od._recentSteps].sort((a,b) => a-b);
              const _median = _sorted[Math.floor(_sorted.length / 2)] || 0;
              const isStill = sameRoom && _sorted.length >= 3 && _median < STILL_MEDIAN;

              if (isStill) {
                od.jitter_steps++;
              } else {
                // Time-gap scaling: require larger step for larger gaps
                const minStep = dt > 60 ? Math.min(2.0, 0.5 + (dt - 60) * 0.01) : 0.5;
                // Same-room cap: max credible step in one room
                const maxStep = sameRoom ? 2.0 : 30.0;
                if (step >= minStep && step <= maxStep) {
                  od.dist_m += step;
                  od.max_step = Math.max(od.max_step, step);
                } else {
                  od.jitter_steps++;
                }
              }
            }
            if (o.r && od.lastRoom && o.r !== od.lastRoom) od.transitions++;
            od.lastPos = pos;
            od.lastRoom = o.r || od.lastRoom;
            od.lastTs = ts;
            if (o.n) od.label = o.n;
          }
        }

        const sorted = Object.entries(objDist).sort((a,b) => b[1].dist_m - a[1].dist_m);
        if (!sorted.length) {
          distResults.appendChild(el("div",{style:"color:#64748b;font-size:12px;padding:8px"}, "No tracked objects found."));
          return;
        }

        // Object filter dropdown
        const filterRow = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"});
        const filterSel = document.createElement("select");
        filterSel.style.cssText = "padding:3px 6px;border:1px solid #334155;border-radius:4px;background:#1e293b;color:#e2e8f0;font-size:11px";
        const allOpt = document.createElement("option");
        allOpt.value = ""; allOpt.textContent = `All objects (${sorted.length})`;
        filterSel.appendChild(allOpt);
        for (const [key, od] of sorted) {
          const opt = document.createElement("option");
          opt.value = key; opt.textContent = od.label || key;
          if (ctx.state._distFilter === key) opt.selected = true;
          filterSel.appendChild(opt);
        }
        filterSel.addEventListener("change", () => { ctx.state._distFilter = filterSel.value; _renderTable(); });
        filterRow.appendChild(el("span",{style:"font-size:10px;color:#64748b"},"Filter:"));
        filterRow.appendChild(filterSel);
        distResults.appendChild(filterRow);

        // Table container
        const tblDiv = el("div",{});
        distResults.appendChild(tblDiv);

        function _renderTable() {
          tblDiv.innerHTML = "";
          const filter = ctx.state._distFilter;
          const shown = filter ? sorted.filter(([k]) => k === filter) : sorted;
          const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto auto;gap:3px 10px;font-size:11px;align-items:center"});
          for (const h of ["Object","Distance","Room Changes","Reliability",""]) {
            tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase"},h));
          }
          const hrs = Math.max(0.01, mins / 60);
          for (const [key, od] of shown.slice(0, 50)) {
            const dist = od.dist_m;
            const distStr = dist >= 1000 ? `${(dist/1000).toFixed(2)} km` : `${dist.toFixed(1)} m`;
            const distColor = dist > 500 ? "#52b788" : dist > 100 ? "#5eead4" : dist > 10 ? "#94a3b8" : "#64748b";
            // Reliability: what % of steps passed the jitter filter
            const totalSteps = od.steps || 1;
            const goodSteps = totalSteps - (od.jitter_steps || 0);
            const reliability = Math.round((goodSteps / totalSteps) * 100);
            const relColor = reliability > 80 ? "#52b788" : reliability > 50 ? "#f59e0b" : "#f87171";
            const nameDiv = el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"});
            nameDiv.textContent = od.label || key;
            if (od.isRef) {
              const refBadge = el("span",{style:"font-size:8px;padding:0 4px;margin-left:4px;border-radius:3px;background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44;vertical-align:middle"}, "REF");
              nameDiv.appendChild(refBadge);
              // For reference devices, distance = phantom jitter (quality metric)
              if (dist > 5) {
                const warnBadge = el("span",{style:"font-size:8px;padding:0 4px;margin-left:3px;border-radius:3px;background:#f8717122;color:#f87171;border:1px solid #f8717144;vertical-align:middle"}, `${distStr} jitter`);
                warnBadge.title = "This stationary device shows phantom distance — indicates BLE positioning noise in your setup";
                nameDiv.appendChild(warnBadge);
              }
            }
            tbl.appendChild(nameDiv);
            tbl.appendChild(el("div",{style:`color:${distColor};font-weight:600;text-align:right;font-family:monospace`}, distStr));
            tbl.appendChild(el("div",{style:"text-align:right;color:#94a3b8"}, String(od.transitions)));
            tbl.appendChild(el("div",{style:`text-align:right;color:${relColor};font-weight:600`}, `${reliability}%`));
            // Action buttons
            const actDiv = el("div",{style:"display:flex;gap:3px;justify-content:flex-end"});
            // Investigate button
            const invBtn = el("button",{class:"btn tiny",style:"font-size:9px;padding:1px 4px"}, "\ud83d\udd0d");
            invBtn.title = `Investigate: ${totalSteps} steps, ${od.jitter_steps||0} filtered as jitter, max step ${od.max_step?.toFixed(1)||0}m`;
            invBtn.addEventListener("click", () => {
              const msg = [
                `\ud83d\udd0d ${od.label || key}`,
                `Total steps: ${totalSteps}`,
                `Good steps: ${goodSteps} (${reliability}%)`,
                `Jitter filtered: ${od.jitter_steps||0}`,
                `Max single step: ${od.max_step?.toFixed(1)||0} m`,
                `Room changes: ${od.transitions}`,
                `Distance: ${distStr}`,
                reliability < 50 ? `\u26a0 Low reliability — mostly jitter. Consider marking as stationary.` : "",
              ].filter(Boolean).join("\n");
              alert(msg);
            });
            actDiv.appendChild(invBtn);
            // Mark as stationary reference — still tracked, but flagged for accuracy monitoring
            const isStationary = _stationarySet.has(String(key).toUpperCase());
            const statBtn = el("button",{class:"btn tiny",style:`font-size:9px;padding:1px 4px;${isStationary ? "color:#52b788;border-color:#52b788" : "color:#f59e0b;border-color:#92400e"}`}, isStationary ? "\u2713 Ref" : "\ud83d\udccc Ref");
            statBtn.title = isStationary ? "This device is a stationary reference — click to remove" : "Mark as stationary reference (known-fixed device for accuracy monitoring)";
            statBtn.addEventListener("click", async () => {
              try {
                const existing = (ctx.state.settings?.distance_stationary_devices || []).map(s => String(s));
                let updated;
                if (isStationary) {
                  updated = existing.filter(s => s.toUpperCase() !== String(key).toUpperCase());
                  ctx.toast(`${od.label || key} removed as reference`);
                } else {
                  if (!confirm(`Mark "${od.label || key}" as a stationary reference?\n\nStationary references are devices you KNOW don't move (TVs, fixed beacons). Their phantom distance reveals BLE positioning jitter — high distance on a stationary device means your scanner setup needs attention.\n\nThe device stays visible with a reference badge.`)) return;
                  updated = [...new Set([...existing, key])];
                  ctx.toast(`${od.label || key} marked as stationary reference`);
                }
                await ctx.actions.settingsSet({ distance_stationary_devices: updated });
                _loadDist();
              } catch(e) { ctx.toast("Failed: " + (e.message||e), true); }
            });
            actDiv.appendChild(statBtn);
            tbl.appendChild(actDiv);
          }
          tblDiv.appendChild(tbl);
          // Summary
          const totalDist = shown.reduce((s,[,od]) => s + od.dist_m, 0);
          const totalStr = totalDist >= 1000 ? `${(totalDist/1000).toFixed(2)} km` : `${totalDist.toFixed(0)} m`;
          const avgReliability = shown.length ? Math.round(shown.reduce((s,[,od]) => s + ((od.steps - (od.jitter_steps||0)) / Math.max(1,od.steps)) * 100, 0) / shown.length) : 0;
          tblDiv.appendChild(el("div",{style:"margin-top:8px;font-size:10px;color:#64748b"},
            `${shown.length} object${shown.length!==1?"s":""} \u00b7 ${totalStr} total \u00b7 ${avgReliability}% avg reliability \u00b7 ${frames.length} frames`));
          // Show stationary reference summary
          const refDevices = shown.filter(([,od]) => od.isRef);
          if (refDevices.length) {
            const refJitter = refDevices.reduce((s,[,od]) => s + od.dist_m, 0);
            const refStr = refJitter >= 1000 ? `${(refJitter/1000).toFixed(2)} km` : `${refJitter.toFixed(1)} m`;
            const jitterQuality = refJitter < 10 ? "Excellent" : refJitter < 50 ? "Good" : refJitter < 200 ? "Fair" : "Poor";
            const jitterColor = refJitter < 10 ? "#52b788" : refJitter < 50 ? "#5eead4" : refJitter < 200 ? "#f59e0b" : "#f87171";
            tblDiv.appendChild(el("div",{style:`margin-top:6px;padding:6px 8px;background:${jitterColor}11;border:1px solid ${jitterColor}33;border-radius:6px;font-size:10px`}, [
              el("span",{style:`color:${jitterColor};font-weight:700`}, `BLE Accuracy: ${jitterQuality}`),
              el("span",{style:"color:#94a3b8;margin-left:6px"}, `${refDevices.length} stationary ref${refDevices.length!==1?"s":""} show ${refStr} phantom distance (lower = better scanner positioning)`),
            ]));
          }
        }
        _renderTable();
      } catch(err) {
        distResults.innerHTML = "";
        distResults.appendChild(el("div",{style:"color:#f87171;font-size:12px"}, "Failed to load: " + (err.message || err)));
      }
    }

    // Auto-load after a short delay (ensures DOM is mounted)
    setTimeout(_loadDist, 200);

    outer.appendChild(distCard);
  }

  return outer;
}
