// Sailing physics. One instance per session; reads boat definition from
// config/boats.js and user settings, integrates each sim tick.
//
// Model summary (moderate-fidelity, believable rather than CFD):
//  - target STW from polar table × point-of-sail multiplier × trim efficiency
//    × speed slider × wind-against-tide chop penalty
//  - first-order speed response (accelTau / decelTau)
//  - no-go zone: inside (closeHauled - margin) the drive collapses
//  - leeway pushes the water track downwind of heading
//  - ground velocity = water velocity + tidal current → SOG/COG
//  - apparent wind from true wind minus ground velocity
//  - turn-rate steering with speed-dependent authority and turn drag

import { BOATS, polarSpeed, classifyPointOfSail } from '../config/boats.js';
import { WIND_AGAINST_TIDE } from '../config/environment.js';
import {
  DEG, KN_TO_MS, MS_TO_KN, dirToVec, vecToDir, norm360, angleDiff,
  clamp, approach, approachAngle,
} from '../util/geo.js';

export class Boat {
  constructor(settings) {
    this.settings = settings;
    this.x = 0; this.z = 0;
    this.headingDeg = 0;
    this.stwKn = 0;
    this.helm = 0;            // -1 (full port) … +1 (full starboard)
    this.autopilot = null;    // target heading deg or null
    this.sheet = 0.5;         // manual trim 0 (hard in) … 1 (fully eased)
    this.heelDeg = 0;
    this.leewayDeg = 0;
    this.aground = false;
    // outputs for UI / 3D
    this.sogKn = 0; this.cogDeg = 0;
    this.awaDeg = 0; this.awsKn = 0; this.twaDeg = 0;
    this.pos = 'inIrons';
    this.trimEfficiency = 1;
    this.optBoomDeg = 10; this.boomDeg = 10;
    this.chop = 0;            // wind-against-tide factor at boat
    this.currentKn = 0; this.currentDirDeg = 0;
    this.luffing = false;
  }

  get def() { return BOATS[this.settings.boatId]; }
  get closeHauledDeg() { return this.settings.closeHauledDeg ?? this.def.closeHauledDeg; }
  get noGoDeg() { return this.closeHauledDeg - this.def.noGoMarginDeg; }

  setPosition(x, z, headingDeg) {
    this.x = x; this.z = z;
    this.headingDeg = headingDeg;
    this.autopilot = headingDeg;
    this.stwKn = 0;
    this.aground = false;
  }

