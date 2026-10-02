// DOM heads-up display + minimap.

import { toSat } from './geo.js';
import { ROAD_OUTER, ISLANDS } from './trackData.js';
import { BBOX } from './world.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      instrJa: $('instr-ja'), instrEn: $('instr-en'), instr: $('instr'),
      next: $('next'), nextLabel: $('next-label'), nextDist: $('next-dist'), nextChecks: $('next-checks'),
      score: $('score'), scoreVal: $('score-val'), list: $('demerit-list'),
      speed: $('speed-val'), gear: $('gear'), blL: $('blink-l'), blR: $('blink-r'),
      look: $('look'), toasts: $('toasts'), status: $('status-line'),
      map: $('minimap'),
    };
    this.mapSize = 1;
    this.buildMapBase();
  }

  setInstruction(ja, en) {
    this.el.instrJa.textContent = ja;
    this.el.instrEn.textContent = en;
    this.el.instr.classList.remove('flash');
    void this.el.instr.offsetWidth;
    this.el.instr.classList.add('flash');
  }

  toast(html, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.innerHTML = html;
    this.el.toasts.prepend(d);
    setTimeout(() => d.classList.add('out'), 4200);
    setTimeout(() => d.remove(), 5000);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
  }

  update(car, ex, opts) {
    const e = this.el;
    e.speed.textContent = Math.round(car.speedKmh);
    e.gear.innerHTML = ['P', 'R', 'N', 'D'].map((g) => `<span class="${car.gear === g ? 'on' : ''}">${g}</span>`).join('') +
      (car.pbrake ? '<span class="pb">(P)</span>' : '') + (car.seatbelt ? '' : '<span class="pb">BELT</span>');
    const on = car.blinkOn;
    e.blL.classList.toggle('on', !!(on && car.blinker === 'left'));
    e.blR.classList.toggle('on', !!(on && car.blinker === 'right'));
    e.blL.classList.toggle('armed', car.blinker === 'left');
    e.blR.classList.toggle('armed', car.blinker === 'right');

    const cur = ex.current || [];
    const names = { mirrorL: '左ミラー L mirror', mirrorR: '右ミラー R mirror', mirrorRear: 'ルームミラー Rear mirror', lookL: '左後方目視 L shoulder', lookR: '右後方目視 R shoulder' };
    const shown = cur.filter((k) => names[k]).map((k) => names[k]);
    e.look.textContent = shown.length ? '👁 ' + shown.join(' · ') : (cur.includes('sideL') ? '👁 左確認 looking left' : cur.includes('sideR') ? '👁 右確認 looking right' : '');

    // practice guidance
    const practice = opts.mode === 'practice';
    e.next.style.display = practice && opts.guide ? '' : 'none';
    e.score.style.display = practice ? '' : 'none';
    if (practice) {
      const n = ex.nextAction();
      if (n) {
        e.nextLabel.textContent = n.label;
        e.nextDist.textContent = n.dist > 1 ? `${Math.round(n.dist)} m` : 'now';
        const item = (ok, color, text) => `<div class="chk ${ok ? 'ok' : ''}"><i style="background:${color}"></i>${text}<b>${ok ? '✓' : ''}</b></div>`;
        let h = '';
        if (n.ev.type === 'start') {
          h += item(n.belt, '#999', 'B シートベルト Seatbelt');
          h += item(n.gear === 'D', '#999', 'Brake + G → D レンジ');
          h += item(!n.pbrake, '#999', 'P サイドブレーキ解除 Release');
        }
        if (n.mirror !== undefined) {
          const side = n.ev.dir === 'left' ? 'Z' : 'C';
          h += item(n.mirror, '#2ecc71', `ミラー Mirror (X / ${side})`);
          h += item(n.signal, '#3b82f6', `合図 Signal (${(n.ev.dir || 'right') === 'left' ? 'Q' : 'E'})`);
          h += item(n.visual, '#ef4444', `目視 Shoulder (hold ${side})`);
          if (n.both) h += `<div class="chk"><i style="background:#ef4444"></i>左右確認 Look both ways (Z, C)</div>`;
        }
        if (n.stopped !== undefined) {
          h += item(n.stopped, '#999', '完全停止 Full stop');
          if (n.ev.type === 'stop') {
            h += item(n.lookL, '#ef4444', '左確認 Look left (Z)');
            h += item(n.lookR, '#ef4444', '右確認 Look right (C)');
          }
        }
        e.nextChecks.innerHTML = h;
      } else {
        e.nextLabel.textContent = '';
        e.nextDist.textContent = '';
        e.nextChecks.innerHTML = '';
      }
      e.scoreVal.textContent = ex.score;
      e.scoreVal.className = ex.score >= 70 && !ex.failed ? 'pass' : 'fail';
    }
    this.drawMap(car, ex, opts);
  }

  setDemerits(list, mode) {
    if (mode !== 'practice') return;
    this.el.list.innerHTML = list.slice(-6).reverse().map((d) =>
      `<li><b>${d.pts === 'fail' ? '中止' : '-' + d.pts}</b> ${d.ja}<small>${d.en}${d.detail ? ' — ' + d.detail : ''}</small></li>`).join('');
  }

  // --- minimap ---------------------------------------------------------------
  buildMapBase() {
    const scale = 4; // px per metre at the largest size
    const w = Math.round((BBOX.x1 - BBOX.x0) * 0.115 * scale);
    const h = Math.round((BBOX.y1 - BBOX.y0) * 0.115 * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    const k = w / (BBOX.x1 - BBOX.x0);
    g.fillStyle = '#26331f'; g.fillRect(0, 0, w, h);
    g.setTransform(k, 0, 0, k, -BBOX.x0 * k, -BBOX.y0 * k);
    const poly = (f) => { g.beginPath(); g.moveTo(f[0], f[1]); for (let i = 2; i < f.length; i += 2) g.lineTo(f[i], f[i + 1]); g.closePath(); };
    g.fillStyle = '#6b6f75'; poly(ROAD_OUTER); g.fill();
    g.fillStyle = '#4c6a35'; for (const isl of ISLANDS) { poly(isl); g.fill(); }
    this.mapBase = cv;
    this.mapK = k;
  }

  drawMap(car, ex, opts) {
    const cv = this.el.map;
    if (this.mapSize === 0) { cv.style.display = 'none'; return; }
    cv.style.display = '';
    const W = this.mapSize === 2 ? Math.min(window.innerWidth * 0.7, 900) : 300;
    const H = W * this.mapBase.height / this.mapBase.width;
    if (cv.width !== Math.round(W)) { cv.width = Math.round(W); cv.height = Math.round(H); }
    const g = cv.getContext('2d');
    g.drawImage(this.mapBase, 0, 0, cv.width, cv.height);
    const k = cv.width / (BBOX.x1 - BBOX.x0);
    const P = (x, z) => { const [sx, sy] = toSat(x, z); return [(sx - BBOX.x0) * k, (sy - BBOX.y0) * k]; };
    // route
    if (opts.mode === 'practice' || opts.showRouteInExam) {
      const pts = ex.path.pts;
      g.lineWidth = Math.max(1.5, k * 1.6);
      g.strokeStyle = 'rgba(80,220,255,0.35)';
      g.beginPath();
      for (let i = 0; i < pts.length; i += 4) { const [a, b] = P(pts[i][0], pts[i][1]); i ? g.lineTo(a, b) : g.moveTo(a, b); }
      g.stroke();
      // remaining part (next 120 m) highlighted
      g.strokeStyle = 'rgba(80,220,255,0.95)';
      g.beginPath();
      const i0 = ex.hint;
      for (let i = i0; i < Math.min(pts.length, i0 + 240); i += 2) { const [a, b] = P(pts[i][0], pts[i][1]); i === i0 ? g.moveTo(a, b) : g.lineTo(a, b); }
      g.stroke();
      const n = ex.nextAction();
      if (n) {
        const q = ex.path.at(n.ev.s).p;
        const [a, b] = P(q[0], q[1]);
        g.fillStyle = '#ffcc00';
        g.beginPath(); g.arc(a, b, 4, 0, 7); g.fill();
      }
    }
    // car
    const [cx, cz] = car.center;
    const [a, b] = P(cx, cz);
    g.save();
    g.translate(a, b);
    g.rotate(car.h);
    g.fillStyle = '#ff4d3d';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    const s = Math.max(5, k * 14);
    g.beginPath(); g.moveTo(s, 0); g.lineTo(-s * 0.6, s * 0.55); g.lineTo(-s * 0.6, -s * 0.55); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }
}

