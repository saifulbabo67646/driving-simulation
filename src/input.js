// Keyboard / mouse / gamepad (incl. steering wheels) input.

import { clamp } from './geo.js';

export class Input {
  constructor(canvas, settings) {
    this.settings = settings;
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.mouseLook = { active: false, yaw: 0, pitch: 0 };
    this.mouseSteer = 0;
    this.mouseBtn = 0;
    this.gamepad = null;
    this.gpPrev = [];

    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'Backspace'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      this.mouseBtn |= 1 << e.button;
      if (e.button === 2 || (e.button === 0 && this.settings.steering !== 'mouse')) {
        this.mouseLook.active = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseBtn &= ~(1 << e.button);
      if (!(this.mouseBtn & 4) && !(this.mouseBtn & 1 && this.settings.steering !== 'mouse')) this.mouseLook.active = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.settings.steering === 'mouse') {
        const w = window.innerWidth;
        this.mouseSteer = clamp(((e.clientX - w / 2) / (w * 0.42)), -1, 1);
      }
      if (this.mouseLook.active) {
        this.mouseLook.yaw = clamp(this.mouseLook.yaw - e.movementX * 0.25, -140, 140);
        this.mouseLook.pitch = clamp(this.mouseLook.pitch - e.movementY * 0.2, -40, 30);
      }
    });
    window.addEventListener('gamepadconnected', (e) => { this.gamepad = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepad = null; });
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  /** Read the current driving controls. */
  poll(dt) {
    const s = this.settings;
    const out = { throttle: 0, brake: 0, steerDir: 0, steerAbs: null, steerRate: s.steerRate, look: null, gp: {} };
    // keyboard
    const up = this.down('ArrowUp', 'KeyW');
    const dn = this.down('ArrowDown', 'KeyS', 'Space');
    // progressive pedals for smoother control
    this.thr = up ? Math.min(1, (this.thr || 0) + dt * (this.down('ShiftLeft', 'ShiftRight') ? 4 : 1.6)) : Math.max(0, (this.thr || 0) - dt * 5);
    this.brk = dn ? Math.min(1, (this.brk || 0) + dt * (this.down('ShiftLeft', 'ShiftRight') ? 6 : 2.2)) : Math.max(0, (this.brk || 0) - dt * 6);
    out.throttle = this.thr * s.throttleMax;
    out.brake = this.brk;
    if (this.down('ArrowLeft', 'KeyA')) out.steerDir -= 1;
    if (this.down('ArrowRight', 'KeyD')) out.steerDir += 1;
    if (s.steering === 'mouse') {
      out.steerAbs = this.mouseSteer;
      if (this.mouseBtn & 1) out.throttle = Math.max(out.throttle, 0.6);
      if (this.mouseBtn & 4) out.brake = Math.max(out.brake, 0.8);
    }

    // gamepad / wheel
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = this.gamepad != null ? pads[this.gamepad] : [...pads].find((p) => p);
    if (gp) {
      const ax = gp.axes;
      const isWheel = /wheel|g29|g920|g923|driving|t300|t150|fanatec|momo|dfgt|g27|g25/i.test(gp.id);
      const dz = (v, d = 0.06) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
      let steer = 0, thr = 0, brk = 0;
      if (isWheel) {
        steer = ax[0] || 0;
        // pedals usually rest at +1 and go to -1 when pressed
        const ped = (v) => (v == null ? 0 : clamp((1 - v) / 2, 0, 1));
        thr = ped(ax[s.wheelThrottleAxis ?? 2]);
        brk = ped(ax[s.wheelBrakeAxis ?? 3]);
        if (thr < 0.02 && brk < 0.02 && ax.length > 5) { thr = ped(ax[5]); brk = ped(ax[1]); }
      } else {
        steer = dz(ax[0] || 0);
        thr = gp.buttons[7] ? gp.buttons[7].value : 0;
        brk = gp.buttons[6] ? gp.buttons[6].value : 0;
      }
      if (Math.abs(steer) > 0.02 || this.gpSteerUsed) {
        this.gpSteerUsed = true;
        out.steerAbs = isWheel ? steer : Math.sign(steer) * Math.pow(Math.abs(steer), 1.6);
      }
      out.throttle = Math.max(out.throttle, thr * s.throttleMax);
      out.brake = Math.max(out.brake, brk);
      const b = gp.buttons.map((x) => x.pressed);
      const edge = (i) => b[i] && !this.gpPrev[i];
      out.gp = {
        blinkL: edge(4), blinkR: edge(5), lookL: b[2], lookR: b[1], lookRear: b[3],
        pbrake: edge(0), gear: edge(9), reverse: edge(8),
      };
      this.gpPrev = b;
    }
    return out;
  }

  endFrame() { this.pressed.clear(); }
}
