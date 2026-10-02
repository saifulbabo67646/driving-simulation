import * as THREE from 'three';
import { filletPath, Path, toWorld, toSat, clamp } from './geo.js';
import { buildWorld, RoadMask, heightAt } from './world.js';
import { Car, DIM, LOOK } from './car.js';
import { Input } from './input.js';
import { Examiner, TrafficLights } from './examiner.js';
import { Hud } from './hud.js';
import { Sound } from './audio.js';
import { COURSES } from './courses/index.js';
import { Autopilot } from './autopilot.js';

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------
const DEFAULTS = {
  course: 'course1', mode: 'practice', steering: 'keyboard', steerRate: 300, throttleMax: 1,
  fov: 66, quality: 'high', voice: true, voiceLang: 'ja', sound: true, guide: true, routeLine: true, dots: true,
};
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('tobu-sim-settings') || '{}')); } catch (e) { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('tobu-sim-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------------------
// renderer / scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const scene = new THREE.Scene();

const loading = document.getElementById('loading-msg');
loading.textContent = 'Building the Tobu test course…';
await new Promise((r) => setTimeout(r, 30));

const world = buildWorld(scene, renderer, { texSize: settings.quality === 'low' ? 2048 : 4096 });
const mask = new RoadMask();
const car = new Car(scene, renderer, { heightAt, mask });
const input = new Input(canvas, settings);
const hud = new Hud();
const sound = new Sound();
const lights = new TrafficLights();

// narrow-course poles: along island kerbs where the road is narrow (S字, クランク, …)
const poles = buildPoles(world.islandPolys, mask);
car.poles = poles;

// chase / overview cameras
const chaseCam = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
const topCam = new THREE.PerspectiveCamera(50, 1, 1, 4000);
let viewMode = 'driver';

// ---------------------------------------------------------------------------
// course + examiner
// ---------------------------------------------------------------------------
let course, path, examiner, routeGroup, autopilot;
let state = 'menu'; // menu | driving | paused | result
let simTime = 0;

function loadCourse(id) {
  course = COURSES[id] || COURSES.course1;
  path = new Path(filletPath(course.waypoints));
  if (routeGroup) scene.remove(routeGroup);
  routeGroup = new THREE.Group();
  scene.add(routeGroup);
}

function buildGuides() {
  routeGroup.clear();
  // route ribbon
  const pts = path.pts;
  const verts = [], idx = [];
  const w = 0.14;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L * w, nz = dx / L * w;
    const y = heightAt(pts[i][0], pts[i][1]) + 0.025;
    verts.push(pts[i][0] + nx, y, pts[i][1] + nz, pts[i][0] - nx, y, pts[i][1] - nz);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x46d9ff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
  line.renderOrder = 2;
  line.name = 'routeLine';
  routeGroup.add(line);
  // guide dots (green = mirror, blue = signal, red = visual check) like the hand-drawn guide map
  const colors = { mirror: 0x2ecc71, signal: 0x3b82f6, visual: 0xef4444 };
  const dotGroup = new THREE.Group();
  dotGroup.name = 'dots';
  for (const d of examiner.guideDots) {
    const { p, d: dir } = path.at(d.s);
    const off = -1.25; // left side of the lane
    const x = p[0] + -dir[1] * off, z = p[1] + dir[0] * off;
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: colors[d.kind], transparent: true, opacity: 0.9, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, heightAt(x, z) + 0.03, z);
    m.renderOrder = 3;
    dotGroup.add(m);
    // small post so the dot is visible from further away
    const post = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), m.material);
    post.position.set(x, heightAt(x, z) + 0.3, z);
    post.rotation.x = Math.PI;
    dotGroup.add(post);
  }
  routeGroup.add(dotGroup);
  applyGuideVisibility();
}

