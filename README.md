# Sail Whitsundays 3D

A browser-based sailing and navigation simulator set in the Whitsunday
Islands, Queensland. Serious but playable: the game is choosing a good route
under real-feeling wind and tide, not racing checkpoints.

**NOT FOR REAL NAVIGATION.** Coastlines are simplified OpenStreetMap data,
depths are estimated, and tidal streams are a calibrated approximation.

---

## Running it

No build step, no install. Any static file server works:

```bash
cd Sailing
python3 -m http.server 8080
# then open http://localhost:8080 (Safari/Chrome, desktop or iPad)
```

Deployment to a DigitalOcean droplet is the same: copy this directory to the
web root and serve with nginx. All assets (including Three.js) are vendored —
no CDN, no network calls at runtime.

```nginx
server {
  listen 80;
  root /var/www/sailing;
  index index.html;
  # .geojson/.json need correct types; nginx defaults handle .json,
  # add geojson explicitly:
  types { application/geo+json geojson; }
}
```

## Controls

| Action | Touch / mouse | Keyboard |
|---|---|---|
| Steer | hold **◀ PORT** / **STBD ▶** | hold ← / → |
| Autopilot nudge | **−10 −1 +1 +10** buttons | `[` / `]` (Shift = ±10) |
| Tack or gybe | **TACK / GYBE** button | `T` |
| Sheet (manual trim mode) | SHEET slider | — |
| Orbit camera | drag / two-finger pinch to zoom; zoom right in for a sail view with telltales | mouse drag + wheel |
| Top-down aerial view | **TOP** button; locked north-up like the chart — anchorage/place labels, shallow patches, a chart-style boat marker and a downwind WIND arrow | — |
| Nav overlays (both 3D views) | pink past track, red dashed heading line, white course-over-ground band | — |
| Chart | **CHART** button; drag to pan, pinch/wheel to zoom | — |
| Add route waypoints | enable **ROUTE+**, tap the chart | — |
| Time compression | 1× / 4× / 12× / 20×, pause | — |
| Restart | **↺** button; back to the start (or reloads the active scenario) | — |

Releasing the helm engages a heading hold on the new course, so on a tablet
you steer in nudges and let the autopilot keep the boat on course while you
study the chart.

## The sailing model (overview)

Implemented in `js/sim/boat.js`, data in `js/config/boats.js`:

- **Polar tables** per boat give target speed through water from true wind
  speed and angle (bilinear interpolation). The monohull points to ~45° TWA;
  the catamaran tacks through more (~52°) but is markedly faster reaching.
- **No-go zone**: inside `closeHauled − noGoMargin` drive collapses and the
  sails luff. Pinching is punished smoothly, as on a real boat.
- **First-order speed response**: boats accelerate/decelerate with separate
  time constants; the cat accelerates harder and loses more way tacking
  (turn drag), the mono carries way.
- **Leeway** pushes the water track to leeward, worst close-hauled, slow,
  and over-pressed.
- **Tidal current** is added vectorially: SOG/COG differ from STW/heading.
  Heading vs COG divergence is visible on the chart (red heading line vs
  green COG arrow).
- **Apparent wind** is computed from true wind minus ground velocity and
  drives the instruments and sail pressure.
- **Wind against tide** (opposed by >~115°) builds chop: boat speed penalty,
  visible whitecaps/steeper sea, and a crew-comfort penalty.
- **Points of sail**: in irons, close-hauled, close reach, beam reach,
  broad reach, running — shown on the banner and reflected in boom angle,
  sail camber and luffing animation.

## Tide model

One semidiurnal curve (12.42 h period, range set in Settings → Tide) drives
the whole region; stream rate follows the rate of change of height. Currents
come from hand-digitised zones (Solway, Hook, Fitzalan, Dent and Unsafe
Passages, The Narrows, Hunt Channel…) with directions and spring rates taken
from the *100 Magic Miles* sketch maps: **streams flood south, ebb north**.
A practice override freezes the tide at max flood, max ebb, or slack.

## Navigation gameplay

Pick a destination (Settings → Passage, or load a scenario). The chart gives
you judgement tools, deliberately not answers:

- animated **current arrows** sized/labelled by rate,
- **wind field** arrows (chart arrows point where wind blows *to*; the
  compass-rose arrow points where it comes *from*),
