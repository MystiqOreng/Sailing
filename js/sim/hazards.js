// Hazard system — PLACEHOLDER for a later iteration.
//
// Architecture: the spawner runs on the sim tick, rolls against a frequency
// budget, and emits events on the shared bus. Hazard types declare their own
// spawn predicate (where/when they can occur) and their effect hooks.
// The 3D scene and chart subscribe to 'hazard:spawn' / 'hazard:clear' to
// render them; sailing physics subscribes to apply effects (e.g. eddy yaw).
//
// Implemented now: settings plumbing, spawn-roll skeleton, event contract.
// Implemented later: actual hazard behaviours, 3D/chart presentation.

const FREQUENCY_BUDGET = { off: 0, rare: 1, occasional: 3 }; // spawns/hour

export const HAZARD_TYPES = [
  { id: 'whale', name: 'Breaching whale', predicate: 'openWater' },
  { id: 'eddy', name: 'Tidal eddy', predicate: 'strongCurrentZone' },
  { id: 'chopZone', name: 'Wind-against-tide overfalls', predicate: 'watZone' },
  { id: 'debris', name: 'Floating debris', predicate: 'anywhere' },
  { id: 'shallowPatch', name: 'Uncharted shallow patch', predicate: 'nearReef' },
];

export class Hazards {
  constructor(settings, events) {
    this.settings = settings;
    this.events = events;
    this.active = [];
    this._rollTimer = 0;
  }

  update(dt /*, boat, tide, world */) {
    const budget = FREQUENCY_BUDGET[this.settings.hazardFrequency] ?? 0;
    if (budget === 0) return;
    this._rollTimer -= dt;
    if (this._rollTimer > 0) return;
    this._rollTimer = 600; // roll every 10 sim minutes
    // Later iteration: pick a type whose predicate matches conditions near
    // the boat, instantiate it, and emit:
    // this.events.emit('hazard:spawn', { type, x, z, ... });
  }
}
