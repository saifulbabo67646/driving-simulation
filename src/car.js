// Vehicle: kinematic bicycle model with automatic-transmission longitudinal
// dynamics, plus a right-hand-drive interior (Japanese test car) with working
// rear-view and door mirrors.

import * as THREE from 'three';
import { clamp, wrapAngle } from './geo.js';

export const DIM = {
  L: 2.55,          // wheelbase
  front: 0.92,      // front overhang
  rear: 0.93,       // rear overhang
  width: 1.70,
  track: 1.47,
  wheelR: 0.3,
  steerRatio: 15.5,
  swMax: 540,       // steering wheel lock (deg)
};
DIM.length = DIM.L + DIM.front + DIM.rear;
DIM.cOff = (DIM.L + DIM.front - DIM.rear) / 2; // rear axle -> body centre

const DEG = Math.PI / 180;
export const LAYER_INTERIOR = 1;

// head look targets (deg): + = left
export const LOOK = {
  mirrorL: { yaw: 56, pitch: -9 },
  mirrorR: { yaw: -37, pitch: -9 },
  mirrorRear: { yaw: 26, pitch: 9 },
  shoulderL: { yaw: 118, pitch: -4 },
  shoulderR: { yaw: -125, pitch: -4 },
};

export class Car {
  constructor(scene, renderer, { heightAt, mask }) {
    this.scene = scene;
    this.renderer = renderer;
    this.heightAt = heightAt;
    this.mask = mask;
    this.poles = [];
    // state
    this.rx = 0; this.rz = 0; this.h = 0; this.v = 0;
    this.sw = 0;                 // steering wheel angle (deg), + = right
    this.gear = 'P';
    this.pbrake = true;
    this.seatbelt = false;
    this.blinker = null;         // 'left' | 'right' | null
    this.blinkerArmed = false;
    this.blinkT = 0;
    this.wheelRot = 0;
    this.wheelsOff = 0;
    this.offWheels = [false, false, false, false];
    this.lastAccel = 0;
    this.y = 0; this.pitch = 0; this.roll = 0;
    this.headYaw = 0; this.headPitch = 0;
    this.listeners = {};
    this.buildModel();
    this.buildMirrors();
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

  // --- positions -----------------------------------------------------------
  get fwd() { return [Math.cos(this.h), Math.sin(this.h)]; }
  /** point at `along` metres in front of the rear axle and `lat` metres to the right */
  local(along, lat) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    return [this.rx + c * along - s * lat, this.rz + s * along + c * lat];
  }
  get center() { return this.local(DIM.cOff, 0); }
  get frontBumper() { return this.local(DIM.L + DIM.front, 0); }
  get speedKmh() { return Math.abs(this.v) * 3.6; }

  /** Place the car with its body centre at (x, z) facing heading h. */
  place(x, z, h) {
    this.h = h;
    this.rx = x - Math.cos(h) * DIM.cOff;
    this.rz = z - Math.sin(h) * DIM.cOff;
    this.v = 0; this.sw = 0;
    this.updateTransform(0);
  }

