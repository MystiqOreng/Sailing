// One-time data pipeline: converts a raw Overpass API dump (osm_raw.json)
// into the bundled chart GeoJSON files under data/.
//
// Usage:  node tools/process-osm.mjs
//
// - Stitches natural=coastline ways into closed island rings
// - Closes mainland (bbox-clipped) chains along the western edge
// - Douglas-Peucker simplification (tolerance below)
// - Emits data/coastline.geojson and data/reefs.geojson

import { readFileSync, writeFileSync } from 'fs';

const BBOX = { s: -20.58, w: 148.70, n: -19.96, e: 149.22 };
const SIMPLIFY_TOL = 0.00035;        // degrees, ~38 m — chart + 3D share this
const MIN_ISLAND_AREA_M2 = 1500;     // drop slivers smaller than this

const raw = JSON.parse(readFileSync(new URL('./osm_raw.json', import.meta.url)));

const nodes = new Map();
const coastWays = [];
const reefWays = [];
const reefRelations = [];
for (const el of raw.elements) {
  if (el.type === 'node') nodes.set(el.id, [el.lon, el.lat]);
  else if (el.type === 'way') {
    if (el.tags?.natural === 'coastline') coastWays.push(el);
    else if (el.tags?.natural === 'reef') reefWays.push(el);
    else coastWays.push(el); // untagged ways are members fetched via '>': decide later
  } else if (el.type === 'relation' && el.tags?.natural === 'reef') {
    reefRelations.push(el);
  }
}

// Separate true coastline ways from relation-member ways
const reefMemberIds = new Set();
for (const rel of reefRelations)
  for (const m of rel.members) if (m.type === 'way' && m.role !== 'inner') reefMemberIds.add(m.ref);

const wayById = new Map();
for (const w of [...coastWays, ...reefWays]) wayById.set(w.id, w);

const realCoast = coastWays.filter(w => w.tags?.natural === 'coastline');

// ---- stitch coastline ways into chains (coastline is directed: water on right)
const byFirst = new Map();
for (const w of realCoast) {
  const f = w.nodes[0];
  if (!byFirst.has(f)) byFirst.set(f, []);
  byFirst.get(f).push(w);
}
const used = new Set();
const rings = [];   // closed
const chains = [];  // open (mainland clipped by bbox)
for (const start of realCoast) {
  if (used.has(start.id)) continue;
  used.add(start.id);
  let chain = [...start.nodes];
  // walk forward
  while (true) {
    const last = chain[chain.length - 1];
    if (last === chain[0]) break; // closed
    const nexts = (byFirst.get(last) || []).filter(w => !used.has(w.id));
    if (!nexts.length) break;
    const next = nexts[0];
    used.add(next.id);
    chain = chain.concat(next.nodes.slice(1));
  }
  if (chain[0] === chain[chain.length - 1]) rings.push(chain);
  else chains.push(chain);
}

const toCoords = ids => ids.map(id => nodes.get(id)).filter(Boolean);

// ---- close open mainland chains by bulging past the west bbox edge
function closeWest(coords) {
  const W = BBOX.w - 0.08;
  const out = [...coords];
  const last = coords[coords.length - 1], first = coords[0];
  out.push([W, last[1]], [W, first[1]], first);
  return out;
}

// ---- Douglas-Peucker
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (Math.sqrt(maxD) > tol) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function ringAreaM2(coords) {
  // shoelace in local metres
  const lat0 = coords[0][1] * Math.PI / 180;
  const mPerLon = 111320 * Math.cos(lat0), mPerLat = 110540;
  let a = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i], [x2, y2] = coords[i + 1];
    a += (x1 * mPerLon) * (y2 * mPerLat) - (x2 * mPerLon) * (y1 * mPerLat);
  }
  return Math.abs(a / 2);
}

const features = [];
let dropped = 0;
for (const ring of rings) {
  let coords = simplify(toCoords(ring), SIMPLIFY_TOL);
  if (coords.length < 4) { dropped++; continue; }
  const area = ringAreaM2(coords);
  if (area < MIN_ISLAND_AREA_M2) { dropped++; continue; }
  features.push({
    type: 'Feature',
    properties: { kind: 'island', areaM2: Math.round(area) },
    geometry: { type: 'Polygon', coordinates: [coords] },
  });
}
for (const chain of chains) {
  let coords = simplify(toCoords(chain), SIMPLIFY_TOL);
  if (coords.length < 3) continue;
  coords = closeWest(coords);
  features.push({
    type: 'Feature',
    properties: { kind: 'mainland', areaM2: Math.round(ringAreaM2(coords)) },
    geometry: { type: 'Polygon', coordinates: [coords] },
  });
}
features.sort((a, b) => b.properties.areaM2 - a.properties.areaM2);

writeFileSync(new URL('../data/coastline.geojson', import.meta.url), JSON.stringify({
  type: 'FeatureCollection',
  attribution: '© OpenStreetMap contributors, ODbL 1.0',
  features,
}));

// ---- reefs
const reefFeatures = [];
function pushReef(coordsList, name) {
  for (let coords of coordsList) {
    coords = simplify(coords, SIMPLIFY_TOL);
    if (coords.length < 4) continue;
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])
      coords.push(coords[0]);
    reefFeatures.push({
      type: 'Feature',
      properties: { kind: 'reef', name: name || null },
      geometry: { type: 'Polygon', coordinates: [coords] },
    });
  }
}
for (const w of reefWays) pushReef([toCoords(w.nodes)], w.tags?.name);
for (const rel of reefRelations) {
  const outers = rel.members.filter(m => m.type === 'way' && m.role !== 'inner')
    .map(m => wayById.get(m.ref)).filter(Boolean).map(w => toCoords(w.nodes));
  pushReef(outers, rel.tags?.name);
}
writeFileSync(new URL('../data/reefs.geojson', import.meta.url), JSON.stringify({
  type: 'FeatureCollection',
  attribution: '© OpenStreetMap contributors, ODbL 1.0',
  features: reefFeatures,
}));

console.log(`islands+mainland: ${features.length} (dropped ${dropped} slivers)`);
console.log(`reefs: ${reefFeatures.length}`);
console.log(`largest areas km2:`, features.slice(0, 8).map(f => (f.properties.areaM2 / 1e6).toFixed(1)).join(', '));
