// Helm controls: touch-first steering buttons, autopilot heading hold,
// tack/gybe assist, manual sheet slider. Keyboard equivalents for desktop.

import { norm360, toMagnetic, fmtDeg, angleDiff } from '../util/geo.js';

export class Helm {
  constructor(root, state, events) {
    this.state = state;
    root.innerHTML = `
      <div class="helm-row">
        <button id="h-port" class="helm-btn">◀ PORT</button>
        <button id="h-tack" class="helm-btn small">TACK / GYBE</button>
        <button id="h-stbd" class="helm-btn">STBD ▶</button>
      </div>
      <div class="helm-row ap">
        <button id="ap-m10" class="ap-btn">−10</button>
        <button id="ap-m1" class="ap-btn">−1</button>
        <div id="ap-display"><label>AP HDG (M)</label><b id="ap-hdg">—</b></div>
        <button id="ap-p1" class="ap-btn">+1</button>
        <button id="ap-p10" class="ap-btn">+10</button>
      </div>
      <div class="helm-row" id="sheet-row" hidden>
        <label>SHEET</label>
        <input id="h-sheet" type="range" min="0" max="100" value="50">
        <span id="h-sheet-val">in ◀▶ eased</span>
      </div>`;
    const $ = id => root.querySelector(id);

    const hold = (el, dir) => {
      const on = e => { e.preventDefault(); this.state.boat.helm = dir; };
      const off = () => {
        if (this.state.boat.helm === dir) {
          this.state.boat.helm = 0;
          this.state.boat.autopilot = this.state.boat.headingDeg; // hold new course
        }
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    hold($('#h-port'), -1);
    hold($('#h-stbd'), 1);

    const nudgeAp = d => {
      const boat = this.state.boat;
      boat.autopilot = norm360((boat.autopilot ?? boat.headingDeg) + d);
    };
    $('#ap-m10').onclick = () => nudgeAp(-10);
    $('#ap-m1').onclick = () => nudgeAp(-1);
    $('#ap-p1').onclick = () => nudgeAp(1);
    $('#ap-p10').onclick = () => nudgeAp(10);

    $('#h-tack').onclick = () => {
      const boat = this.state.boat;
      const wind = this.state.wind;
      // mirror the true wind angle through the eye of the wind (or dead aft):
      // heading = windFrom - twa, so the mirrored course is windFrom + twa
      const twa = angleDiff(wind.fromDeg, boat.autopilot ?? boat.headingDeg);
      boat.autopilot = norm360(wind.fromDeg + twa);
      events.emit('notice', { text: Math.abs(twa) < 90 ? 'Tacking…' : 'Gybing…', kind: 'info' });
    };

    this.sheetRow = $('#sheet-row');
    $('#h-sheet').addEventListener('input', e => {
      this.state.boat.sheet = e.target.value / 100;
    });
    this.apEl = $('#ap-hdg');

    // keyboard: arrows steer, [ ] trim, T tack
    window.addEventListener('keydown', e => {
      if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft') this.state.boat.helm = -1;
      if (e.key === 'ArrowRight') this.state.boat.helm = 1;
      if (e.key === 't' || e.key === 'T') $('#h-tack').click();
      if (e.key === '[') nudgeAp(e.shiftKey ? -10 : -1);
      if (e.key === ']') nudgeAp(e.shiftKey ? 10 : 1);
    });
    window.addEventListener('keyup', e => {
      if (e.key === 'ArrowLeft' && this.state.boat.helm === -1 ||
          e.key === 'ArrowRight' && this.state.boat.helm === 1) {
        this.state.boat.helm = 0;
        this.state.boat.autopilot = this.state.boat.headingDeg;
      }
    });
  }

  update() {
    const boat = this.state.boat;
    this.apEl.textContent = boat.autopilot != null ? fmtDeg(toMagnetic(boat.autopilot)) : '—';
    this.sheetRow.hidden = this.state.settings.assistance !== 'manual';
  }
}
