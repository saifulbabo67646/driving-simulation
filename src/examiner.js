// The examiner (検定員): follows the car along the course, gives the
// instructions, watches mirror / signal / shoulder checks and applies the
// Japanese 減点方式 (demerit) scoring. 100 points, pass mark 70.

import { clamp } from './geo.js';
import { DIM, LOOK } from './car.js';

export const FAIL = 'fail';

export const DEMERITS = {
  signalNone:   { ja: '合図不履行', en: 'No turn signal', pts: 10 },
  signalLate:   { ja: '合図時期不適', en: 'Signal too late (30 m before a turn / 3 s before a lane change)', pts: 5 },
  signalCancel: { ja: '合図戻し忘れ', en: 'Turn signal left on', pts: 5 },
  safety:       { ja: '安全不確認', en: 'Safety check missed', pts: 10 },
  stopFail:     { ja: '指定場所一時不停止', en: 'Did not stop at the stop line', pts: FAIL },
  stopPos:      { ja: '停止位置不適', en: 'Stopped too far before the stop line', pts: 5 },
  redLight:     { ja: '信号無視', en: 'Entered on a red light', pts: FAIL },
  yellowLight:  { ja: '信号無視（黄）', en: 'Entered on amber when you could have stopped', pts: 10 },
  railStop:     { ja: '踏切不停止', en: 'Did not stop before the level crossing', pts: FAIL },
  curb:         { ja: '脱輪', en: 'Wheel off the road / over the kerb', pts: 20 },
  contact:      { ja: '接触', en: 'Touched a pole', pts: 20 },
  speeding:     { ja: '速度超過', en: 'Over 40 km/h', pts: 10 },
  narrowSpeed:  { ja: '速度速すぎ（狭路）', en: 'Too fast in the narrow course (> 15 km/h)', pts: 10 },
  lane:         { ja: '通行区分違反', en: 'Wrong lane / drifted out of the lane', pts: 10 },
  hillNoStop:   { ja: '指示違反（坂道）', en: 'Did not stop on the hill', pts: 20 },
  hillRoll:     { ja: '後退（坂道発進）', en: 'Rolled back on the hill start', pts: 10 },
  hillRollFail: { ja: '後退 1m以上', en: 'Rolled back 1 m or more', pts: FAIL },
  accel:        { ja: '加速不良', en: 'Did not reach 40 km/h on the straight', pts: 5 },
  belt:         { ja: 'シートベルト未装着', en: 'Seatbelt not fastened', pts: 5 },
  pbrake:       { ja: 'サイドブレーキ戻し忘れ', en: 'Moved off with the parking brake on', pts: 5 },
  harshBrake:   { ja: '急ブレーキ', en: 'Harsh braking', pts: 10 },
  pullOver:     { ja: '寄せ不良', en: 'Not close enough to the kerb at the finish (aim < 30 cm)', pts: 5 },
  finishPos:    { ja: '停止位置不良', en: 'Stopped away from the finish mark', pts: 5 },
};

const LOOK_KINDS = ['mirrorL', 'mirrorR', 'mirrorRear', 'lookL', 'lookR', 'sideL', 'sideR'];

export class TrafficLights {
  constructor() {
    this.t = Math.random() * 44;
    this.cycle = 44;
  }
  update(dt) { this.t = (this.t + dt) % this.cycle; }
  /** state for approach 'W'/'E' (east-west traffic) or 'N'/'S' */
  state(approach) {
    const t = this.t;
    const ew = approach === 'W' || approach === 'E';
    const g0 = ew ? 2 : 24, g1 = ew ? 18 : 40, y1 = ew ? 21 : 43;
    if (t >= g0 && t < g1) return 'green';
    if (t >= g1 && t < y1) return 'yellow';
    return 'red';
  }
  /** seconds since the state of this approach last changed */
  since(approach) {
    const t = this.t;
    const ew = approach === 'W' || approach === 'E';
    const marks = ew ? [2, 18, 21] : [24, 40, 43];
    let best = Infinity;
    for (const m of marks) { const d = (t - m + this.cycle) % this.cycle; best = Math.min(best, d); }
    return best;
  }
}

