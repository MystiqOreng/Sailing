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
  }

  setClockHours(h) { this.clockS = h * 3600; }

  advance(dt) {
    this.clockS += dt;
    const phase = (this.clockS / this.periodS) * Math.PI * 2;
    const halfRange = this.settings.tideRangeM / 2;
    if (this.settings.tideFrozen) {
      const s = this.settings.tideFrozenState;
      this.streamFactor = s === 'flood' ? 1 : s === 'ebb' ? -1 : 0;
      this.heightM = halfRange * (s === 'slack' ? 1 : 0); // slack shown at HW
    } else {
      // height = cos(phase): clock 0 = high water
      this.heightM = halfRange * Math.cos(phase);
      // stream lags height by 90°: max flood while rising → -sin... rising is
      // phase in (π, 2π). flood = rising tide → streamFactor = -sin(phase)?
      // d(height)/dt ∝ -sin(phase); flood (rising) when -sin > 0. Use that.
      this.streamFactor = -Math.sin(phase);
    }
    // Scale zone strength by how big this tide is relative to springs.
    this.rangeScale = this.settings.tideRangeM / TIDE_DEFAULTS.springRangeM;
  }

  get state() {
    if (Math.abs(this.streamFactor) < 0.15) return 'slack';
    return this.streamFactor > 0 ? 'flood' : 'ebb';
  }

  // Hours until the next slack water (stream reversal), for the tide panel.
  hoursToTurn() {
    if (this.settings.tideFrozen) return null;
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