function applyGuideVisibility() {
  if (!routeGroup) return;
  const practice = settings.mode === 'practice';
  const l = routeGroup.getObjectByName('routeLine');
  const d = routeGroup.getObjectByName('dots');
  if (l) l.visible = practice && settings.routeLine;
  if (d) d.visible = practice && settings.dots;
}

function startRun() {
  loadCourse(settings.course);
  const [sx, sy] = course.waypoints[0];
  const [x, z] = toWorld(sx, sy);
  car.place(x, z, course.startHeading);
  car.gear = 'P'; car.pbrake = true; car.seatbelt = false; car.blinker = null; car.sw = 0;
  examiner = new Examiner(course, path, car, {
    mode: settings.mode,
    onSay: (ja, en) => { hud.setInstruction(ja, en); sound.speak(ja, en, settings.voiceLang); },
    onDemerit: (d) => {
      hud.setDemerits(examiner.demerits, settings.mode);
      if (settings.mode === 'practice' || d.pts === 'fail') {
        hud.toast(`<b>${d.pts === 'fail' ? '試験中止' : '-' + d.pts}</b> ${d.ja}<small>${d.en}${d.detail ? ' — ' + d.detail : ''}</small>`, d.pts === 'fail' ? 'fail' : 'bad');
        sound.chime(true);
      }
      if (d.key === 'curb' || d.key === 'contact') sound.bump();
    },
    onFail: () => {
      if (settings.mode === 'exam') setTimeout(() => showResult(), 1800);
      else hud.toast('<b>In a real test this ends the exam (試験中止).</b><small>Practice mode: keep driving or press Backspace to retry this part.</small>', 'fail');
    },
    onFinish: () => setTimeout(() => showResult(), 1200),
    onOffRoute: () => hud.toast('<b>コースが違います</b><small>Off the course route. Follow the blue line / map, or press Backspace to go back to the last checkpoint.</small>', 'warn'),
    onHill: () => { if (settings.mode === 'practice') hud.toast('<b>坂道で停止 ✓</b><small>Now move off without rolling back (> 30 cm is a demerit, 1 m is a fail).</small>', 'good'); },
  });
  autopilot = new Autopilot(car, path, examiner);
  autopilot.lights = lights;
  buildGuides();
  hud.setDemerits([], settings.mode);
  hud.setInstruction('', '');
  simTime = 0;
  state = 'driving';
  document.body.classList.toggle('exam', settings.mode === 'exam');
  showOverlay(null);
  if (settings.mode === 'practice') {
    hud.toast('<b>発進手順 Start procedure</b><small>B seatbelt → hold ↓ brake + G (shift to D) → P release parking brake → X / C mirrors → E right signal → hold C (right shoulder check) → ↑ go</small>', 'info');
  }
}

function respawn() {
  if (!examiner || settings.mode !== 'practice') return;
  const s = examiner.checkpointBefore(examiner.sC);
  const back = Math.max(0, s - 12);
  const { p, d } = path.at(back);
  car.place(p[0], p[1], Math.atan2(d[1], d[0]));
  car.gear = 'D'; car.pbrake = false; car.v = 0;
  if (car.blinker) car.setBlinker(null);
  examiner.rewind(back);
  hud.toast('<b>Checkpoint</b><small>Moved back to the last checkpoint.</small>', 'info');
}

// ---------------------------------------------------------------------------
// overlays (menu, pause, help, result)
// ---------------------------------------------------------------------------
const overlays = ['menu', 'pause', 'help', 'result'];
function showOverlay(id) {
  document.body.classList.toggle('in-menu', id === 'menu');
  for (const o of overlays) document.getElementById(o).classList.toggle('show', o === id);
}

