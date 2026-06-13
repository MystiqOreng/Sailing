// 3D boat models built from primitives — monohull and catamaran are
// visually and behaviourally distinct. Sails are deformable meshes:
// boom angle, camber and luffing flutter all animate from sim state,
// so a zoomed-in player can read trim quality directly off the cloth.

import * as THREE from 'three';

const HULL_WHITE = new THREE.MeshLambertMaterial({ color: 0xf4f2ec });
const DECK_GREY = new THREE.MeshLambertMaterial({ color: 0xd8d5cc });
const TRIM_NAVY = new THREE.MeshLambertMaterial({ color: 0x23364a });
const SPAR = new THREE.MeshLambertMaterial({ color: 0x8b8f96 });
const SAIL = new THREE.MeshLambertMaterial({
  color: 0xfaf8f0, side: THREE.DoubleSide,
});

// Deformable triangular sail: grid columns run aft from the luff.
// camber + flutter are applied per-frame in updateSail().
function makeSail(luffH, footL, cols = 10, rows = 12) {
  const geo = new THREE.BufferGeometry();
  const verts = [], idx = [], base = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const width = footL * (1 - v); // triangle: foot → head
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      base.push(u * width, v * luffH, 0);
      verts.push(0, 0, 0);
    }
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const mesh = new THREE.Mesh(geo, SAIL);
  mesh.userData = { base, cols, rows, luffH, footL };
  return mesh;
}

function updateSail(mesh, camber, luffing, t, side) {
  const { base, cols, rows } = mesh.userData;
  const pos = mesh.geometry.attributes.position;
  let i = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++, i++) {
      const u = c / cols, v = r / rows;
      let x = base[i * 3], y = base[i * 3 + 1];
      // camber: belly bulges to leeward, max ~40% aft, less aloft
      let z = side * camber * Math.sin(u * Math.PI) * (1 - v * 0.45)
        * mesh.userData.footL * 0.14;
      if (luffing) {
        // cloth flutter: travelling ripple, strongest at the luff
        z += Math.sin(t * 14 + v * 9 + u * 4) * 0.18 * (1 - u) * (0.4 + camber);
      }
      pos.setXYZ(i, x, y, z);
    }
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

// Telltales: ribbon streamers on both faces of a sail. They stream aft when
// the flow is attached, lift and flutter when the sail is under-trimmed or
// pinching (windward face), and stall upward when over-sheeted (leeward).
// Green = starboard face, red = port face, like real port/starboard yarn.
const TT_STBD = new THREE.LineBasicMaterial({ color: 0x2fbf5a });
const TT_PORT = new THREE.LineBasicMaterial({ color: 0xd84040 });
const TT_SEGS = 6;

function makeTelltales(sail, anchors) {
  const set = [];
  for (const a of anchors) {
    for (const face of [-1, 1]) { // sail-local z side: +1 stbd tack face
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position',
        new THREE.Float32BufferAttribute(new Float32Array((TT_SEGS + 1) * 3), 3));
      const line = new THREE.Line(geo, face === 1 ? TT_STBD : TT_PORT);
      line.frustumCulled = false;
      sail.add(line);
      set.push({ line, u: a.u, v: a.v, len: a.len ?? 0.9, face });
    }
  }
  return set;
}

function updateTelltales(set, mesh, camber, side, lift, stall, t) {
  const { luffH, footL } = mesh.userData;
  for (const tt of set) {
    // anchor on the deformed sail surface (same camber formula as updateSail)
    const x0 = tt.u * footL * (1 - tt.v);
    const y0 = tt.v * luffH;
    const z0 = side * camber * Math.sin(tt.u * Math.PI) * (1 - tt.v * 0.45) * footL * 0.14;
    // the belly bulges to leeward (sign of `side`), so that face is leeward
    const bad = tt.face === Math.sign(side || 1) ? stall : lift;
    const pos = tt.line.geometry.attributes.position;
    for (let i = 0; i <= TT_SEGS; i++) {
      const f = i / TT_SEGS;
      const flutter = Math.sin(t * (10 + 9 * bad) + f * 6 + tt.v * 7) * f;
      pos.setXYZ(i,
        x0 + f * tt.len * (1 - 0.55 * bad),        // shortens aft-run when bad
        y0 + bad * f * tt.len * 0.6 + flutter * (0.04 + 0.28 * bad),
        z0 + tt.face * 0.07 + flutter * 0.05);
    }
    pos.needsUpdate = true;
  }
}

function monohull() {
  const g = new THREE.Group();
  // hull: stretched sphere reads as a fair cruiser hull at distance
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), HULL_WHITE);
  hull.scale.set(6.2, 1.5, 2.05);
  hull.position.y = 0.15;
  g.add(hull);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.18, 24), DECK_GREY);
  deck.scale.set(5.9, 1, 1.9);
  deck.position.y = 0.95;
  g.add(deck);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 2.4), HULL_WHITE);
  cabin.position.set(0.4, 1.4, 0);
  g.add(cabin);
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.45, 2.2), TRIM_NAVY);
  coaming.position.set(-3.0, 1.15, 0);
  g.add(coaming);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.9, 0.22), TRIM_NAVY);
  keel.position.y = -1.9;
  g.add(keel);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.14), TRIM_NAVY);
  rudder.position.set(-5.0, -1.0, 0);
  g.add(rudder);
  return { group: g, mastPos: new THREE.Vector3(1.4, 1.0, 0), mastH: 17, boomL: 5.6, jibFoot: 4.6, bowX: 6.2 };
}

