// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// THE PLAN VIEWER — the experimental 2D flat map.
//
// This is the one view whose subject IS the photograph. It draws the uploaded
// plan images and lays rooms over them in image coordinates, which is the
// sanctioned use: an uploaded plan is something you trace once and look at
// when you ask to look at it.
//
// It lives here rather than in overview.js for one reason. A file is the unit
// the photo guard can reason about, and while this sat inside the house view
// there was no way to certify that view photo-free — the check could not tell
// "the map of your house" from "a picture of your house". Now it can: the
// house view is metres, this is images, and the two cannot be confused.
//
// Everything else — the 3D stack, presence, scanners, barriers — reads the
// metric fabric and never a photograph. See tests/test_photo_divorce.py.

const { makeStackXform, imageAr, fabricWorldRooms, metreAnchor } =
  await import(`./stack_transform.js${new URL(import.meta.url).search}`);

  // ---------- EXPERIMENTAL: 2D Flat Map (replaces 3D iso when enabled) ----------
  export function render2DMap(ctx, deps){
  const { esc: _esc, renderRoomGrid, radios, sid: _sid, isScanner: _isScanner } = deps;
    const maps_list = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
    if(!maps_list.length) return renderRoomGrid();

    const _esc = s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const roomColorFn = ctx.helpers.roomColor;
    const _isScanner = ctx.helpers.isScanner;
    const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);

    // Determine which maps to show
    const hiddenIds = new Set((ctx.state.settings && ctx.state.settings.hidden_map_ids) || []);
    const visible = maps_list.filter(m => !hiddenIds.has(m.id));
    if(!visible.length) return renderRoomGrid();

    const multiFloor = visible.length > 1;
    const focusIdx = ctx.state._2dFocusIdx || 0;
    const activeMap = visible[Math.min(focusIdx, visible.length - 1)];

    // ── Floor stitching: collect all maps on the same floor ──────────────
    const haFloors2d = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
    const activeFloorId = activeMap.stack?.floor_id || activeMap.floor_id || "";
    const floorMaps = visible.filter(m => {
      const fid = m.stack?.floor_id || m.floor_id || "";
      return fid === activeFloorId;
    });
    // Use all floor maps if there are multiple on this floor, else just activeMap
    const renderMaps = floorMaps.length > 1 ? floorMaps : [activeMap];

    // ── Build mapPt transform for each map (local 0-1 → world coords) ────
    const _OUTSIDE_FID_2D = "__outside__";
    const _mapPts = {};
    // Build transforms for ALL visible maps (not just renderMaps) so the
    // heatmap can include adjacent-floor calibration data for cross-floor bleed.
    for (const m of visible) {
      _mapPts[m.id] = makeStackXform(m.stack, imageAr(m)).mapPt;
    }

    // ── Compute world bounding box of all floor maps ─────────────────────
    let wBB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const m of renderMaps) {
      const mpt = _mapPts[m.id];
      if (!mpt) continue;
      for (const [cx, cy] of [[0,0],[1,0],[1,1],[0,1]]) {
        const [wx, wy] = mpt(cx, cy);
        wBB.minX = Math.min(wBB.minX, wx);
        wBB.minY = Math.min(wBB.minY, wy);
        wBB.maxX = Math.max(wBB.maxX, wx);
        wBB.maxY = Math.max(wBB.maxY, wy);
      }
    }
    if (!isFinite(wBB.minX)) wBB = { minX: 0, minY: 0, maxX: 1, maxY: 0.75 };
    // Add 2% padding
    const wPad = Math.max(wBB.maxX - wBB.minX, wBB.maxY - wBB.minY) * 0.02;
    wBB.minX -= wPad; wBB.minY -= wPad; wBB.maxX += wPad; wBB.maxY += wPad;
    const wW = wBB.maxX - wBB.minX;
    const wH = wBB.maxY - wBB.minY;
    // World → view normalized (0-1)
    const w2v = (wx, wy) => [(wx - wBB.minX) / wW, (wy - wBB.minY) / wH];
    // Is this a stitched multi-map view?
    const isStitched = renderMaps.length > 1;

    const imgW = isStitched ? 800 : (activeMap.image?.width || 800);
    const imgH = isStitched ? Math.round(800 * wH / wW) : (activeMap.image?.height || 600);
    const imgUrl = ctx.helpers.mapImageUrl(activeMap);

    // Filter state (persists within session)
    if(ctx.state._2dFilters === undefined) ctx.state._2dFilters = { scanners: true, tagged: true, unknown: false, rooms: true, mapImg: false, radioMap: false, distortion: false };
    // Maps are setup tools only — never show floor plan images in overview
    ctx.state._2dFilters.mapImg = false;
    const F = ctx.state._2dFilters;

    // Radio map state (must be declared before buildSVG closure captures them)
    let _radioMapScanner = ctx.state._2dRadioMapScanner || null;
    const _radioMapOn = !!(ctx.state.settings && ctx.state.settings.radio_map_enabled);
    const _distortionOn = !!(ctx.state.settings && ctx.state.settings.distortion_map_enabled);

    // Lazy-load calibration data for radio map / distortion map overlays
    let _calPoints = ctx.state._2dCalPoints || null;
    let _radioMapMod = ctx.state._2dRadioMapMod || null;
    if ((F.radioMap || F.distortion) && !_calPoints) {
      // Fetch calibration data once, then re-render
      (async () => {
        try {
          const calData = await ctx.actions.calibrationGet();
          ctx.state._2dCalPoints = calData.points || [];
          _calPoints = ctx.state._2dCalPoints;
          // Also compute available scanners for the scanner selector
          if (_radioMapMod) {
            ctx.state._2dCalScanners = (isStitched && _radioMapMod.getFloorScanners) ? _radioMapMod.getFloorScanners(_calPoints, renderMaps.map(m=>m.id)) : _radioMapMod.getMapScanners(_calPoints, activeMap.id);
          }
          // Trigger re-render of the SVG
          if (svgDiv) svgDiv.innerHTML = buildSVG();
          if (typeof _updateScannerBar === "function") _updateScannerBar();
        } catch (e) { console.warn("PadSpan: calibration fetch for radio map failed", e); }
      })();
    }
    // Lazy-load the radio_map module
    if ((_radioMapOn || _distortionOn) && !_radioMapMod) {
      (async () => {
        try {
          const mod = await import("./radio_map.js?b=" + (ctx.state.buildId || ""));
          ctx.state._2dRadioMapMod = mod;
          _radioMapMod = mod;
          // Recompute scanner list if cal data is already loaded
          if (_calPoints) {
            ctx.state._2dCalScanners = mod.getMapScanners(_calPoints, activeMap.id);
          }
          if (svgDiv) svgDiv.innerHTML = buildSVG();
        } catch (e) { console.warn("PadSpan: radio_map module load failed", e); }
      })();
    }

    // Zoom/pan state
    if(ctx.state._2dZoom === undefined) ctx.state._2dZoom = 1.0;
    if(ctx.state._2dPanX === undefined) ctx.state._2dPanX = 0;
    if(ctx.state._2dPanY === undefined) ctx.state._2dPanY = 0;

    // Objects on this map
    const objects = ((liveSnap && liveSnap.objects && liveSnap.objects.list) || []).filter(o => !_isScanner(o));
    const receivers = (activeMap.receivers || []);

    // Live radios for scanner status
    const liveRadios = (liveSnap && liveSnap.ble && liveSnap.ble.radios) || [];
    const liveRadioMap = {};
    for(const r of liveRadios) liveRadioMap[r.source] = r;

    // Stroke widths & marker sizes in normalized [0..1] space (matches Maps tab approach)
    const _sw = 0.003;           // room boundary stroke
    const _mkR = 0.015;          // scanner marker radius
    const _dotR = 0.008;         // object dot radius
    const _fsRoom = 0.022;       // room label font size
    const _fsScan = 0.014;       // scanner label font size
    const _fsObj = 0.013;        // object label font size

    // ── Point transform helper ───────────────────────────────────────────
    // In stitched mode, convert local map coords to view coords via world space.
    // In single-map mode, coords pass through unchanged (0-1 = view space).
    const _pt = (m, lx, ly) => {
      if (!isStitched) return [lx, ly];
      const mpt = _mapPts[m.id];
      if (!mpt) return [lx, ly];
      const [wx, wy] = mpt(lx, ly);
      return w2v(wx, wy);
    };
    const _f = v => v.toFixed(5);

    // ── Fabric-first rooms: once the committed fabric exists (and a measured
    // map anchors it to the world frame), the house view draws IT — the
    // per-photo room_bounds below stay only as the un-anchored fallback.
    const _fabricW2d = fabricWorldRooms(maps_list, ctx.state.model);
    const _activeInv2d = makeStackXform(activeMap.stack, imageAr(activeMap)).invMapPt;
    const _fabricRooms2d = _fabricW2d
      ? Object.entries(_fabricW2d).filter(([, fr]) => fr.floor_id === String(activeFloorId || "main"))
      : null;
    const _fabricPt2d = (wx, wy) => isStitched ? w2v(wx, wy) : _activeInv2d(wx, wy);

    // Build SVG content — viewBox="0 0 1 {aspect}" with xMidYMid meet
    // for correct aspect ratio in stitched mode.
    const vAspect = isStitched ? (wH / wW) : 1;
    const buildSVG = () => {
      let s = `<svg viewBox="0 0 1 ${_f(vAspect)}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="${isStitched ? "xMidYMid meet" : "none"}" width="100%" height="100%" style="display:block">`;
      s += `<rect x="0" y="0" width="1" height="${_f(vAspect)}" fill="#0d1f12"/>`;

      // ── Map images ──────────────────────────────────────────────────────
      if (F.mapImg) {
        for (const m of renderMaps) {
          const mUrl = ctx.helpers.mapImageUrl(m);
          if (!mUrl) continue;
          if (isStitched) {
            // Project the 4 corners to get positioned image via SVG transform
            const [vTL_x, vTL_y] = _pt(m, 0, 0);
            const [vTR_x, vTR_y] = _pt(m, 1, 0);
            const [vBL_x, vBL_y] = _pt(m, 0, 1);
            // Compute affine transform from unit square to view quadrilateral
            // For SVG image: use x, y, width, height + transform
            const dx = vTR_x - vTL_x, dy = vTR_y - vTL_y;
            const ex = vBL_x - vTL_x, ey = vBL_y - vTL_y;
            // SVG matrix(a,b,c,d,e,f): maps (x,y) → (a*x+c*y+e, b*x+d*y+f)
            s += `<image href="${mUrl}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" opacity="0.65" transform="matrix(${_f(dx)},${_f(dy)},${_f(ex)},${_f(ey)},${_f(vTL_x)},${_f(vTL_y)})"/>`;
          } else {
            s += `<image href="${mUrl}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" opacity="0.75"/>`;
          }
        }
      }

      // ── Radio Map heatmap layer ─────────────────────────────────────────
      if (F.radioMap && _radioMapMod && _calPoints && _calPoints.length && _radioMapMod.floorHeatmapSVG) {
        // Apply user gain/contrast before rendering
        if (_radioMapMod.setUserGainContrast) {
          _radioMapMod.setUserGainContrast(ctx.state._heatGain || ctx.state.settings?.heatmap_gain || 0, ctx.state._heatContrast || ctx.state.settings?.heatmap_contrast || 0);
        }
        // Prefer model-based heatmap (scanner positions + physics)
        let floorSvg = "";
        if (_radioMapMod.modelFloorHeatmapSVG) {
          if (_radioMapMod.setFabricWorld) _radioMapMod.setFabricWorld(_fabricW2d);
          floorSvg = _radioMapMod.modelFloorHeatmapSVG(renderMaps, _mapPts, w2v, wBB, ctx.state.settings, visible, liveSnap, ctx.state.model);
        }
        if (!floorSvg && _radioMapMod.floorHeatmapSVG) {
          floorSvg = _radioMapMod.floorHeatmapSVG(_calPoints, renderMaps, _mapPts, w2v, wBB, _radioMapScanner, visible);
        }
        if (floorSvg) s += floorSvg;
      }

      // ── Distortion Map layer (deformation grid with heatmap colors) ─────
      // Replaces the heatmap when active — same colors, grid geometry shows distortion
      if (F.distortion && !F.radioMap && _radioMapMod && _calPoints && _calPoints.length) {
        if (_radioMapMod.setUserGainContrast) {
          _radioMapMod.setUserGainContrast(ctx.state._heatGain || ctx.state.settings?.heatmap_gain || 0, ctx.state._heatContrast || ctx.state.settings?.heatmap_contrast || 0);
        }
        if (_radioMapMod.floorDistortionSVG) {
          const dmSvg = _radioMapMod.floorDistortionSVG(_calPoints, renderMaps, _mapPts, w2v, wBB, visible);
          if (dmSvg) s += dmSvg;
        } else {
        // Legacy fallback: per-map distortion
        for (const m of renderMaps) {
          const dmSvg = _radioMapMod.distortionMapSVG(_calPoints, m.id, m.rf_barriers || [], m.receivers || []);
          if (dmSvg) {
            if (isStitched) {
              const [vTL_x, vTL_y] = _pt(m, 0, 0);
              const [vTR_x, vTR_y] = _pt(m, 1, 0);
              const [vBL_x, vBL_y] = _pt(m, 0, 1);
              const dx = vTR_x - vTL_x, dy = vTR_y - vTL_y;
              const ex = vBL_x - vTL_x, ey = vBL_y - vTL_y;
              s += `<g transform="matrix(${_f(dx)},${_f(dy)},${_f(ex)},${_f(ey)},${_f(vTL_x)},${_f(vTL_y)})">`;
              s += `<svg viewBox="0 0 1 1" width="1" height="1" preserveAspectRatio="none">${dmSvg}</svg>`;
              s += `</g>`;
            } else {
              s += dmSvg;
            }
          }
        }
        } // end legacy fallback
      }

      // ── Room boundaries ─────────────────────────────────────────────────
      if (F.rooms) {
        if (_fabricRooms2d && _fabricRooms2d.length) {
          for (const [room, fr] of _fabricRooms2d) {
            const color = roomColorFn(room);
            const vpts = fr.pts.map(([wx, wy]) => _fabricPt2d(wx, wy));
            const pp = vpts.map(([vx, vy]) => `${_f(vx)},${_f(vy)}`).join(" ");
            s += `<polygon points="${pp}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="${_sw}" stroke-opacity="0.7"/>`;
            const vcx = vpts.reduce((a, p) => a + p[0], 0) / vpts.length;
            const vcy = vpts.reduce((a, p) => a + p[1], 0) / vpts.length;
            s += `<text x="${_f(vcx)}" y="${_f(vcy)}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="${_fsRoom}" font-weight="600" opacity="0.8">${_esc(room)}</text>`;
          }
        } else {
        for (const m of renderMaps) {
          for (const [room, b] of Object.entries(m.room_bounds || {})) {
            if (!b || b.type !== "poly" || !Array.isArray(b.points) || b.points.length < 3) continue;
            const color = roomColorFn(room);
            const pp = b.points.map(p => { const [vx, vy] = _pt(m, p[0], p[1]); return `${_f(vx)},${_f(vy)}`; }).join(" ");
            s += `<polygon points="${pp}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="${_sw}" stroke-opacity="0.7"/>`;
            const cx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
            const cy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
            const [vcx, vcy] = _pt(m, cx, cy);
            s += `<text x="${_f(vcx)}" y="${_f(vcy)}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="${_fsRoom}" font-weight="600" opacity="0.8">${_esc(room)}</text>`;
          }
        }
        }
      }

      // ── Scanners ────────────────────────────────────────────────────────
      if (F.scanners) {
        for (const m of renderMaps) {
          for (const r of (m.receivers || [])) {
            const [px, py] = _pt(m, r.x != null ? r.x : 0.5, r.y != null ? r.y : 0.5);
            const src = r.source || r.id || "";
            const liveR = liveRadioMap[src];
            const isOnline = !!liveR;
            const rxColor = isOnline ? "#52b788" : "#4a6052";
            const rxFull = r.label || (liveR && liveR.name) || r.source || "radio";
            const rxShort = _esc((_sid(src) || rxFull.substring(0,3)).toUpperCase());
            const rxSrc2d = _esc(src);
            // Compact: small radio glyph + 2-3 char id; full name on hover (title).
            s += `<g data-scanner-src="${rxSrc2d}" style="cursor:pointer"><title>${_esc(rxFull)} ${isOnline?"● online":"○ offline"}</title>`;
            s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_mkR*1.8}" fill="none" stroke="${rxColor}" stroke-width="${_sw*0.5}" opacity="0.3"/>`;
            s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_mkR}" fill="none" stroke="${rxColor}" stroke-width="${_sw*0.7}" opacity="0.6"/>`;
            s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_mkR*0.5}" fill="${rxColor}" opacity="0.9"/>`;
            s += `<text x="${_f(px)}" y="${_f(py - _mkR*2.4)}" text-anchor="middle" fill="${rxColor}" font-size="${_fsScan*0.85}" font-weight="700">${rxShort}</text>`;
            s += `</g>`;
          }
        }
      }

      // ── Objects positioned on floor maps ─────────────────────────────────
      const roomCentroids = {};
      if (_fabricRooms2d && _fabricRooms2d.length) {
        for (const [room, fr] of _fabricRooms2d) {
          const vpts = fr.pts.map(([wx, wy]) => _fabricPt2d(wx, wy));
          roomCentroids[room] = {
            x: vpts.reduce((a, p) => a + p[0], 0) / vpts.length,
            y: vpts.reduce((a, p) => a + p[1], 0) / vpts.length,
          };
        }
      } else {
      for (const m of renderMaps) {
        for (const [room, b] of Object.entries(m.room_bounds || {})) {
          if (!b || !b.points || b.points.length < 3) continue;
          if (roomCentroids[room]) continue; // first map wins
          const cx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
          const cy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
          const [vx, vy] = _pt(m, cx, cy);
          roomCentroids[room] = { x: vx, y: vy };
        }
      }
      }

      const _roomObjIdx = {};
      for (const o of objects) {
        const isTagged = !!(o.user_label || o.identified);
        const isFollowed = ctx.actions.followedHas && (ctx.actions.followedHas(o.address || "") || ctx.actions.followedHas(o.key || ""));
        if (!F.tagged && isTagged && !isFollowed) continue;
        if (!F.unknown && !isTagged && !isFollowed) continue;
        if (_quietMode && !isTagged && !isFollowed) continue;

        let px, py;
        // Positions are metres; this flat view falls back to room centroids.
        if (o.room && roomCentroids[o.room]) {
          const c = roomCentroids[o.room];
          const idx = (_roomObjIdx[o.room] || 0);
          _roomObjIdx[o.room] = idx + 1;
          const angle = idx * 2.4;
          const spread = 0.04;
          px = c.x + Math.cos(angle) * Math.min(spread * (1 + idx * 0.3), spread * 3);
          py = c.y + Math.sin(angle) * Math.min(spread * (1 + idx * 0.3), spread * 3);
        } else {
          continue;
        }

        const lbl = (o.user_label || o.private_ble_name || o.name || "").substring(0, 14);
        const _oKey = _esc(o.key || o.address || o.entity_id || "");

        if (isFollowed) {
          s += `<g data-obj-key="${_oKey}" style="cursor:pointer">`;
          s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_dotR*2}" fill="#fbbf24" fill-opacity="0.15"/>`;
          s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_dotR}" fill="#fbbf24" stroke="#071008" stroke-width="${_sw*0.5}"/>`;
          if (lbl) s += `<text x="${_f(px)}" y="${_f(py - _dotR*2)}" text-anchor="middle" fill="#fbbf24" font-size="${_fsObj}" font-weight="600">${_esc(lbl)}</text>`;
          s += `</g>`;
        } else if (isTagged) {
          s += `<g data-obj-key="${_oKey}" style="cursor:pointer">`;
          s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_dotR}" fill="#5eead4" stroke="#071008" stroke-width="${_sw*0.5}" opacity="0.9"/>`;
          if (lbl) s += `<text x="${_f(px)}" y="${_f(py - _dotR*1.8)}" text-anchor="middle" fill="#5eead4" font-size="${_fsObj}" font-weight="600" opacity="0.85">${_esc(lbl)}</text>`;
          s += `</g>`;
        } else {
          s += `<g data-obj-key="${_oKey}" style="cursor:pointer">`;
          s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_dotR*0.7}" fill="#f59e0b" stroke="#071008" stroke-width="${_sw*0.3}" opacity="0.5"/>`;
          s += `</g>`;
        }
      }

      s += `</svg>`;
      return s;
    };

    // ── DOM construction ──
    const outer = document.createElement("div");
    outer.style.cssText = "margin-bottom:16px";

    // Experimental badge
    const badge2d = document.createElement("div");
    badge2d.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px";
    badge2d.innerHTML = `<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:#422006;color:#fbbf24;border:1px solid #92400e;font-weight:700">EXPERIMENTAL</span><span style="font-size:12px;color:#94a3b8">2D Map Mode</span>`;
    outer.appendChild(badge2d);

    // Filter toggles
    const filterBar = document.createElement("div");
    filterBar.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px";

    let _updateScannerBar = null; // set later if radio map enabled
    const makeFilterBtn = (key, label, color) => {
      const btn = document.createElement("button");
      btn.className = "btn inline";
      const update = () => {
        btn.style.cssText = F[key]
          ? `font-size:11px;padding:2px 8px;background:${color}22;border-color:${color};color:${color};font-weight:600`
          : "font-size:11px;padding:2px 8px;color:#64748b;border-color:#334155";
        btn.textContent = (F[key] ? "\u25C9 " : "\u25CB ") + label;
      };
      update();
      btn.addEventListener("click", () => {
        F[key] = !F[key];
        update();
        svgDiv.innerHTML = buildSVG();
        // Update scanner selector visibility when Radio Map toggled
        if (key === "radioMap" && _updateScannerBar) _updateScannerBar();
      });
      return btn;
    };

    // View-mode toggle — this top-down overhead is the default; flip to 3D stack.
    const viewTo3d = document.createElement("button");
    viewTo3d.className = "btn inline";
    viewTo3d.style.cssText = "font-size:11px;padding:2px 8px;color:#94a3b8;border-color:#334155";
    viewTo3d.textContent = "◈ 3D view";
    viewTo3d.title = "Switch to the 3D stacked-floor view";
    viewTo3d.addEventListener("click", async () => {
      viewTo3d.disabled = true;
      try { await ctx.actions.settingsSet({ overview_2d_mode: false }); }
      catch(e){ viewTo3d.disabled = false; if(ctx.toast) ctx.toast("Failed to switch view", true); }
    });
    filterBar.appendChild(viewTo3d);
    const sepView = document.createElement("span");
    sepView.style.cssText = "width:1px;height:16px;background:#334155;margin:0 2px";
    filterBar.appendChild(sepView);

    // Layer toggles (map image off by default — setup tool only) + room lines
    filterBar.appendChild(makeFilterBtn("mapImg", "Map", "#a78bfa"));
    filterBar.appendChild(makeFilterBtn("rooms", "Rooms", "#60a5fa"));
    // Separator
    const sep2d = document.createElement("span");
    sep2d.style.cssText = "width:1px;height:16px;background:#334155;margin:0 2px";
    filterBar.appendChild(sep2d);
    filterBar.appendChild(makeFilterBtn("scanners", "Scanners", "#52b788"));
    filterBar.appendChild(makeFilterBtn("tagged", "Tagged", "#5eead4"));
    filterBar.appendChild(makeFilterBtn("unknown", "Unknown", "#f59e0b"));

    // ── Radio Map & Distortion Map toggles (experimental, gated behind settings) ──
    if (_radioMapOn || _distortionOn) {
      const sep2d2 = document.createElement("span");
      sep2d2.style.cssText = "width:1px;height:16px;background:#334155;margin:0 2px";
      filterBar.appendChild(sep2d2);
      if (_radioMapOn) filterBar.appendChild(makeFilterBtn("radioMap", "Radio Map", "#e879f9"));
      if (_distortionOn) filterBar.appendChild(makeFilterBtn("distortion", "Distortion", "#fb923c"));
    }
    filterBar.appendChild(helpBtn("overview_2d_controls"));
    outer.appendChild(filterBar);

    // Scanner selector for per-scanner radio map (shown when radio map is active)
    const scannerBar = document.createElement("div");
    scannerBar.style.cssText = "display:none;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px";
    if (_radioMapOn) {
      _updateScannerBar = () => {
        if (!F.radioMap) { scannerBar.style.display = "none"; return; }
        scannerBar.style.display = "flex";
        scannerBar.innerHTML = "";
        const lbl = document.createElement("span");
        lbl.style.cssText = "font-size:11px;color:#94a3b8";
        lbl.textContent = "Scanner:";
        scannerBar.appendChild(lbl);
        // "Combined" button
        const combBtn = document.createElement("button");
        combBtn.className = "btn inline";
        combBtn.style.cssText = !_radioMapScanner
          ? "font-size:10px;padding:2px 8px;background:#0a2a1a;border-color:#e879f9;color:#e879f9;font-weight:700"
          : "font-size:10px;padding:2px 8px;color:#64748b";
        combBtn.textContent = "Combined";
        combBtn.addEventListener("click", () => {
          _radioMapScanner = null;
          ctx.state._2dRadioMapScanner = null;
          _updateScannerBar();
          svgDiv.innerHTML = buildSVG();
        });
        scannerBar.appendChild(combBtn);
        // Per-scanner buttons (from calibration data)
        const calScanners = ctx.state._2dCalScanners || [];
        for (const sc of calScanners) {
          const btn = document.createElement("button");
          btn.className = "btn inline";
          const isActive = _radioMapScanner === sc.source;
          btn.style.cssText = isActive
            ? "font-size:10px;padding:2px 8px;background:#0a2a1a;border-color:#e879f9;color:#e879f9;font-weight:700"
            : "font-size:10px;padding:2px 8px;color:#64748b";
          btn.textContent = (sc.name || sc.source).substring(0, 20);
          btn.addEventListener("click", () => {
            _radioMapScanner = sc.source;
            ctx.state._2dRadioMapScanner = sc.source;
            _updateScannerBar();
            svgDiv.innerHTML = buildSVG();
          });
          scannerBar.appendChild(btn);
        }
      };
      _updateScannerBar();
    }
    outer.appendChild(scannerBar);

    // ── Heatmap Gain & Contrast sliders ──────────────────────────────────
    const heatCtrlBar = document.createElement("div");
    heatCtrlBar.style.cssText = "display:none;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;padding:6px 10px;background:#0a1a12;border:1px solid #1a4228;border-radius:8px";
    if (_radioMapOn) {
      // Initialize from settings or defaults
      const _hGain = ctx.state.settings?.heatmap_gain ?? 0;
      const _hContrast = ctx.state.settings?.heatmap_contrast ?? 0;

      const gainSlider = document.createElement("input");
      gainSlider.type = "range"; gainSlider.min = "-20"; gainSlider.max = "20"; gainSlider.step = "1";
      gainSlider.value = String(_hGain);
      gainSlider.style.cssText = "width:100px;accent-color:#e879f9";
      const gainLbl = document.createElement("span");
      gainLbl.style.cssText = "font-size:10px;color:#d8b4fe;min-width:55px";
      gainLbl.textContent = `Gain: ${_hGain > 0 ? "+" : ""}${_hGain} dB`;

      const contrastSlider = document.createElement("input");
      contrastSlider.type = "range"; contrastSlider.min = "-15"; contrastSlider.max = "15"; contrastSlider.step = "1";
      contrastSlider.value = String(_hContrast);
      contrastSlider.style.cssText = "width:100px;accent-color:#e879f9";
      const contrastLbl = document.createElement("span");
      contrastLbl.style.cssText = "font-size:10px;color:#d8b4fe;min-width:75px";
      contrastLbl.textContent = `Contrast: ${_hContrast > 0 ? "+" : ""}${_hContrast}`;

      const saveBtn = document.createElement("button");
      saveBtn.className = "btn inline";
      saveBtn.style.cssText = "font-size:10px;padding:2px 8px;color:#52b788;border-color:#2d6a4f";
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", async () => {
        try {
          await ctx.actions.settingsSet({
            heatmap_gain: parseInt(gainSlider.value, 10),
            heatmap_contrast: parseInt(contrastSlider.value, 10),
          });
          ctx.toast("Heatmap settings saved");
        } catch(e) { ctx.toast("Failed to save", true); }
      });

      const _updateHeat = () => {
        const g = parseInt(gainSlider.value, 10);
        const c = parseInt(contrastSlider.value, 10);
        gainLbl.textContent = `Gain: ${g > 0 ? "+" : ""}${g} dB`;
        contrastLbl.textContent = `Contrast: ${c > 0 ? "+" : ""}${c}`;
        // Apply gain/contrast to the heatmap module
        if (_radioMapMod && _radioMapMod.setHatchRange) {
          // Store in state for buildSVG to use
          ctx.state._heatGain = g;
          ctx.state._heatContrast = c;
          svgDiv.innerHTML = buildSVG();
        }
      };
      gainSlider.addEventListener("input", _updateHeat);
      contrastSlider.addEventListener("input", _updateHeat);

      heatCtrlBar.appendChild(document.createTextNode(""));
      heatCtrlBar.append(
        gainLbl, gainSlider,
        contrastLbl, contrastSlider,
        saveBtn,
      );

      // Show/hide with radio map toggle
      const origUpdateScanner = _updateScannerBar;
      if (origUpdateScanner) {
        const wrappedUpdate = () => {
          origUpdateScanner();
          heatCtrlBar.style.display = F.radioMap ? "flex" : "none";
        };
        _updateScannerBar = wrappedUpdate;
        wrappedUpdate();
      } else {
        heatCtrlBar.style.display = F.radioMap ? "flex" : "none";
      }
    }
    outer.appendChild(heatCtrlBar);

    // Floor / Map selector (only if multiple visible maps)
    if(multiFloor){
      const mapBar = document.createElement("div");
      mapBar.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px";

      // Group maps by floor for the selector
      const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
      const floorGroups = new Map(); // floorLabel → [mapIndex, ...]
      for(let mi = 0; mi < visible.length; mi++){
        const m = visible[mi];
        const floorId = m.stack?.floor_id || m.floor_id || "";
        const haFlr = haFloors.find(f => String(f.id) === String(floorId));
        const flLbl = haFlr ? (haFlr.name || haFlr.id) : (m.name || m.id || `Map ${mi+1}`);
        if(!floorGroups.has(flLbl)) floorGroups.set(flLbl, []);
        floorGroups.get(flLbl).push(mi);
      }

      // If we have distinct floors, show floor buttons; otherwise fall back to map buttons
      const useFloors = floorGroups.size > 1 || (floorGroups.size === 1 && [...floorGroups.values()][0].length > 1);
      const lbl = document.createElement("span");
      lbl.style.cssText = "font-size:12px;color:#94a3b8";
      lbl.textContent = useFloors ? "Floor:" : "Map:";
      mapBar.appendChild(lbl);

      if(useFloors){
        for(const [floorName, mapIndices] of floorGroups){
          const isActive = mapIndices.includes(focusIdx);
          const fbtn = document.createElement("button");
          fbtn.className = "btn inline";
          fbtn.style.cssText = isActive
            ? "font-size:11px;padding:2px 10px;background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
            : "font-size:11px;padding:2px 10px;color:#94a3b8";
          fbtn.textContent = floorName;
          const firstIdx = mapIndices[0];
          fbtn.addEventListener("click", () => {
            ctx.state._2dFocusIdx = firstIdx;
            ctx.state._2dZoom = 1.0;
            ctx.state._2dPanX = 0;
            ctx.state._2dPanY = 0;
            ctx.actions.renderRooms();
          });
          mapBar.appendChild(fbtn);
          // If this floor has multiple maps and is active, show sub-buttons
          if(isActive && mapIndices.length > 1){
            for(const mi of mapIndices){
              const m = visible[mi];
              const sbtn = document.createElement("button");
              sbtn.className = "btn inline";
              sbtn.style.cssText = mi === focusIdx
                ? "font-size:10px;padding:1px 6px;background:#0a2a1a;border-color:#94a3b8;color:#e2e8f0;font-weight:600"
                : "font-size:10px;padding:1px 6px;color:#64748b";
              sbtn.textContent = m.name || m.id;
              const idx = mi;
              sbtn.addEventListener("click", () => {
                ctx.state._2dFocusIdx = idx;
                ctx.state._2dZoom = 1.0;
                ctx.state._2dPanX = 0;
                ctx.state._2dPanY = 0;
                ctx.actions.renderRooms();
              });
              mapBar.appendChild(sbtn);
            }
          }
        }
      } else {
        // Fallback: individual map buttons
        for(let mi = 0; mi < visible.length; mi++){
          const m = visible[mi];
          const mbtn = document.createElement("button");
          mbtn.className = "btn inline";
          mbtn.style.cssText = mi === focusIdx
            ? "font-size:11px;padding:2px 10px;background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
            : "font-size:11px;padding:2px 10px;color:#94a3b8";
          mbtn.textContent = m.name || m.id || `Map ${mi+1}`;
          const idx = mi;
          mbtn.addEventListener("click", () => {
            ctx.state._2dFocusIdx = idx;
            ctx.state._2dZoom = 1.0;
            ctx.state._2dPanX = 0;
            ctx.state._2dPanY = 0;
            ctx.actions.renderRooms();
          });
          mapBar.appendChild(mbtn);
        }
      }
      outer.appendChild(mapBar);
    }

    // SVG container with zoom/pan
    const svgWrap = document.createElement("div");
    svgWrap.style.cssText = "position:relative;overflow:hidden;border-radius:8px;background:#071008;cursor:grab;touch-action:none;width:100%";
    // Compute aspect-ratio container height: fill width, maintain aspect ratio
    const aspectPct = isStitched
      ? (wH / wW * 100).toFixed(2)
      : (imgH / imgW * 100).toFixed(2);
    svgWrap.style.paddingBottom = `${Math.min(80, Math.max(30, aspectPct))}%`;

    const svgDiv = document.createElement("div");
    svgDiv.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;transform-origin:0 0`;
    svgDiv.innerHTML = buildSVG();

    // Zoom/pan logic
    let zoom = ctx.state._2dZoom;
    let panX = ctx.state._2dPanX;
    let panY = ctx.state._2dPanY;
    let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

    const applyTransform = () => {
      svgDiv.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    };
    applyTransform();

    svgWrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = svgWrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = zoom;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.max(0.5, Math.min(8, zoom * delta));
      // Zoom toward cursor
      panX = mx - (mx - panX) * (zoom / oldZoom);
      panY = my - (my - panY) * (zoom / oldZoom);
      ctx.state._2dZoom = zoom;
      ctx.state._2dPanX = panX;
      ctx.state._2dPanY = panY;
      applyTransform();
    }, { passive: false });

    svgWrap.addEventListener("pointerdown", (e) => {
      if(e.button !== 0) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      svgWrap.style.cursor = "grabbing";
      svgWrap.setPointerCapture(e.pointerId);
    });
    svgWrap.addEventListener("pointermove", (e) => {
      if(!dragging) return;
      panX = panStartX + (e.clientX - dragStartX);
      panY = panStartY + (e.clientY - dragStartY);
      ctx.state._2dPanX = panX;
      ctx.state._2dPanY = panY;
      applyTransform();
    });
    const endDrag = () => {
      dragging = false;
      svgWrap.style.cursor = "grab";
    };
    svgWrap.addEventListener("pointerup", endDrag);
    svgWrap.addEventListener("pointercancel", endDrag);

    // Reset zoom button
    const resetBtn = document.createElement("button");
    resetBtn.className = "btn inline";
    resetBtn.style.cssText = "position:absolute;top:6px;right:6px;z-index:2;font-size:11px;padding:2px 8px;background:#071008cc;color:#94a3b8";
    resetBtn.textContent = "Reset zoom";
    resetBtn.addEventListener("click", () => {
      zoom = 1.0; panX = 0; panY = 0;
      ctx.state._2dZoom = 1; ctx.state._2dPanX = 0; ctx.state._2dPanY = 0;
      applyTransform();
    });

    // Click handler for 2D SVG: scanners and objects
    svgDiv.addEventListener("click", (e) => {
      // Scanner click
      const sg = e.target.closest("[data-scanner-src]");
      if (sg) {
        const src = sg.getAttribute("data-scanner-src");
        if (src) {
          const radio = liveRadios.find(r => r.source === src);
          if (radio) { ctx.actions.showScannerDetail(radio); return; }
        }
      }
      // Object click
      const og = e.target.closest("[data-obj-key]");
      if (og) {
        const objKey = og.getAttribute("data-obj-key");
        if (objKey) {
          const obj = objects.find(o =>
            (o.key||"") === objKey || (o.address||"") === objKey || (o.entity_id||"") === objKey);
          if (obj) ctx.actions.showObjectDetail(obj);
        }
      }
    });

    svgWrap.appendChild(svgDiv);
    svgWrap.appendChild(resetBtn);
    outer.appendChild(svgWrap);

    return outer;
  }
