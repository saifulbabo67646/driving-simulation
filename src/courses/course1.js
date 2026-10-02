// 外国免許(普通) 1コース — Tobu driving test centre, Numazu.
//
// Route (follows the official course board, red then blue line, plus the
// hand-annotated guide map ①-⑨):
//   発着点 → ① merge into the outer circuit (lane 1) → one clockwise lap,
//   accelerate on the back straight → ② move to the right lane →
//   ③ right turn into the middle road → signalised intersection: left →
//   止まれ (64): stop, left → ④ top road west → S字 → ⑤ exit left →
//   intersection: right → south road → クランク → ⑥ T-junction left →
//   ⑦ straight over the intersection → ⑧ right onto the outermost road →
//   坂道発進 → 踏切 → merge into the circuit → ⑨ east side → 発着点 (寄せ・停止)
//
// Waypoints are [x, y, filletRadius] in satellite pixels.

import { loopLane, DEPARTURE } from '../layout.js';

const L1 = loopLane(1);
const L2 = loopLane(2);
const LY = DEPARTURE.laneY;
const KERB_Y = 990.5; // pulled over: ~25 cm from the platform kerb

export default {
  id: 'course1',
  name: 'Course 1',
  nameJa: '1コース',
  startHeading: Math.PI, // facing west (sat frame angle)
  waypoints: [
    [925, KERB_Y],
    [600, LY, 60],
    [470, LY, 150],
    [L1.left, L1.top, L1.rTL],
    [L1.right, L1.top, L1.rTR],
    [L1.right, L1.bottom, L1.rBR],
    [1180, L1.bottom, 500],
    [985, L2.bottom, 500],
    [L2.left, L2.bottom, L2.rBL],
    [L2.left, 444.5, 45],
    [1072, 444.5, 40],
    [1072, 188, 35],
    [760, 182],
    [661, 180, 40],
    // S字 centre line (from the satellite skeleton)
    [661, 250], [661, 300], [663, 318], [669, 334], [680, 347], [695, 356], [714, 358],
    [733, 356], [750, 346], [766, 337], [786, 333], [806, 336], [822, 345], [831, 358],
    [836, 375], [838, 395],
    [838, 452, 30],
    [1106, 452, 30],
    [1106, 778, 36],
    // クランク
    [1306, 778, 34],
    [1306, 670, 34],
    [1414, 670, 34],
    [1414, 478, 25],
    [302, 476, 110],
    [302, 42, 100],
    [1045, 42, 70],
    [1130, L1.top, 70],
    [L1.right, L1.top, L1.rTR],
    [L1.right, L1.bottom, L1.rBR],
    [1165, L1.bottom, 80],
    [1050, LY, 80],
    [960, KERB_Y, 60],
    [850, KERB_Y],
  ],

  // Events in driving order. `at` anchors are sat px near the route.
  events: [
    { type: 'start', ja: '準備ができたら発進してください。', en: 'When you are ready, please move off.' },
    { type: 'lanechange', dir: 'right', at: [590, LY], label: '①', note: 'merge',
      ja: '外周に合流します。', en: 'Merge into the outer circuit (keep to the left lane).' },
    { type: 'say', at: [L1.left, 760], ja: '外周を一周します。左側の車線を走ってください。', en: 'One lap of the outer circuit. Stay in the left lane.' },
    { type: 'say', at: [640, L1.top], ja: 'この直線で時速40キロまで加速してください。', en: 'Accelerate to 40 km/h on this straight.' },
    { type: 'accel', from: [700, L1.top], to: [1420, L1.top], target: 40 },
    { type: 'say', at: [1440, L1.top], ja: '減速して、カーブに入ってください。', en: 'Slow down for the curve.' },
    { type: 'say', at: [1530, L1.bottom], ja: '右の車線に進路変更してください。', en: 'Change to the right-hand lane.' },
    { type: 'lanechange', dir: 'right', at: [1180, L1.bottom], label: '②' },
    { type: 'say', at: [L2.left, 790], ja: '次を右折してください。', en: 'Turn right at the next junction.' },
    { type: 'turn', dir: 'right', at: [L2.left, 444.5], label: '③', lookBoth: true },
    { type: 'say', at: [640, 444.5], ja: '信号のある交差点を左折してください。', en: 'Turn left at the traffic lights.' },
    { type: 'light', approach: 'W', line: [1000, 444.5] },
    { type: 'turn', dir: 'left', at: [1072, 444.5], label: '信号左折' },
    { type: 'say', at: [1072, 405], ja: '突き当たりで一時停止して、左折してください。', en: 'Stop at the stop line at the end, then turn left.' },
    { type: 'stop', kind: 'stopsign', line: [1072, 226], label: '止まれ' },
    { type: 'turn', dir: 'left', at: [1072, 188], label: '④' },
    { type: 'say', at: [960, 188], ja: '次を左折して、S字コースに入ってください。', en: 'Turn left into the S-curve.' },
    { type: 'turn', dir: 'left', at: [661, 180], label: 'S字入口' },
    { type: 'narrow', name: 'S字', from: [661, 212], to: [836, 370] },
    { type: 'say', at: [800, 334], ja: '出口を左折してください。', en: 'Turn left at the exit.' },
    { type: 'turn', dir: 'left', at: [838, 452], label: '⑤', lookBoth: true, sig: 12 },
    { type: 'say', at: [880, 452], ja: '信号を右折してください。', en: 'Turn right at the traffic lights.' },
    { type: 'light', approach: 'W', line: [1000, 452] },
    { type: 'turn', dir: 'right', at: [1106, 452], label: '信号右折' },
    { type: 'say', at: [1106, 560], ja: '次を左に曲がって、クランクに入ってください。', en: 'Turn left into the crank.' },
    { type: 'turn', dir: 'left', at: [1106, 778], label: 'クランク入口' },
    { type: 'narrow', name: 'クランク', from: [1128, 778], to: [1415, 645] },
    { type: 'say', at: [1414, 640], ja: '突き当たりを左折してください。', en: 'Turn left at the end of the road.' },
    { type: 'turn', dir: 'left', at: [1414, 478], label: '⑥', lookBoth: true, sig: 12 },
    { type: 'say', at: [1370, 478], ja: '交差点を直進してください。', en: 'Go straight over the intersection.' },
    { type: 'light', approach: 'E', line: [1178, 478], label: '⑦' },
    { type: 'say', at: [880, 478], ja: '突き当たりを右折して、外周の坂道に進んでください。', en: 'At the end, turn right onto the outer road with the hill.' },
    { type: 'turn', dir: 'right', at: [302, 476], label: '⑧', lookBoth: true },
    { type: 'say', at: [302, 260], ja: '坂道の途中で停止して、坂道発進をしてください。', en: 'Stop part-way up the hill, then do a hill start.' },
    { type: 'hill', from: [500, 39], to: [548, 39] },
    { type: 'say', at: [770, 39], ja: '踏切です。一時停止して安全を確認してください。', en: 'Level crossing ahead: stop and check both ways.' },
    { type: 'stop', kind: 'railway', line: [870, 39], label: '踏切' },
    { type: 'lanechange', dir: 'right', at: [1120, 118], label: '合流', note: 'merge' },
    { type: 'say', at: [L1.right, 560], ja: '発着点に戻ります。左に寄せて停止してください。', en: 'Return to the start point. Pull over to the left and stop.' },
    { type: 'lanechange', dir: 'left', at: [1180, L1.bottom], label: '⑨ 寄せ', keepSignal: true },
    { type: 'finish', at: [DEPARTURE.markX, KERB_Y], ja: 'お疲れ様でした。試験を終了します。', en: 'Thank you. That is the end of the test.' },
  ],
};
