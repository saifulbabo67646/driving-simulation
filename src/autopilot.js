// Development helper: drives the route automatically (pure pursuit) and,
// optionally, performs the mirror / signal / shoulder routine like a model
// student. Enable from the console:  __sim.autopilot(true)
import { clamp, wrapAngle } from './geo.js';
import { DIM, LOOK } from './car.js';

export class Autopilot {
  constructor(car, path, examiner) {
    this.car = car; this.path = path; this.ex = examiner;
    this.on = false;
    this.routine = true;
    this.stopTimer = 0;
  }

  /** returns { ctl, head } overriding the user input */
  control(dt) {
    const car = this.car, ex = this.ex, path = this.path;
    const ctl = { throttle: 0, brake: 0, steerDir: 0, steerAbs: 0, steerRate: 300, gp: {} };
    let head = { yaw: 0, pitch: 0 };
    const sC = ex.sC;
    // --- steering: curvature feed-forward + heading / lateral feedback (rear axle)
    const v = Math.abs(car.v);
    const pr = path.project(car.rx, car.rz, Math.max(0, ex.hint - 20), 160);
    const sR = pr.s;
    const preview = 0.25 + v * 0.12;
    const a0 = path.at(sR + preview - 0.4), a1 = path.at(sR + preview + 0.4);
    const kappa = (a0.d[0] * a1.d[1] - a0.d[1] * a1.d[0]) / 0.8;
    const hp = Math.atan2(a1.d[1] + a0.d[1], a1.d[0] + a0.d[0]);
    const eh = wrapAngle(hp - car.h);
    const delta = Math.atan(DIM.L * kappa) + 1.2 * eh - 0.45 * clamp(pr.lat, -2, 2);
    ctl.steerAbs = clamp((delta * 180 / Math.PI) * DIM.steerRatio / DIM.swMax, -1, 1);

    // --- target speed from curvature ahead
    let vT = 38 / 3.6;
    for (let d = 0; d < 40; d += 2) {
      const a = path.at(sC + d), b = path.at(sC + d + 3);
      const cross = a.d[0] * b.d[1] - a.d[1] * b.d[0];
      const curv = Math.abs(cross) / 3;
      if (curv > 1e-3) vT = Math.min(vT, Math.sqrt(2.0 / curv) + d * 0.35);
    }
    if (ex.inNarrow) vT = Math.min(vT, 8 / 3.6);

    // --- events: stops / hill / finish / lights
    const front = ex.sF;
    for (const e of ex.events) {
      if (e.done) continue;
      if (((e.type === 'stop' || e.type === 'hill') && !e.st.apGo) || e.type === 'finish') {
        const target = e.type === 'hill' ? (e.s + e.s2) / 2 : e.type === 'stop' ? e.s - 0.7 : e.s;
        const dist = target - front;
        if (dist < 40 && dist > -1) vT = Math.min(vT, Math.sqrt(Math.max(0, dist) * 2 * 1.6));
        if (dist < 0.6 && dist > -1.5) vT = 0;
        break;
      }
      if (e.type === 'light' && !e.done) {
        const st = ex.cb.lights ? null : null;
        void st;
      }
    }
    // red lights
    const lights = this.lights;
    if (lights) {
      for (const e of ex.events) {
        if (e.done || e.type !== 'light') continue;
        const dist = e.s - front;
        const stt = lights.state(e.approach);
        if (dist > -0.5 && dist < 45 && stt !== 'green') {
          const need = (v * v) / (2 * 4);
          if (stt === 'red' || dist > need + 1) {
            this.holdLight = true;
            vT = Math.min(vT, Math.sqrt(Math.max(0, dist - 1) * 2 * 1.4));
          }
        }
        break;
      }
    }

    // --- routine: signals and checks
    if (this.routine) {
      for (const e of ex.events) if (e.type === 'lanechange' && e.st.vis && !e.done && !e.keepSignal && car.blinker === e.dir && sC > e.s + 25) car.setBlinker(null);
      for (const e of ex.events) {
        if (e.done || e.st.vis) continue;
        if (e.type === 'turn' || e.type === 'lanechange') {
          const side = e.dir === 'left' ? 'L' : 'R';
          const D = e.dots;
          if (sC > D.mirror - 0.5 && sC < D.mirror + 3) head = side === 'L' ? LOOK.mirrorL : LOOK.mirrorR;
          if (sC > D.signal && car.blinker !== e.dir && !e.st.sig) car.setBlinker(e.dir);
          if (sC > D.visual - 1 && sC < D.visual + 3) head = side === 'L' ? LOOK.shoulderL : LOOK.shoulderR;
          if (e.lookBoth && sC > e.s - 16 && sC < e.s - 12) head = { yaw: side === 'L' ? -50 : 60, pitch: 0 };
          break;
        }
      }
    }
    // after stopping: wait a moment (and look both ways) before going
    if (Math.abs(car.v) < 0.05 && vT < 0.1) this.stopTimer += dt; else if (vT > 0.3) this.stopTimer = 0;
    if (this.stopTimer > 0 && this.stopTimer < 2.4) {
      head = this.stopTimer < 1.1 ? { yaw: 60, pitch: 0 } : { yaw: -50, pitch: 0 };
    }
    if (this.stopTimer > 2.4) {
      // release the stop for stop / hill events
      for (const e of ex.events) {
        if (e.done) continue;
        if ((e.type === 'stop' || e.type === 'hill') && e.st.stopped && !e.st.apGo) { e.st.apGo = true; this.stopTimer = 0; }
        if (e.type === 'stop' || e.type === 'hill' || e.type === 'finish') break;
      }
    }

    const fin = ex.events.find((e) => e.type === 'finish');
    if (fin && !fin.done && Math.abs(car.v) < 0.05 && Math.abs(fin.s - front) < 2) {
      car.pbrake = true; car.gear = 'P';
      if (car.blinker) car.setBlinker(null);
    }
    const err = vT - v;
    if (err > 0) ctl.throttle = clamp(err * 0.6, 0, 1);
    else ctl.brake = clamp(-err * 0.35, 0, 1);
    if (vT === 0) ctl.brake = Math.max(ctl.brake, 0.6);
    ctl.brake = Math.min(ctl.brake, 0.55);

    return { ctl, head };
  }
}