function bindMenu() {
  const sel = (name, val) => document.querySelectorAll(`[data-set="${name}"]`).forEach((b) => b.classList.toggle('on', b.dataset.val === String(val)));
  const refresh = () => {
    for (const k of ['course', 'mode', 'steering', 'quality', 'voiceLang']) sel(k, settings[k]);
    document.getElementById('opt-voice').checked = settings.voice;
    document.getElementById('opt-sound').checked = settings.sound;
    document.getElementById('opt-guide').checked = settings.guide;
    document.getElementById('opt-route').checked = settings.routeLine;
    document.getElementById('opt-dots').checked = settings.dots;
    document.getElementById('opt-steer').value = settings.steerRate;
    document.getElementById('opt-fov').value = settings.fov;
    document.getElementById('steer-val').textContent = settings.steerRate + '°/s';
    document.getElementById('fov-val').textContent = settings.fov + '°';
  };
  document.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    const k = b.dataset.set;
    settings[k] = b.dataset.val;
    saveSettings(); refresh();
  }));
  const chk = (id, key) => document.getElementById(id).addEventListener('change', (e) => { settings[key] = e.target.checked; saveSettings(); applyGuideVisibility(); });
  chk('opt-voice', 'voice'); chk('opt-sound', 'sound'); chk('opt-guide', 'guide'); chk('opt-route', 'routeLine'); chk('opt-dots', 'dots');
  document.getElementById('opt-steer').addEventListener('input', (e) => { settings.steerRate = +e.target.value; saveSettings(); refresh(); });
  document.getElementById('opt-fov').addEventListener('input', (e) => { settings.fov = +e.target.value; saveSettings(); refresh(); onResize(); });
  document.getElementById('btn-start').addEventListener('click', () => { sound.init(); sound.resume(); startRun(); });
  document.getElementById('btn-resume').addEventListener('click', () => { state = 'driving'; showOverlay(null); });
  document.getElementById('btn-restart').addEventListener('click', () => startRun());
  document.getElementById('btn-menu').addEventListener('click', () => { state = 'menu'; showOverlay('menu'); });
  document.getElementById('btn-again').addEventListener('click', () => startRun());
  document.getElementById('btn-result-menu').addEventListener('click', () => { state = 'menu'; showOverlay('menu'); });
  document.getElementById('btn-help-close').addEventListener('click', () => showOverlay(state === 'paused' ? 'pause' : null));
  document.querySelectorAll('.btn-help').forEach((b) => b.addEventListener('click', () => showOverlay('help')));
  refresh();
}

function showResult() {
  if (state === 'result') return;
  state = 'result';
  const ex = examiner;
  const score = ex.score;
  const pass = !ex.failed && score >= 70 && ex.finished;
  const r = document.getElementById('result-body');
  const verdict = ex.failed ? '試験中止 — FAIL' : !ex.finished ? '未完了 — not finished' : pass ? '合格 — PASS' : '不合格 — FAIL';
  r.innerHTML = `
    <div class="verdict ${pass ? 'pass' : 'fail'}">${verdict}</div>
    <div class="final-score">${score}<small> / 100 (pass ≥ 70)</small></div>
    <p class="muted">${course.nameJa} ${course.name} · ${(simTime / 60).toFixed(1)} min · ${settings.mode === 'exam' ? 'Exam mode' : 'Practice mode'}</p>
    ${ex.demerits.length ? `<table class="dem"><tr><th>減点</th><th>項目</th><th>Details</th></tr>${ex.demerits.map((d) =>
      `<tr><td>${d.pts === 'fail' ? '中止' : '-' + d.pts}</td><td>${d.ja}</td><td>${d.en}${d.detail ? '<br><small>' + d.detail + '</small>' : ''}</td></tr>`).join('')}</table>`
      : '<p class="good-run">減点なし — a clean run!</p>'}`;
  showOverlay('result');
  sound.chime(!pass);
}