export class Examiner {
  constructor(course, path, car, opts = {}) {
    this.course = course;
    this.path = path;
    this.car = car;
    this.mode = opts.mode || 'practice';
    this.cb = opts;
    this.demerits = [];
    this.failed = null;
    this.finished = false;
    this.looks = [];
    this.lookTimers = {};
    this.blinkerOn = null;
    this.hint = 0;
    this.sC = 0; this.lat = 0; this.dist = 0;
    this.time = 0;
    this.episodes = {};
    this.started = false;
    car.on('blinker', (dir) => {
      this.blinkerOn = dir ? { dir, s: this.sC, t: this.time } : null;
    });
    car.on('contact', () => this.episode('contact', true, 'contact'));
    this.prepare();
  }

  // ---------------------------------------------------------------------------
  prepare() {
    const path = this.path;
    let after = 0;
    let prevEnd = 0;
    this.events = this.course.events.map((e, i) => {
      const ev = { ...e, i, done: false, st: {} };
      const anchor = e.at || e.line || e.from;
      if (anchor) {
        ev.s = path.sOfSat(anchor[0], anchor[1], Math.max(0, after - 5));
        after = ev.s;
      } else ev.s = 0;
      if (e.to) ev.s2 = path.sOfSat(e.to[0], e.to[1], ev.s);
      if (e.type === 'narrow' && ev.s2) prevEnd = Math.max(prevEnd, ev.s2 - 4);
      if (e.type === 'turn' || e.type === 'lanechange' || e.type === 'start') {
        ev.prevEnd = prevEnd;
        if (e.type === 'turn') ev.reqSig = e.sig || clamp(ev.s - prevEnd - 10, 6, 30);
        prevEnd = ev.s + (e.type === 'turn' ? 8 : e.type === 'lanechange' ? 20 : 2);
      }
      return ev;
    });
    // checkpoints for respawn
    this.checkpoints = [0, ...this.events.filter((e) => e.type !== 'say').map((e) => e.s)].sort((a, b) => a - b);
    this.guideDots = [];
    const dot = (ev, kind, s) => { ev.dots = ev.dots || {}; ev.dots[kind] = s; this.guideDots.push({ s, kind }); };
    for (const ev of this.events) {
      if (ev.type === 'turn') {
        const sig = ev.s - ev.reqSig;
        ev.mirrorFrom = Math.max(ev.prevEnd - 2, ev.s - 70);
        dot(ev, 'mirror', Math.max(ev.mirrorFrom + 1.5, sig - 6));
        dot(ev, 'signal', Math.max(sig, ev.dots.mirror + 2));
        dot(ev, 'visual', ev.s - 7);
      } else if (ev.type === 'lanechange') {
        ev.mirrorFrom = ev.s - 70;
        if (ev.note === 'merge') {
          dot(ev, 'mirror', ev.s - 16);
          dot(ev, 'signal', ev.s - 12);
          dot(ev, 'visual', ev.s - 5);
        } else {
          dot(ev, 'mirror', ev.s - 45);
          dot(ev, 'signal', ev.s - 38);
          dot(ev, 'visual', ev.s - 6);
        }
      } else if (ev.type === 'stop') {
        this.guideDots.push({ s: ev.s - 2.5, kind: 'visual', both: true });
      }
    }
  }

  get score() {
    let s = 100;
    for (const d of this.demerits) if (typeof d.pts === 'number') s -= d.pts;
    return s;
  }

  add(key, detail = '') {
    const d = { key, ...DEMERITS[key], detail, s: this.sC, t: this.time };
    this.demerits.push(d);
    if (d.pts === FAIL && !this.failed) {
      this.failed = d;
      this.cb.onFail && this.cb.onFail(d);
    }
    this.cb.onDemerit && this.cb.onDemerit(d);
  }

  /** episode-based demerit: fires once until reset */
  episode(name, active, key, detail) {
    const e = this.episodes[name] || (this.episodes[name] = { on: false, clearT: 0 });
    if (active) {
      e.clearT = 0;
      if (!e.on) { e.on = true; this.add(key, detail); }
    } else if (e.on) {
      e.clearT += this.dt || 0.016;
      if (e.clearT > 1.2) e.on = false;
    }
  }

  say(ja, en) { this.cb.onSay && this.cb.onSay(ja, en); }

