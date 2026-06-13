// Wind model: user-set mean direction/speed plus smooth gust/oscillation
// noise driven by sim time. Output is the instantaneous true wind.

import { norm360 } from '../util/geo.js';

// Smooth pseudo-random oscillation from layered sines (deterministic, cheap).
function osc(t, p1, p2, p3) {
  return (Math.sin(t / p1) * 0.5 + Math.sin(t / p2 + 1.7) * 0.3 + Math.sin(t / p3 + 4.2) * 0.2);
}

export class Wind {
  constructor(settings) {
    this.settings = settings; // shared settings object (windFromDeg, windKn, gustiness)
    this.fromDeg = settings.windFromDeg;
    this.speedKn = settings.windKn;
  }

  // t = sim time in seconds
  update(t) {
    const g = this.settings.gustiness;
    // Gusts: ±18% speed at gustiness 1.0, period ~ 1-3 min
    this.speedKn = Math.max(0.5,
      this.settings.windKn * (1 + 0.18 * g * osc(t, 41, 97, 13)));
    // Direction wander: ±12° at gustiness 1.0, slower
    this.fromDeg = norm360(this.settings.windFromDeg + 12 * g * osc(t, 67, 149, 23));
  }
}
