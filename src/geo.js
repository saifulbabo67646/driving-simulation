// Geometry helpers.
//
// All track data is authored in "satellite pixels" (sx, sy) of the reference
// top-down image of the Tobu driving test centre (x to the east, y to the
// south, 1 px ~= 0.115 m). The 3D world uses metres with
//   world.x = east, world.z = south, world.y = up
// and the origin at the centre of the signalised intersection.

export const S = 0.115;            // metres per satellite pixel
export const ORIGIN = [1090, 460]; // sat px of the world origin

export const toWorld = (sx, sy) => [(sx - ORIGIN[0]) * S, (sy - ORIGIN[1]) * S];
export const toSat = (x, z) => [x / S + ORIGIN[0], z / S + ORIGIN[1]];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/** Convert a flat [x0,y0,x1,y1,...] sat-px array into world [[x,z],...]. */
export function flatToWorld(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push(toWorld(flat[i], flat[i + 1]));
  return out;
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Build a smooth path from a list of vertices [x, y, r] (sat px). Each
 * interior vertex with r > 0 is replaced by a circular fillet of radius r
 * (sat px). Returns world-space points [[x, z], ...] sampled every ~0.5 m.
 */
export function filletPath(verts, step = 0.5) {
  const P = verts.map((v) => ({ p: toWorld(v[0], v[1]), r: (v[2] || 0) * S }));
  const pts = [P[0].p];
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1].p, b = P[i].p, c = P[i + 1].p;
    const r = P[i].r;
    if (!r) { pts.push(b); continue; }
    const d1 = norm([b[0] - a[0], b[1] - a[1]]);
    const d2 = norm([c[0] - b[0], c[1] - b[1]]);
    const cos = clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1);
    const theta = Math.acos(cos); // turning angle
    if (theta < 1e-3) { pts.push(b); continue; }
    let t = r * Math.tan(theta / 2);
    const lenIn = dist(a, b), lenOut = dist(b, c);
    t = Math.min(t, lenIn * 0.95, lenOut * 0.95);
    const rr = t / Math.tan(theta / 2);
    const p1 = [b[0] - d1[0] * t, b[1] - d1[1] * t];
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    const side = cross > 0 ? 1 : -1; // +1: turning towards +normal
    const nrm = [-d1[1] * side, d1[0] * side];
    const ctr = [p1[0] + nrm[0] * rr, p1[1] + nrm[1] * rr];
    const a0 = Math.atan2(p1[1] - ctr[1], p1[0] - ctr[0]);
    const n = Math.max(2, Math.ceil((theta * rr) / (step * 0.5)));
    for (let k = 0; k <= n; k++) {
      const ang = a0 + side * theta * (k / n);
      pts.push([ctr[0] + Math.cos(ang) * rr, ctr[1] + Math.sin(ang) * rr]);
    }
  }
  pts.push(P[P.length - 1].p);
  return smooth(resample(pts, step), 4);
}

/** light Laplacian smoothing to remove kinks between straight segments */
export function smooth(pts, passes = 3) {
  let a = pts;
  for (let k = 0; k < passes; k++) {
    const b = [a[0]];
    for (let i = 1; i < a.length - 1; i++) {
      b.push([(a[i - 1][0] + 2 * a[i][0] + a[i + 1][0]) / 4, (a[i - 1][1] + 2 * a[i][1] + a[i + 1][1]) / 4]);
    }
    b.push(a[a.length - 1]);
    a = b;
  }
  return a;
}

export function norm(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Resample a polyline at a fixed spacing. */
export function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = dist(a, b);
    if (L < 1e-6) continue;
    let s = step - carry;
    while (s <= L) {
      const t = s / L;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      s += step;
    }
    carry = L - (s - step);
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.2) out.push(last);
  return out;
}

/**
 * A path with arc-length parametrisation and fast local projection.
 */
export class Path {
  constructor(pts) {
    this.pts = pts;
    this.s = [0];
    for (let i = 1; i < pts.length; i++) this.s.push(this.s[i - 1] + dist(pts[i - 1], pts[i]));
    this.length = this.s[this.s.length - 1];
  }
  /** Position + tangent at arc length s. */
  at(s) {
    s = clamp(s, 0, this.length);
    let lo = 0, hi = this.s.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.s[m] <= s) lo = m; else hi = m;
    }
    const a = this.pts[lo], b = this.pts[hi];
    const seg = this.s[hi] - this.s[lo] || 1;
    const t = (s - this.s[lo]) / seg;
    const d = norm([b[0] - a[0], b[1] - a[1]]);
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d, i: lo };
  }
  /**
   * Project (x, z) to the path, searching segments near index `hint` (or the
   * whole path when hint < 0). Returns {s, lat, dist, i}. lat > 0 means the
   * point is to the right of the direction of travel.
   */
  project(x, z, hint = -1, window = 120) {
    const n = this.pts.length;
    const i0 = hint < 0 ? 0 : Math.max(0, hint - window);
    const i1 = hint < 0 ? n - 1 : Math.min(n - 1, hint + window);
    let best = { d2: Infinity };
    for (let i = i0; i < i1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const vx = b[0] - a[0], vz = b[1] - a[1];
      const L2 = vx * vx + vz * vz || 1e-9;
      let t = ((x - a[0]) * vx + (z - a[1]) * vz) / L2;
      t = clamp(t, 0, 1);
      const px = a[0] + vx * t, pz = a[1] + vz * t;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best.d2) {
        const L = Math.sqrt(L2);
        // right of travel direction in an x-east / z-south frame: (-vz, vx)
        const lat = ((x - px) * -vz + (z - pz) * vx) / L;
        best = { d2, s: this.s[i] + t * L, i, lat };
      }
    }
    best.dist = Math.sqrt(best.d2);
    return best;
  }
  /**
   * Arc length of the first pass of the path near a sat-px anchor point,
   * at or after arc length `after` (the route visits some places twice).
   */
  sOfSat(sx, sy, after = 0, radius = 6) {
    const q = toWorld(sx, sy);
    let first = -1;
    for (let i = 0; i < this.pts.length; i++) {
      if (this.s[i] < after) continue;
      if (dist(this.pts[i], q) < radius) { first = i; break; }
    }
    let bestS = 0, bestD = Infinity;
    const i0 = first >= 0 ? first : 0;
    for (let i = i0; i < this.pts.length; i++) {
      if (this.s[i] < after) continue;
      if (first >= 0 && this.s[i] > this.s[first] + 25) break;
      const d = dist(this.pts[i], q);
      if (d < bestD) { bestD = d; bestS = this.s[i]; }
    }
    return bestS;
  }
}