// ---------------------------------------------------------------------------
// resize
// ---------------------------------------------------------------------------
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, settings.quality === 'high' ? 1.75 : 1);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  for (const c of [car.camera, chaseCam, topCam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
  car.camera.fov = settings.fov;
  car.camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ---------------------------------------------------------------------------
// main loop
// ---------------------------------------------------------------------------
const head = { yaw: 0, pitch: 0, holdL: 0, holdR: 0 };
let last = performance.now();
let hudT = 0, clusterT = 0, lastBlink = false;
const FIXED = 1 / 120;
let acc = 0;
let lastOff = 0;

function handleKeys(gp) {
  const brakeHeld = (input.brk || 0) > 0.25 || input.down('ArrowDown', 'KeyS', 'Space');
  if (input.hit('Escape')) {
    if (state === 'driving') { state = 'paused'; showOverlay('pause'); }
    else if (state === 'paused') { state = 'driving'; showOverlay(null); }
  }
  if (state !== 'driving') return;
  if (input.hit('KeyQ') || gp.blinkL) { car.setBlinker('left'); sound.click(true); }
  if (input.hit('KeyE') || gp.blinkR) { car.setBlinker('right'); sound.click(true); }
  if (input.hit('KeyB')) { car.seatbelt = !car.seatbelt; hud.toast(car.seatbelt ? '<b>シートベルト装着</b><small>Seatbelt fastened</small>' : '<b>Seatbelt off</b>', 'info'); sound.click(false); }
  if (input.hit('KeyP') || gp.pbrake) { car.pbrake = !car.pbrake; sound.click(false); }
  if (input.hit('KeyG') || gp.gear) {
    if (car.gear === 'P' || car.gear === 'N') {
      if (brakeHeld && Math.abs(car.v) < 0.1) car.gear = 'D';
      else hud.toast('<b>ブレーキを踏んで</b><small>Hold the brake (↓) while shifting into D.</small>', 'warn');
    } else if (Math.abs(car.v) < 0.1) car.gear = 'P';
    else hud.toast('<b>Stop first</b><small>Stop the car before shifting to P.</small>', 'warn');
  }
  if (input.hit('KeyR') || gp.reverse) {
    if (Math.abs(car.v) < 0.1 && brakeHeld) car.gear = car.gear === 'R' ? 'D' : 'R';
    else hud.toast('<b>Stop + brake</b><small>Stop and hold the brake to select R.</small>', 'warn');
  }
  if (input.hit('KeyN')) { if (Math.abs(car.v) < 0.1) car.gear = 'N'; }
  if (input.hit('KeyV')) viewMode = viewMode === 'driver' ? 'chase' : viewMode === 'chase' ? 'top' : 'driver';
  if (input.hit('KeyM')) hud.mapSize = (hud.mapSize + 1) % 3;
  if (input.hit('KeyT')) { settings.routeLine = !settings.routeLine; settings.dots = settings.routeLine; saveSettings(); applyGuideVisibility(); }
  if (input.hit('KeyH', 'F1')) showOverlay(document.getElementById('help').classList.contains('show') ? null : 'help');
  if (input.hit('Backspace')) respawn();
}

function simStep(dt, ctl) {
  car.step(dt, ctl);
  lights.update(dt);
  examiner.update(dt, { lights });
  simTime += dt;
}

// autopilot incl. the moving-off routine (development / demo)
function autoControl(dt) {
  if (!examiner.started) {
    autopilot.t0 = (autopilot.t0 || 0) + dt;
    const t = autopilot.t0;
    car.seatbelt = true;
    if (car.gear === 'P') car.gear = 'D';
    car.pbrake = false;
    const head = t < 0.8 ? LOOK.mirrorRear : t < 1.6 ? LOOK.mirrorR : t > 2.0 && t < 3.0 ? LOOK.shoulderR : { yaw: 0, pitch: 0 };
    if (t > 1.7 && car.blinker !== 'right') car.setBlinker('right');
    const ctl = { throttle: t > 3.4 ? 0.3 : 0, brake: t > 3.4 ? 0 : 1, steerAbs: 0, steerRate: 300, gp: {} };
    return { ctl, head };
  }
  return autopilot.control(dt);
}

function updateHead(dt, gp, forced) {
  let tYaw = 0, tPitch = 0;
  const zl = input.down('KeyZ') || gp.lookL, zr = input.down('KeyC') || gp.lookR, zx = input.down('KeyX') || gp.lookRear;
  head.holdL = zl ? head.holdL + dt : 0;
  head.holdR = zr ? head.holdR + dt : 0;
  if (forced) { tYaw = forced.yaw; tPitch = forced.pitch; }
  else if (input.mouseLook.active) { tYaw = input.mouseLook.yaw; tPitch = input.mouseLook.pitch; }
  else if (zl) { const t = head.holdL < 0.45 ? LOOK.mirrorL : LOOK.shoulderL; tYaw = t.yaw; tPitch = t.pitch; }
  else if (zr) { const t = head.holdR < 0.45 ? LOOK.mirrorR : LOOK.shoulderR; tYaw = t.yaw; tPitch = t.pitch; }
  else if (zx) { tYaw = LOOK.mirrorRear.yaw; tPitch = LOOK.mirrorRear.pitch; }
  if (!input.mouseLook.active) {
    input.mouseLook.yaw *= Math.max(0, 1 - dt * 6);
    input.mouseLook.pitch *= Math.max(0, 1 - dt * 6);
    if (Math.abs(input.mouseLook.yaw) > 1) { tYaw = tYaw || input.mouseLook.yaw; }
  }
  const k = Math.min(1, dt * 10);
  head.yaw += (tYaw - head.yaw) * k;
  head.pitch += (tPitch - head.pitch) * k;
  car.setHead(head.yaw, head.pitch);
}

function updateCameras() {
  const [cx, cz] = car.center;
  const f = car.fwd;
  const cy = car.y;
  if (viewMode === 'chase') {
    const tx = cx - f[0] * 9, tz = cz - f[1] * 9;
    chaseCam.position.lerp(new THREE.Vector3(tx, cy + 3.8, tz), 0.15);
    chaseCam.lookAt(cx + f[0] * 5, cy + 0.8, cz + f[1] * 5);
  } else if (viewMode === 'top') {
    topCam.position.set(cx, 70, cz + 25);
    topCam.lookAt(cx, 0, cz);
  }
  world.followSun(cx, cz);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let ctl = input.poll(dt);
  handleKeys(ctl.gp);
  if (state === 'driving') {
    acc += dt;
    let ap = null;
    if (autopilot && autopilot.on) { ap = autoControl(dt); ctl = ap.ctl; }
    updateHead(dt, ctl.gp, ap && ap.head);
    while (acc >= FIXED) {
      acc -= FIXED;
      simStep(FIXED, ctl);
    }
    for (const s of world.signalHeads) s.set(lights.state(s.approach));
    if (car.wheelsOff && !lastOff) sound.bump();
    lastOff = car.wheelsOff;
    sound.enabled = settings.sound;
    sound.voice = settings.voice;
    sound.engine(car.speedKmh, ctl.throttle, true);
    const b = car.blinkOn;
    if (b !== lastBlink && car.blinker) sound.click(b);
    lastBlink = b;
  } else {
    acc = 0;
    sound.engine(0, 0, false);
  }
  input.endFrame();

  updateCameras();
  hudT += dt; clusterT += dt;
  if (examiner && (hudT > 0.1)) { hudT = 0; hud.update(car, examiner, settings); }
  if (clusterT > 0.066) { clusterT = 0; car.drawCluster(); }

  // render: shadows once, then mirrors, then the main view
  renderer.shadowMap.needsUpdate = true;
  const cam = viewMode === 'driver' ? car.camera : viewMode === 'chase' ? chaseCam : topCam;
  car.group.visible = true;
  renderer.render(scene, cam);
  if (viewMode === 'driver' && state !== 'menu') car.renderMirrors(scene);
}

// ---------------------------------------------------------------------------
function buildPoles(islands, mask) {
  const list = [];
  for (const poly of islands) {
    // skip the thin divider next to the departure lane
    const [, sy0] = toSat(poly[0][0], poly[0][1]);
    if (sy0 > 940) continue;
    let carry = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (let s = carry; s < L; s += 3.6) {
        const x = a[0] + dx * s, z = a[1] + dz * s;
        // outward normal: whichever side is road
        let nx = -dz, nz = dx;
        if (!mask.isRoad(x + nx * 0.6, z + nz * 0.6)) { nx = -nx; nz = -nz; }
        if (!mask.isRoad(x + nx * 0.6, z + nz * 0.6)) continue;
        // measure road width along the normal
        let w = 0;
        for (w = 0.6; w < 6; w += 0.15) if (!mask.isRoad(x + nx * w, z + nz * w)) break;
        if (w < 4.3) {
          const px = x - nx * 0.5, pz = z - nz * 0.5;
          const [, qy] = toSat(px, pz);
          if (qy < 120 || qy > 940) continue;
          list.push({ x: px, z: pz, r: 0.04 });
        }
      }
      carry = 0;
    }
  }
  // instanced visual
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 128;
  const g = cv.getContext('2d');
  for (let y = 0; y < 128; y += 16) { g.fillStyle = (y / 16) % 2 ? '#f7f7f2' : '#f2c21b'; g.fillRect(0, y, 16, 16); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 8), new THREE.MeshLambertMaterial({ map: tex }), list.length);
  const m = new THREE.Matrix4();
  list.forEach((p, i) => { m.makeTranslation(p.x, 0.15 + 0.85 + heightAt(p.x, p.z), p.z); mesh.setMatrixAt(i, m); });
  mesh.castShadow = true;
  scene.add(mesh);
  return list;
}