function catamaran() {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), HULL_WHITE);
    hull.scale.set(6.4, 1.3, 0.85);
    hull.position.set(0, 0.3, side * 2.55);
    g.add(hull);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.5, 5.6), DECK_GREY);
  bridge.position.y = 1.15;
  g.add(bridge);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.15, 4.6), HULL_WHITE);
  cabin.position.set(0.4, 1.95, 0);
  g.add(cabin);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 4.4), TRIM_NAVY);
  screen.position.set(3.2, 1.95, 0);
  g.add(screen);
  return { group: g, mastPos: new THREE.Vector3(1.2, 1.4, 0), mastH: 19, boomL: 6.0, jibFoot: 5.0, bowX: 6.4 };
}

export class Boat3D {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();   // position + heading
    this.heelGroup = new THREE.Group(); // heel rotates around fore-aft axis
    this.root.add(this.heelGroup);
    scene.add(this.root);
    this.built = null;
  }

  build(boatId) {
    if (this.built === boatId) return;
    this.built = boatId;
    this.heelGroup.clear();
    const spec = boatId === 'cat' ? catamaran() : monohull();
    this.spec = spec;
    this.heelGroup.add(spec.group);

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.13, spec.mastH, 8), SPAR);
    mast.position.copy(spec.mastPos).add(new THREE.Vector3(0, spec.mastH / 2, 0));
    this.heelGroup.add(mast);

    // boom + mainsail pivot at the mast
    this.boomGroup = new THREE.Group();
    this.boomGroup.position.copy(spec.mastPos).add(new THREE.Vector3(0, 1.3, 0));
    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, spec.boomL, 8), SPAR);
    boom.rotation.z = Math.PI / 2;
    boom.position.x = -spec.boomL / 2;
    this.boomGroup.add(boom);
    this.main = makeSail(spec.mastH - 2.2, spec.boomL);
    this.main.rotation.y = Math.PI; // foot runs aft along the boom
    this.boomGroup.add(this.main);
    this.heelGroup.add(this.boomGroup);

    // jib pivots at the bow
    this.jibGroup = new THREE.Group();
    this.jibGroup.position.set(spec.bowX - 0.4, 1.1, 0);
    this.jib = makeSail(spec.mastH * 0.78, spec.jibFoot);
    this.jib.rotation.y = Math.PI;
    this.jibGroup.add(this.jib);
    this.heelGroup.add(this.jibGroup);

    // telltales: jib luff (steering) + main leech (trim/stall)
    this.jibTT = makeTelltales(this.jib, [
      { u: 0.15, v: 0.30 }, { u: 0.15, v: 0.52 }, { u: 0.15, v: 0.72 },
    ]);
    this.mainTT = makeTelltales(this.main, [
      { u: 0.92, v: 0.45 }, { u: 0.92, v: 0.70 },
    ]);

    // forestay line for looks
    const top = spec.mastPos.clone().add(new THREE.Vector3(0, spec.mastH * 0.95, 0));
    const bow = new THREE.Vector3(spec.bowX - 0.3, 1.0, 0);
    const dir = top.clone().sub(bow);
    const stay = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, dir.length(), 4), SPAR);
    stay.position.copy(bow).add(top).multiplyScalar(0.5);
    stay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.heelGroup.add(stay);
  }

  // boat = sim Boat instance; t = sim time (s)
  update(boat, t) {
    this.build(boat.settings.boatId);
    this.root.position.set(boat.x, 0, boat.z);
    // model bow points +x; world north is -z, so heading 0 needs a +90° yaw
    this.root.rotation.y = (90 - boat.headingDeg) * Math.PI / 180;
    // gentle pitching with the sea for life
    const pitch = Math.sin(t * 1.1) * 0.015 * (1 + boat.chop);
    this.heelGroup.rotation.x = boat.heelDeg * Math.PI / 180;
    this.heelGroup.rotation.z = pitch;

    // boom swings to leeward: wind over starboard (TWA+) → boom to port (-z)
    const side = boat.twaDeg >= 0 ? -1 : 1;
    const boomRad = side * boat.boomDeg * Math.PI / 180;
    this.boomGroup.rotation.y = boomRad;
    this.jibGroup.rotation.y = side * (boat.boomDeg * 0.85 + 8) * Math.PI / 180;

    // sail shape: flat when hard in or luffing, full when powered
    const power = boat.pos === 'inIrons' ? 0.15 : 0.55 + 0.45 * Math.min(1, boat.awsKn / 18);
    updateSail(this.main, power, boat.luffing, t, side);
    updateSail(this.jib, power * 0.9, boat.luffing, t, side);

    // telltale state from trim quality: + err = eased too far (luff lifts),
    // − err = over-sheeted (leeward stalls); luffing forces the lift
    const err = boat.boomDeg - boat.optBoomDeg;
    const lift = boat.luffing ? 1 : clamp01((err - 6) / 12);
    const stall = clamp01((-err - 6) / 12);
    updateTelltales(this.jibTT, this.jib, power * 0.9, side, lift, stall, t);
    updateTelltales(this.mainTT, this.main, power, side, lift, stall, t);
  }
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