- **laylines** for your boat's actual close-hauled angle,
- a **route pencil** (ROUTE+) that labels each leg with magnetic bearing and
  distance — no ETA prediction; comparing routes is your job, as on a boat.

### Example scenario: Shute Harbour → Whitehaven Beach

SE 18 kn, spring tides, departing 2 h before high water. North-about via
Hook Passage is longer but mostly reaching; south-about via Solway Passage is
shorter but you arrive near the ebb — wind-against-tide in Solway in fresh SE
trade is genuinely unpleasant (the sim penalises it, as the cruising guide
warns). Time your passage or take the long way: that's the game. Two more
scenarios are bundled in Settings → Passage.

## Data sources and attribution

- **Coastline and reef geometry**: © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, licensed [ODbL 1.0](https://opendatacommons.org/licenses/odbl/).
  Fetched via Overpass API, processed by `tools/process-osm.mjs` into
  `data/coastline.geojson` / `data/reefs.geojson`.
- **Current zones, shoals, anchorages, peaks**: hand-digitised approximations
  informed by the *100 Magic Miles* cruising guide sketch maps (photos in
  `/reference`, not redistributed) and the AUS 252 paper chart. These are
  gameplay data, not chart data.
- **Three.js** r160, MIT licence, vendored in `/vendor`.

## Adding a licensed chart layer later

The chart is architected for this: `js/chart/chart.js` separates
`drawBaseChart()` (base geometry) from all overlay/interaction code.
To add a paid raster chart (e.g. quilted GeoTIFF tiles):

1. Add a tile loader that maps the chart view's `center` + `mPerPx` to tile
   fetches (the view is a plain web-mercator-like local projection;
   `util/geo.js` has the lon/lat ↔ world transforms).
2. Draw tiles first in `drawBaseChart()`, keep OSM land as fallback.
3. Real bathymetry can then replace `World.estimatedDepth()` (one function,
   `js/sim/world.js`) — grounding, the depth instrument and health hooks all
   read from it.

## Where things are tuned

See **TUNING.md**. Quick map:

| What | Where |
|---|---|
| Polars, pointing, accel, turn, leeway, heel | `js/config/boats.js` |
| Wind presets, WAT penalty, defaults | `js/config/environment.js` |
| Current zones / shoals / anchorages / scenarios | `data/chart-detail.json` |
| Tide curve behaviour | `js/sim/tide.js` |
| Depth proxy shape | `js/sim/world.js` |
| Health/comfort rates | `js/sim/health.js` |
| Sea state visuals | `js/scene/scene3d.js` |

## Assumptions and limitations

- **No real bathymetry.** Open depth data for the area wasn't bundled; depth
  is a shore-distance proxy plus hand-placed shoal patches. The depth
  instrument is labelled *est* for this reason. Soundings on the real chart
  (e.g. French Shoal at 2 m) informed the patches, but gaps exist.
- **Tide is one regional curve.** Real Whitsunday streams lag height
  differently per passage and have local anomalies (Solway's are notorious).
  Rates and directions are calibrated to the cruising-guide arrows at
  springs, not to harmonic predictions.
- **Magnetic variation fixed at 7.5°E.** Displays marked (M) use it.
- **Simplified coastline (~38 m tolerance).** Good for route choice; do not
  judge a 50 m wide pass by it. Fringing reefs are under-mapped in OSM, so
  reef-edge caution comes from the shallow-fringe band, not surveyed edges.
- **No waves' effect on motion** beyond the wind-against-tide speed penalty;
  no broaching, no surfing, no reefing model (polars cap at 25 kn as if
  sensibly reefed).
- **Single sail plan** (main + jib). No spinnaker, no reefing UI.
- **Hazards are stubs**; health hooks run but nothing spawns.
- **Time compression** doesn't accelerate the *visual* sea state, only the
  sim clock — deliberate, to keep the 3D readable at 12×.

## Hazard system status

`js/sim/hazards.js` is a working skeleton: frequency setting, spawn-roll
timer, event-bus contract (`hazard:spawn` / `hazard:clear`) and a typed
hazard list (whales, eddies, overfalls, debris, shallow patches). Behaviours
and presentation are a later iteration. The crew health bar already responds
to wind-against-tide, pinching, dead runs, shallow water, groundings,
favourable current and nice reaching conditions.
