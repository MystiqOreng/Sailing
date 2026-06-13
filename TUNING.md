# Tuning guide

Everything gameplay-relevant is data-driven. Numbers below are the defaults
and the knobs that matter. After editing, just reload the browser.

## 1. Boat feel — `js/config/boats.js`

Each boat (`mono`, `cat`) has:

| Key | Default (mono / cat) | Effect |
|---|---|---|
| `closeHauledDeg` | 45 / 52 | best pointing angle (user can override in Settings) |
| `noGoMarginDeg` | 12 / 14 | no-go zone = closeHauled − margin |
| `accelTau` | 7 / 5 s | seconds to close ~63% of speed deficit |
| `decelTau` | 13 / 9 s | how long the boat carries way |
| `turnRateMax` | 11 / 8 °/s | helm authority at speed |
| `turnDrag` | 0.010 / 0.022 | speed scrubbed while turning — raise to make tacks costlier |
| `leewayBase` | 4.0 / 5.5° | leeway close-hauled in 16 kn |
| `heelMax` | 27 / 6° | visual + physics heel cap |
| `draftM` | 2.1 / 1.2 | grounding depth |
| `polar` | tables | STW (kn) by TWS row × TWA column. Edit cells directly; linear interpolation between |

The five **point-of-sail multipliers** (`posMultipliers`) are also exposed as
sliders in Settings → Tuning, alongside a global speed multiplier
(0.6–1.4). Sliders write back into these tables live.

## 2. Wind — Settings panel or `js/config/environment.js`

- 10 selectable directions (N, NE, E, ESE, SE, SSE, S, SW, W, NW), speed
  0–30 kn, gustiness 0–1 (±18% speed, ±12° wander at 1.0 — see
  `js/sim/wind.js` `osc()` periods to change gust rhythm).
- Forecast presets (`WEATHER_PRESETS`) — add your own entries freely.

## 3. Tide and current

- **Curve**: Settings → Tide sets range (1.2–3.8 m). Springs calibration is
  `TIDE_DEFAULTS.springRangeM` (3.6 m) in `environment.js` — zone rates are
  scaled by `range / springRange`.
- **Zones**: `data/chart-detail.json → currentZones[]`. Each has position,
  `radiusM` (gaussian falloff), `floodDirDeg` (direction the flood sets
  towards — south-ish in this region) and `maxSpringKn`. Add/move/strengthen
  zones without touching code.
- **Freeze override**: Settings → Tide locks max flood / max ebb / slack for
  practising a passage at a known state.

## 4. Wind-against-tide penalty — `environment.js → WIND_AGAINST_TIDE`

`chop = opposition × current(kn) × TWS/15`, then STW penalty
`min(maxPenalty, penaltyPerChop × chop)`. Raise `maxPenalty` (0.30) to make
adverse passages truly miserable; `whitecapBoost` controls the visual.

## 5. Depth & grounding — `js/sim/world.js`

`estimatedDepth()`: shore-distance proxy (0 m at beach → 30 m at 1.2 km)
overridden by `shoals[]` patches in `chart-detail.json`. Add shallow patches
there (position, radius, min depth).

## 6. Crew health hooks — `js/sim/health.js`

`RATES` (per sim-minute): wind-against-tide −2.5×chop, pinching −1.5,
dead run −1.2, <5 m water −3, aground −8, fair current +0.8, nice reach +1.

## 7. Sea state visuals — `js/scene/scene3d.js`

In `update()`: wave amplitude `0.12 + (windKn/25)^1.5 × 1.5 + chop × 0.5`;
whitecaps start at 12 kn (`(windKn − 12)/18`). Wave lengths/speeds are in the
`SEA_VERT` shader.

## 8. Scenarios — `data/chart-detail.json → scenarios[]`

Each sets origin/destination anchorage ids, wind, gustiness, tide range and
tide-clock hour (0 = high water; ~3.1 = max ebb; ~6.2 = low water;
~9.3 = max flood). Copy a block to add your own passage problems.
