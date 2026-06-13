// Geo + angle utilities shared by sim, chart and 3D scene.
//
// World frame: metres, origin at ORIGIN_LL. x = east, z = south (three.js
// convention, so north = -z, and y is up in the 3D scene).
// Headings/bearings: degrees clockwise from true north unless suffixed M.

export const ORIGIN_LL = { lon: 148.96, lat: -20.27 };
export const MAG_VARIATION = 7.5; // deg East. true = magnetic + variation

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos(ORIGIN_LL.lat * Math.PI / 180);

export const DEG = Math.PI / 180;
export const KN_TO_MS = 0.514444;
export const MS_TO_KN = 1 / KN_TO_MS;
export const NM_M = 1852;

export function llToWorld(lon, lat) {
  return {
    x: (lon - ORIGIN_LL.lon) * M_PER_DEG_LON,
    z: -(lat - ORIGIN_LL.lat) * M_PER_DEG_LAT,
  };
}

export function worldToLL(x, z) {
  return {
    lon: ORIGIN_LL.lon + x / M_PER_DEG_LON,
    lat: ORIGIN_LL.lat - z / M_PER_DEG_LAT,
  };
}

// Unit vector (world x,z) for a compass direction in degrees true.
export function dirToVec(deg) {
  return { x: Math.sin(deg * DEG), z: -Math.cos(deg * DEG) };
}

// Compass direction (deg true) of a world vector.
export function vecToDir(x, z) {
  return norm360(Math.atan2(x, -z) / DEG);
}

export function norm360(d) { return ((d % 360) + 360) % 360; }

// Signed smallest difference a-b in (-180, 180]
export function angleDiff(a, b) {
  let d = norm360(a - b);
  if (d > 180) d -= 360;
  return d;
}

export function toMagnetic(trueDeg) { return norm360(trueDeg - MAG_VARIATION); }

export function dist(ax, az, bx, bz) { return Math.hypot(bx - ax, bz - az); }

export function fmtDeg(d) { return String(Math.round(norm360(d))).padStart(3, '0') + '°'; }
export function fmtKn(v) { return v.toFixed(1); }
export function fmtNm(m) { const nm = m / NM_M; return nm >= 10 ? nm.toFixed(1) : nm.toFixed(2); }

export const COMPASS_PTS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export function compassPoint(deg) {
  return COMPASS_PTS[Math.round(norm360(deg) / 22.5) % 16];
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// Critically-damped-ish exponential approach, frame-rate independent.
export function approach(current, target, tau, dt) {
  return target + (current - target) * Math.exp(-dt / tau);
}
export function approachAngle(current, target, tau, dt) {
  return norm360(target + angleDiff(current, target) * Math.exp(-dt / tau));
}
