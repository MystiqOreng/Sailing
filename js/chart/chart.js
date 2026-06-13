// Chart view: 2D canvas, paper-chart styling, pan/pinch/wheel zoom,
// tactical overlays (current field, wind field, laylines, route, vectors).
//
// This module is deliberately self-contained: a future licensed chart layer
// (e.g. raster tiles or S-57 derived vectors) replaces/augments
// drawBaseChart() only — overlays and interaction stay unchanged.

import {
  llToWorld, worldToLL, dirToVec, norm360, toMagnetic, fmtDeg, fmtNm,
  NM_M, clamp, vecToDir,
} from '../util/geo.js';

const COL = {
  water: '#cfe2ec',
  waterDeep: '#dceaf2',
  shallow: '#a8cfe0',
  shallower: '#8fc3da',
  land: '#f2ecc8',
  landEdge: '#9a8f5f',
  green: '#cfe0b4',
  reef: '#7fccc2',
  reefFlat: 'rgba(122, 201, 176, 0.55)',  // fringing coral reef flat band
  reefEdge: 'rgba(45, 138, 120, 0.6)',
  shoal: 'rgba(127, 204, 194, 0.55)',
  label: '#41566b',
  anchorage: '#7a2e8e',
  boat: '#b3261e',
  cog: '#1c6b30',
  layline: 'rgba(179, 38, 30, 0.65)',
  laylineStbd: 'rgba(28, 107, 48, 0.75)',
  route: '#2456a8',
  current: '#0b6da8',
  wind: 'rgba(60, 90, 140, 0.55)',
  grat: 'rgba(80, 110, 140, 0.25)',
};

export class Chart {
  constructor(canvas, world, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.state = state; // shared app state: boat, wind, tide, settings, route
    this.center = { x: 0, z: 0 };
    this.mPerPx = 28;
    this.followBoat = true;
    this.routeEdit = false;
    this.animPhase = 0;

    // Basemap: 'offline' = the vendored canvas chart (works with no network);
    // 'osm'/'sat' = OpenLayers slippy map (OSM or Esri satellite) + OpenSeaMap
    // seamarks, synced under the canvas overlays. Online modes show far richer
    // reef/seamark detail; offline stays fully self-contained.
    this.osmEl = document.getElementById('chart-osm');
    this.olMap = null;
    this.baseMode = localStorage.getItem('sail-whitsundays-basemode') || 'offline';

    // animated wind streamlines (world-space tracer particles)
    this._windTraces = [];
    this._traceTarget = 0;
    this._islandEllipses = null;
    this._passages = null;

    this._bindInput();
  }

  get online() { return this.baseMode !== 'offline' && typeof ol !== 'undefined'; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.dpr = dpr;
    this.w = r.width; this.h = r.height;
    // ~1 trace per 3500 px², bounded — keeps the wind layer legible at any size
    this._traceTarget = clamp(Math.round((this.w * this.h) / 3500), 80, 280);
    if (this.olMap) this.olMap.updateSize();
  }

  s2w(px, py) {
    return {
      x: this.center.x + (px - this.w / 2) * this.mPerPx,
      z: this.center.z + (py - this.h / 2) * this.mPerPx,
    };
  }
  w2s(x, z) {
    return {
      x: this.w / 2 + (x - this.center.x) / this.mPerPx,
      y: this.h / 2 + (z - this.center.z) / this.mPerPx,
    };
  }

  zoomBy(f, px, py) {
    const before = this.s2w(px ?? this.w / 2, py ?? this.h / 2);
    this.mPerPx = clamp(this.mPerPx * f, 1.5, 90);
    const after = this.s2w(px ?? this.w / 2, py ?? this.h / 2);
    this.center.x += before.x - after.x;
    this.center.z += before.z - after.z;
  }

