// Sail Whitsundays 3D — entry point. Wires data, sim, 3D scene, chart and UI.

import { loadWorld } from './sim/world.js';
import { Boat } from './sim/boat.js';
import { Wind } from './sim/wind.js';
import { Tide } from './sim/tide.js';
import { Health } from './sim/health.js';
import { Hazards } from './sim/hazards.js';
import { EventBus } from './sim/events.js';
import { Scene3D } from './scene/scene3d.js';
import { Boat3D } from './scene/boat3d.js';
import { Chart } from './chart/chart.js';
import { Instruments } from './ui/instruments.js';
import { Helm } from './ui/helm.js';
import { SettingsPanel } from './ui/settings.js';
import { DEFAULT_SETTINGS, TIME_SCALES } from './config/environment.js';

const $ = sel => document.querySelector(sel);

async function init() {
  const world = await loadWorld();

  const settings = structuredClone(DEFAULT_SETTINGS);
  SettingsPanel.restore(settings);

  const events = new EventBus();
  const state = {
    world, settings, events,
    boat: new Boat(settings),
    wind: new Wind(settings),
    tide: new Tide(settings, world.detail.currentZones),
    health: null,
    destination: null,
    route: [],            // chart waypoints (judgement aid, no ETA by design)
    simTime: 9 * 3600,    // sim clock, seconds since midnight
    paused: false,
  };
  state.health = new Health(events);
  state.tide.setReference?.(settings.tideRef); // predicted-tide mode if enabled
  const hazards = new Hazards(settings, events);

  // ---- scenario loader
  let lastScenarioId = null; // restart re-runs this, or the default start
  function loadScenario(id) {
    const sc = world.detail.scenarios.find(s => s.id === id);
    if (!sc) return;
    lastScenarioId = id;
    settings.windFromDeg = sc.windFromDeg;
    settings.windKn = sc.windKn;
    settings.gustiness = sc.gustiness;
    settings.tideRangeM = sc.tideRangeM;
    settings.tideFrozen = false;
    state.tide.setClockHours(sc.tideClockH);
    const o = world.anchorageById(sc.originId);
    const d = world.anchorageById(sc.destinationId);
    state.boat.setPosition(o.x, o.z, o.approachDeg ?? 0);
    state.destination = { x: d.x, z: d.z, name: d.name, id: d.id };
    state.route.length = 0;
    events.emit('notice', { text: sc.name, kind: 'info' });
  }

  // default situation: free sailing off Pioneer Rocks (Airlie Beach), no set
  // destination. Start on a flooding tide so the tidal streams are visible.
  function defaultStart() {
    lastScenarioId = null;
    const o = world.anchorageById('pioneer');
    state.boat.setPosition(o.x, o.z, o.approachDeg ?? 0);
    state.destination = null;
    state.route.length = 0;
    state.tide.setClockHours(9.3); // near peak flood
  }

  function restart() {
    state.simTime = 9 * 3600;
    state.health.value = 100;
    if (lastScenarioId) loadScenario(lastScenarioId);
    else {
      defaultStart();
      events.emit('notice', { text: 'Restarted off Pioneer Rocks.', kind: 'info' });
    }
  }

  // ---- 3D + chart + UI
  const scene = new Scene3D($('#scene3d'), world);
  const boat3d = new Boat3D(scene.scene);
  const chart = new Chart($('#chart'), world, state);
  const instruments = new Instruments($('#instruments'), state);
  const helm = new Helm($('#helm'), state, events);
  new SettingsPanel($('#settings'), state, events, loadScenario);

  function resizeAll() {
    scene.resize(innerWidth, innerHeight);
    chart.resize();
  }
  addEventListener('resize', resizeAll);
  resizeAll();

  // ---- top bar
  $('#btn-settings').onclick = () => $('#settings').classList.toggle('open');
  const chartWrap = $('#chart-wrap');
  $('#btn-chart').onclick = () => {
    chartWrap.classList.toggle('open');
    $('#btn-chart').classList.toggle('on');
    chart.resize();
  };
  $('#btn-pause').onclick = () => {
    state.paused = !state.paused;
    $('#btn-pause').textContent = state.paused ? '▶' : '⏸';
  };
  $('#btn-restart').onclick = restart;
  $('#btn-top').onclick = () => {
    const on = $('#btn-top').classList.toggle('on');
    scene.setTopDown(on);
  };
  for (const ts of TIME_SCALES) {
    const b = document.createElement('button');
    b.textContent = ts + '×';
    b.className = 'ts-btn' + (ts === settings.timeScale ? ' on' : '');
    b.onclick = () => {
      settings.timeScale = ts;
      document.querySelectorAll('.ts-btn').forEach(x => x.classList.toggle('on', x === b));
    };
    $('#timescales').appendChild(b);
  }

  // ---- chart toolbar
  const ovBtns = { current: 'CUR', wind: 'WIND', laylines: 'LAY', labels: 'ABC', graticule: 'GRID' };
  const tools = $('#chart-tools');
  for (const [key, label] of Object.entries(ovBtns)) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'chip' + (settings.overlays[key] ? ' on' : '');
    b.onclick = () => {
      settings.overlays[key] = !settings.overlays[key];
      b.classList.toggle('on');
    };
    tools.appendChild(b);
  }
  const routeBtn = document.createElement('button');
  routeBtn.textContent = 'ROUTE+';
  routeBtn.className = 'chip';
  routeBtn.onclick = () => {
    chart.routeEdit = !chart.routeEdit;
    routeBtn.classList.toggle('on', chart.routeEdit);
  };
  tools.appendChild(routeBtn);
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'CLR';
  clearBtn.className = 'chip';
  clearBtn.onclick = () => { state.route.length = 0; };
  tools.appendChild(clearBtn);

  // basemap cycle: offline canvas chart → OSM → Esri satellite (both online
  // modes add OpenSeaMap seamarks and far richer reef detail)
  const baseModes = [
    { id: 'offline', label: 'CHART' },
    { id: 'osm', label: 'OSM' },
    { id: 'sat', label: 'SAT' },
  ];
  const baseBtn = document.createElement('button');
  baseBtn.className = 'chip';
  const syncBaseBtn = () => {
    const m = baseModes.find(b => b.id === chart.baseMode) ?? baseModes[0];
    baseBtn.textContent = '🗺 ' + m.label;
    baseBtn.classList.toggle('on', chart.baseMode !== 'offline');
  };
  baseBtn.onclick = () => {
    const i = baseModes.findIndex(b => b.id === chart.baseMode);
    chart.setBaseMode(baseModes[(i + 1) % baseModes.length].id);
    syncBaseBtn();
  };
  syncBaseBtn();
  tools.appendChild(baseBtn);
  $('#btn-center').onclick = () => chart.centerOnBoat();
  $('#btn-zin').onclick = () => chart.zoomBy(0.6);
  $('#btn-zout').onclick = () => chart.zoomBy(1 / 0.6);

  // ---- notices
  const noticeBox = $('#notices');
  events.on('notice', ({ text, kind }) => {
    const el = document.createElement('div');
    el.className = 'notice ' + (kind ?? 'info');
    el.textContent = text;
    noticeBox.appendChild(el);
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 6000);
  });
  events.on('aground', () =>
    events.emit('notice', { text: 'Aground! Back the sails and turn to deeper water.', kind: 'bad' }));

  // arrival check
  let arrived = false;
  setInterval(() => {
    if (!state.destination) { arrived = false; return; }
    const d = Math.hypot(state.destination.x - state.boat.x, state.destination.z - state.boat.z);
    if (d < 250 && !arrived) {
      arrived = true;
      events.emit('notice', { text: `Arrived: ${state.destination.name}. Well sailed.`, kind: 'good' });
    } else if (d > 600) arrived = false;
  }, 2000);

  // ---- default situation: off Pioneer Rocks; returning players keep their
  // saved weather/tide and start at the same spot
  defaultStart();
  if (!localStorage.getItem('sail-whitsundays-visited')) {
    localStorage.setItem('sail-whitsundays-visited', '1');
    events.emit('notice', { text: 'Free sailing off Airlie Beach — open the chart and judge wind and tide.', kind: 'info' });
  }

  // dev/test shortcuts: #chart opens the chart, #close zooms the camera in,
  // #cat starts on the catamaran, #top starts in the aerial view
  if (location.hash === '#chart') $('#btn-chart').click();
  if (location.hash === '#osm' || location.hash === '#sat') {
    $('#btn-chart').click();
    chart.setBaseMode(location.hash.slice(1));
    syncBaseBtn();
  }
  if (location.hash === '#top') $('#btn-top').click();
  if (location.hash === '#tack') setTimeout(() => $('#h-tack').click(), 3000);
  if (location.hash === '#close' || location.hash === '#cat') scene.camera.position.set(14, 6, 18);
  if (location.hash === '#cat') settings.boatId = 'cat';

  // ---- main loop
  const clockEl = $('#clock');
  let last = performance.now();
  let uiTick = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (!state.paused) {
      let simDt = realDt * settings.timeScale;
      state.simTime += simDt;
      while (simDt > 0) {
        const dt = Math.min(simDt, 0.5);
        simDt -= dt;
        state.wind.update(state.simTime);
        state.tide.advance(dt, state.simTime);
        state.boat.update(dt, state.wind, state.tide, world, events);
        state.health.update(dt, state.boat, state.wind);
        hazards.update(dt);
      }
    }

    // 3D (skip when chart fills the screen — saves tablet battery)
    if (!chartWrap.classList.contains('open')) {
      boat3d.update(state.boat, state.simTime);
      scene.setDestination(state.destination);
      scene.follow(state.boat);
      scene.update(realDt, state.simTime, state.boat,
        state.wind.speedKn, state.wind.fromDeg, state.boat.chop);
    } else {
      chart.render(realDt);
    }

    // instruments at ~10 Hz is plenty
    uiTick += realDt;
    if (uiTick > 0.1) {
      uiTick = 0;
      instruments.update();
      helm.update();
      const h = Math.floor(state.simTime / 3600) % 24;
      const m = Math.floor(state.simTime / 60) % 60;
      clockEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  requestAnimationFrame(frame);

  $('#loading').remove();
}

init().catch(err => {
  console.error(err);
  const el = document.querySelector('#loading');
  if (el) el.textContent = 'Failed to load: ' + err.message;
});
