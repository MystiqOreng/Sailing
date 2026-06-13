// Settings drawer: boat, weather, tide, performance tuning, scenarios,
// hazards (stub). Writes into the shared settings object; persists to
// localStorage. Sliders deliberately have wide ranges so users can tune
// behaviour to match their own boat experience (see TUNING.md).

import { BOATS } from '../config/boats.js';
import { WIND_DIRECTIONS, WEATHER_PRESETS } from '../config/environment.js';

const STORE_KEY = 'sail-whitsundays-settings';

export class SettingsPanel {
  constructor(root, state, events, onScenario) {
    this.state = state;
    this.events = events;
    this.onScenario = onScenario;
    this.root = root;
    this._build();
  }

  _build() {
    const s = this.state.settings;
    const world = this.state.world;
    const boat = () => BOATS[this.state.settings.boatId];

    const windBtns = WIND_DIRECTIONS.map(d =>
      `<button class="winddir ${d.deg === s.windFromDeg ? 'on' : ''}" data-deg="${d.deg}">${d.label}</button>`).join('');
    const presetOpts = WEATHER_PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    const destOpts = world.anchorages.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    const scenarioCards = world.detail.scenarios.map(sc => `
      <div class="scenario">
        <b>${sc.name}</b>
        <p>${sc.description}</p>
        <button class="load-scenario" data-id="${sc.id}">Load</button>
      </div>`).join('');
    const posSliders = ['closeHauled', 'closeReach', 'beamReach', 'broadReach', 'running'].map(k => `
      <label class="slider-row">${k.replace(/([A-Z])/g, ' $1').toLowerCase()}
        <input type="range" class="pos-mult" data-pos="${k}" min="60" max="140" value="100">
        <span class="val">1.00</span>
      </label>`).join('');

    this.root.innerHTML = `
      <div class="drawer-head">
        <h2>Settings</h2><button id="set-close">✕</button>
      </div>
      <nav class="tabs">
        <button data-tab="boat" class="on">Boat</button>
        <button data-tab="weather">Weather</button>
        <button data-tab="tide">Tide</button>
        <button data-tab="perf">Tuning</button>
        <button data-tab="nav">Passage</button>
      </nav>

      <section data-tab="boat">
        <label class="row">Boat type
          <select id="set-boat">
            <option value="mono">Monohull cruiser 40 ft</option>
            <option value="cat">Catamaran cruiser 40 ft</option>
          </select>
        </label>
        <label class="slider-row">Best close-hauled angle (°TWA)
          <input id="set-ch" type="range" min="38" max="62" value="${boat().closeHauledDeg}">
          <span class="val">${boat().closeHauledDeg}°</span>
        </label>
        <label class="row">Sail trim
          <select id="set-assist">
            <option value="auto">Auto (crew trims for you)</option>
            <option value="manual">Manual sheet</option>
          </select>
        </label>
        <label class="row">Hazards <span class="hint">(reserved for a later iteration)</span>
          <select id="set-hazards">
            <option value="off">Off</option>
            <option value="rare">Rare</option>
            <option value="occasional">Occasional</option>
          </select>
        </label>
      </section>

      <section data-tab="weather" hidden>
        <label class="row">Forecast preset
          <select id="set-preset"><option value="">— custom —</option>${presetOpts}</select>
        </label>
        <div class="row">Wind from <div class="windgrid">${windBtns}</div></div>
        <label class="slider-row">Wind speed (kn)
          <input id="set-wind" type="range" min="0" max="30" value="${s.windKn}">
          <span class="val">${s.windKn}</span>
        </label>
        <label class="slider-row">Gustiness / variability
          <input id="set-gust" type="range" min="0" max="100" value="${s.gustiness * 100}">
          <span class="val">${s.gustiness.toFixed(1)}</span>
        </label>
      </section>

      <section data-tab="tide" hidden>
        <label class="row"><input id="set-tideref" type="checkbox" ${s.tideRef?.enabled ? 'checked' : ''}>
          Use predicted tides (Hamilton Is. reference)</label>
        <div class="grid" id="tideref-fields">
          <label class="field">Next high water
            <input id="set-hw-time" type="time" value="${s.tideRef?.hwTime ?? ''}">
          </label>
          <label class="field">HW height (m)
            <input id="set-hw-h" type="number" step="0.1" min="0" max="6" value="${s.tideRef?.hwHeightM ?? ''}">
          </label>
          <label class="field">Next low water
            <input id="set-lw-time" type="time" value="${s.tideRef?.lwTime ?? ''}">
          </label>
          <label class="field">LW height (m)
            <input id="set-lw-h" type="number" step="0.1" min="0" max="6" value="${s.tideRef?.lwHeightM ?? ''}">
          </label>
        </div>
        <p class="hint" id="tideref-readout"></p>
        <label class="slider-row">Tide range (m) — neaps ↔ springs
          <input id="set-range" type="range" min="12" max="38" value="${s.tideRangeM * 10}">
          <span class="val">${s.tideRangeM.toFixed(1)}</span>
        </label>
        <label class="row"><input id="set-frozen" type="checkbox" ${s.tideFrozen ? 'checked' : ''}>
          Freeze tide state (practice mode)</label>
        <label class="row">Frozen state
          <select id="set-frozen-state">
            <option value="flood">Flooding (max)</option>
            <option value="ebb">Ebbing (max)</option>
            <option value="slack">Slack water</option>
          </select>
        </label>
        <p class="hint">Streams flood SOUTH through the passages, ebb north
        (per 100 Magic Miles). Zone rates live in data/chart-detail.json.</p>
      </section>

      <section data-tab="perf" hidden>
        <label class="slider-row">Overall speed multiplier
          <input id="set-speed" type="range" min="60" max="140" value="${s.speedMultiplier * 100}">
          <span class="val">${s.speedMultiplier.toFixed(2)}</span>
        </label>
        <h3>Point-of-sail multipliers (${boat().name})</h3>
        ${posSliders}
        <p class="hint">Defaults already sail believably; these are for matching
        a boat you know. Full polar tables: js/config/boats.js.</p>
      </section>

      <section data-tab="nav" hidden>
        <label class="row">Destination
          <select id="set-dest"><option value="">— none —</option>${destOpts}</select>
        </label>
        <label class="row">Start from
          <select id="set-origin">${destOpts}</select>
        </label>
        <button id="set-teleport" class="wide">Move boat to start</button>
        <h3>Scenarios</h3>
        ${scenarioCards}
      </section>`;

    const $ = sel => this.root.querySelector(sel);
    const $$ = sel => [...this.root.querySelectorAll(sel)];

    $('#set-close').onclick = () => this.root.classList.remove('open');
    $$('.tabs button').forEach(b => b.onclick = () => {
      $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
      $$('section').forEach(sec => sec.hidden = sec.dataset.tab !== b.dataset.tab);
    });

    const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(this.state.settings));
    const bindVal = (input, fmt) => {
      const span = input.closest('.slider-row')?.querySelector('.val');
      if (span) span.textContent = fmt();
    };

