// World data: loads chart GeoJSON + hand detail, builds a spatial grid of
// coastline segments for fast distance-to-shore queries, and provides the
// estimated-depth proxy used for grounding and health hooks.
//
// Depth proxy: no open bathymetry is bundled, so depth is estimated as a
// function of distance to the nearest coastline (drying at the beach,
// ~30 m well offshore) overridden by hand-digitised shoal patches.
// Swap this for real soundings when a licensed chart layer is added.

import { llToWorld, dist } from '../util/geo.js';

const CELL = 800; // spatial grid cell size, metres

export class World {
  constructor(coastGeo, reefGeo, detail) {
    this.coastGeo = coastGeo;
    this.reefGeo = reefGeo;
    this.detail = detail;

    // Polygons in world metres
    this.landPolys = coastGeo.features.map(f => ({
      kind: f.properties.kind,
      areaM2: f.properties.areaM2,
      pts: f.geometry.coordinates[0].map(([lon, lat]) => llToWorld(lon, lat)),
    }));
    this.reefPolys = reefGeo.features.map(f => ({
      name: f.properties.name,
      pts: f.geometry.coordinates[0].map(([lon, lat]) => llToWorld(lon, lat)),
    }));
    this.shoals = detail.shoals.map(s => ({ ...s, ...llToWorld(s.lon, s.lat) }));
    this.anchorages = detail.anchorages.map(a => ({ ...a, ...llToWorld(a.lon, a.lat) }));

    this._buildGrid();
  }

  _buildGrid() {
    this.grid = new Map();
    for (const poly of this.landPolys) {
      const p = poly.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const seg = [p[i], p[i + 1]];
        const minX = Math.min(p[i].x, p[i + 1].x), maxX = Math.max(p[i].x, p[i + 1].x);
        const minZ = Math.min(p[i].z, p[i + 1].z), maxZ = Math.max(p[i].z, p[i + 1].z);
        for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
          for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
            const key = cx + ':' + cz;
            if (!this.grid.has(key)) this.grid.set(key, []);
            this.grid.get(key).push(seg);
          }
      }
    }
  }

  // Distance (m) to nearest coastline segment, searched in expanding rings.
  distanceToShore(x, z, maxM = 4000) {
    const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
    let best = Infinity;
    const maxR = Math.ceil(maxM / CELL);
    for (let r = 0; r <= maxR; r++) {
      if (best < (r - 1) * CELL) break; // can't beat best any more
      for (let cx = cx0 - r; cx <= cx0 + r; cx++)
        for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
          if (Math.max(Math.abs(cx - cx0), Math.abs(cz - cz0)) !== r) continue;
          const segs = this.grid.get(cx + ':' + cz);
          if (!segs) continue;
          for (const [a, b] of segs) {
            const d = pointSegDist(x, z, a, b);
            if (d < best) best = d;
          }
        }
    }
    return Math.min(best, maxM);
  }

  // ===== TUNING: depth proxy shape =====
  estimatedDepth(x, z) {
    const dShore = this.distanceToShore(x, z);
    // beach slope: 0 m at shore → 30 m at 1.2 km offshore (non-linear)
    let depth = 30 * Math.pow(Math.min(1, dShore / 1200), 0.7);
    for (const s of this.shoals) {
      const d = dist(x, z, s.x, s.z);
      if (d < s.radiusM) {
        const t = d / s.radiusM; // shallowest at the centre
        depth = Math.min(depth, s.minDepthM + (depth - s.minDepthM) * t * t);
      }
    }
    return depth;
  }

  isOnLand(x, z) {
    for (const poly of this.landPolys) {
      if (pointInPoly(x, z, poly.pts)) return true;
    }
    return false;
  }

  anchorageById(id) { return this.anchorages.find(a => a.id === id); }
}

function pointSegDist(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - a.x) * dx + (pz - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + t * dx - px, a.z + t * dz - pz);
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].z, xj = pts[j].x, zj = pts[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export async function loadWorld() {
  const [coast, reefs, detail] = await Promise.all([
    fetch('data/coastline.geojson').then(r => r.json()),
    fetch('data/reefs.geojson').then(r => r.json()),
    fetch('data/chart-detail.json').then(r => r.json()),
  ]);
  return new World(coast, reefs, detail);
}