  // --- looks -----------------------------------------------------------------
  trackLooks(yaw, pitch, dt) {
    const near = (a, b, tol) => Math.abs(a - b) < tol;
    const cond = {
      mirrorL: near(yaw, LOOK.mirrorL.yaw, 15) && pitch < 2,
      mirrorR: near(yaw, LOOK.mirrorR.yaw, 13) && pitch < 2,
      mirrorRear: near(yaw, LOOK.mirrorRear.yaw, 11) && pitch > 2,
      lookL: yaw > 92,
      lookR: yaw < -95,
      sideL: yaw > 40,
      sideR: yaw < -30,
    };
    for (const k of LOOK_KINDS) {
      if (cond[k]) {
        this.lookTimers[k] = (this.lookTimers[k] || 0) + dt;
        const need = k.startsWith('mirror') ? 0.22 : 0.15;
        if (this.lookTimers[k] >= need && !this.lookTimers[k + '_rec']) {
          this.lookTimers[k + '_rec'] = true;
          this.looks.push({ kind: k, s: this.sC, t: this.time });
          if (this.looks.length > 300) this.looks.shift();
          this.cb.onLook && this.cb.onLook(k);
        }
      } else {
        this.lookTimers[k] = 0;
        this.lookTimers[k + '_rec'] = false;
      }
    }
    // a shoulder check also passes the side glance
    this.current = Object.keys(cond).filter((k) => cond[k]);
  }

  hasLook(kinds, s0, s1, t0 = -Infinity) {
    // a look still being held counts too
    for (const k of kinds) if (this.lookTimers[k + '_rec'] && this.sC >= s0 && this.sC <= s1 + 0.5) return true;
    return this.looks.some((l) => kinds.includes(l.kind) && l.s >= s0 - 0.5 && l.s <= s1 + 0.5 && l.t >= t0);
  }