  update(dt, wind, tide, world, events) {
    const def = this.def;

    // ---- steering
    if (this.autopilot != null && this.helm === 0) {
      const err = angleDiff(this.autopilot, this.headingDeg);
      this.helmAuto = clamp(err / 20, -1, 1);
    } else {
      this.helmAuto = 0;
      if (this.helm !== 0) this.autopilot = null; // hand steering overrides AP
    }
    const helm = this.helm !== 0 ? this.helm : this.helmAuto;
    // steering authority needs flow over the rudder
    const authority = clamp(this.stwKn / 3, 0.15, 1);
    const yawRate = helm * def.turnRateMax * authority;
    this.headingDeg = norm360(this.headingDeg + yawRate * dt);

    // ---- wind angles
    this.twaDeg = angleDiff(wind.fromDeg, this.headingDeg); // + = wind over stbd bow
    const absTwa = Math.abs(this.twaDeg);
    this.pos = classifyPointOfSail(absTwa, this.noGoDeg);

    // ---- sail trim
    // Optimal boom angle eases from ~8° close-hauled to ~80° on a run.
    this.optBoomDeg = clamp(8 + (absTwa - this.closeHauledDeg) * 0.62, 8, 82);
    let targetBoom;
    if (this.settings.assistance === 'auto') {
      targetBoom = this.optBoomDeg;
      this.trimEfficiency = 1;
    } else {
      targetBoom = 5 + this.sheet * 80;
      const err = targetBoom - this.optBoomDeg; // + = eased too far
      this.trimEfficiency = clamp(1 - (err / 38) ** 2, 0.35, 1);
    }
    this.boomDeg = approach(this.boomDeg, targetBoom, 1.2, dt);
    this.luffing = this.pos === 'inIrons' ||
      (this.settings.assistance === 'manual' && this.boomDeg > this.optBoomDeg + 14);

    // ---- current at boat
    const cur = tide.currentAt(this.x, this.z);
    this.currentKn = cur.kn;
    this.currentDirDeg = cur.kn > 0.02 ? vecToDir(cur.x, cur.z) : 0;

    // ---- wind against tide chop
    const windToDeg = norm360(wind.fromDeg + 180);
    const opposition = cur.kn > 0.1
      ? Math.max(0, -Math.cos(angleDiff(windToDeg, this.currentDirDeg) * DEG) - WIND_AGAINST_TIDE.oppositionThreshold)
      : 0;
    this.chop = opposition * cur.kn * (wind.speedKn / 15);
    const chopPenalty = Math.min(WIND_AGAINST_TIDE.maxPenalty,
      WIND_AGAINST_TIDE.penaltyPerChop * this.chop / (1 - WIND_AGAINST_TIDE.oppositionThreshold));

    // ---- target speed through water
    let target = 0;
    if (this.pos !== 'inIrons') {
      target = polarSpeed(def, wind.speedKn, absTwa)
        * def.posMultipliers[this.pos]
        * this.settings.speedMultiplier
        * this.trimEfficiency
        * (1 - chopPenalty);
      // taper between the no-go angle and the first polar column, so
      // pinching bleeds speed progressively instead of falling off a cliff
      const firstTwa = def.polar.twa[0];
      if (absTwa < firstTwa) {
        target *= clamp(0.35 + 0.65 * (absTwa - this.noGoDeg) / (firstTwa - this.noGoDeg), 0.35, 1);
      }
    } else {
      // pinching into the no-go zone: drive collapses smoothly to zero
      const into = clamp((this.noGoDeg - absTwa) / this.noGoDeg, 0, 1);
      target = polarSpeed(def, wind.speedKn, this.noGoDeg + 2)
        * this.settings.speedMultiplier * (1 - into) * 0.5;
    }

    // turn drag: scrub speed while the helm is over (cats hate tacking slow)
    target *= Math.max(0.3, 1 - def.turnDrag * Math.abs(yawRate) * 10);

    const tau = target > this.stwKn ? def.accelTau : def.decelTau;
    this.stwKn = approach(this.stwKn, target, tau, dt);

    // ---- heel (monohull leans, cat stays flat)
    const heelDrive = Math.sin(clamp(absTwa, 0, 110) * DEG) *
      (wind.speedKn / 22) ** 2 * (this.pos === 'inIrons' ? 0.2 : 1);
    const targetHeel = clamp(def.heelMax * heelDrive, 0, def.heelMax) * Math.sign(-this.twaDeg);
    this.heelDeg = approach(this.heelDeg, targetHeel, 2.5, dt);

    // ---- leeway: worst close-hauled in breeze at low speed
    const upwindFactor = clamp(Math.cos((absTwa - 50) * DEG), 0, 1);
    this.leewayDeg = clamp(
      def.leewayBase * upwindFactor * (wind.speedKn / 16) ** 1.5 / Math.max(0.4, this.stwKn / 5),
      0, 14) * Math.sign(this.twaDeg); // pushed away from the wind

    // ---- integrate position: water track + current
    const waterDir = norm360(this.headingDeg + this.leewayDeg);
    const wv = dirToVec(waterDir);
    const sMs = this.stwKn * KN_TO_MS;
    const gvx = wv.x * sMs + cur.x;
    const gvz = wv.z * sMs + cur.z;
    const nx = this.x + gvx * dt;
    const nz = this.z + gvz * dt;

    // ---- grounding (depth proxy): stop, don't crash
    const depth = world.estimatedDepth(nx, nz);
    this.depthM = depth;
    if (depth < def.draftM || world.isOnLand(nx, nz)) {
      if (!this.aground) events.emit('aground');
      this.aground = true;
      this.stwKn = 0;
    } else {
      this.aground = false;
      this.x = nx; this.z = nz;
    }

    // ---- SOG / COG
    this.sogKn = Math.hypot(gvx, gvz) * MS_TO_KN;
    this.cogDeg = this.sogKn > 0.05 ? vecToDir(gvx, gvz) : this.headingDeg;

    // ---- apparent wind (true wind vector minus ground velocity)
    const wTo = dirToVec(windToDeg);
    const wMs = wind.speedKn * KN_TO_MS;
    const ax = wTo.x * wMs - gvx, az = wTo.z * wMs - gvz;
    this.awsKn = Math.hypot(ax, az) * MS_TO_KN;
    const awFromDeg = vecToDir(-ax, -az);
    this.awaDeg = angleDiff(awFromDeg, this.headingDeg);
  }
}
