// Boat definitions and performance tables.
//
// ===== TUNING: this file is the main place to change how each boat sails =====
//
// polar: speed through water (knots) by true wind speed (rows, `tws`) and
//        true wind angle (columns, `twa`). Linear interpolation between
//        points; below the no-go angle the boat stalls regardless of table.
// closeHauledDeg: default best pointing angle (true wind angle). User can
//        override in Settings. The no-go zone is this minus noGoMarginDeg.
// accelTau / decelTau: seconds to close ~63% of the gap to target speed.
// turnRateMax: deg/s of heading change at full helm and good boatspeed.
// turnDrag: speed scrub per deg/s of turn — cats lose more way tacking.
// leewayBase: deg of leeway close-hauled in ~16 kn; scales with wind².
// heelMax: visual + physics heel cap (deg).
// posMultipliers: per point-of-sail efficiency knobs, exposed as sliders.

export const BOATS = {
  mono: {
    id: 'mono',
    name: 'Monohull cruiser 40 ft',
    closeHauledDeg: 45,
    noGoMarginDeg: 12,        // in irons inside (closeHauled - margin)
    tackThroughKn: 0.55,      // fraction of speed kept through a tack
    accelTau: 7,
    decelTau: 13,
    turnRateMax: 11,
    turnDrag: 0.010,
    leewayBase: 4.0,
    heelMax: 27,
    draftM: 2.1,
    polar: {
      tws: [4, 6, 10, 16, 20, 25],
      twa: [40, 45, 52, 60, 75, 90, 110, 120, 135, 150, 165, 180],
      stw: [
        [1.9, 2.2, 2.5, 2.7, 2.9, 3.0, 2.9, 2.8, 2.5, 2.1, 1.8, 1.6],
        [2.9, 3.4, 3.7, 4.0, 4.4, 4.5, 4.4, 4.2, 3.6, 3.0, 2.6, 2.4],
        [4.6, 5.2, 5.7, 6.0, 6.5, 6.7, 6.6, 6.4, 5.8, 5.0, 4.5, 4.2],
        [5.7, 6.4, 6.9, 7.2, 7.7, 7.9, 8.0, 7.9, 7.6, 6.9, 6.3, 6.0],
        [5.8, 6.6, 7.1, 7.5, 8.0, 8.3, 8.5, 8.4, 8.3, 7.8, 7.3, 7.0],
        [5.6, 6.5, 7.1, 7.4, 8.0, 8.4, 8.7, 8.8, 8.9, 8.6, 8.2, 8.0]
      ]
    },
    posMultipliers: { closeHauled: 1.0, closeReach: 1.0, beamReach: 1.0, broadReach: 1.0, running: 1.0 }
  },

  cat: {
    id: 'cat',
    name: 'Catamaran cruiser 40 ft',
    closeHauledDeg: 52,
    noGoMarginDeg: 14,
    tackThroughKn: 0.40,      // cats carry less way through the wind
    accelTau: 5,
    decelTau: 9,
    turnRateMax: 8,
    turnDrag: 0.022,
    leewayBase: 5.5,
    heelMax: 6,
    draftM: 1.2,
    polar: {
      tws: [4, 6, 10, 16, 20, 25],
      twa: [45, 52, 60, 75, 90, 110, 120, 135, 150, 165, 180],
      stw: [
        [1.6, 2.2, 2.6, 3.1, 3.3, 3.2, 3.0, 2.7, 2.2, 1.9, 1.7],
        [2.4, 3.4, 4.0, 4.8, 5.0, 4.9, 4.6, 4.0, 3.2, 2.8, 2.6],
        [3.8, 5.4, 6.2, 7.2, 7.6, 7.5, 7.2, 6.4, 5.4, 4.7, 4.4],
        [4.8, 6.6, 7.6, 8.8, 9.4, 9.6, 9.4, 8.8, 7.6, 6.6, 6.2],
        [5.0, 6.8, 7.9, 9.4, 10.2, 10.6, 10.4, 10.0, 8.8, 7.8, 7.4],
        [4.8, 6.6, 7.8, 9.6, 10.6, 11.2, 11.2, 11.0, 10.0, 9.0, 8.6]
      ]
    },
    posMultipliers: { closeHauled: 1.0, closeReach: 1.0, beamReach: 1.0, broadReach: 1.0, running: 1.0 }
  }
};

// Point-of-sail classification boundaries (deg TWA). The close-hauled lower
// bound is dynamic (the boat's no-go angle); these are the rest.
export const POS_BOUNDS = { closeReach: 60, beamReach: 80, broadReach: 100, running: 150 };

export function classifyPointOfSail(absTwa, noGoDeg) {
  if (absTwa < noGoDeg) return 'inIrons';
  if (absTwa < POS_BOUNDS.closeReach) return 'closeHauled';
  if (absTwa < POS_BOUNDS.beamReach) return 'closeReach';
  if (absTwa < POS_BOUNDS.broadReach) return 'beamReach';
  if (absTwa < POS_BOUNDS.running) return 'broadReach';
  return 'running';
}

export const POS_LABELS = {
  inIrons: 'IN IRONS',
  closeHauled: 'CLOSE-HAULED',
  closeReach: 'CLOSE REACH',
  beamReach: 'BEAM REACH',
  broadReach: 'BROAD REACH',
  running: 'RUNNING',
};

// Bilinear interpolation into a boat's polar table.
export function polarSpeed(boat, twsKn, absTwa) {
  const { tws, twa, stw } = boat.polar;
  const ti = clampIndex(tws, twsKn);
  const ai = clampIndex(twa, absTwa);
  const tF = frac(tws, ti, twsKn);
  const aF = frac(twa, ai, absTwa);
  const v00 = stw[ti][ai], v01 = stw[ti][ai + 1] ?? v00;
  const v10 = (stw[ti + 1] ?? stw[ti])[ai], v11 = (stw[ti + 1] ?? stw[ti])[ai + 1] ?? v10;
  let v = (v00 * (1 - aF) + v01 * aF) * (1 - tF) + (v10 * (1 - aF) + v11 * aF) * tF;
  // Below the lightest table wind, fade linearly to zero.
  if (twsKn < tws[0]) v *= twsKn / tws[0];
  return v;
}

function clampIndex(arr, v) {
  for (let i = arr.length - 2; i >= 0; i--) if (v >= arr[i]) return i;
  return 0;
}
function frac(arr, i, v) {
  const a = arr[i], b = arr[i + 1];
  if (b === undefined || b === a) return 0;
  return Math.min(1, Math.max(0, (v - a) / (b - a)));
}
