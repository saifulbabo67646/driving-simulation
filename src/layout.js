// Static layout of the Tobu (Numazu, Shizuoka) driving test course.
// Everything here is in satellite pixels (see geo.js). Measured from the
// satellite photo and cross-checked with the course guide maps.

import { smoothstep } from './geo.js';

// ---------------------------------------------------------------------------
// Main outer circuit (外周). It is a rounded rectangle; distances below are
// measured outward from the rectangle spanned by the four corner centres.
//   lane 1 (outer, clockwise / 走行車線) | dashed | lane 2 (clockwise / 追越車線)
//   | solid centre line | lane 3 (anti-clockwise) | inner kerb
// ---------------------------------------------------------------------------
export const LOOP = { x0: 601.5, x1: 1562.5, y0: 264, y1: 803.5 };
export const LOOP_R = { outer: 150, dash: 121, center: 91, inner: 61, lane1: 136, lane2: 106, lane3: 76 };
// The corner arcs are concentric with each other but their centre sits
// further inside than the rectangle corner (measured on the diagonal):
// arc radius = offset + LOOP_E[corner].
export const LOOP_E = { TL: 27, TR: 28, BR: 14, BL: 27 };

/** Lane-centre coordinates of the main circuit for lane 1..3 (+ corner fillet radii). */
export function loopLane(n) {
  const r = LOOP_R['lane' + n];
  return {
    left: LOOP.x0 - r, right: LOOP.x1 + r, top: LOOP.y0 - r, bottom: LOOP.y1 + r, r,
    rTL: r + LOOP_E.TL, rTR: r + LOOP_E.TR, rBR: r + LOOP_E.BR, rBL: r + LOOP_E.BL,
  };
}

/** Closed clockwise polyline (sat px) of the circuit at offset R. */
export function loopPolyline(R, seg = 24) {
  const { x0, x1, y0, y1 } = LOOP;
  const E = LOOP_E;
  const pts = [];
  const arc = (cx, cy, e, a0) => {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (Math.PI / 2) * (k / seg);
      pts.push([cx + Math.cos(a) * (R + e), cy + Math.sin(a) * (R + e)]);
    }
  };
  arc(x0 + E.TL, y0 + E.TL, E.TL, Math.PI);          // top-left
  arc(x1 - E.TR, y0 + E.TR, E.TR, -Math.PI / 2);     // top-right
  arc(x1 - E.BR, y1 - E.BR, E.BR, 0);                // bottom-right
  arc(x0 + E.BL, y1 - E.BL, E.BL, Math.PI / 2);      // bottom-left
  pts.push(pts[0]);
  return pts;
}

// ---------------------------------------------------------------------------
// Slope (坂道) on the outermost north road, west of the level crossing.
// ---------------------------------------------------------------------------
export const SLOPE = { x0: 455, x1: 560, x2: 670, x3: 775, yMax: 106, H: 1.4 };

export function slopeProfile(sx) {
  const { x0, x1, x2, x3, H } = SLOPE;
  if (sx <= x0 || sx >= x3) return 0;
  if (sx < x1) return H * smoothstep(x0, x1, sx);
  if (sx <= x2) return H;
  return H * (1 - smoothstep(x2, x3, sx));
}

/** Ground height (m) at a sat-px position. */
export function heightAtSat(sx, sy) {
  if (sy > SLOPE.yMax + 8) return 0;
  const h = slopeProfile(sx);
  if (!h) return 0;
  return h * (1 - smoothstep(SLOPE.yMax, SLOPE.yMax + 8, sy));
}

// ---------------------------------------------------------------------------
// Road markings
// ---------------------------------------------------------------------------
export const CENTER_LINES = [
  // middle east-west road (中央道路)
  [[548, 461], [1000, 461]],
  [[1178, 461], [1622, 461]],
  // north road between the intersection and the top
  [[1089, 202], [1089, 372]],
  // south road
  [[1089, 548], [1089, 864]],
  // east road (between 44/47 and 51/52)
  [[1430, 497], [1430, 845]],
  // outermost north road (IN/OUT + slope + level crossing)
  [[312, 120], [312, 425]],
  [[380, 56], [868, 56]],
  [[908, 56], [1000, 56]],
];