  // --- physics ---------------------------------------------------------------
  step(dt, inp) {
    // steering wheel
    if (inp.steerAbs != null) {
      const target = clamp(inp.steerAbs, -1, 1) * DIM.swMax;
      this.sw += clamp(target - this.sw, -1100 * dt, 1100 * dt);
    } else if (inp.steerDir) {
      // turning back towards the centre is quicker (hand-over-hand)
      const rate = inp.steerRate * (Math.sign(inp.steerDir) !== Math.sign(this.sw) && this.sw !== 0 ? 1.35 : 1);
      this.sw += inp.steerDir * rate * dt;
    } else {
      const ret = 330 * clamp(Math.abs(this.v) / 4, 0, 1) * dt;
      this.sw -= Math.sign(this.sw) * Math.min(Math.abs(this.sw), ret);
    }
    this.sw = clamp(this.sw, -DIM.swMax, DIM.swMax);
    const delta = (this.sw / DIM.steerRatio) * DEG;

    // blinker auto-cancel (like a real column switch)
    if (this.blinker) {
      const dirSign = this.blinker === 'right' ? 1 : -1;
      if (this.sw * dirSign > 100) this.blinkerArmed = true;
      if (this.blinkerArmed && this.sw * dirSign < 25) { this.setBlinker(null, true); }
    }
    this.blinkT += dt;

    // terrain
    const [fx, fz] = this.local(DIM.L, 0);
    const hF = this.heightAt(fx, fz), hR = this.heightAt(this.rx, this.rz);
    const slope = Math.atan2(hF - hR, DIM.L);

    // longitudinal forces
    const g = 9.81;
    let a = 0;
    const v0 = this.v;
    if (this.gear === 'D' || this.gear === 'R') {
      const dir = this.gear === 'R' ? -1 : 1;
      const vf = this.v * dir;
      const creep = 1.0 * clamp(1 - vf / 2.0, 0, 1.6);
      const top = this.gear === 'R' ? 4.5 : 26;
      const drive = inp.throttle * 3.4 * clamp(1 - vf / top, 0, 1) * (vf < 3 ? 0.75 + vf / 12 : 1);
      a += dir * (drive + creep);
    }
    a -= g * Math.sin(slope);
    a -= Math.sign(this.v) * (0.13 + 0.00042 * this.v * this.v);
    if (this.wheelsOff) a -= Math.sign(this.v) * 1.6;
    let brakeDec = inp.brake * 8.5;
    if (this.pbrake) brakeDec += 5.5;
    if (this.gear === 'P') { this.v = 0; }
    else if (Math.abs(this.v) < 0.06 && Math.abs(a) <= brakeDec + 0.12) {
      this.v = 0;
    } else {
      this.v += a * dt;
      const dv = brakeDec * dt;
      if (this.v > 0) this.v = Math.max(0, this.v - dv);
      else if (this.v < 0) this.v = Math.min(0, this.v + dv);
    }
    this.lastAccel = (this.v - v0) / dt;

    // kinematic bicycle (reference: rear axle centre)
    const prev = { rx: this.rx, rz: this.rz, h: this.h };
    this.h = wrapAngle(this.h + (this.v / DIM.L) * Math.tan(delta) * dt);
    this.rx += this.v * Math.cos(this.h) * dt;
    this.rz += this.v * Math.sin(this.h) * dt;

    // pole contact (S字 / クランク poles)
    const hit = this.hitPole();
    if (hit) {
      Object.assign(this, prev);
      if (Math.abs(this.v) > 0.05) this.emit('contact', hit);
      this.v = 0;
    }

    // wheels on/off the road surface
    const wheels = this.wheelPoints();
    let off = 0;
    for (let i = 0; i < 4; i++) {
      const o = !this.mask.isRoad(wheels[i][0], wheels[i][1]);
      this.offWheels[i] = o;
      if (o) off++;
    }
    this.wheelsOff = off;
    this.wheelRot += (this.v * dt) / DIM.wheelR;
    this.updateTransform(dt, wheels);
  }

  wheelPoints() {
    const t = DIM.track / 2;
    return [this.local(DIM.L, -t), this.local(DIM.L, t), this.local(0, -t), this.local(0, t)]; // FL FR RL RR
  }

  /** Body rectangle corners (for drawing / collision). */
  corners(margin = 0) {
    const f = DIM.L + DIM.front + margin, r = -DIM.rear - margin, w = DIM.width / 2 + margin;
    return [this.local(f, -w), this.local(f, w), this.local(r, w), this.local(r, -w)];
  }

  hitPole(extra = 0) {
    if (!this.poles.length) return null;
    const c = Math.cos(this.h), s = Math.sin(this.h);
    for (const p of this.poles) {
      const dx = p.x - this.rx, dz = p.z - this.rz;
      if (dx * dx + dz * dz > 25) continue;
      const along = dx * c + dz * s;
      const lat = -dx * s + dz * c;
      const cx = clamp(along, -DIM.rear, DIM.L + DIM.front);
      const cz = clamp(lat, -DIM.width / 2, DIM.width / 2);
      if ((along - cx) ** 2 + (lat - cz) ** 2 < (p.r + extra) ** 2) return p;
    }
    return null;
  }

  setBlinker(dir, auto = false) {
    if (dir === this.blinker) dir = null;
    this.blinker = dir;
    this.blinkerArmed = false;
    this.blinkT = 0;
    this.emit('blinker', dir, auto);
  }
  get blinkOn() { return this.blinker && (this.blinkT % 0.8) < 0.45; }

