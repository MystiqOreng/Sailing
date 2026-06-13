// Tide and tidal stream model.
//
// A single semidiurnal curve drives the whole region (adequate for the
// prototype; the Whitsundays are strongly semidiurnal). Stream rate follows
// the rate of change of height: max flood mid-rising, max ebb mid-falling.
//
// Currents come from hand-digitised zones (data/chart-detail.json) with a
// gaussian falloff; overlapping zones blend by strength. Flood direction is
// the zone's floodDirDeg; the ebb is the reciprocal. Streams in the
// Whitsundays flood SOUTH through the passages (per 100 Magic Miles), which
// is what the bundled zone data encodes.
//
// ===== TUNING: zone positions/rates are in data/chart-detail.json;
//       the curve + scaling behaviour is here =====

import { TIDE_DEFAULTS } from '../config/environment.js';
import { llToWorld, dirToVec, KN_TO_MS } from '../util/geo.js';

export class Tide {
  constructor(settings, zonesLL) {
    this.settings = settings;
    this.periodS = TIDE_DEFAULTS.periodH * 3600;
    this.zones = zonesLL.map(z => ({
      ...z,
      ...llToWorld(z.lon, z.lat),
      sigma: z.radiusM,
      floodVec: dirToVec(z.floodDirDeg),
    }));
    this.clockS = 0;      // tide clock, seconds since an arbitrary high water
    this.heightM = 0;
    this.streamFactor = 0; // -1 (max ebb) … +1 (max flood)
    this.ref = null;       // predicted-tide reference (see setReference)
    this._simTime = null;  // last sim clock (s since midnight), for ref mode
  }

  setClockHours(h) { this.clockS = h * 3600; }

  // Predicted tide from the next HW and next LW (Hamilton Island reference).
  // We build a periodic half-cycle between the two events and read height +
  // stream off it. Height is a raised cosine (the smooth form the rule of
  // twelfths approximates); the stream is its rate of change, which traces the
  // 1·2·3·3·2·1 twelfths profile — slack at the turns, fastest at mid-tide.
  setReference(ref) {
    if (!ref || !ref.enabled) { this.ref = null; return; }
    const a = parseHHMM(ref.hwTime), b = parseHHMM(ref.lwTime);
    const ah = Number(ref.hwHeightM), bh = Number(ref.lwHeightM);
    if (a == null || b == null || !isFinite(ah) || !isFinite(bh)) { this.ref = null; return; }
    // order the two events chronologically (either may be HW or LW)
    const ev = [{ t: a, h: ah }, { t: b, h: bh }].sort((p, q) => p.t - q.t);
    let half = ev[1].t - ev[0].t;
    if (half <= 0) half += 24 * 3600; // next event is after midnight
    this.ref = { t0: ev[0].t, h0: ev[0].h, h1: ev[1].h, half };
  }

  // Bracketing events around the current sim time, in ref mode.
  _refBracket() {
    const { t0, h0, h1, half } = this.ref;
    const k = Math.floor((this._simTime - t0) / half);
    const even = (((k % 2) + 2) % 2) === 0;
    const tA = t0 + k * half;
    const f = Math.min(1, Math.max(0, (this._simTime - tA) / half));
    return { f, hA: even ? h0 : h1, hB: even ? h1 : h0, tB: tA + half };
  }

  advance(dt, simTime = null) {
    this.clockS += dt;
    if (simTime != null) this._simTime = simTime;
    const halfRange = this.settings.tideRangeM / 2;
    const refActive = this.ref && this._simTime != null;
    this.rangeScale = (refActive
      ? Math.abs(this.ref.h1 - this.ref.h0)
      : this.settings.tideRangeM) / TIDE_DEFAULTS.springRangeM;

    if (this.settings.tideFrozen) {
      const s = this.settings.tideFrozenState;
      this.streamFactor = s === 'flood' ? 1 : s === 'ebb' ? -1 : 0;
      this.heightM = refActive
        ? (this.ref.h0 + this.ref.h1) / 2
        : halfRange * (s === 'slack' ? 1 : 0);
    } else if (refActive) {
      const { f, hA, hB } = this._refBracket();
      this.heightM = hA + (hB - hA) * (1 - Math.cos(Math.PI * f)) / 2;
      // flood = rising tide (streams set SOUTH); ebb = falling
      this.streamFactor = Math.sign(hB - hA) * Math.sin(Math.PI * f);
    } else {
      const phase = (this.clockS / this.periodS) * Math.PI * 2;
      // height = cos(phase): clock 0 = high water
      this.heightM = halfRange * Math.cos(phase);
      // d(height)/dt ∝ -sin(phase); flood (rising) when -sin > 0.
      this.streamFactor = -Math.sin(phase);
    }
  }

  get state() {
    if (Math.abs(this.streamFactor) < 0.15) return 'slack';
    return this.streamFactor > 0 ? 'flood' : 'ebb';
  }

  // Hours until the next slack water (stream reversal), for the tide panel.
  hoursToTurn() {
    if (this.settings.tideFrozen) return null;
    if (this.ref && this._simTime != null) {
      return (this._refBracket().tB - this._simTime) / 3600; // next HW/LW = slack
    }
    const phase = ((this.clockS / this.periodS) % 1) * Math.PI * 2;
    // stream = -sin(phase): zero crossings at phase 0 and π
    const next = phase < Math.PI ? Math.PI : Math.PI * 2;
    return ((next - phase) / (Math.PI * 2)) * TIDE_DEFAULTS.periodH;
  }

  // Current vector (m/s, world x/z) at a world position.
  // Blend: strongest-zone-dominant weighted average to avoid passage currents
  // being diluted by the broad background zone.
  currentAt(x, z) {
    let wSum = 0, vx = 0, vz = 0;
    for (const zn of this.zones) {
      const d2 = (x - zn.x) ** 2 + (z - zn.z) ** 2;
      const w = Math.exp(-d2 / (2 * zn.sigma * zn.sigma)) * zn.maxSpringKn;
      if (w < 1e-4) continue;
      vx += w * zn.floodVec.x * zn.maxSpringKn;
      vz += w * zn.floodVec.z * zn.maxSpringKn;
      wSum += w;
    }
    if (!wSum) return { x: 0, z: 0, kn: 0 };
    const scale = this.streamFactor * this.rangeScale * KN_TO_MS / wSum;
    const cx = vx * scale, cz = vz * scale;
    return { x: cx, z: cz, kn: Math.hypot(cx, cz) / KN_TO_MS };
  }
}

// "HH:MM" (24h) → seconds since midnight, or null if malformed.
function parseHHMM(s) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(s ?? '');
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 3600 + min * 60;
}
