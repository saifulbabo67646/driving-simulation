// Builds the 3D world: ground, road surface with markings, raised islands
// with kerbs, the slope, level crossing, signs, signals, posts, buildings,
// trees and the distant scenery.

import * as THREE from 'three';
import { S, toWorld, toSat, flatToWorld, pointInPoly } from './geo.js';
import { ROAD_OUTER, ISLANDS } from './trackData.js';
import {
  LOOP_R, loopPolyline, heightAtSat, SLOPE, CENTER_LINES, STOP_LINES, CROSSWALKS, DIAMONDS,
  TRIANGLES, INTERSECTION, DEPARTURE, RAILWAY, POSTS, STOP_SIGNS, SIGNALS, PED_SIGNS, LAMPS,
} from './layout.js';

// texture/mask bounding box in sat px
export const BBOX = { x0: 268, y0: 0, x1: 1748, y1: 1006 };

export const heightAt = (x, z) => {
  const [sx, sy] = toSat(x, z);
  return heightAtSat(sx, sy);
};

/** Fast road/off-road lookup raster at 10 cm resolution. */
export class RoadMask {
  constructor() {
    const res = 0.1;
    this.res = res;
    const [wx0, wz0] = toWorld(BBOX.x0, BBOX.y0);
    const [wx1, wz1] = toWorld(BBOX.x1, BBOX.y1);
    this.x0 = wx0; this.z0 = wz0;
    this.w = Math.ceil((wx1 - wx0) / res);
    this.h = Math.ceil((wz1 - wz0) / res);
    const cv = document.createElement('canvas');
    cv.width = this.w; cv.height = this.h;
    const g = cv.getContext('2d');
    const k = S / res;
    g.setTransform(k, 0, 0, k, -BBOX.x0 * k, -BBOX.y0 * k);
    g.fillStyle = '#fff';
    tracePoly(g, ROAD_OUTER);
    g.fill();
    g.fillStyle = '#000';
    for (const isl of ISLANDS) { tracePoly(g, isl); g.fill(); }
    const data = g.getImageData(0, 0, this.w, this.h).data;
    this.m = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.m.length; i++) this.m[i] = data[i * 4] > 127 ? 1 : 0;
  }
  isRoad(x, z) {
    const i = Math.floor((x - this.x0) / this.res);
    const j = Math.floor((z - this.z0) / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    return this.m[j * this.w + i] === 1;
  }
}

function tracePoly(g, flat) {
  g.beginPath();
  g.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) g.lineTo(flat[i], flat[i + 1]);
  g.closePath();
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
function noiseCanvas(size, base, spread, count, alpha = 0.5) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const c = spread[(Math.random() * spread.length) | 0];
    g.globalAlpha = Math.random() * alpha;
    g.fillStyle = c;
    const r = Math.random() * 2.2 + 0.4;
    g.fillRect(Math.random() * size, Math.random() * size, r, r * (0.6 + Math.random()));
  }
  g.globalAlpha = 1;
  return cv;
}