  updateTransform(dt, wheels = this.wheelPoints()) {
    const hs = wheels.map(([x, z], i) => this.heightAt(x, z) + (this.offWheels[i] ? 0.15 : 0));
    const front = (hs[0] + hs[1]) / 2, rear = (hs[2] + hs[3]) / 2;
    const left = (hs[0] + hs[2]) / 2, right = (hs[1] + hs[3]) / 2;
    this.pitch = Math.atan2(front - rear, DIM.L);
    this.roll = Math.atan2(left - right, DIM.track);
    const [cx, cz] = this.center;
    this.y = (front + rear) / 2;
    const g = this.group;
    g.position.set(cx, this.y, cz);
    g.rotation.set(-this.pitch, Math.PI / 2 - this.h, this.roll, 'YXZ');
    // wheels
    const delta = (this.sw / DIM.steerRatio) * DEG;
    this.wheels.forEach((w, i) => {
      w.spin.rotation.x = this.wheelRot;
      if (i < 2) w.pivot.rotation.y = -delta;
    });
    this.wheelSpin.rotation.z = this.sw * DEG;
  }

  // --- model -----------------------------------------------------------------
  buildModel() {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    this.group = g;
    this.scene.add(g);
    const zc = -DIM.cOff; // rear axle relative to body centre

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f5f2, roughness: 0.35, metalness: 0.15 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.6 });
    const glassDark = new THREE.MeshStandardMaterial({ color: 0x202a33, roughness: 0.1, metalness: 0.3 });
    const dash = new THREE.MeshStandardMaterial({ color: 0x45484e, roughness: 0.85, emissive: 0x141518 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x6a6d73, roughness: 0.8, emissive: 0x1a1b1e });
    const liner = new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.95, emissive: 0x7d786e });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.95, emissive: 0x121316 });

    const box = (w, h, d, x, y, z, mat, layer = 0, parent = g) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      if (layer) m.layers.set(layer);
      m.castShadow = layer === 0;
      parent.add(m);
      return m;
    };
    const frontZ = DIM.L + DIM.front + zc, rearZ = -DIM.rear + zc;

    // --- exterior (visible in mirrors / chase view; back faces hidden from inside)
    box(1.68, 0.38, 1.3, 0, 0.74, frontZ - 0.7, white);             // hood block
    box(1.70, 0.42, 0.3, 0, 0.47, frontZ - 0.15, white);            // front bumper
    box(1.68, 0.42, 0.78, 0, 0.78, rearZ + 0.42, white);            // boot
    box(1.70, 0.42, 0.3, 0, 0.47, rearZ + 0.15, white);             // rear bumper
    for (const sx of [1, -1]) {
      box(0.05, 0.6, 3.0, sx * 0.83, 0.64, -0.25, white);            // doors
      box(0.06, 0.06, 2.7, sx * 0.8, 1.44, -0.45, white);            // roof rails
    }
    box(1.4, 0.05, 1.75, 0, 1.47, -0.45, white);                     // roof
    box(1.6, 0.08, 4.0, 0, 0.33, 0, black);                          // floor / underbody
    // headlights / tail lights
    for (const sx of [1, -1]) {
      box(0.32, 0.12, 0.04, sx * 0.62, 0.72, frontZ + 0.01, new THREE.MeshStandardMaterial({ color: 0xe8f0ff, emissive: 0x222222 }));
      box(0.3, 0.12, 0.04, sx * 0.64, 0.78, rearZ - 0.01, new THREE.MeshStandardMaterial({ color: 0xb01616, emissive: 0x200000 }));
    }
    // rear window & windscreen (exterior only, tinted)
    const rw = box(1.32, 0.42, 0.04, 0, 1.23, -1.42, glassDark);
    rw.rotation.x = -0.55;
    // test-car roof sign (検定中)
    const signTex = canvasText('検定車', 256, 96, '#1f4fa3', '#fff', 'bold 60px sans-serif');
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.1),
      [white, white, white, white, new THREE.MeshBasicMaterial({ map: signTex }), new THREE.MeshBasicMaterial({ map: signTex })]);
    sign.position.set(0, 1.6, -0.2);
    g.add(sign);

    // wheels
    this.wheels = [];
    const tyre = new THREE.CylinderGeometry(DIM.wheelR, DIM.wheelR, 0.2, 18);
    tyre.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.18, 0.18, 0.21, 10);
    rim.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xa8acb0, metalness: 0.6, roughness: 0.4 });
    [[DIM.L, 1], [DIM.L, -1], [0, 1], [0, -1]].forEach(([along, side]) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * DIM.track / 2, DIM.wheelR, along + zc);
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tyre, black));
      spin.add(new THREE.Mesh(rim, rimMat));
      spin.children.forEach((c) => { c.castShadow = true; });
      pivot.add(spin);
      g.add(pivot);
      this.wheels.push({ pivot, spin });
    });

    // --- pillars (seen from both sides)
    const pillar = (a, b, w = 0.07, d = 0.1, mat = trim) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const len = va.distanceTo(vb);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
      m.position.copy(va).add(vb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      m.castShadow = true;
      g.add(m);
      return m;
    };
    for (const sx of [1, -1]) {
      pillar([sx * 0.76, 0.96, 0.98], [sx * 0.68, 1.46, 0.36], 0.06, 0.08);   // A
      pillar([sx * 0.79, 0.95, -0.5], [sx * 0.72, 1.46, -0.5], 0.06, 0.13);   // B
      pillar([sx * 0.78, 0.95, -1.35], [sx * 0.7, 1.46, -1.15], 0.07, 0.3);   // C
    }
    pillar([0.7, 1.45, 0.38], [-0.7, 1.45, 0.38], 0.08, 0.08);                 // header
    // window line / sills (interior)
    for (const sx of [1, -1]) {
      box(0.1, 0.05, 2.5, sx * 0.76, 0.96, -0.3, trim, LAYER_INTERIOR);
      box(0.04, 0.55, 2.6, sx * 0.79, 0.68, -0.3, dash, LAYER_INTERIOR);       // door panel
      box(0.08, 0.04, 0.4, sx * 0.74, 0.86, 0.15, trim, LAYER_INTERIOR);       // arm rest/handle
    }
    // roof liner + sun visors
    box(1.42, 0.02, 1.75, 0, 1.44, -0.48, liner, LAYER_INTERIOR);
    // folded sun visors
    box(0.46, 0.025, 0.16, -0.36, 1.425, 0.3, liner, LAYER_INTERIOR);
    box(0.46, 0.025, 0.16, 0.36, 1.425, 0.3, liner, LAYER_INTERIOR);

    // dashboard
    box(1.52, 0.2, 0.55, 0, 0.87, 0.75, dash, LAYER_INTERIOR);
    const top = box(1.52, 0.04, 0.42, 0, 0.99, 0.82, dash, LAYER_INTERIOR);
    top.rotation.x = 0.12;
    box(1.4, 0.3, 0.12, 0, 0.66, 0.52, trim, LAYER_INTERIOR);              // lower dash
    box(0.22, 0.25, 0.6, 0.0, 0.55, 0.15, trim, LAYER_INTERIOR);           // centre console
    box(0.32, 0.2, 0.05, 0.02, 0.86, 0.48, black, LAYER_INTERIOR);         // centre panel / audio
    // vents
    for (const vx of [-0.62, -0.1, 0.12, 0.62]) box(0.14, 0.05, 0.02, vx, 0.93, 0.475, black, LAYER_INTERIOR);
    // instrument cluster (driver on the right => local -x)
    const hood = box(0.46, 0.06, 0.2, -0.36, 1.0, 0.5, dash, LAYER_INTERIOR);
    hood.rotation.x = -0.12;
    this.clusterCanvas = document.createElement('canvas');
    this.clusterCanvas.width = 512; this.clusterCanvas.height = 192;
    this.clusterTex = new THREE.CanvasTexture(this.clusterCanvas);
    this.clusterTex.colorSpace = THREE.SRGBColorSpace;
    const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15), new THREE.MeshBasicMaterial({ map: this.clusterTex }));
    cluster.position.set(-0.36, 0.905, 0.466);
    cluster.rotation.set(-0.35, Math.PI, 0, 'YXZ');
    cluster.layers.set(LAYER_INTERIOR);
    g.add(cluster);

    // steering wheel
    const column = new THREE.Group();
    column.position.set(-0.36, 0.9, 0.36);
    column.rotation.x = 0.42;
    g.add(column);
    const colMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 10), black);
    colMesh.rotation.x = Math.PI / 2;
    colMesh.position.z = 0.15;
    colMesh.layers.set(LAYER_INTERIOR);
    column.add(colMesh);
    this.wheelSpin = new THREE.Group();
    column.add(this.wheelSpin);
    const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.02, 10, 40), new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.6, emissive: 0x0c0c0e }));
    rimMesh.layers.set(LAYER_INTERIOR);
    this.wheelSpin.add(rimMesh);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 16), dash);
    hub.rotation.x = Math.PI / 2;
    hub.layers.set(LAYER_INTERIOR);
    this.wheelSpin.add(hub);
    [[0, -1], [0.95, 0.3], [-0.95, 0.3]].forEach(([dx, dy]) => {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.015), trim);
      sp.position.set(dx * 0.1, dy * 0.1, 0);
      sp.rotation.z = Math.atan2(dx, -dy);
      sp.layers.set(LAYER_INTERIOR);
      this.wheelSpin.add(sp);
    });
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.025), new THREE.MeshBasicMaterial({ color: 0xc9a227 }));
    marker.position.set(0, 0.185, 0);
    marker.layers.set(LAYER_INTERIOR);
    this.wheelSpin.add(marker);
    // blinker stalk (right side of the column on Japanese cars)
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.16, 6), black);
    stalk.rotation.z = Math.PI / 2;
    stalk.position.set(-0.11, 0.0, 0.12);
    stalk.layers.set(LAYER_INTERIOR);
    column.add(stalk);

    // gear selector
    this.gearKnob = box(0.05, 0.08, 0.05, -0.02, 0.76, 0.22, black, LAYER_INTERIOR);

    // seats and the examiner in the passenger (left) seat
    for (const sx of [0.38, -0.38]) {
      box(0.5, 0.12, 0.5, sx, 0.52, -0.5, seatMat, LAYER_INTERIOR);
      const back = box(0.5, 0.65, 0.1, sx, 0.88, -0.78, seatMat, LAYER_INTERIOR);
      back.rotation.x = -0.15;
      box(0.26, 0.2, 0.08, sx, 1.27, -0.86, seatMat, LAYER_INTERIOR);
    }
    box(1.4, 0.55, 0.12, 0, 0.82, -1.5, seatMat, LAYER_INTERIOR); // rear bench
    const suit = new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9b597, roughness: 0.9 });
    box(0.42, 0.5, 0.25, 0.38, 0.88, -0.62, suit, LAYER_INTERIOR);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
    head.position.set(0.38, 1.24, -0.6);
    head.layers.set(LAYER_INTERIOR);
    g.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, 1.4), black);
    hair.position.set(0.38, 1.26, -0.62);
    hair.layers.set(LAYER_INTERIOR);
    g.add(hair);
    const clip = box(0.22, 0.03, 0.3, 0.33, 0.78, -0.35, new THREE.MeshStandardMaterial({ color: 0x8b6a3f }), LAYER_INTERIOR);
    clip.rotation.x = 0.4;
    // passenger-side assist brake pedal block (教習車)
    box(0.15, 0.06, 0.25, 0.4, 0.35, 0.55, black, LAYER_INTERIOR);

    // --- driver camera
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.05, 4000);
    this.camera.layers.enable(LAYER_INTERIOR);
    this.eye = new THREE.Vector3(-0.36, 1.2, -0.3);
    this.camera.position.copy(this.eye);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(0, Math.PI, 0);
    g.add(this.camera);
    this.zc = zc;
  }

  buildMirrors() {
    const g = this.group;
    const frame = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.6 });
    const mk = (w, h, fov, pos, rot, meshPos, meshSize, aim) => {
      const rt = new THREE.WebGLRenderTarget(w, h, { samples: 2 });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      const cam = new THREE.PerspectiveCamera(fov, w / h, 0.3, 900);
      cam.position.set(...pos);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(rot[0], rot[1], 0);
      g.add(cam);
      const geo = new THREE.PlaneGeometry(meshSize[0], meshSize[1]);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); // mirror image
      const mat = new THREE.MeshBasicMaterial({ map: rt.texture });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...meshPos);
      mesh.layers.set(LAYER_INTERIOR);
      g.add(mesh);
      const eyeL = this.eye.clone();
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...meshPos), eyeL, new THREE.Vector3(0, 1, 0));
      mesh.quaternion.setFromRotationMatrix(m);
      mesh.rotateY(Math.PI);
      if (aim) mesh.rotateY(aim);
      const back = new THREE.Mesh(new THREE.BoxGeometry(meshSize[0] + 0.03, meshSize[1] + 0.03, 0.04), frame);
      back.position.set(0, 0, -0.025);
      back.layers.set(LAYER_INTERIOR);
      mesh.add(back);
      return { rt, cam, mesh };
    };
    this.mirrors = {
      rear: mk(512, 160, 15, [0, 1.32, -1.75], [-0.03, 0], [0.02, 1.33, 0.5], [0.27, 0.075]),
      left: mk(256, 200, 26, [0.98, 1.0, 0.62], [-0.06, -0.24], [0.97, 1.0, 0.64], [0.17, 0.13], 0.12),
      right: mk(256, 200, 26, [-0.98, 1.0, 0.62], [-0.06, 0.24], [-0.97, 1.0, 0.64], [0.17, 0.13], -0.12),
    };
    // door mirror housings (white, outside the door)
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f3f0, roughness: 0.4 });
    for (const sx of [1, -1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.1), white);
      h.position.set(sx * 0.97, 1.0, 0.7);
      h.layers.set(LAYER_INTERIOR);
      g.add(h);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.06), white);
      arm.position.set(sx * 0.86, 0.98, 0.72);
      arm.layers.set(LAYER_INTERIOR);
      g.add(arm);
    }
  }

  renderMirrors(scene) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    for (const k of ['rear', 'left', 'right']) {
      const m = this.mirrors[k];
      r.setRenderTarget(m.rt);
      r.render(scene, m.cam);
    }
    r.setRenderTarget(prevTarget);
  }

  /** Apply head yaw/pitch (deg) to the driver camera. */
  setHead(yaw, pitch) {
    this.headYaw = yaw; this.headPitch = pitch;
    const c = this.camera;
    c.rotation.set(pitch * DEG, Math.PI + yaw * DEG, 0, 'YXZ');
    // lean when looking over the shoulder
    const lean = clamp((Math.abs(yaw) - 60) / 60, 0, 1);
    c.position.set(this.eye.x + Math.sign(yaw) * lean * 0.12, this.eye.y + lean * 0.02, this.eye.z + lean * 0.08);
  }

  drawCluster(extra = {}) {
    const cv = this.clusterCanvas, g = cv.getContext('2d');
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, 512, 192);
    // speedometer arc
    const cx = 256, cy = 150, R = 120;
    const kmh = this.speedKmh;
    g.lineWidth = 4; g.strokeStyle = '#3c4148';
    g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    g.fillStyle = '#cfd6de'; g.font = '16px sans-serif'; g.textAlign = 'center';
    for (let s = 0; s <= 120; s += 20) {
      const a = Math.PI * (1.05 + 0.9 * s / 120);
      g.strokeStyle = '#cfd6de'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
      g.fillText(s, cx + Math.cos(a) * (R - 28), cy + Math.sin(a) * (R - 28) + 5);
    }
    const a = Math.PI * (1.05 + 0.9 * Math.min(kmh, 125) / 120);
    g.strokeStyle = '#ff5a2a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8)); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif';
    g.fillText(Math.round(kmh), cx, cy - 22);
    g.font = '14px sans-serif'; g.fillStyle = '#9aa3ad'; g.fillText('km/h', cx, cy - 4);
    // blinkers
    const on = this.blinkOn;
    g.fillStyle = on && this.blinker === 'left' ? '#2fe36b' : '#1d3326';
    g.beginPath(); g.moveTo(40, 40); g.lineTo(80, 15); g.lineTo(80, 65); g.closePath(); g.fill();
    g.fillStyle = on && this.blinker === 'right' ? '#2fe36b' : '#1d3326';
    g.beginPath(); g.moveTo(472, 40); g.lineTo(432, 15); g.lineTo(432, 65); g.closePath(); g.fill();
    // gear
    g.font = 'bold 26px sans-serif';
    ['P', 'R', 'N', 'D'].forEach((c, i) => {
      g.fillStyle = this.gear === c ? '#ffd23a' : '#4a5059';
      g.fillText(c, 410 + i * 24, 175);
    });
    // warning lamps
    if (this.pbrake) { g.fillStyle = '#ff3b30'; g.font = 'bold 18px sans-serif'; g.fillText('(P) BRAKE', 70, 175); }
    if (!this.seatbelt) { g.fillStyle = '#ff3b30'; g.font = 'bold 18px sans-serif'; g.fillText('BELT', 70, 120); }
    if (extra.text) { g.fillStyle = '#9fe0ff'; g.font = '14px sans-serif'; g.fillText(extra.text, 256, 186); }
    this.clusterTex.needsUpdate = true;
  }
}

function canvasText(text, w, h, bg, fg, font) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