    $('#set-boat').value = s.boatId;
    $('#set-boat').onchange = e => {
      s.boatId = e.target.value;
      s.closeHauledDeg = null; // reset to new boat's default
      $('#set-ch').value = BOATS[s.boatId].closeHauledDeg;
      bindVal($('#set-ch'), () => `${BOATS[s.boatId].closeHauledDeg}°`);
      save();
    };
    $('#set-ch').oninput = e => {
      s.closeHauledDeg = +e.target.value;
      bindVal(e.target, () => `${s.closeHauledDeg}°`); save();
    };
    $('#set-assist').value = s.assistance;
    $('#set-assist').onchange = e => { s.assistance = e.target.value; save(); };
    $('#set-hazards').value = s.hazardFrequency;
    $('#set-hazards').onchange = e => { s.hazardFrequency = e.target.value; save(); };

    $('#set-preset').onchange = e => {
      const p = WEATHER_PRESETS.find(x => x.id === e.target.value);
      if (!p) return;
      s.windFromDeg = p.windFromDeg; s.windKn = p.windKn; s.gustiness = p.gustiness;
      $('#set-wind').value = p.windKn;
      bindVal($('#set-wind'), () => String(p.windKn));
      $('#set-gust').value = p.gustiness * 100;
      bindVal($('#set-gust'), () => p.gustiness.toFixed(1));
      $$('.winddir').forEach(b => b.classList.toggle('on', +b.dataset.deg === p.windFromDeg));
      save();
    };
    $$('.winddir').forEach(b => b.onclick = () => {
      s.windFromDeg = +b.dataset.deg;
      $$('.winddir').forEach(x => x.classList.toggle('on', x === b));
      $('#set-preset').value = ''; save();
    });
    $('#set-wind').oninput = e => {
      s.windKn = +e.target.value;
      bindVal(e.target, () => String(s.windKn)); save();
    };
    $('#set-gust').oninput = e => {
      s.gustiness = e.target.value / 100;
      bindVal(e.target, () => s.gustiness.toFixed(1)); save();
    };