  // ---------------------------------------------------------------------------
  /** Called every physics step. */
  update(dt, ctx) {
    this.dt = dt;
    this.time += dt;
    const car = this.car;
    const [cx, cz] = car.center;
    const pr = this.path.project(cx, cz, this.hint, 140);
    this.hint = pr.i;
    this.sC = pr.s; this.lat = pr.lat; this.dist = pr.dist;
    // front bumper position along the path (car roughly aligned)
    this.sF = this.sC + (DIM.L + DIM.front - DIM.cOff);
    this.trackLooks(car.headYaw, car.headPitch, dt);
    if (this.finished) return;
    const kmh = car.speedKmh;
    const stopped = Math.abs(car.v) < 0.12;

    // --- continuous checks
    this.inNarrow = false;
    for (const ev of this.events) if (ev.type === 'narrow' && this.sC >= ev.s - 2 && this.sC <= ev.s2 + 2) this.inNarrow = ev;
    if (this.started) {
      this.episode('speed', kmh > 42, 'speeding', `${Math.round(kmh)} km/h`);
      if (this.episodes.speed && this.episodes.speed.on && kmh < 38) this.episodes.speed.clearT = 99;
      this.episode('curb', car.wheelsOff > 0, 'curb', this.inNarrow ? this.inNarrow.name : '');
      if (car.lastAccel < -6.8 && Math.abs(car.v) > 3) this.episode('harsh', true, 'harshBrake');
      else this.episode('harsh', false);
      // lane position (not in narrow sections, turns or lane changes)
      let exempt = !!this.inNarrow || pr.dist > 8;
      for (const ev of this.events) {
        if (ev.type === 'turn' && Math.abs(this.sC - ev.s) < 16) exempt = true;
        if (ev.type === 'lanechange' && this.sC > ev.s - 15 && this.sC < ev.s + 40) exempt = true;
        if (ev.type === 'finish' && this.sC > ev.s - 30) exempt = true;
        if (ev.type === 'start' && this.sC < 40) exempt = true;
      }
      const out = !exempt && (pr.lat > 2.0 || pr.lat < -2.3);
      const st = this.laneT || 0;
      this.laneT = out ? st + dt : 0;
      this.episode('lane', this.laneT > 1.5, 'lane', pr.lat > 0 ? 'drifted right' : 'drifted left');
      // wrong course
      this.offRouteT = pr.dist > 12 ? (this.offRouteT || 0) + dt : 0;
      if (this.offRouteT > 2 && !this.warnedOffRoute) {
        this.warnedOffRoute = true;
        this.cb.onOffRoute && this.cb.onOffRoute();
      }
      if (pr.dist < 6) this.warnedOffRoute = false;
    }

    // --- events
    const front = this.sF;
    for (const ev of this.events) {
      if (ev.done) continue;
      const st = ev.st;
      switch (ev.type) {
        case 'start': {
          if (!st.said) { st.said = true; this.say(ev.ja, ev.en); }
          if (!this.started && (Math.abs(car.v) > 0.3 || this.sC > 0.8)) {
            this.started = true;
            if (!car.seatbelt) this.add('belt');
            if (this.blinkerOn?.dir !== 'right') this.add('signalNone', 'moving off (発進)');
            const mirror = this.hasLook(['mirrorRear', 'mirrorR'], -5, 5);
            const shoulder = this.looks.some((l) => l.kind === 'lookR' && l.t > this.time - 15) || this.lookTimers.lookR_rec;
            if (!mirror || !shoulder) this.add('safety', `moving off: ${!mirror ? 'mirror ' : ''}${!shoulder ? 'right shoulder' : ''}`.trim());
            st.pbT = 0;
          }
          if (this.started) {
            if (car.pbrake && Math.abs(car.v) > 0.2) st.pbT += dt;
            if (st.pbT > 1.0 && !st.pbDone) { st.pbDone = true; this.add('pbrake'); }
            if (this.sC > 15) ev.done = true;
          }
          break;
        }
        case 'say':
          if (this.sC >= ev.s) { ev.done = true; this.say(ev.ja, ev.en); }
          break;
        case 'accel':
          if (this.sC >= ev.s) st.max = Math.max(st.max || 0, kmh);
          if (this.sC >= ev.s2) { ev.done = true; if ((st.max || 0) < 34) this.add('accel', `max ${Math.round(st.max || 0)} km/h`); }
          break;
        case 'narrow':
          if (this.sC >= ev.s && this.sC <= ev.s2 && kmh > 15 && !st.fast) { st.fast = true; this.add('narrowSpeed', ev.name); }
          if (this.sC > ev.s2) ev.done = true;
          break;
        case 'turn': this.evalTurn(ev, st); break;
        case 'lanechange': this.evalLaneChange(ev, st); break;
        case 'stop': {
          if (front >= ev.s - 8) {
            if (stopped && front >= ev.s - 7 && front <= ev.s + 0.8) {
              if (!st.stopped) { st.stopped = true; st.stopT = this.time; }
              st.lastStopFront = front;
            }
            if (st.stopped && !st.lookOk) {
              const recent = (k) => this.lookTimers[k + '_rec'] || this.looks.some((x) => x.kind === k && x.t >= st.stopT - 2);
              st.lookL = st.lookL || recent('sideL');
              st.lookR = st.lookR || recent('sideR');
              if (st.lookL && st.lookR) st.lookOk = true;
            }
            if (front > ev.s + 0.8 && !st.passed) {
              st.passed = true;
              if (!st.stopped) this.add(ev.kind === 'railway' ? 'railStop' : 'stopFail', ev.label);
              else if (st.lastStopFront < ev.s - 3.2) this.add('stopPos', `${(ev.s - st.lastStopFront).toFixed(1)} m before the line`);
            }
            if (front > ev.s + 3) {
              ev.done = true;
              if (st.stopped && !st.lookOk) this.add('safety', `${ev.label}: look left and right after stopping`);
            }
          }
          break;
        }
        case 'light': {
          const pf = st.prevFront ?? front;
          if (pf < ev.s && front >= ev.s) {
            const state = ctx.lights.state(ev.approach);
            if (state === 'red') this.add('redLight');
            else if (state === 'yellow' && ctx.lights.since(ev.approach) > 1.2) this.add('yellowLight');
            ev.done = true;
          }
          st.prevFront = front;
          if (this.sC > ev.s + 10) ev.done = true;
          break;
        }
        case 'hill': {
          if (!st.stopped && stopped && front >= ev.s - 1.2 && front <= ev.s2 + 1.2) {
            st.stopped = true; st.stopS = this.sC; st.minS = this.sC; st.stopT = this.time;
            this.cb.onHill && this.cb.onHill('stopped');
          }
          if (st.stopped) {
            st.minS = Math.min(st.minS, this.sC);
            if (this.sC > st.stopS + 3) {
              ev.done = true;
              const back = st.stopS - st.minS;
              if (back >= 1.0) this.add('hillRollFail', `${back.toFixed(2)} m`);
              else if (back >= 0.3) this.add('hillRoll', `${back.toFixed(2)} m`);
            }
          } else if (front > ev.s2 + 1.5) {
            ev.done = true;
            this.add('hillNoStop');
          }
          break;
        }
        case 'finish': this.evalFinish(ev, st, stopped); break;
      }
    }
  }

