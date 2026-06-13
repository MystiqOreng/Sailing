// Instrument cluster: marine-display styling, updated each frame.
// The compass rose canvas shows heading (lubber), wind-FROM (orange arrow,
// per spec the compass arrow points where wind comes from), COG (green) and
// current set (blue).

import {
  toMagnetic, fmtDeg, compassPoint, norm360, dirToVec,
} from '../util/geo.js';
import { POS_LABELS } from '../config/boats.js';

export class Instruments {
  constructor(root, state) {
    this.state = state;
    root.innerHTML = `
      <canvas id="rose" width="280" height="280"></canvas>
      <div class="inst-grid">
        <div class="inst"><label>HDG (M)</label><b id="i-hdg">000°</b></div>
        <div class="inst"><label>COG (M)</label><b id="i-cog">000°</b></div>
        <div class="inst"><label>STW kn</label><b id="i-stw">0.0</b></div>
        <div class="inst"><label>SOG kn</label><b id="i-sog">0.0</b></div>
        <div class="inst"><label>AWA / AWS</label><b id="i-aw">0° / 0</b></div>
        <div class="inst"><label>TWD / TWS</label><b id="i-tw">SE / 0</b></div>
        <div class="inst"><label>DEPTH est</label><b id="i-depth">—</b></div>
        <div class="inst"><label>CURRENT</label><b id="i-cur">slack</b></div>
      </div>
      <div id="i-pos" class="pos-banner">IN IRONS</div>
      <div class="tide-row">
        <span id="i-tide">TIDE —</span>
        <span class="health"><i id="i-health" style="width:100%"></i></span>
      </div>`;
    this.rose = root.querySelector('#rose');
    this.el = id => root.querySelector(id);
    this.cache = {};
  }

  _set(id, text) {
    if (this.cache[id] !== text) {
      this.cache[id] = text;
      this.el(id).textContent = text;
    }
  }

  update() {
    const { boat, wind, tide, health } = this.state;
    this._set('#i-hdg', fmtDeg(toMagnetic(boat.headingDeg)));
    this._set('#i-cog', fmtDeg(toMagnetic(boat.cogDeg)));
    this._set('#i-stw', boat.stwKn.toFixed(1));
    this._set('#i-sog', boat.sogKn.toFixed(1));
    this._set('#i-aw', `${Math.abs(Math.round(boat.awaDeg))}°${boat.awaDeg >= 0 ? 'S' : 'P'} / ${boat.awsKn.toFixed(0)}`);
    this._set('#i-tw', `${compassPoint(wind.fromDeg)} / ${wind.speedKn.toFixed(0)}`);
    this._set('#i-depth', boat.depthM > 28 ? '>30 m' : `${boat.depthM.toFixed(1)} m`);
    this._set('#i-cur', boat.currentKn < 0.15 ? 'slack'
      : `${boat.currentKn.toFixed(1)} kn → ${fmtDeg(toMagnetic(boat.currentDirDeg))}`);

    const pos = this.el('#i-pos');
    const label = boat.aground ? 'AGROUND' : POS_LABELS[boat.pos];
    if (this.cache.pos !== label) {
      this.cache.pos = label;
      pos.textContent = label;
      pos.className = 'pos-banner' +
        (boat.aground ? ' bad' : boat.pos === 'inIrons' ? ' warn' : '');
    }

    const turn = tide.hoursToTurn();
    this._set('#i-tide', `TIDE ${tide.state.toUpperCase()} ${tide.heightM >= 0 ? '+' : ''}${tide.heightM.toFixed(1)}m` +
      (turn != null ? ` · turns ${turn.toFixed(1)}h` : ' · frozen'));
    this.el('#i-health').style.width = health.value.toFixed(0) + '%';
    this.el('#i-health').style.background =
      health.value > 60 ? '#3f9b56' : health.value > 30 ? '#c9912b' : '#b3361e';

    this._drawRose();
  }

  _drawRose() {
    const c = this.rose, ctx = c.getContext('2d');
    const { boat, wind } = this.state;
    const R = c.width / 2, r = R - 18;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(R, R);

    // card (north-up, magnetic)
    ctx.strokeStyle = '#3d4f63'; ctx.fillStyle = '#0e1925';
    ctx.beginPath(); ctx.arc(0, 0, r + 12, 0, 7); ctx.fill();
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#9fb4c8'; ctx.font = 'bold 18px Helvetica';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 30) {
      const a = (d - 90) * Math.PI / 180;
      const lx = Math.cos(a), ly = Math.sin(a);
      ctx.strokeStyle = '#54677c'; ctx.lineWidth = d % 90 === 0 ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(lx * (r - 8), ly * (r - 8)); ctx.lineTo(lx * r, ly * r);
      ctx.stroke();
      if (d % 90 === 0) {
        ctx.fillStyle = '#cfdce8';
        ctx.fillText('NESW'[d / 90], lx * (r - 24), ly * (r - 24));
      }
    }

    const arrow = (degTrue, color, len, width, head = true) => {
      const a = (toMagnetic(degTrue) - 90) * Math.PI / 180;
      const x = Math.cos(a) * len, y = Math.sin(a) * len;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y);
      if (head) {
        const ha = Math.atan2(y, x);
        ctx.moveTo(x, y);
        ctx.lineTo(x - 10 * Math.cos(ha - 0.4), y - 10 * Math.sin(ha - 0.4));
        ctx.moveTo(x, y);
        ctx.lineTo(x - 10 * Math.cos(ha + 0.4), y - 10 * Math.sin(ha + 0.4));
      }
      ctx.stroke();
    };

    // wind arrow points FROM the wind direction toward centre (spec)
    {
      const a = (toMagnetic(wind.fromDeg) - 90) * Math.PI / 180;
      const ox = Math.cos(a) * (r - 4), oy = Math.sin(a) * (r - 4);
      const ix = Math.cos(a) * (r - 38), iy = Math.sin(a) * (r - 38);
      ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ix, iy);
      const ha = Math.atan2(iy - oy, ix - ox);
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix - 12 * Math.cos(ha - 0.45), iy - 12 * Math.sin(ha - 0.45));
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix - 12 * Math.cos(ha + 0.45), iy - 12 * Math.sin(ha + 0.45));
      ctx.stroke();
    }

    arrow(boat.cogDeg, '#56b06c', r - 46, 2.5);
    if (boat.currentKn > 0.15) arrow(boat.currentDirDeg, '#4d9fd6', 30 + boat.currentKn * 14, 2.5);

    // heading lubber: boat-shaped pointer
    {
      const a = (toMagnetic(boat.headingDeg) - 90) * Math.PI / 180;
      ctx.save();
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = '#e6e1d3';
      ctx.beginPath();
      ctx.moveTo(0, -(r - 52)); ctx.lineTo(7, 12); ctx.lineTo(-7, 12);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // no-go zone shading around wind-from
    {
      const noGo = boat.noGoDeg;
      const a0 = (toMagnetic(wind.fromDeg) - noGo - 90) * Math.PI / 180;
      const a1 = (toMagnetic(wind.fromDeg) + noGo - 90) * Math.PI / 180;
      ctx.fillStyle = 'rgba(214, 86, 60, 0.14)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r - 8, a0, a1); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
