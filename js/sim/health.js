// Crew comfort / seamanship rating (0-100). This is the hook layer for the
// future hazard system: conditions accumulate via rates per sim-minute.
//
// ===== TUNING: rates are per sim-minute =====

import { clamp } from '../util/geo.js';

const RATES = {
  windAgainstTide: -2.5,   // scaled by chop factor
  pinching: -1.5,
  deadRun: -1.2,
  shallowWater: -3.0,      // depth < 5 m under way
  aground: -8.0,
  favourableCurrent: +0.8, // current component along COG > 0.3 kn
  niceReach: +1.0,         // beam/broad reach in 10-20 kn, low chop
};

export class Health {
  constructor(events) {
    this.value = 100;
    this.events = events;
    this._sightingTimer = 0;
  }

  update(dt, boat, wind) {
    const perMin = dt / 60;
    let delta = 0;

    if (boat.chop > 0.4) delta += RATES.windAgainstTide * Math.min(2, boat.chop) * perMin;
    if (boat.pos === 'inIrons' && boat.stwKn > 1) delta += RATES.pinching * perMin;
    if (Math.abs(boat.twaDeg) > 172) delta += RATES.deadRun * perMin;
    if (boat.depthM < 5 && boat.sogKn > 1 && !boat.aground) delta += RATES.shallowWater * perMin;
    if (boat.aground) delta += RATES.aground * perMin;

    // favourable current: positive component of current along course
    const along = boat.currentKn * Math.cos((boat.currentDirDeg - boat.cogDeg) * Math.PI / 180);
    if (along > 0.3) delta += RATES.favourableCurrent * perMin;

    if ((boat.pos === 'beamReach' || boat.pos === 'broadReach') &&
        wind.speedKn >= 10 && wind.speedKn <= 20 && boat.chop < 0.2) {
      delta += RATES.niceReach * perMin;
    }

    this.value = clamp(this.value + delta, 0, 100);

    // Demonstration of the positive-event hook: rare dolphin sighting in
    // pleasant conditions. Whales etc. plug in here in a later iteration.
    this._sightingTimer -= dt;
    if (this._sightingTimer <= 0) {
      this._sightingTimer = 300 + Math.random() * 900;
      if (boat.chop < 0.2 && boat.sogKn > 3 && Math.random() < 0.25) {
        this.value = clamp(this.value + 4, 0, 100);
        this.events.emit('notice', { text: 'Dolphins on the bow!', kind: 'good' });
      }
    }
  }
}
