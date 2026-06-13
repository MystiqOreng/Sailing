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
    this._bindInput();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.dpr = dpr;
    this.w = r.width; this.h = r.height;
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
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.drawBaseChart();
    const ov = this.state.settings.overlays;
    if (ov.graticule) this.drawGraticule();
    if (ov.current) this.drawCurrentField();
    if (ov.wind) this.drawWindField();
    if (ov.labels) this.drawLabels();
    this.drawAnchorages();
    if (ov.route) this.drawRoute();
    this.drawDestination();
    if (ov.laylines) this.drawLaylines();
    this.drawBoat();
    this.drawScaleBar();
    this.drawAttribution();
    ctx.restore();
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
    const gap = 80; // px between arrows
    const tide = this.state.tide;
    for (let px = gap / 2; px < this.w; px += gap) {
      for (let py = gap / 2; py < this.h; py += gap) {
        const w = this.s2w(px, py);
        if (this.world.isOnLand(w.x, w.z)) continue;
        const cur = tide.currentAt(w.x, w.z);
        if (cur.kn < 0.15) continue;
        const dir = vecToDir(cur.x, cur.z);
        const len = clamp(8 + cur.kn * 14, 10, 52);
        const alpha = clamp(0.25 + cur.kn * 0.3, 0.25, 0.9);
        // animate: arrows drift along their direction
        const v = dirToVec(dir);
        const off = (this.animPhase * gap * 0.4) % (gap * 0.4);
        const ax = px + v.x * (off - gap * 0.2);
        const ay = py + v.z * (off - gap * 0.2);
        this._arrow(ax, ay, dir, len, `rgba(11,109,168,${alpha})`, cur.kn >= 1.5 ? 2.4 : 1.6);
        if (cur.kn >= 1 && this.mPerPx < 25) {
          ctx.fillStyle = COL.current; ctx.font = '10px Helvetica, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(cur.kn.toFixed(1), px, py + 16);
        }
      }
    }
  }

  drawWindField() {
    // Chart overlay shows where the wind is blowing TO (spec).
    const wind = this.state.wind;
    const dirTo = norm360(wind.fromDeg + 180);
    const gap = 110;
    const len = clamp(10 + wind.speedKn, 14, 44);
    for (let px = gap / 2; px < this.w; px += gap)
      for (let py = gap / 2; py < this.h; py += gap)
        this._arrow(px, py, dirTo, len, COL.wind, 1.4);
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

    // current at boat (blowing-to arrow, blue)
    if (boat.currentKn > 0.15) {
      const cur = dirToVec(boat.currentDirDeg);
      const cl = 14 + boat.currentKn * 12;
      this._lineArrow(p, { x: p.x + cur.x * cl, y: p.y + cur.z * cl }, COL.current, 2);
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

  drawAttribution() {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(51,71,92,0.75)';
    ctx.font = '10px Helvetica';
    ctx.textAlign = 'right';
    ctx.fillText('Chart data © OpenStreetMap contributors (ODbL) — NOT FOR NAVIGATION', this.w - 8, this.h - 8);
  }
}