// ---------------------------------------------------------------------------
bindMenu();
loadCourse(settings.course);
{
  // menu backdrop: park the car at the start
  const [sx, sy] = course.waypoints[0];
  const [x, z] = toWorld(sx, sy);
  car.place(x, z, course.startHeading);
  viewMode = 'driver';
}
document.getElementById('loading').remove();
showOverlay('menu');
requestAnimationFrame(frame);
window.__sim = {
  autopilot: (on = true, routine = true) => { if (autopilot) { autopilot.on = on; autopilot.routine = routine; } },
  /** run the simulation headless for `sec` seconds (autopilot drives) */
  simulate(sec) {
    const n = Math.round(sec / FIXED);
    for (let i = 0; i < n && !examiner.finished && state === 'driving'; i++) {
      const ap = autoControl(FIXED);
      updateHead(FIXED, {}, ap.head);
      simStep(FIXED, ap.ctl);
    }
    return { s: examiner.sC, t: simTime, score: examiner.score, finished: examiner.finished, failed: examiner.failed && examiner.failed.ja };
  },
  /** place the car exactly on the ideal line (rear axle on the path) and report kerb / pole conflicts */
  sweep(step = 0.25, extra = 0) {
    const out = [];
    for (let s = 0; s < path.length - 1; s += step) {
      const { p, d } = path.at(s);
      car.rx = p[0]; car.rz = p[1]; car.h = Math.atan2(d[1], d[0]);
      const off = car.wheelPoints().map(([x, z]) => !mask.isRoad(x, z));
      const pole = car.hitPole(extra);
      if (off.some(Boolean) || pole) {
        const [sx, sy] = toSat(...car.center);
        out.push({ s: +s.toFixed(1), off: off.map((o) => (o ? 1 : 0)).join(''), pole: !!pole, sat: [Math.round(sx), Math.round(sy)] });
      }
    }
    return out;
  },
  car, lights, get examiner() { return examiner; }, settings, startRun, path: () => path, scene, renderer, setView: (v) => { viewMode = v; }, clamp, DIM };