  /** true when the next turn / lane change wants the same signal within its signalling distance */
  sameSignalSoon(ev, dir) {
    for (let j = ev.i + 1; j < this.events.length; j++) {
      const n = this.events[j];
      if (n.type !== 'turn' && n.type !== 'lanechange') continue;
      const need = n.type === 'turn' ? n.reqSig + 6 : 45;
      return n.dir === dir && n.s - this.sC < need;
    }
    return false;
  }

  evalTurn(ev, st) {
    const car = this.car;
    const dir = ev.dir;
    const mirrorKinds = [dir === 'left' ? 'mirrorL' : 'mirrorR', 'mirrorRear'];
    if (!st.sig && this.sC >= ev.s - 3) {
      st.sig = true;
      const b = this.blinkerOn;
      if (!b || b.dir !== dir) this.add('signalNone', ev.label);
      else if (b.s > ev.s - ev.reqSig + 4) this.add('signalLate', `${ev.label}: ${Math.max(0, ev.s - b.s).toFixed(0)} m (need ${ev.reqSig.toFixed(0)} m)`);
      st.mirror = this.hasLook(mirrorKinds, ev.mirrorFrom, ev.s);
    }
    if (st.sig && !st.vis && this.sC >= ev.s + 4) {
      st.vis = true;
      const missing = [];
      if (!st.mirror) missing.push('mirror');
      const sh = this.hasLook([dir === 'left' ? 'lookL' : 'lookR'], ev.s - 22, ev.s + 4);
      if (!sh) missing.push(`${dir} shoulder (目視)`);
      if (ev.lookBoth) {
        const l = this.hasLook(['sideL', 'lookL'], ev.s - 28, ev.s + 4);
        const r = this.hasLook(['sideR', 'lookR'], ev.s - 28, ev.s + 4);
        if (!l || !r) missing.push('left/right at the junction');
      }
      if (missing.length) this.add('safety', `${ev.label}: ${missing.join(', ')}`);
    }
    if (st.vis && this.sC >= ev.s + 22) {
      ev.done = true;
      if (car.blinker === dir && !this.sameSignalSoon(ev, dir)) this.add('signalCancel', ev.label);
    }
  }

  evalLaneChange(ev, st) {
    const car = this.car;
    const dir = ev.dir;
    if (!st.sig && this.sC >= ev.s) {
      st.sig = true;
      const b = this.blinkerOn;
      if (!b || b.dir !== dir) this.add('signalNone', ev.label);
      else if (this.time - b.t < (ev.note === 'merge' ? 1 : 2.7)) this.add('signalLate', `${ev.label}: ${(this.time - b.t).toFixed(1)} s (need ${ev.note === 'merge' ? 1 : 3} s)`);
      st.mirror = this.hasLook([dir === 'left' ? 'mirrorL' : 'mirrorR', 'mirrorRear'], ev.s - 70, ev.s);
    }
    if (st.sig && !st.vis && this.sC >= ev.s + 10) {
      st.vis = true;
      const missing = [];
      if (!st.mirror) missing.push('mirror');
      if (!this.hasLook([dir === 'left' ? 'lookL' : 'lookR'], ev.s - 25, ev.s + 10)) missing.push(`${dir} shoulder (目視)`);
      if (missing.length) this.add('safety', `${ev.label}: ${missing.join(', ')}`);
    }
    if (st.vis && !ev.keepSignal && this.sC >= ev.s + 38) {
      ev.done = true;
      if (car.blinker === dir && !this.sameSignalSoon(ev, dir)) this.add('signalCancel', ev.label);
    }
    if (st.vis && ev.keepSignal) ev.done = true;
  }