  _bindInput() {
    const c = this.canvas;
    const pointers = new Map();
    let pinchDist = 0, moved = false;

    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      moved = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    c.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const cur = { x: e.offsetX, y: e.offsetY };
      if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 3) moved = true;
      if (pointers.size === 1) {
        this.center.x -= (cur.x - prev.x) * this.mPerPx;
        this.center.z -= (cur.y - prev.y) * this.mPerPx;
        this.followBoat = false;
      } else if (pointers.size === 2) {
        pointers.set(e.pointerId, cur);
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          this.zoomBy(pinchDist / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
          this.followBoat = false;
        }
        pinchDist = d;
        return;
      }
      pointers.set(e.pointerId, cur);
    });
    const up = e => {
      if (pointers.has(e.pointerId) && !moved && pointers.size === 1 && this.routeEdit) {
        const w = this.s2w(e.offsetX, e.offsetY);
        this.state.route.push(w);
      }
      pointers.delete(e.pointerId);
      pinchDist = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomBy(Math.pow(1.0016, e.deltaY), e.offsetX, e.offsetY);
      this.followBoat = false;
    }, { passive: false });
  }

  centerOnBoat() {
    this.followBoat = true;
  }

  render(dt) {
    const { ctx } = this;
    this.animPhase = (this.animPhase + dt * 0.4) % 1;
    if (this.followBoat) {
      this.center.x = this.state.boat.x;
      this.center.z = this.state.boat.z;
    }

    // sync the slippy basemap (if any) to the canvas view, or hide it
    const online = this.online;
    if (online) {
      this._ensureOSM();
      if (this.osmEl) this.osmEl.style.display = 'block';
      this._syncOSM();
    } else if (this.osmEl) {
      this.osmEl.style.display = 'none';
    }

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.w, this.h); // transparent so the basemap shows in online modes
    const ov = this.state.settings.overlays;
    if (!online) {
      this.drawBaseChart();
      if (ov.graticule) this.drawGraticule();
    }
    if (ov.current) this.drawCurrentField();
    if (ov.wind) this.drawWindField(dt);
    if (ov.labels) this.drawLabels();
    this.drawAnchorages();
    if (ov.route) this.drawRoute();
    this.drawDestination();
    if (ov.laylines) this.drawLaylines();
    this.drawBoat();
    this.drawScaleBar();
    this.drawAttribution(online);
    ctx.restore();
  }

  // ---- OpenLayers basemap (online: OSM / Esri satellite + OpenSeaMap) ----
  setBaseMode(mode) {
    this.baseMode = mode;
    localStorage.setItem('sail-whitsundays-basemode', mode);
    if (this.online) {
      this._ensureOSM();
      this._applyBaseLayers();
      if (this.olMap) this.olMap.updateSize();
      if (this.osmEl) this.osmEl.style.display = 'block';
      this._syncOSM();
    } else if (this.osmEl) {
      this.osmEl.style.display = 'none';
    }
  }

  _ensureOSM() {
    if (this.olMap || typeof ol === 'undefined' || !this.osmEl) return;
    const osm = new ol.layer.Tile({ source: new ol.source.OSM(), visible: false });
    const sat = new ol.layer.Tile({
      visible: false,
      source: new ol.source.XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: 'Imagery © Esri, Maxar, Earthstar Geographics', maxZoom: 19,
      }),
    });
    const seamark = new ol.layer.Tile({
      visible: false, opacity: 0.95,
      source: new ol.source.XYZ({
        url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
        attributions: '© OpenSeaMap contributors', crossOrigin: 'anonymous', maxZoom: 18,
      }),
    });
    this._olLayers = { osm, sat, seamark };
    this.olMap = new ol.Map({
      target: this.osmEl,
      layers: [osm, sat, seamark],
      controls: [new ol.control.Attribution({ collapsible: false })],
      interactions: [], // the canvas on top drives pan/zoom; OL just follows
      view: new ol.View({
        center: ol.proj.fromLonLat([148.95, -20.27]),
        zoom: 11, constrainResolution: false,
      }),
    });
    this._applyBaseLayers();
  }

  _applyBaseLayers() {
    if (!this._olLayers) return;
    const m = this.baseMode;
    this._olLayers.osm.setVisible(m === 'osm');
    this._olLayers.sat.setVisible(m === 'sat');
    this._olLayers.seamark.setVisible(m === 'osm' || m === 'sat'); // seamarks on both
  }

  _syncOSM() {
    if (!this.olMap) return;
    const ll = worldToLL(this.center.x, this.center.z);
    const view = this.olMap.getView();
    view.setCenter(ol.proj.fromLonLat([ll.lon, ll.lat]));
    // app mPerPx is true ground metres; Web Mercator resolution is inflated by
    // 1/cos(lat), so divide to keep the boat (near centre) aligned with tiles
    view.setResolution(this.mPerPx / Math.cos(ll.lat * Math.PI / 180));
  }

  drawBaseChart() {
    const { ctx } = this;
    ctx.fillStyle = COL.water;
    ctx.fillRect(0, 0, this.w, this.h);

    // shallow fringe: wide soft strokes under the land give a fringing-
    // shoal band consistent with the depth proxy in world.js
    ctx.lineJoin = 'round';
    for (const [width, col] of [[1100, COL.waterDeep], [450, COL.shallow], [180, COL.shallower]]) {
      const px = width / this.mPerPx;
      if (px < 1.5) continue;
      ctx.lineWidth = px; ctx.strokeStyle = col;
      for (const poly of this.world.landPolys) {
        ctx.beginPath(); this._tracePoly(poly.pts); ctx.stroke();
      }
    }

    // shoal patches
    for (const s of this.world.shoals) {
      const p = this.w2s(s.x, s.z);
      const r = s.radiusM / this.mPerPx;
      if (r < 2) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
      ctx.fillStyle = COL.shoal; ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#3d9a8e'; ctx.lineWidth = 1; ctx.stroke();
      ctx.setLineDash([]);
      if (this.mPerPx < 12) {
        ctx.fillStyle = '#256158'; ctx.font = 'italic 11px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${s.name} (${s.minDepthM}m)`, p.x, p.y - r - 4);
      }
    }

    // fringing coral reef flats around the islands. The Whitsunday islands are
    // almost all reef-fringed, but OSM carries only a handful of reef polygons,
    // so this draws a schematic reef-flat band hugging island shores from the
    // coastline itself. Centred on the shoreline; the land fill on top covers
    // the inner half, leaving a reef ring just offshore. (NOT FOR NAVIGATION.)
    const reefPx = 240 / this.mPerPx;
    if (reefPx >= 2) {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = reefPx; ctx.strokeStyle = COL.reefFlat;
      for (const poly of this.world.landPolys) {
        if (poly.kind === 'mainland') continue; // islands are the reef-fringed ones
        ctx.beginPath(); this._tracePoly(poly.pts); ctx.stroke();
      }
    }

    // reefs from OSM
    for (const poly of this.world.reefPolys) {
      ctx.beginPath(); this._tracePoly(poly.pts);
      ctx.fillStyle = COL.reef; ctx.fill();
    }

    // land
    for (const poly of this.world.landPolys) {
      ctx.beginPath(); this._tracePoly(poly.pts);
      ctx.fillStyle = poly.kind === 'mainland' ? COL.land : COL.green;
      ctx.fill();
      ctx.strokeStyle = COL.landEdge; ctx.lineWidth = 1.1; ctx.stroke();
    }
  }

  _tracePoly(pts) {
    const { ctx } = this;
    let started = false;
    for (const pt of pts) {
      const p = this.w2s(pt.x, pt.z);
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  drawGraticule() {
    const { ctx } = this;
    ctx.strokeStyle = COL.grat; ctx.lineWidth = 1;
    ctx.fillStyle = COL.label; ctx.font = '10px Georgia, serif';
    const tl = worldToLL(...Object.values(this.s2w(0, 0)));
    const br = worldToLL(...Object.values(this.s2w(this.w, this.h)));
    const step = this.mPerPx > 30 ? 0.1 : 0.05; // degrees
    for (let lon = Math.ceil(tl.lon / step) * step; lon < br.lon; lon += step) {
      const p = this.w2s(llToWorld(lon, tl.lat).x, 0);
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, this.h); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText(`${lon.toFixed(2)}°E`, p.x + 2, 12);
    }
    for (let lat = Math.ceil(br.lat / step) * step; lat < tl.lat; lat += step) {
      const p = this.w2s(0, llToWorld(tl.lon, lat).z);
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(this.w, p.y); ctx.stroke();
      ctx.fillText(`${Math.abs(lat).toFixed(2)}°S`, 2, p.y - 3);
    }
  }

  drawCurrentField() {
    const { ctx } = this;
    const gap = 76; // px between arrows
    const tide = this.state.tide;
    for (let px = gap / 2; px < this.w; px += gap) {
      for (let py = gap / 2; py < this.h; py += gap) {
        const w = this.s2w(px, py);
        if (!this.online && this.world.isOnLand(w.x, w.z)) continue;
        const cur = tide.currentAt(w.x, w.z);
        if (cur.kn < 0.15) continue;
        const dir = vecToDir(cur.x, cur.z);
        const len = clamp(10 + cur.kn * 13, 12, 54);
        // red tidal arrows (distinct from the blue wind streamlines), graded
        // from light orange-red in a weak set to deep red in the strong races
        const t = clamp(cur.kn / 3, 0, 1);
        const alpha = clamp(0.45 + cur.kn * 0.3, 0.45, 0.95);
        const col = `rgba(200, ${Math.round(92 - t * 56)}, ${Math.round(70 - t * 44)}, ${alpha})`;
        // animate: arrows drift along their set
        const v = dirToVec(dir);
        const off = (this.animPhase * gap * 0.4) % (gap * 0.4);
        const ax = px + v.x * (off - gap * 0.2);
        const ay = py + v.z * (off - gap * 0.2);
        this._fillArrow(ax, ay, dir, len, col, 1.6 + t * 1.8);
        if (cur.kn >= 1 && this.mPerPx < 25) {
          ctx.fillStyle = '#b42318';
          ctx.font = 'bold 10px Helvetica, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(cur.kn.toFixed(1), px, py + 17);
        }
      }
    }
  }

  // Arrow with a solid filled head; centred on (px,py) along dirDeg.
  _fillArrow(px, py, dirDeg, len, color, width = 1.6) {
    const { ctx } = this;
    const v = dirToVec(dirDeg);
    const x2 = px + v.x * len / 2, y2 = py + v.z * len / 2;
    const x1 = px - v.x * len / 2, y1 = py - v.z * len / 2;
    const a = Math.atan2(v.z, v.x);
    const hs = Math.max(5, len * 0.3);
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - v.x * hs * 0.6, y2 - v.z * hs * 0.6); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hs * Math.cos(a - 0.42), y2 - hs * Math.sin(a - 0.42));
    ctx.lineTo(x2 - hs * Math.cos(a + 0.42), y2 - hs * Math.sin(a + 0.42));
    ctx.closePath(); ctx.fill();
  }

  // Animated wind streamlines: tracer particles advected through a wind field
  // that bends and shelters around islands and funnels through the passages —
  // ported from the whitsunday-chart-view prototype into world coordinates.
  drawWindField(dt) {
    const { ctx } = this;
    if (!this._islandEllipses) this._buildWindGeometry();

    // top up the trace pool, seeding new traces across the current view
    while (this._windTraces.length < this._traceTarget) this._windTraces.push(this._spawnTrace());
    if (this._windTraces.length > this._traceTarget) this._windTraces.length = this._traceTarget;

    // visual speed is held roughly constant on screen across zoom levels
    const worldPerSec = 46 * this.mPerPx;
    const margin = 80 * this.mPerPx;

    ctx.lineCap = 'round';
    for (const t of this._windTraces) {
      const f = this._windFieldAt(t.x, t.z);
      const mag = Math.hypot(f.vx, f.vz) || 1;
      const sp = clamp(mag, 0.12, 1.8);
      t.x += (f.vx / mag) * worldPerSec * sp * dt;
      t.z += (f.vz / mag) * worldPerSec * sp * dt;
      t.alpha = clamp(0.25 + sp * 0.5, 0.12, 0.95);
      t.hist.push([t.x, t.z]);
      if (t.hist.length > 16) t.hist.shift();
      t.age += dt;

      const s = this.w2s(t.x, t.z);
      if (t.age > t.maxAge || s.x < -margin / this.mPerPx || s.x > this.w + margin / this.mPerPx
          || s.y < -margin / this.mPerPx || s.y > this.h + margin / this.mPerPx) {
        Object.assign(t, this._spawnTrace());
        continue;
      }

      if (t.hist.length < 2) continue;
      for (let i = 1; i < t.hist.length; i++) {
        const a = this.w2s(t.hist[i - 1][0], t.hist[i - 1][1]);
        const b = this.w2s(t.hist[i][0], t.hist[i][1]);
        const fade = i / t.hist.length;
        ctx.strokeStyle = `rgba(8, 118, 196, ${(0.12 + fade * 0.42) * t.alpha})`;
        ctx.lineWidth = 1.4 + fade * 2.0;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
  }

  _spawnTrace() {
    const w = this.s2w(Math.random() * this.w, Math.random() * this.h);
    return { x: w.x, z: w.z, age: 0, maxAge: 2.5 + Math.random() * 3.5, alpha: 0.6, hist: [[w.x, w.z]] };
  }

  // Build island ellipses (for sheltering) and passage corridors (for
  // funnelling) once, in world metres, from the loaded chart data.
  _buildWindGeometry() {
    this._islandEllipses = [];
    for (const poly of this.world.landPolys) {
      if (poly.kind === 'mainland') continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, sx = 0, sz = 0;
      for (const p of poly.pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        sx += p.x; sz += p.z;
      }
      const rx = (maxX - minX) / 2, rz = (maxZ - minZ) / 2;
      if (Math.max(rx, rz) < 300) continue; // skip specks
      this._islandEllipses.push({ cx: sx / poly.pts.length, cz: sz / poly.pts.length, rx, rz });
    }
    // passages: the sim's current zones already mark them (skip the broad
    // background zone). axis angle = the flood set direction.
    this._passages = (this.world.detail.currentZones || [])
      .filter(z => z.radiusM < 6000)
      .map(z => {
        const w = llToWorld(z.lon, z.lat);
        const v = dirToVec(z.floodDirDeg);
        return { x: w.x, z: w.z, r: z.radiusM * 1.6, ang: Math.atan2(v.z, v.x) };
      });
  }

  // Wind vector (world x/z, magnitude is a relative speed factor) at a point.
  _windFieldAt(wx, wz) {
    const toDeg = norm360(this.state.wind.fromDeg + 180);
    const base = dirToVec(toDeg);
    const baseAng = Math.atan2(base.z, base.x);
    let spd = 1, bend = 0;

    for (const e of this._islandEllipses) {
      const dx = wx - e.cx, dz = wz - e.cz;
      const body = (dx / e.rx) ** 2 + (dz / e.rz) ** 2;
      if (body < 1) { spd *= 0.10; continue; } // calm over/behind the land
      // lee shadow: a circle offset downwind of the island centre
      const lx = dx - base.x * e.rx * 1.2, lz = dz - base.z * e.rz * 1.2;
      const lee = (lx / (e.rx * 1.8)) ** 2 + (lz / (e.rz * 1.8)) ** 2;
      if (lee < 1) spd *= 0.35 + lee * 0.4;
      // shoulders: slight acceleration and deflection around the edges
      if (body < 2.2) {
        const k = (2.2 - body) / 1.2;
        spd *= 1 + 0.18 * k;
        const tangent = Math.atan2(dz, dx) + Math.PI / 2;
        bend += Math.sin(tangent - baseAng) * 0.14 * k;
      }
    }

    for (const p of this._passages) {
      const dx = wx - p.x, dz = wz - p.z, d = Math.hypot(dx, dz);
      if (d < p.r) {
        const aligned = Math.abs(Math.cos(baseAng - p.ang));
        spd *= 1 + (1 - d / p.r) * aligned * 0.5;
      }
    }

    const ang = baseAng + bend;
    return { vx: Math.cos(ang) * spd, vz: Math.sin(ang) * spd };
  }

  _arrow(px, py, dirDeg, len, color, width = 1.6) {
    const { ctx } = this;
    const v = dirToVec(dirDeg);
    const x2 = px + v.x * len / 2, y2 = py + v.z * len / 2;
    const x1 = px - v.x * len / 2, y1 = py - v.z * len / 2;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    const a = Math.atan2(v.z, v.x);
    const hs = Math.max(4, len * 0.22);
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hs * Math.cos(a - 0.45), y2 - hs * Math.sin(a - 0.45));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hs * Math.cos(a + 0.45), y2 - hs * Math.sin(a + 0.45));
    ctx.stroke();
  }

  drawLabels() {
    const { ctx } = this;
    for (const l of this.world.detail.labels) {
      const w = llToWorld(l.lon, l.lat);
      const p = this.w2s(w.x, w.z);
      if (p.x < -100 || p.x > this.w + 100 || p.y < -50 || p.y > this.h + 50) continue;
      const size = l.size * (l.italic ? 1 : 1);
      if (this.mPerPx > 60 && size < 11) continue;
      ctx.font = `${l.italic ? 'italic ' : ''}${size + 2}px Georgia, serif`;
      ctx.fillStyle = l.italic ? '#5b7b96' : COL.label;
      ctx.textAlign = 'center';
      ctx.fillText(l.name, p.x, p.y);
    }
  }

  drawAnchorages() {
    const { ctx } = this;
    if (this.mPerPx > 45) return;
    for (const a of this.world.anchorages) {
      const p = this.w2s(a.x, a.z);
      if (p.x < -20 || p.x > this.w + 20 || p.y < -20 || p.y > this.h + 20) continue;
      ctx.strokeStyle = COL.anchorage; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 1, 4.5, 0.35 * Math.PI, 0.65 * Math.PI, false); // anchor flukes
      ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 3);
      ctx.moveTo(p.x - 3.4, p.y - 4.4); ctx.lineTo(p.x + 3.4, p.y - 4.4);
      ctx.stroke();
      if (this.mPerPx < 18) {
        ctx.fillStyle = COL.anchorage; ctx.font = '11px Georgia, serif';
        ctx.textAlign = 'left';
        ctx.fillText(a.name, p.x + 8, p.y + 4);
      }
    }
  }

  drawDestination() {
    const dest = this.state.destination;
    if (!dest) return;
    const { ctx } = this;
    const p = this.w2s(dest.x, dest.z);
    const b = this.w2s(this.state.boat.x, this.state.boat.z);
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = COL.route; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.setLineDash([]);
    // flag
    ctx.fillStyle = COL.route;
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.stroke();
    // bearing / distance (magnetic, nm)
    const dx = dest.x - this.state.boat.x, dz = dest.z - this.state.boat.z;
    const brg = toMagnetic(vecToDir(dx, dz));
    const distM = Math.hypot(dx, dz);
    ctx.fillStyle = COL.route; ctx.font = 'bold 12px Helvetica, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${dest.name}  ${fmtDeg(brg)}M  ${fmtNm(distM)} nm`, p.x + 10, p.y - 8);
  }

  drawLaylines() {
    const { ctx } = this;
    const boat = this.state.boat;
    const chDeg = boat.closeHauledDeg;
    const from = this.state.wind.fromDeg;
    const b = this.w2s(boat.x, boat.z);
    const lenM = 12 * NM_M;
    for (const [sign, col] of [[1, COL.laylineStbd], [-1, COL.layline]]) {
      // line the boat would make good close-hauled on each tack (through water)
      const tackDir = dirToVec(norm360(from + sign * chDeg));
      const e = this.w2s(boat.x + tackDir.x * lenM, boat.z + tackDir.z * lenM);
      ctx.setLineDash([10, 7]);
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawRoute() {
    const { ctx } = this;
    const route = this.state.route;
    if (!route.length) return;
    let prev = { x: this.state.boat.x, z: this.state.boat.z };
    let prevS = this.w2s(prev.x, prev.z);
    ctx.strokeStyle = COL.route;
    for (let i = 0; i < route.length; i++) {
      const wp = route[i];
      const p = this.w2s(wp.x, wp.z);
      ctx.lineWidth = 2; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(prevS.x, prevS.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.fill();
      ctx.strokeStyle = COL.route; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.stroke();
      ctx.fillStyle = COL.route; ctx.font = 'bold 10px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), p.x, p.y + 3.5);
      // leg label: magnetic bearing + distance (judgement aid, no ETA — by design)
      const brg = toMagnetic(vecToDir(wp.x - prev.x, wp.z - prev.z));
      const d = Math.hypot(wp.x - prev.x, wp.z - prev.z);
      ctx.font = '10px Helvetica'; ctx.textAlign = 'left';
      ctx.fillText(`${fmtDeg(brg)}M ${fmtNm(d)}nm`, (prevS.x + p.x) / 2 + 6, (prevS.y + p.y) / 2 - 4);
      prev = wp; prevS = p;
    }
  }

  drawBoat() {
    const { ctx } = this;
    const boat = this.state.boat;
    const p = this.w2s(boat.x, boat.z);

    // COG vector: position in 6 minutes over ground
    const sogM6 = boat.sogKn * NM_M / 10;
    const cv = dirToVec(boat.cogDeg);
    const ce = this.w2s(boat.x + cv.x * sogM6, boat.z + cv.z * sogM6);
    this._lineArrow(p, ce, COL.cog, 2);

    // HDG line (thin, no arrowhead)
    const hv = dirToVec(boat.headingDeg);
    const he = this.w2s(boat.x + hv.x * sogM6 * 1.1, boat.z + hv.z * sogM6 * 1.1);
    ctx.strokeStyle = COL.boat; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(he.x, he.y); ctx.stroke();

    // current at boat (set arrow, red — matches the tidal field)
    if (boat.currentKn > 0.15) {
      const cur = dirToVec(boat.currentDirDeg);
      const cl = 14 + boat.currentKn * 12;
      this._lineArrow(p, { x: p.x + cur.x * cl, y: p.y + cur.z * cl }, '#b42318', 2);
    }

    // boat symbol
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(boat.headingDeg * Math.PI / 180);
    ctx.fillStyle = COL.boat;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.quadraticCurveTo(5, -2, 4, 7);
    ctx.lineTo(-4, 7); ctx.quadraticCurveTo(-5, -2, 0, -9);
    ctx.fill();
    ctx.restore();
  }

  _lineArrow(a, b, color, width) {
    const { ctx } = this;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 7 * Math.cos(ang - 0.42), b.y - 7 * Math.sin(ang - 0.42));
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 7 * Math.cos(ang + 0.42), b.y - 7 * Math.sin(ang + 0.42));
    ctx.stroke();
  }

  drawScaleBar() {
    const { ctx } = this;
    const targetPx = 120;
    const nmOptions = [0.1, 0.25, 0.5, 1, 2, 5, 10];
    let nm = nmOptions[0];
    for (const o of nmOptions) if (o * NM_M / this.mPerPx < targetPx * 1.4) nm = o;
    const px = nm * NM_M / this.mPerPx;
    const x = 16, y = this.h - 22;
    ctx.strokeStyle = '#33475c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
    ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4);
    ctx.stroke();
    ctx.fillStyle = '#33475c'; ctx.font = '11px Helvetica';
    ctx.textAlign = 'center';
    ctx.fillText(`${nm} nm`, x + px / 2, y - 7);
  }

  drawAttribution(online) {
    const { ctx } = this;
    ctx.fillStyle = online ? 'rgba(20,30,40,0.85)' : 'rgba(51,71,92,0.75)';
    ctx.font = '10px Helvetica';
    ctx.textAlign = 'right';
    // online tile attributions are shown by the OpenLayers control itself
    const text = online
      ? 'NOT FOR NAVIGATION'
      : 'Chart data © OpenStreetMap contributors (ODbL) — NOT FOR NAVIGATION';
    ctx.fillText(text, this.w - 8, online ? 26 : this.h - 8);
  }
}