function grassTexture(renderer) {
  const cv = noiseCanvas(512, '#6f8a3e', ['#5c7a2f', '#83994a', '#4f6b28', '#90a456', '#6a7f34'], 26000, 0.7);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function concreteTexture(renderer) {
  const cv = noiseCanvas(256, '#c9c7bf', ['#b5b3ab', '#d8d6cf', '#a9a7a0'], 6000, 0.6);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function textTexture(lines, { w = 256, h = 256, bg = '#fff', fg = '#111', font = 'bold 150px sans-serif', border = 0 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = fg; g.lineWidth = border; g.strokeRect(border / 2, border / 2, w - border, h - border); }
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (arr.length - 1) / 2) * (h / (arr.length + 0.4))));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Road surface texture (asphalt + all markings), drawn in sat px.
// ---------------------------------------------------------------------------
function paintRoad(texW) {
  const W = texW;
  const k = W / (BBOX.x1 - BBOX.x0);
  const H = Math.round((BBOX.y1 - BBOX.y0) * k);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.setTransform(k, 0, 0, k, -BBOX.x0 * k, -BBOX.y0 * k);
  const px = (m) => m / S; // metres -> sat px

  // asphalt
  g.save();
  g.beginPath();
  const addPoly = (flat) => {
    g.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) g.lineTo(flat[i], flat[i + 1]);
    g.closePath();
  };
  addPoly(ROAD_OUTER);
  for (const isl of ISLANDS) addPoly(isl);
  g.fillStyle = '#5b5e62';
  g.fill('evenodd');
  g.clip('evenodd');
  // texture speckle (pattern tile)
  g.setTransform(1, 0, 0, 1, 0, 0);
  const tile = document.createElement('canvas');
  tile.width = tile.height = 256;
  const tg = tile.getContext('2d');
  const cols = ['#4a4d51', '#6a6d70', '#53565a', '#727477', '#45484c'];
  for (let i = 0; i < 2600; i++) {
    tg.globalAlpha = 0.25 + Math.random() * 0.35;
    tg.fillStyle = cols[(Math.random() * cols.length) | 0];
    const s = 1 + Math.random() * 1.6;
    tg.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  g.fillStyle = g.createPattern(tile, 'repeat');
  g.fillRect(0, 0, W, H);
  // subtle large-scale patches (repairs / wear)
  for (let i = 0; i < 260; i++) {
    g.globalAlpha = 0.05 + Math.random() * 0.06;
    g.fillStyle = Math.random() < 0.5 ? '#3d4044' : '#7a7c7e';
    const r = (20 + Math.random() * 90) * k;
    g.beginPath();
    g.ellipse(Math.random() * W, Math.random() * H, r, r * (0.3 + Math.random() * 0.7), Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.setTransform(k, 0, 0, k, -BBOX.x0 * k, -BBOX.y0 * k);

  // departure lane platform tint
  g.fillStyle = 'rgba(80,82,86,0.6)';
  g.fillRect(DEPARTURE.x0, DEPARTURE.y0, DEPARTURE.x1 - DEPARTURE.x0, DEPARTURE.y1 - DEPARTURE.y0);
  // level crossing plates
  g.fillStyle = '#6b4a3f';
  g.fillRect(RAILWAY.x0, RAILWAY.y0, RAILWAY.x1 - RAILWAY.x0, RAILWAY.y1 - RAILWAY.y0);
  g.fillStyle = '#3a3a3a';
  g.fillRect(RAILWAY.x - 5.2, RAILWAY.y0, 1.3, RAILWAY.y1 - RAILWAY.y0);
  g.fillRect(RAILWAY.x + 3.9, RAILWAY.y0, 1.3, RAILWAY.y1 - RAILWAY.y0);

  const WHITE = '#ecebe4';
  g.strokeStyle = WHITE; g.fillStyle = WHITE;
  g.lineCap = 'butt'; g.lineJoin = 'round';

  const polyline = (pts, width, dash) => {
    g.lineWidth = px(width);
    g.setLineDash(dash ? dash.map(px) : []);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
    g.setLineDash([]);
  };

  // outer circuit: lane line (dashed) and centre line (solid, broken by the crosswalk)
  polyline(loopPolyline(LOOP_R.dash), 0.15, [5, 5]);
  const center = loopPolyline(LOOP_R.center);
  g.save();
  g.beginPath();
  g.rect(BBOX.x0, BBOX.y0, BBOX.x1 - BBOX.x0, BBOX.y1 - BBOX.y0);
  g.rect(1262, 860, 46, 50);
  g.clip('evenodd');
  polyline(center, 0.15);
  g.restore();
  // outer edge line on the east side
  polyline([[LOOP_R.outer - 2 + 1562.5, 264], [LOOP_R.outer - 2 + 1562.5, 803]], 0.15);

  for (const l of CENTER_LINES) polyline(l, 0.15);
  // departure lane edge lines + start/finish mark
  polyline([[DEPARTURE.x0 + 30, DEPARTURE.y1 - 3], [DEPARTURE.x1 - 6, DEPARTURE.y1 - 3]], 0.15);
  g.lineWidth = px(0.2);
  g.strokeRect(DEPARTURE.markX - 2, DEPARTURE.y0 + 4, px(0.3), DEPARTURE.y1 - DEPARTURE.y0 - 8);
  g.font = `bold ${px(0.9)}px sans-serif`;
  g.save();
  g.translate(DEPARTURE.markX - 14, DEPARTURE.laneY);
  g.rotate(Math.PI / 2);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('発着点', 0, 0);
  g.restore();

  // stop lines
  for (const [a, b] of STOP_LINES) polyline([a, b], 0.45);

  // crosswalks
  for (const c of CROSSWALKS) {
    const bar = px(0.45), gap = px(0.45);
    if (c.bars === 'y') {
      for (let x = c.x0 + gap / 2; x + bar <= c.x1; x += bar + gap) g.fillRect(x, c.y0, bar, c.y1 - c.y0);
    } else {
      for (let y = c.y0 + gap / 2; y + bar <= c.y1; y += bar + gap) g.fillRect(c.x0, y, c.x1 - c.x0, bar);
    }
  }
  // intersection centre square
  g.lineWidth = px(0.15);
  g.setLineDash([px(0.8), px(0.6)]);
  g.strokeRect(INTERSECTION.cx - 27, INTERSECTION.cy - 27, 54, 54);
  g.setLineDash([]);
  // diamonds
  for (const [x, y, a] of DIAMONDS) {
    g.save(); g.translate(x, y); g.rotate(a);
    g.lineWidth = px(0.2);
    g.beginPath();
    g.moveTo(-px(2.5), 0); g.lineTo(0, -px(0.8)); g.lineTo(px(2.5), 0); g.lineTo(0, px(0.8)); g.closePath();
    g.stroke(); g.restore();
  }
  // triangles
  for (const [x, y, a] of TRIANGLES) {
    g.save(); g.translate(x, y); g.rotate(a);
    g.lineWidth = px(0.15);
    g.beginPath();
    g.moveTo(-px(1.2), -px(0.5)); g.lineTo(-px(1.2), px(0.5)); g.lineTo(px(0.4), 0); g.closePath();
    g.stroke(); g.restore();
  }
  // 止まれ road text before the stop lines of 64 / 42 / 52
  const roadText = (txt, x, y, rot) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.scale(1, 2.4);
    g.font = `bold ${px(1.1)}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, 0, 0);
    g.restore();
  };
  roadText('止まれ', 1072, 252, Math.PI);
  roadText('止まれ', 1106, 826, 0);
  roadText('止まれ', 1447, 821, 0);
  roadText('踏切', 845, 39, Math.PI / 2);
  g.restore();
  return cv;
}

// ---------------------------------------------------------------------------
export function buildWorld(scene, renderer, opts = {}) {
  const texW = Math.min(opts.texSize || 4096, renderer.capabilities.maxTextureSize);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const world = { colliders: [], signalHeads: [], updaters: [] };

  // --- sky + fog -----------------------------------------------------------
  scene.background = new THREE.Color(0xc7d3de);
  scene.fog = new THREE.Fog(0xc7d3de, 180, 1500);
  scene.add(makeSkyDome());
  scene.add(makeMountains());

  // --- lights --------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xe3ebf5, 0x5d6b47, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
  sun.position.set(-60, 120, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  world.sun = sun;
  world.followSun = (x, z) => {
    sun.position.set(x - 60, 120, z + 80);
    sun.target.position.set(x, 0, z);
  };

  // --- ground (grass) -----------------------------------------------------
  const grassTex = grassTexture(renderer);
  const gt = grassTex.clone(); gt.needsUpdate = true;
  gt.repeat.set(220, 220);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshLambertMaterial({ map: gt, color: 0xb8c4a0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  scene.add(ground);

  // surrounding service roads / car parks (simple asphalt patches)
  const outsideAsphalt = new THREE.MeshLambertMaterial({ color: 0x6b6d70 });
  const patch = (sx0, sy0, sx1, sy1) => {
    const [x0, z0] = toWorld(sx0, sy0);
    const [x1, z1] = toWorld(sx1, sy1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), outsideAsphalt);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
    m.receiveShadow = true;
    scene.add(m);
  };
  patch(130, -20, 210, 1420);     // public road to the west
  patch(1860, -20, 1960, 1420);   // public road to the east
  patch(1330, 1000, 1780, 1400);  // motorcycle course area
  patch(240, 1000, 780, 1400);    // car parks
  patch(140, 560, 250, 900);

  // --- road surface --------------------------------------------------------
  const roadCanvas = paintRoad(texW);
  const roadTex = new THREE.CanvasTexture(roadCanvas);
  roadTex.colorSpace = THREE.SRGBColorSpace;
  roadTex.anisotropy = aniso;
  roadTex.generateMipmaps = true;
  roadTex.minFilter = THREE.LinearMipmapLinearFilter;
  world.roadCanvas = roadCanvas;
  const [rx0, rz0] = toWorld(BBOX.x0, BBOX.y0);
  const [rx1, rz1] = toWorld(BBOX.x1, BBOX.y1);
  const rw = rx1 - rx0, rh = rz1 - rz0;
  const roadGeo = new THREE.PlaneGeometry(rw, rh, Math.round(rw / 0.6), Math.round(rh / 1.2));
  roadGeo.rotateX(-Math.PI / 2);
  roadGeo.translate((rx0 + rx1) / 2, 0, (rz0 + rz1) / 2);
  {
    const p = roadGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
    roadGeo.computeVertexNormals();
  }
  const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({
    map: roadTex, alphaTest: 0.5, transparent: false, roughness: 0.92, metalness: 0,
  }));
  road.receiveShadow = true;
  scene.add(road);

  // --- islands (raised grass with concrete kerbs) --------------------------
  const islandGrass = grassTex.clone(); islandGrass.needsUpdate = true;
  islandGrass.repeat.set(0.22, 0.22);
  const ct = concreteTexture(renderer);
  const kerbTex = ct.clone(); kerbTex.needsUpdate = true; kerbTex.repeat.set(1, 1);
  const islandMats = [
    new THREE.MeshLambertMaterial({ map: islandGrass, color: 0xd2dcb4 }),
    new THREE.MeshLambertMaterial({ map: kerbTex, color: 0xe2e0d8 }),
  ];
  const kerbH = 0.16;
  world.islandPolys = [];
  for (const isl of ISLANDS) {
    const pts = flatToWorld(isl);
    world.islandPolys.push(pts);
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: kerbH, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > kerbH * 0.5) p.setY(i, kerbH + heightAt(p.getX(i), p.getZ(i)));
      else p.setY(i, -0.02);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, islandMats);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    scene.add(mesh);
  }

  // retaining wall along the north edge of the slope road
  {
    const outer = flatToWorld(ROAD_OUTER).filter(([x, z]) => {
      const [sx, sy] = toSat(x, z);
      return sy < 40 && sx > SLOPE.x0 - 25 && sx < SLOPE.x3 + 25;
    }).sort((a, b) => a[0] - b[0]);
    const wallMat = new THREE.MeshLambertMaterial({ map: ct, color: 0xd9d6cc, side: THREE.DoubleSide });
    const verts = [], idx = [];
    outer.forEach(([x, z], i) => {
      const h = heightAt(x, z + 0.4);
      verts.push(x, -0.05, z - 0.15, x, h + 0.35, z - 0.15);
      if (i > 0) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    const uv = [];
    outer.forEach(([x]) => uv.push(x / 2, 0, x / 2, 1));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const wall = new THREE.Mesh(geo, wallMat);
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall);
    // guard rail on top
    const rail = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    for (let i = 0; i < outer.length - 1; i += 3) {
      const [x, z] = outer[i];
      const h = heightAt(x, z + 0.4);
      if (h < 0.2) continue;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), rail);
      post.position.set(x, h + 0.75, z - 0.15);
      scene.add(post);
    }
  }

  // --- departure platform + canopy ----------------------------------------
  {
    const [x0, z0] = toWorld(DEPARTURE.x0 + 10, DEPARTURE.y1);
    const [x1, z1] = toWorld(DEPARTURE.x1, DEPARTURE.y1 + 14);
    addBox(scene, (x0 + x1) / 2, 0.08, (z0 + z1) / 2, x1 - x0, 0.18, z1 - z0, 0xcfccc3);
    // canopy with green corrugated roof (see photos)
    const [cx0, cz0] = toWorld(612, 952);
    const [cx1, cz1] = toWorld(1022, 1010);
    const roofMat = new THREE.MeshLambertMaterial({ map: corrugatedTexture(), color: 0xffffff });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cx1 - cx0, 0.15, cz1 - cz0), roofMat);
    roof.position.set((cx0 + cx1) / 2, 3.6, (cz0 + cz1) / 2);
    roof.castShadow = true;
    scene.add(roof);
    for (let x = cx0 + 1; x < cx1; x += 7.5) {
      addBox(scene, x, 1.8, cz1 - 0.4, 0.25, 3.6, 0.25, 0xd8dcd6, true);
    }
    // station building + tower block behind
    const [bx0, bz0] = toWorld(612, 1012);
    const [bx1, bz1] = toWorld(1022, 1060);
    addBox(scene, (bx0 + bx1) / 2, 2.2, (bz0 + bz1) / 2, bx1 - bx0, 4.4, bz1 - bz0, 0xe9e9e4, true);
    const [hx0, hz0] = toWorld(780, 1075);
    const [hx1, hz1] = toWorld(1320, 1300);
    const tile = tileTexture();
    const bmat = new THREE.MeshLambertMaterial({ map: tile });
    const hb = new THREE.Mesh(new THREE.BoxGeometry(hx1 - hx0, 13, hz1 - hz0), bmat);
    hb.position.set((hx0 + hx1) / 2, 6.5, (hz0 + hz1) / 2);
    hb.castShadow = true;
    scene.add(hb);
    // glass walkway
    const [gx0, gz0] = toWorld(1255, 958);
    const [gx1, gz1] = toWorld(1318, 1075);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(gx1 - gx0, 3.2, gz1 - gz0),
      new THREE.MeshLambertMaterial({ color: 0x9fb0bd }));
    glass.position.set((gx0 + gx1) / 2, 4.4, (gz0 + gz1) / 2);
    scene.add(glass);
    // other buildings around
    [[240, 1190, 360, 1320, 6, 0xd7dbd6], [395, 1185, 700, 1320, 7, 0xcfd6d2], [0, 1150, 100, 1414, 8, 0xc9cdc9],
      [1405, 1320, 1780, 1414, 3, 0xd6d6d0], [-200, 300, 100, 560, 5, 0xd2d0c8]].forEach(([a, b, c, d, h, col]) => {
      const [p0, q0] = toWorld(a, b); const [p1, q1] = toWorld(c, d);
      addBox(scene, (p0 + p1) / 2, h / 2, (q0 + q1) / 2, p1 - p0, h, q1 - q0, col, true);
    });
  }

  // --- level crossing --------------------------------------------------------
  buildRailway(scene);

  // --- signs, posts, signals, lamps --------------------------------------------
  const postMat = new THREE.MeshLambertMaterial({ color: 0xf4f4f0 });
  for (const [n, sx, sy] of POSTS) {
    const [x, z] = toWorld(sx, sy);
    const h0 = heightAt(x, z) + 0.15;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 8), postMat);
    pole.position.set(x, h0 + 0.75, z);
    pole.castShadow = true;
    scene.add(pole);
    const tex = textTexture(String(n), { w: 128, h: 128, font: 'bold 82px sans-serif', border: 8 });
    const plateMat = new THREE.MeshLambertMaterial({ map: tex });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.03),
      [postMat, postMat, postMat, postMat, plateMat, plateMat]);
    plate.position.set(x, h0 + 1.45, z);
    // face the nearest road: point towards the intersection-ish centre of the course
    plate.rotation.y = Math.atan2(INTERSECTION.cx - sx, INTERSECTION.cy - sy) + (Math.random() - 0.5) * 0.4;
    scene.add(plate);
  }

  for (const s of STOP_SIGNS) addStopSign(scene, s);
  for (const [sx, sy] of PED_SIGNS) addPedSign(scene, sx, sy);
  for (const s of SIGNALS) world.signalHeads.push(addSignal(scene, s));
  for (const [sx, sy] of LAMPS) addLamp(scene, sx, sy);

  // --- trees, hedges, fences --------------------------------------------------
  addVegetation(scene, world);

  // distant lattice tower (visible in the photos)
  addTower(scene, 1240, -1250);

  return world;
}

// ---------------------------------------------------------------------------
function addBox(scene, x, y, z, w, h, d, color, shadow = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  scene.add(m);
  return m;
}

function corrugatedTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  for (let x = 0; x < 256; x += 8) {
    const grd = g.createLinearGradient(x, 0, x + 8, 0);
    grd.addColorStop(0, '#7fa38a'); grd.addColorStop(0.5, '#a9c8b0'); grd.addColorStop(1, '#6f927a');
    g.fillStyle = grd; g.fillRect(x, 0, 8, 64);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tileTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#dcd6c9'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#c4bdaf'; g.lineWidth = 1;
  for (let y = 0; y < 256; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  g.fillStyle = '#4d5866';
  for (let y = 40; y < 256; y += 85) for (let x = 20; x < 256; x += 60) g.fillRect(x, y, 40, 30);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSkyDome() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 512;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#8fa9c4');
  grd.addColorStop(0.45, '#b9c8d6');
  grd.addColorStop(0.5, '#cdd7e0');
  grd.addColorStop(1, '#cdd7e0');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
  // soft overcast clouds
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 1024, y = 40 + Math.random() * 200;
    const r = 20 + Math.random() * 70;
    const cg = g.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, 'rgba(240,243,246,0.35)');
    cg.addColorStop(1, 'rgba(240,243,246,0)');
    g.fillStyle = cg;
    g.beginPath(); g.ellipse(x, y, r * 1.8, r * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16),
    new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10;
  return dome;
}

function makeMountains() {
  const cv = document.createElement('canvas');
  cv.width = 2048; cv.height = 256;
  const g = cv.getContext('2d');
  const layer = (color, base, amp, seed) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 256);
    for (let x = 0; x <= 2048; x += 8) {
      const t = x / 2048 * Math.PI * 2;
      const y = base - amp * (0.55 * Math.sin(t * 3 + seed) + 0.3 * Math.sin(t * 7 + seed * 2) +
        0.15 * Math.sin(t * 17 + seed * 3) + 0.35 * Math.max(0, Math.sin(t * 2 + seed * 0.5)) ** 3);
      g.lineTo(x, y);
    }
    g.lineTo(2048, 256);
    g.closePath(); g.fill();
  };
  layer('#9aa8b6', 150, 70, 1.3);
  layer('#7f8f9f', 190, 45, 4.1);
  layer('#6d7c69', 236, 14, 2.2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  const geo = new THREE.CylinderGeometry(1300, 1300, 260, 64, 1, true);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  // make sky-coloured pixels transparent by using an alpha map derived from the canvas
  const a = document.createElement('canvas');
  a.width = 2048; a.height = 256;
  const ag = a.getContext('2d');
  ag.drawImage(cv, 0, 0);
  const id = ag.getImageData(0, 0, 2048, 256);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = id.data[i + 3] > 10 ? 255 : 0;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
  }
  ag.putImageData(id, 0, 0);
  m.material.alphaMap = new THREE.CanvasTexture(a);
  m.material.alphaMap.wrapS = THREE.RepeatWrapping;
  m.position.y = 110;
  m.renderOrder = -9;
  return m;
}

function addStopSign(scene, s) {
  const [x, z] = toWorld(s.x, s.y);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), new THREE.MeshLambertMaterial({ color: 0xdedede }));
  pole.position.set(x, 1.1 + 0.15, z);
  pole.castShadow = true;
  scene.add(pole);
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(0, 18); g.lineTo(256, 18); g.lineTo(128, 240); g.closePath(); g.fill();
  g.fillStyle = '#d7191f';
  g.beginPath(); g.moveTo(18, 28); g.lineTo(238, 28); g.lineTo(128, 220); g.closePath(); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center';
  g.fillText('止まれ', 128, 92);
  g.font = 'bold 18px sans-serif'; g.fillText('STOP', 128, 120);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshLambertMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
  // plane normal is +z; rotate so that it points along s.face (sat angle)
  sign.rotation.y = Math.atan2(Math.cos(s.face), Math.sin(s.face));
  sign.position.set(x, 2.0 + 0.15, z);
  scene.add(sign);
}

function addPedSign(scene, sx, sy) {
  const [x, z] = toWorld(sx, sy);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 8), new THREE.MeshLambertMaterial({ color: 0xdedede }));
  pole.position.set(x, 1.35, z);
  scene.add(pole);
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#1d5fbf'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(64, 10); g.lineTo(118, 112); g.lineTo(10, 112); g.closePath(); g.fill();
  g.fillStyle = '#111';
  g.beginPath(); g.arc(70, 48, 7, 0, 7); g.fill();
  g.fillRect(56, 58, 14, 26);
  g.fillRect(36, 96, 56, 6);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.03), new THREE.MeshLambertMaterial({ map: t }));
  sign.position.set(x, 2.4, z);
  sign.rotation.y = Math.PI / 2;
  scene.add(sign);
}

function addSignal(scene, s) {
  const [x, z] = toWorld(s.x, s.y);
  const [ax, az] = toWorld(s.ax, s.ay);
  const grey = new THREE.MeshLambertMaterial({ color: 0x9a9fa3 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 5.6, 10), grey);
  pole.position.set(x, 2.8, z);
  pole.castShadow = true;
  scene.add(pole);
  const len = Math.hypot(ax - x, az - z) + 0.6;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 8), grey);
  arm.rotation.z = Math.PI / 2;
  const armGroup = new THREE.Group();
  armGroup.position.set(x, 5.2, z);
  armGroup.rotation.y = -Math.atan2(az - z, ax - x);
  arm.position.x = len / 2;
  armGroup.add(arm);
  scene.add(armGroup);
  // head: Japanese horizontal signal  [green][yellow][red] left-to-right as seen by the driver
  const head = new THREE.Group();
  head.position.set(ax, 5.0, az);
  // face direction: local +z should point along s.face
  head.rotation.y = Math.atan2(Math.cos(s.face), Math.sin(s.face));
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.42, 0.25), new THREE.MeshLambertMaterial({ color: 0x8c9196 }));
  head.add(box);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.3), new THREE.MeshLambertMaterial({ color: 0x7b8085 }));
  visor.position.set(0, 0.22, 0.2);
  head.add(visor);
  const lamps = {};
  const colors = { green: 0x16d9a0, yellow: 0xffc21a, red: 0xff2a1a };
  // seen from the front (+z), the viewer's left is local +x... a viewer facing -z sees +x on their right.
  // Driver faces the head (looking along -z of head); driver's left is local -x.
  [['green', -0.4], ['yellow', 0], ['red', 0.4]].forEach(([c, ox]) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), mat);
    lamp.position.set(ox, 0, 0.13);
    head.add(lamp);
    lamps[c] = { mat, on: colors[c] };
  });
  scene.add(head);
  return {
    approach: s.approach,
    set(state) {
      for (const c of ['green', 'yellow', 'red']) lamps[c].mat.color.setHex(state === c ? lamps[c].on : 0x1f2124);
    },
  };
}

function addLamp(scene, sx, sy) {
  const [x, z] = toWorld(sx, sy);
  const grey = new THREE.MeshLambertMaterial({ color: 0x8d9296 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 8, 8), grey);
  pole.position.set(x, 4, z);
  pole.castShadow = true;
  scene.add(pole);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.35), grey);
  head.position.set(x + 0.4, 8, z);
  scene.add(head);
}

function buildRailway(scene) {
  const [rx] = toWorld(RAILWAY.x, 0);
  const [, zA] = toWorld(0, RAILWAY.y0 - 40);
  const [, zB] = toWorld(0, RAILWAY.y1 + 40);
  const gauge = 1.067;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8a88, metalness: 0.7, roughness: 0.4 });
  for (const off of [-gauge / 2, gauge / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, zB - zA), steel);
    rail.position.set(rx + off, 0.03, (zA + zB) / 2);
    scene.add(rail);
  }
  const wood = new THREE.MeshLambertMaterial({ color: 0x5b4636 });
  const [, zr0] = toWorld(0, RAILWAY.y0);
  const [, zr1] = toWorld(0, RAILWAY.y1);
  for (let z = zA; z < zB; z += 0.65) {
    if (z > zr0 - 0.2 && z < zr1 + 0.2) continue;
    const s = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.22), wood);
    s.position.set(rx, -0.01, z);
    scene.add(s);
  }
  // ballast
  const ballast = new THREE.MeshLambertMaterial({ color: 0x8a857c });
  [[zA, zr0 - 0.3], [zr1 + 0.3, zB]].forEach(([a, b]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, b - a), ballast);
    m.position.set(rx, -0.03, (a + b) / 2);
    scene.add(m);
  });
  // warning devices (踏切警報機) with crossbuck, lights and raised gate arm
  addCrossingSignal(scene, RAILWAY.x - 22, RAILWAY.y0 + 2, 0);
  addCrossingSignal(scene, RAILWAY.x + 22, RAILWAY.y1 + 6, Math.PI);
}

function addCrossingSignal(scene, sx, sy, rot) {
  const [x, z] = toWorld(sx, sy);
  const g = new THREE.Group();
  g.position.set(x, 0.15, z);
  g.rotation.y = rot;
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 256;
  const c = cv.getContext('2d');
  for (let y = 0; y < 256; y += 32) { c.fillStyle = (y / 32) % 2 ? '#111' : '#f5c400'; c.fillRect(0, y, 32, 32); }
  const stripe = new THREE.CanvasTexture(cv);
  stripe.colorSpace = THREE.SRGBColorSpace;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 10), new THREE.MeshLambertMaterial({ map: stripe }));
  pole.position.y = 1.6;
  pole.castShadow = true;
  g.add(pole);
  // crossbuck (yellow/black X)
  const xbMat = new THREE.MeshLambertMaterial({ color: 0xf5c400 });
  [0.7, -0.7].forEach((a) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.03), xbMat);
    b.position.set(0, 2.95, 0.08);
    b.rotation.z = a;
    g.add(b);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.25),
    new THREE.MeshLambertMaterial({ map: textTexture('踏切あり', { w: 256, h: 100, bg: '#f5c400', fg: '#111', font: 'bold 54px sans-serif' }) }));
  sign.position.set(0, 3.35, 0.1);
  g.add(sign);
  // red lamps (off)
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x3b0a0a });
  [-0.3, 0.3].forEach((ox) => {
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    back.position.set(ox, 2.3, 0.08);
    g.add(back);
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), lampMat);
    l.position.set(ox, 2.3, 0.09);
    g.add(l);
  });
  // gate machine + raised boom
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, 0.35), new THREE.MeshLambertMaterial({ color: 0xf5c400 }));
  box.position.set(0.6, 0.5, 0);
  g.add(box);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.08, 5.5, 0.08), new THREE.MeshLambertMaterial({ map: stripe }));
  boom.position.set(0.6, 3.6, 0.15);
  boom.rotation.z = 0.08;
  g.add(boom);
  scene.add(g);
}

function addVegetation(scene, world) {
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 2.2, 6);
  const crownGeo = new THREE.IcosahedronGeometry(1.8, 1);
  const shrubGeo = new THREE.IcosahedronGeometry(0.55, 1);
  const trees = [];
  const addRow = (a, b, spacing, jitter = 1) => {
    const [x0, z0] = toWorld(a[0], a[1]);
    const [x1, z1] = toWorld(b[0], b[1]);
    const L = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 0; s < L; s += spacing) {
      const t = s / L;
      trees.push([x0 + (x1 - x0) * t + (Math.random() - 0.5) * jitter, z0 + (z1 - z0) * t + (Math.random() - 0.5) * jitter, 0.8 + Math.random() * 0.6]);
    }
  };
  addRow([290, 4], [1060, 4], 9);
  addRow([1080, 2], [1150, 90], 8);
  addRow([1160, 102], [1740, 102], 14);
  addRow([1785, 90], [1785, 1350], 7, 0.6);
  addRow([1865, 0], [1865, 1400], 9, 0.6);
  addRow([238, 60], [238, 520], 10);
  addRow([105, 0], [105, 1400], 16);
  // random trees in the fields
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2, r = 230 + Math.random() * 300;
    trees.push([Math.cos(a) * r, Math.sin(a) * r, 1 + Math.random()]);
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a4632 }), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x3f5f2a, flatShading: true }), trees.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  trees.forEach(([x, z, s], i) => {
    m.compose(new THREE.Vector3(x, 1.1 * s, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, 2.9 * s, z), q, new THREE.Vector3(s, s * (0.9 + Math.random() * 0.4), s));
    crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, col.setHSL(0.24 + Math.random() * 0.06, 0.4, 0.22 + Math.random() * 0.1));
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);

  // round trimmed shrubs on the islands (as in the photos)
  const shrubs = [];
  for (const poly of world.islandPolys) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const area = (maxX - minX) * (maxZ - minZ);
    const n = Math.min(14, Math.floor(area / 60));
    let tries = 0;
    for (let k = 0; k < n && tries < 400; tries++) {
      const x = minX + Math.random() * (maxX - minX), z = minZ + Math.random() * (maxZ - minZ);
      if (!pointInPoly(x, z, poly)) continue;
      // keep away from the kerb
      let ok = true;
      for (const [px, pz] of poly) if ((px - x) ** 2 + (pz - z) ** 2 < 2.6 ** 2) { ok = false; break; }
      if (!ok) continue;
      shrubs.push([x, z, heightAt(x, z)]);
      k++;
    }
  }
  const sh = new THREE.InstancedMesh(shrubGeo, new THREE.MeshLambertMaterial({ color: 0x46672d, flatShading: true }), shrubs.length);
  shrubs.forEach(([x, z, h], i) => {
    const s = 0.7 + Math.random() * 0.6;
    m.compose(new THREE.Vector3(x, h + 0.15 + 0.4 * s, z), q, new THREE.Vector3(s, s * 0.85, s));
    sh.setMatrixAt(i, m);
  });
  sh.castShadow = true;
  scene.add(sh);

  // hedges & fence along the north / east boundary
  const hedgeMat = new THREE.MeshLambertMaterial({ color: 0x3e5c2a });
  const hedge = (a, b, h = 1.1, w = 1.2) => {
    const [x0, z0] = toWorld(a[0], a[1]);
    const [x1, z1] = toWorld(b[0], b[1]);
    const L = Math.hypot(x1 - x0, z1 - z0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(L, h, w), hedgeMat);
    mesh.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    mesh.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    mesh.castShadow = true;
    scene.add(mesh);
  };
  hedge([1150, 91], [1745, 91], 1.1, 0.9);
  hedge([1752, 110], [1752, 960], 1.3, 1.0);
  hedge([1075, 8], [1150, 94]);
  hedge([275, 30], [275, 560], 1.0, 1.0);
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0x6d7378, transparent: true, opacity: 0.55 });
  const fence = (a, b) => {
    const [x0, z0] = toWorld(a[0], a[1]);
    const [x1, z1] = toWorld(b[0], b[1]);
    const L = Math.hypot(x1 - x0, z1 - z0);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.8), fenceMat);
    mesh.position.set((x0 + x1) / 2, 0.9, (z0 + z1) / 2);
    mesh.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    mesh.material.side = THREE.DoubleSide;
    scene.add(mesh);
  };
  fence([1150, 84], [1760, 84]);
  fence([1770, 86], [1770, 1000]);
}

function addTower(scene, sx, sy) {
  const [x, z] = toWorld(sx, sy);
  const g = new THREE.Group();
  const red = new THREE.LineBasicMaterial({ color: 0xc8463c });
  const pts = [];
  const H = 55;
  const half = (y) => 3.2 * (1 - y / H) + 0.6;
  for (let y = 0; y < H; y += 4) {
    const a = half(y), b = half(y + 4);
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [p, q] = c[i], [r, s] = c[(i + 1) % 4];
      pts.push(p * a, y, q * a, p * b, y + 4, q * b);         // leg
      pts.push(p * a, y, q * a, r * b, y + 4, s * b);         // brace
      pts.push(p * a, y, q * a, r * a, y, s * a);             // ring
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, red));
  g.position.set(x, 0, z);
  scene.add(g);
}