  evalFinish(ev, st, stopped) {
    const car = this.car;
    if (this.sF < ev.s - 10) return;
    if (!st.over && this.sF > ev.s + 2.5) { st.over = true; this.add('finishPos', 'went past the 発着点 mark'); }
    if (stopped && !st.stoppedAt) {
      st.stoppedAt = this.sF;
      const err = this.sF - ev.s;
      if (!st.over && err < -2.5) this.add('finishPos', `${(-err).toFixed(1)} m short of the mark`);
      const gap = this.kerbGap();
      st.gap = gap;
      if (gap > 0.5) this.add('pullOver', `${(gap * 100).toFixed(0)} cm from the kerb`);
    }
    if (!stopped && st.stoppedAt != null && Math.abs(this.sF - st.stoppedAt) > 1) st.stoppedAt = null;
    if (st.stoppedAt != null && car.gear === 'P' && car.pbrake) {
      ev.done = true;
      this.finished = true;
      this.say(ev.ja, ev.en);
      this.cb.onFinish && this.cb.onFinish({ gap: st.gap });
    }
  }

  /** distance (m) from the car's left side to the kerb */
  kerbGap() {
    const car = this.car;
    let best = 9;
    for (const along of [0.2, DIM.L - 0.2]) {
      for (let d = 0; d < 2.5; d += 0.04) {
        const [x, z] = car.local(along, -(DIM.width / 2 + d));
        if (!car.mask.isRoad(x, z)) { best = Math.min(best, d); break; }
      }
    }
    return best;
  }

  /** Upcoming manoeuvre + what has been done so far (for the practice HUD). */
  nextAction() {
    for (const ev of this.events) {
      if (ev.done) continue;
      if (!['turn', 'lanechange', 'stop', 'start', 'hill', 'finish'].includes(ev.type)) continue;
      if (ev.type === 'start' && this.started) continue;
      if ((ev.type === 'turn' || ev.type === 'lanechange') && ev.st.vis) continue;
      const car = this.car;
      const dist = ev.s - (ev.type === 'stop' || ev.type === 'hill' || ev.type === 'finish' ? this.sF : this.sC);
      const r = { ev, dist };
      if (ev.type === 'turn' || ev.type === 'lanechange') {
        const side = ev.dir === 'left' ? 'L' : 'R';
        const s0 = ev.mirrorFrom;
        r.mirror = this.hasLook(['mirror' + side, 'mirrorRear'], s0, ev.s + 40);
        r.signal = car.blinker === ev.dir;
        r.visual = this.hasLook(['look' + side], ev.s - 25, ev.s + 40);
        r.label = `${ev.label || ''} ${ev.type === 'turn' ? (ev.dir === 'left' ? '左折 Left turn' : '右折 Right turn') : (ev.dir === 'left' ? '左へ進路変更 Move left' : '右へ進路変更 Move right')}`;
        r.both = ev.lookBoth;
      } else if (ev.type === 'start') {
        r.mirror = this.hasLook(['mirrorRear', 'mirrorR'], -5, 5);
        r.signal = car.blinker === 'right';
        r.visual = this.looks.some((l) => l.kind === 'lookR' && l.t > this.time - 15);
        r.label = '発進 Move off';
        r.belt = car.seatbelt; r.gear = car.gear; r.pbrake = car.pbrake;
      } else if (ev.type === 'stop') {
        r.label = ev.kind === 'railway' ? '踏切 一時停止 Level crossing stop' : '一時停止 Stop line';
        r.stopped = !!ev.st.stopped; r.lookL = !!ev.st.lookL; r.lookR = !!ev.st.lookR;
      } else if (ev.type === 'hill') {
        r.label = '坂道発進 Hill start';
        r.stopped = !!ev.st.stopped;
      } else if (ev.type === 'finish') {
        r.label = '発着点 Finish: stop, P + parking brake';
      }
      return r;
    }
    return null;
  }

  /** Reset events after arc length s (practice respawn). */
  rewind(s) {
    for (const ev of this.events) {
      if (ev.s >= s - 1 || (ev.s2 && ev.s2 >= s)) { ev.done = false; ev.st = {}; }
    }
    this.hint = Math.max(0, this.path.at(s).i);
    this.laneT = 0;
    this.offRouteT = 0;
    for (const k in this.episodes) this.episodes[k].on = false;
  }

  checkpointBefore(s) {
    let best = 0;
    for (const c of this.checkpoints) if (c < s - 12) best = c;
    return best;
  }
}

