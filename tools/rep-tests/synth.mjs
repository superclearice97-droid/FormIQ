// Synthetic workouts built from one real standing pose: rotate/move body parts in 3D, project to the image, add tracking noise.
import fs from 'fs';
const mod = await import('../../reps.js');
const base = JSON.parse(fs.readFileSync('./data/curl_full.json')).frames.filter(f => f.w).sort((a, b) => (b.lm[15].y + b.lm[16].y) - (a.lm[15].y + a.lm[16].y))[0];
const W0 = base.w.map(p => ({ ...p })), asp = 16 / 9, S = 0.42;
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const hipMid = W => ({ x: (W[23].x + W[24].x) / 2, y: (W[23].y + W[24].y) / 2, z: (W[23].z + W[24].z) / 2 });
const UPPER = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
function rotY(W, ids, deg, c) { const a = deg * Math.PI / 180; for (const i of ids) { const x = W[i].x - c.x, z = W[i].z - c.z; W[i].x = c.x + x * Math.cos(a) - z * Math.sin(a); W[i].z = c.z + x * Math.sin(a) + z * Math.cos(a); } }
function rotZ(W, ids, deg, c) { const a = deg * Math.PI / 180; for (const i of ids) { const x = W[i].x - c.x, y = W[i].y - c.y; W[i].x = c.x + x * Math.cos(a) - y * Math.sin(a); W[i].y = c.y + x * Math.sin(a) + y * Math.cos(a); } }
function rotX(W, ids, deg, c) { const a = deg * Math.PI / 180; for (const i of ids) { const y = W[i].y - c.y, z = W[i].z - c.z; W[i].y = c.y + y * Math.cos(a) - z * Math.sin(a); W[i].z = c.z + y * Math.sin(a) + z * Math.cos(a); } }
function liftKnee(W, s, amt) { // amt 0..1: thigh from down to horizontal (forward = -z toward camera)
  const [h, k, a, he, ft] = s === 'l' ? [23, 25, 27, 29, 31] : [24, 26, 28, 30, 32];
  rotX(W, [k, a, he, ft], -90 * amt, W[h]); rotX(W, [a, he, ft], 90 * amt, W[k]);
}
function armsUp(W, amt) { // raise straight arms sideways-up: 0 down, 1 overhead
  for (const [s, ids] of [[11, [13, 15, 17, 19, 21]], [12, [14, 16, 18, 20, 22]]]) rotZ(W, ids, (s === 11 ? 1 : -1) * 170 * amt, W[s]);
}
function frame(W, t, dy = 0) {
  const lm = W.map(p => ({ x: 0.5 + p.x * S / asp + rnd() * 0.006, y: 0.42 + (p.y + dy) * S + rnd() * 0.006, z: p.z * S, visibility: 0.95 }));
  const w = W.map(p => ({ x: p.x + rnd() * 0.01, y: p.y + dy + rnd() * 0.01, z: p.z + rnd() * 0.02 }));
  return { t, lm, w };
}
const gens = {
  stand: (p) => {},
  twist: (p, W) => rotY(W, UPPER, 40 * Math.sin(p), hipMid(W)),
  sidebend: (p, W) => { armsUp(W, 1); rotZ(W, UPPER, 25 * Math.sin(p), hipMid(W)); },
  kneelift: (p, W) => { const s = Math.sin(p); liftKnee(W, s > 0 ? 'l' : 'r', Math.abs(s) * 0.9); },
  jog: (p, W) => { const s = Math.sin(p); liftKnee(W, s > 0 ? 'l' : 'r', Math.abs(s) * 0.35); },
  hipshake: (p, W) => { armsUp(W, 1); const d = 0.07 * Math.sin(p); for (const i of [23, 24, 11, 12, 13, 14, 15, 16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 22]) W[i].x += d; for (const i of [25, 26]) W[i].x += d / 2; },
  armtwist: (p, W) => { armsUp(W, 1); for (const i of [15, 16, 17, 18, 19, 20, 21, 22]) W[i].x += 0.18 * Math.sin(p); },
  armraise: (p, W) => armsUp(W, (1 - Math.cos(p)) / 2),
  frontraise: (p, W) => { const a = 90 * (1 - Math.cos(p)) / 2; rotX(W, [13, 15, 17, 19, 21], -a, W[11]); rotX(W, [14, 16, 18, 20, 22], -a, W[12]); },
  walkfwd: (p, W, t) => { const s = Math.sin(p); liftKnee(W, s > 0 ? 'l' : 'r', Math.abs(s) * 0.25); },
  tree: (p, W) => { liftKnee(W, 'l', 0.6); },
  warrior2: (p, W) => { for (const [s, ids, d] of [[11, [13, 15, 17, 19, 21], -1], [12, [14, 16, 18, 20, 22], 1]]) rotZ(W, ids, d * 85, W[s]);
    const h = hipMid(W); for (const i of UPPER.concat([23, 24])) W[i].y += 0.18; rotX(W, [25, 27, 29, 31], -55, W[23]); rotX(W, [27, 29, 31], 85, W[25]); for (const i of [26, 28, 30, 32]) W[i].x -= 0.15; },
};
const jump = (p) => -Math.max(0, Math.sin(p)) * 0.07;   // body lifts by 7 cm per hop
function run(gen, ex, { hz = 0.6, secs = 12, fps = 30, lead = 1.5, dyf = null, zoom = 0 } = {}) {
  const tr = mod.createTracker(ex); let reps = 0, secsHeld = 0;
  for (let i = 0; i < secs * fps; i++) {
    const t = i * 1000 / fps, p = t / 1000 < lead ? 0 : 2 * Math.PI * hz * (t / 1000 - lead);
    const W = W0.map(q => ({ ...q })); gens[gen](p, W, t);
    if (zoom) { const k = 1 + zoom * t / (secs * 1000); for (const q of W) { q.x *= k; q.y = (q.y - 0.9) * k + 0.9; } }
    const r = tr.update(...Object.values(frame(W, t, dyf ? dyf(p) : 0)).slice(1), t, asp);
    if (r.rep) { reps++; if (r.rep.sec) secsHeld++; }
  }
  return reps;
}
const cycles = (hz, secs, lead = 1.5) => Math.floor(hz * (secs - lead));
const T = [
  ['twist', 'standtwist', 2, {}], ['twist', 'russiantwist', 0, {}],  // russian twist needs sitting
  ['sidebend', 'sidebend', 2, {}], ['kneelift', 'kneelift', 2, {}], ['kneelift', 'highknees', 2, { hz: 1.2 }],
  ['jog', 'jog', 2, { hz: 1.5 }], ['jog', 'highknees', 0, { hz: 1.5 }], ['hipshake', 'hipshake', 2, { hz: 1 }],
  ['armtwist', 'armtwist', 2, {}], ['armtwist', 'armspin', 1, {}], ['armraise', 'armraisecombo', 1, {}], ['armraise', 'jacks', 1, {}],
  ['frontraise', 'frontraise', 1, {}], ['stand', 'jumprope', 1, { hz: 2, dyf: jump }],
  ['stand', 'standtwist', 0, {}], ['stand', 'sidebend', 0, {}], ['stand', 'kneelift', 0, {}], ['stand', 'jog', 0, {}], ['stand', 'jumprope', 0, {}],
  ['stand', 'hipshake', 0, {}], ['stand', 'squat', 0, {}], ['stand', 'jacks', 0, {}], ['stand', 'armtwist', 0, {}],
  ['walkfwd', 'jumprope', 0, { hz: 1, zoom: 0.5 }], ['walkfwd', 'squat', 0, { hz: 1, zoom: 0.5 }], ['walkfwd', 'highknees', 0, { hz: 1, zoom: 0.5 }],
  ['kneelift', 'jumprope', 0, { hz: 1.2 }], ['jog', 'jumprope', 0, { hz: 1.5 }], ['armraise', 'jumprope', 0, {}],
  ['tree', 'tree', 'hold', { secs: 12 }], ['stand', 'tree', 0, { secs: 12 }], ['warrior2', 'warrior2', 'hold', { secs: 12 }], ['stand', 'warrior2', 0, { secs: 12 }],
];
let bad = 0;
for (const [gen, ex, mult, o] of T) {
  const hz = o.hz ?? 0.6, secs = o.secs ?? 12, got = run(gen, ex, o);
  const want = mult === 'hold' ? `~${secs - 2}s` : mult * cycles(hz, secs);
  const ok = mult === 'hold' ? got >= secs - 3 : Math.abs(got - want) <= Math.max(1, want * 0.1);
  if (!ok) bad++;
  console.log(`${(gen + ' as ' + ex).padEnd(28)} want ${String(want).padStart(4)} got ${String(got).padStart(3)} ${ok ? '' : '  <--'}`);
}
console.log('problems:', bad);