/** Stop lines: [a, b] in sat px (0.45 m wide). */
export const STOP_LINES = [
  [[1055, 226], [1089, 226]],   // north road top, northbound  (止まれ 64)
  [[1089, 372], [1122, 372]],   // north road, southbound into the intersection
  [[1055, 548], [1089, 548]],   // south road, northbound into the intersection
  [[1089, 850], [1122, 850]],   // south road bottom, southbound (止まれ 42)
  [[1000, 428], [1000, 461]],   // middle road, eastbound into the intersection
  [[1178, 461], [1178, 495]],   // middle road, westbound into the intersection
  [[1430, 845], [1465, 845]],   // east road bottom, southbound (止まれ 52)
  [[870, 22], [870, 56]],       // level crossing, eastbound
  [[908, 56], [908, 92]],       // level crossing, westbound
  [[1252, 866], [1252, 897]],   // bottom crosswalk, eastbound
  [[1325, 897], [1325, 955]],   // bottom crosswalk, westbound
];

/** Zebra crossings: rect + direction of the bars ('x' = bars run east-west). */
export const CROSSWALKS = [
  { x0: 1052, y0: 390, x1: 1124, y1: 418, bars: 'y' },
  { x0: 1052, y0: 502, x1: 1124, y1: 530, bars: 'y' },
  { x0: 1016, y0: 428, x1: 1044, y1: 495, bars: 'x' },
  { x0: 1136, y0: 428, x1: 1164, y1: 495, bars: 'x' },
  { x0: 1270, y0: 866, x1: 1300, y1: 955, bars: 'x' },
];

/** 横断歩道あり diamonds: centre + road direction angle (rad, sat frame). */
export const DIAMONDS = [
  [822, 882, 0], [1000, 882, 0],
  [1580, 909, 2.9], [1594, 937, 2.9],
  [1668, 790, 1.75], [1697, 792, 1.75],
];

/** Give-way / junction-ahead triangles. */
export const TRIANGLES = [
  [1088, 180, Math.PI / 2], [517, 462, 0], [1650, 458, Math.PI], [1432, 466, -Math.PI / 2],
  [1088, 885, -Math.PI / 2],
];

export const INTERSECTION = { x0: 1045, y0: 418, x1: 1136, y1: 501, cx: 1090, cy: 460 };

/** Departure lane under the canopy (発着点). */
export const DEPARTURE = { x0: 440, x1: 1142, y0: 958, y1: 1000, laneY: 979, markX: 895 };

/** Level crossing (踏切). */
export const RAILWAY = { x: 888, x0: 876, x1: 900, y0: 14, y1: 98 };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
/** Numbered course posts (ポール番号) as seen on the guide maps. */
export const POSTS = [
  [1, 435, 547], [2, 420, 410], [3, 958, 100], [4, 1120, 30], [5, 1585, 100],
  [10, 689, 856], [11, 690, 790], [13, 699, 512], [14, 627, 512], [20, 769, 512],
  [21, 765, 641], [22, 760, 752], [23, 821, 856], [24, 837, 830], [25, 837, 650], [26, 837, 513],
  [30, 924, 513], [31, 924, 733], [32, 924, 840], [33, 1020, 846], [34, 1037, 804], [35, 1037, 645],
  [40, 1145, 650], [41, 1145, 743], [42, 1145, 846], [43, 1363, 846], [44, 1382, 811],
  [45, 1382, 709], [46, 1382, 600], [47, 1382, 521],
  [50, 1478, 512], [51, 1483, 709], [52, 1496, 835], [53, 1605, 610], [54, 1595, 513],
  [61, 712, 218], [62, 560, 360], [63, 812, 418], [64, 1036, 260],
  [70, 1326, 222], [71, 1242, 222], [72, 1150, 232], [73, 1277, 416], [74, 1476, 416], [75, 1605, 390],
];

/** 止まれ signs: position + the direction their face points (towards traffic). */
export const STOP_SIGNS = [
  { x: 1040, y: 236, face: Math.PI / 2 },   // 64 - faces south (northbound traffic)
  { x: 1140, y: 830, face: -Math.PI / 2 },  // 42 - faces north (southbound traffic)
  { x: 1482, y: 818, face: -Math.PI / 2 },  // 52
];

/** Traffic signals: pole position, arm end (over the lane), facing angle. */
export const SIGNALS = [
  { approach: 'W', x: 1140, y: 420, ax: 1140, ay: 446, face: Math.PI },        // for eastbound
  { approach: 'E', x: 1040, y: 500, ax: 1040, ay: 476, face: 0 },              // for westbound
  { approach: 'N', x: 1132, y: 505, ax: 1106, ay: 505, face: -Math.PI / 2 },   // for southbound
  { approach: 'S', x: 1048, y: 415, ax: 1072, ay: 415, face: Math.PI / 2 },    // for northbound
];

export const PED_SIGNS = [[1245, 852], [1335, 958]];
export const LAMPS = [[1010, 380], [1170, 380], [1010, 540], [1170, 540], [560, 470], [1610, 470]];
