# 東部運転免許センター 技能試験シミュレーター
### Tobu Driving License Center (Numazu, Shizuoka) — driving test practice simulator

A browser-based 3D simulator of the **Tobu driving test course** in Numazu, built with
three.js. You sit in the driver's seat of a right-hand-drive automatic test car and drive
the real course layout, following Japanese rules. An examiner gives instructions (Japanese voice + English captions)
and scores you with the usual 減点方式: you start with 100 points and need 70 to pass.

Built for practising the **外国免許切替 (foreign licence conversion)** test. Course 1 is
done. Courses 2–4 will be added from their guide maps.

## Running it

ES modules don't load from `file://`, so serve the folder with any static web server:

| OS | How |
|----|-----|
| Windows | double-click `start-windows.bat` (needs Python 3) |
| macOS / Linux | `./start-mac-linux.sh` or `python3 -m http.server 8080` |
| Anything with Node | `npx serve .` |

Then open <http://localhost:8080/>. Use Chrome or Edge for the best performance and the Japanese voice.
Everything is bundled (three.js is vendored), so it also works offline.

## What's in Course 1 (1コース)

The route follows the official course board (red, then blue line) and the hand-annotated guide map (①–⑨):

1. **発着点 → ①** move off from the departure lane under the canopy and merge into the outer circuit
2. **One clockwise lap** of the outer circuit; accelerate to ~40 km/h on the back straight
3. **②** change to the right-hand lane → **③** turn right into the middle road
4. **Traffic lights:** turn left → **止まれ (post 64):** stop, look both ways, turn left → **④**
5. **S字** (S-curve) → **⑤** turn left at the exit → **traffic lights:** turn right
6. **クランク** (crank) → **⑥** turn left at the T-junction → **⑦** go straight over the intersection
7. **⑧** turn right onto the outermost road → **坂道発進** hill start → **踏切** level crossing (stop + look)
8. Merge back into the circuit → **⑨** pull over to the left → stop at **発着点**, then P + parking brake

The road layout, islands and kerbs come straight from the satellite photo, including the numbered
course posts (1–75), stop signs, crossings, the signalised intersection, the slope and the level crossing.

## Controls

| Key | Action |
|-----|--------|
| ↑ / W | accelerator (hold Shift for more) |
| ↓ / S / Space | brake |
| ← → / A D | steering wheel |
| Q / E | left / right turn signal (cancels itself after a turn, like a real car) |
| Z | left door mirror. Keep holding for a **left shoulder check (目視)** |
| C | right door mirror. Keep holding for a **right shoulder check** |
| X | rear-view mirror |
| right-mouse drag | look around |
| B | seatbelt · G = P↔D (hold the brake) · R reverse · N neutral · P parking brake |
| V | driver / chase / overhead view · M map size · T route line on/off |
| Backspace | (practice) go back to the last checkpoint |
| Esc | pause |

You can also use a gamepad or a steering wheel (G29/G920/T300 and others): stick or wheel to steer, triggers or pedals for throttle and brake,
LB/RB for the signals, X/B to look left/right, Y for the rear-view mirror.

### Modes
* **練習 Practice**: blue route line, green/blue/red **mirror / signal / shoulder-check dots** on the road (same idea as the
  hand-drawn guide map), a "next action" checklist and live demerits.
* **本番 Exam**: examiner voice only, no guidance. You only see the result at the end, or 試験中止 if you fail.

## What the examiner checks

| | |
|---|---|
| 合図 signals | on **30 m** before a turn, **3 s** before a lane change; turned off afterwards |
| 安全確認 safety checks | mirror before signalling, shoulder check right before turning or moving over, left/right at junctions |
| 一時停止 / 踏切 | full stop with the front bumper just before the line, then look left **and** right |
| 信号 | entering on red = 試験中止 (instant fail); amber when you could have stopped = −10 |
| S字 / クランク | ≤ 15 km/h; any wheel over the kerb (脱輪) −20; touching a pole (接触) −20 |
| 坂道発進 | stop on the slope; rolling back ≥ 30 cm −10, ≥ 1 m = 試験中止 |
| speed | over 40 km/h −10; must reach about 40 km/h on the back straight |
| other | lane position, harsh braking, seatbelt, parking brake, pulling in within 30 cm of the kerb at the finish |

The point values follow the common 減点 table but are approximate. The real examiner has the final word.

## Project layout

```
index.html, style.css        UI shell
src/main.js                  app / game loop / menus
src/world.js                 3D course: road texture + markings, kerbs, slope, crossing, signs, scenery
src/car.js                   vehicle physics (AT, slope, creep) + RHD interior + live mirrors
src/examiner.js              rules engine, demerit scoring, traffic lights
src/courses/course1.js       Course 1 route (waypoints in satellite pixels) + examiner events
src/layout.js                fixed course features (lanes, stop lines, crosswalks, posts, signals…)
src/trackData.js             road / island polygons extracted from the satellite photo
src/autopilot.js             dev helper: drives the route like a model student (__sim.autopilot())
tools/extract_track.py       regenerates trackData.js from a satellite screenshot
```

### Adding courses 2–4
Each course is a file in `src/courses/` with a `waypoints` list (`[x, y, filletRadius]` in satellite pixels)
and an `events` list (turns, lane changes, stop lines, lights, narrow sections, hill, finish, instructions).
Register it in `src/courses/index.js` and enable its button in `index.html`.

To check a new route in the browser console:
`__sim.sweep()` lists places where the ideal line would put a wheel over a kerb or hit a pole, and
`__sim.autopilot(true)` drives it like a model student (it should score 100).
