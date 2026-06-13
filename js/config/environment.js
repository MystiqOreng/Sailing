// Environmental presets and defaults.
//
// ===== TUNING: default weather/tide behaviour lives here =====

export const WIND_DIRECTIONS = [
  { label: 'N', deg: 0 }, { label: 'NE', deg: 45 }, { label: 'E', deg: 90 },
  { label: 'ESE', deg: 112.5 }, { label: 'SE', deg: 135 }, { label: 'SSE', deg: 157.5 },
  { label: 'S', deg: 180 }, { label: 'SW', deg: 225 }, { label: 'W', deg: 270 },
  { label: 'NW', deg: 315 },
];

export const WEATHER_PRESETS = [
  { id: 'trade-fresh', name: 'SE trade, fresh (18-23 kn)', windFromDeg: 135, windKn: 20, gustiness: 0.5 },
  { id: 'trade-mod', name: 'SE trade, moderate (14-18 kn)', windFromDeg: 135, windKn: 16, gustiness: 0.4 },
  { id: 'trade-light', name: 'ESE light (8-12 kn)', windFromDeg: 112.5, windKn: 10, gustiness: 0.3 },
  { id: 'northerly', name: 'Northerly change (10-15 kn)', windFromDeg: 10, windKn: 12, gustiness: 0.6 },
  { id: 'glass', name: 'Light & variable (4-6 kn)', windFromDeg: 90, windKn: 5, gustiness: 0.8 },
];

export const TIDE_DEFAULTS = {
  periodH: 12.42,        // semidiurnal M2 period
  springRangeM: 3.6,     // spring range the current zones are calibrated to
  defaultRangeM: 2.8,    // neaps ~1.2 — springs ~3.6 (slider)
  meanDepthOffsetM: 0,   // reserved for datum work with real bathymetry
};

// Wind-against-tide model. chop = opposition × current(kn) × (TWS/15).
// STW penalty = min(maxPenalty, penaltyPerChop × chop).
export const WIND_AGAINST_TIDE = {
  oppositionThreshold: 0.4,  // cos-based opposition before any effect
  penaltyPerChop: 0.07,
  maxPenalty: 0.30,
  whitecapBoost: 0.6,        // extra whitecap intensity in WAT zones
};

// Time compression options (sim seconds per real second).
export const TIME_SCALES = [1, 4, 12, 20];

export const DEFAULT_SETTINGS = {
  boatId: 'mono',
  closeHauledDeg: null,      // null = use boat default
  speedMultiplier: 1.0,      // global sailing speed slider 0.6–1.4
  assistance: 'auto',        // 'auto' = auto sail trim, 'manual' = sheet slider
  hazardFrequency: 'off',    // off | rare | occasional  (spawning stubbed)
  overlays: { current: true, wind: true, laylines: true, route: true, labels: true, graticule: false },
  windFromDeg: 135,
  windKn: 16,
  gustiness: 0.4,
  tideRangeM: 2.8,
  tideFrozen: false,
  tideFrozenState: 'flood',  // flood | ebb | slack
  // Predicted tide (Hamilton Island reference): when enabled the stream rate
  // and height follow the next HW/LW the user enters (rule-of-twelfths curve)
  // instead of the synthetic range slider.
  tideRef: { enabled: false, hwTime: '', hwHeightM: null, lwTime: '', lwHeightM: null },
  timeScale: 4,
};