    $('#set-range').oninput = e => {
      s.tideRangeM = e.target.value / 10;
      bindVal(e.target, () => s.tideRangeM.toFixed(1)); save();
    };

    // ---- predicted tide (Hamilton Is. reference)
    const tideRefReadout = $('#tideref-readout');
    const applyTideRef = () => {
      s.tideRef = {
        enabled: $('#set-tideref').checked,
        hwTime: $('#set-hw-time').value,
        hwHeightM: $('#set-hw-h').value === '' ? null : +$('#set-hw-h').value,
        lwTime: $('#set-lw-time').value,
        lwHeightM: $('#set-lw-h').value === '' ? null : +$('#set-lw-h').value,
      };
      this.state.tide.setReference?.(s.tideRef);
      const r = s.tideRef;
      if (r.enabled && this.state.tide.ref) {
        const range = Math.abs(r.hwHeightM - r.lwHeightM);
        tideRefReadout.textContent =
          `Range ${range.toFixed(1)} m · stream follows rule of twelfths (1·2·3·3·2·1), ` +
          `slack at HW/LW, fastest mid-tide.`;
      } else {
        tideRefReadout.textContent = r.enabled
          ? 'Enter both HW and LW time + height to drive the tide.'
          : 'Using the synthetic range slider below.';
      }
      save();
    };
    ['#set-tideref', '#set-hw-time', '#set-hw-h', '#set-lw-time', '#set-lw-h']
      .forEach(sel => { $(sel).oninput = applyTideRef; $(sel).onchange = applyTideRef; });
    applyTideRef();

    $('#set-frozen').onchange = e => { s.tideFrozen = e.target.checked; save(); };
    $('#set-frozen-state').value = s.tideFrozenState;
    $('#set-frozen-state').onchange = e => { s.tideFrozenState = e.target.value; save(); };

    $('#set-speed').oninput = e => {
      s.speedMultiplier = e.target.value / 100;
      bindVal(e.target, () => s.speedMultiplier.toFixed(2)); save();
    };
    $$('.pos-mult').forEach(inp => {
      inp.value = BOATS[s.boatId].posMultipliers[inp.dataset.pos] * 100;
      inp.oninput = () => {
        BOATS[s.boatId].posMultipliers[inp.dataset.pos] = inp.value / 100;
        bindVal(inp, () => (inp.value / 100).toFixed(2));
      };
    });

    $('#set-dest').onchange = e => {
      const a = this.state.world.anchorageById(e.target.value);
      this.state.destination = a ? { x: a.x, z: a.z, name: a.name } : null;
      this.state.route.length = 0;
    };
    $('#set-origin').value = 'pioneer';
    $('#set-teleport').onclick = () => {
      const a = this.state.world.anchorageById($('#set-origin').value);
      if (a) {
        this.state.boat.setPosition(a.x, a.z, a.approachDeg ?? 0);
        this.events.emit('notice', { text: `Departed ${a.name}`, kind: 'info' });
        this.root.classList.remove('open');
      }
    };
    $$('.load-scenario').forEach(b => b.onclick = () => {
      this.onScenario(b.dataset.id);
      // sync UI to scenario weather
      $('#set-wind').value = s.windKn;
      bindVal($('#set-wind'), () => String(s.windKn));
      $$('.winddir').forEach(x => x.classList.toggle('on', +x.dataset.deg === s.windFromDeg));
      $('#set-range').value = s.tideRangeM * 10;
      bindVal($('#set-range'), () => s.tideRangeM.toFixed(1));
      $('#set-dest').value = this.state.destination?.id ?? $('#set-dest').value;
      this.root.classList.remove('open');
    });
  }

  static restore(settings) {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) Object.assign(settings, JSON.parse(raw));
    } catch { /* fresh start */ }
  }
}
