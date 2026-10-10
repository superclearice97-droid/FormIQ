/* FormIQ Ride: gamified indoor rides and runs on a smart bike, trainer or treadmill.
   Virtual routes with hills, pace partners, a ghost of your best time, structured workouts, XP, levels and badges.
   Live power, cadence, speed/pace, heart rate (with zones) and breathing rate (estimated from a chest strap's
   beat-to-beat data). Bikes: optional hill simulation and ERG mode over FTMS. Treadmills: FormIQ never changes
   belt speed; incline follows the route only if the rider turns that on. Everything stays on this device. */
import "./secure.js?v=18";
import { parseFTMS, logWorkout, stravaReady, stravaUploadTcx, saveFile } from "./activity.js?v=18";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = n => String(n).padStart(2, "0");
const hms = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; };
const pace = kmh => kmh > 0.5 ? hms(3600 / kmh) : "–";

/* ---------- settings & progress ---------- */
const SET_KEY = "formiq.ride.settings.v1", PROG_KEY = "formiq.ride.progress.v1", RIDES_KEY = "formiq.rides.v1";
const DEF = { weight: 75, age: 35, maxHr: 0, ftp: 0, easyKmh: 8, difficulty: 50, control: true, autoIncline: false, maxIncline: 8, voice: true };
let cfg = { ...DEF, ...load(SET_KEY, {}) };
const maxHr = () => +cfg.maxHr || Math.round(208 - 0.7 * cfg.age);
const ftp = () => +cfg.ftp || Math.round(cfg.weight * 2.5);
let prog = { xp: 0, badges: [], pbs: {}, rides: 0, ...load(PROG_KEY, {}) };
const xpFor = n => 250 * n * (n - 1);                      // level 2 at 500 XP, 3 at 1,500, 4 at 3,000, 5 at 5,000 …
const levelOf = xp => { let n = 1; while (xp >= xpFor(n + 1)) n++; return n; };
const JERSEYS = [["#1f8a5b", 1, "Team green"], ["#1565c0", 2, "Ocean blue"], ["#ef6c00", 4, "Sunset orange"], ["#8e24aa", 6, "Royal purple"], ["#f9a825", 8, "Gold"]];

/* ---------- routes ---------- */
const SEG = 5;                                             // metres of road per drawn segment
const ROUTES = [
  { id: "lake", name: "Lakeside Loop", level: 1, theme: "lake", blurb: "Flat and friendly, with gentle rollers.",
    sections: [[500, 0, 0], [400, 1.5, 1.5], [300, 0, -1], [500, -2, 0], [600, 0, 1], [400, 2.5, -1.5], [700, 0, 0], [500, -1.5, 2], [400, 0, -2], [600, 2, 0], [500, 0, 0.5], [500, -1, -0.5]] },
  { id: "canyon", name: "Canyon Sprint", level: 1, theme: "desert", blurb: "Short, fast and flat. Go hard.",
    sections: [[600, 0, 0], [500, 3, 0.3], [500, 0, -0.3], [400, -3, 0], [600, 0, 0.5], [500, 2, -0.5], [500, -2, 0], [400, 0, 0]] },
  { id: "pine", name: "Pine Ridge", level: 3, theme: "forest", blurb: "Two real climbs through the pines.",
    sections: [[800, 0, 0], [500, 1, 2], [1200, 0, 6], [400, -2, 3], [600, 0, -4], [700, 2, -3], [500, 0, 0], [600, -1, 2], [900, 1.5, 4], [500, 0, 1], [1000, -2, -4], [800, 0, -5.5], [500, 0, -3.6]] },
  { id: "summit", name: "Summit Road", level: 5, theme: "alpine", blurb: "A long climb above the snow line, then the descent.",
    sections: [[500, 0, 1], [1000, 1, 4], [800, -2, 6], [700, 2, 8], [600, -1.5, 9], [900, 1, 5], [500, 0, 2], [1000, -1, -5], [900, 2, -7], [800, -2, -6], [1300, 1, -4], [1000, 0, -4.5]] },
];
const THEMES = {
  lake: { sky: ["#6fb8e6", "#d9f1ff"], hills: ["#7fb27a", "#5b9460"], grass: ["#4caf50", "#45a24a"], rumble: ["#ffffff", "#d84343"], road: ["#5f6368", "#595d62"], lane: "#ffffff", tree: "round", fog: "#d9f1ff" },
  desert: { sky: ["#f29a54", "#ffe2b8"], hills: ["#c9763f", "#a75b30"], grass: ["#e2b56c", "#d8a95e"], rumble: ["#ffffff", "#8d6e63"], road: ["#6d5d55", "#665750"], lane: "#fff3c4", tree: "cactus", fog: "#ffe2b8" },
  forest: { sky: ["#5a8fba", "#cfe6f7"], hills: ["#2f6b4b", "#24573c"], grass: ["#2f7d46", "#2a7240"], rumble: ["#ffffff", "#2e7d32"], road: ["#55595e", "#505459"], lane: "#ffffff", tree: "pine", fog: "#cfe6f7" },
  alpine: { sky: ["#34437a", "#f0b39d"], hills: ["#e9eef5", "#b8c5d6"], grass: ["#e1e8f0", "#d6dfe9"], rumble: ["#ffffff", "#1565c0"], road: ["#4b4f57", "#464a52"], lane: "#ffffff", tree: "snowpine", fog: "#f0b39d" },
};
function buildRoute(r) {
  const secs = r.sections.slice();
  const net = secs.reduce((t, [l, , g]) => t + l * g / 100, 0);
  if (Math.abs(net) > 0.5) { const len = Math.max(300, Math.round(Math.abs(net) / 0.04 / SEG) * SEG); secs.push([len, 0, -net / len * 100]); }
  const raw = []; for (const [l, c, g] of secs) for (let i = 0; i < Math.round(l / SEG); i++) raw.push({ c, g });
  const N = raw.length, segs = []; let elev = 0;
  for (let i = 0; i < N; i++) {                              // smooth grade and curve so hills and bends ease in
    let sg = 0, sc = 0; for (let k = -10; k <= 10; k++) { const q = raw[(i + k + N) % N]; sg += q.g; sc += q.c; }
    const g = sg / 21; segs.push({ i, curve: sc / 21, y1: elev, y2: elev + SEG * g / 100 }); elev += SEG * g / 100;
  }
  segs.forEach((s, i) => { s.y1 -= elev * i / N; s.y2 -= elev * (i + 1) / N; s.grade = (s.y2 - s.y1) / SEG * 100; s.sprites = []; });
  segs.forEach((s, i) => {
    const h = (i * 2654435761) >>> 0;                         // deterministic scatter
    if (i % 5 === 0) s.sprites.push({ x: -(1.5 + (h % 100) / 60), k: "tree", v: h % 3 });
    if (i % 6 === 3) s.sprites.push({ x: 1.5 + ((h >> 8) % 100) / 60, k: "tree", v: (h >> 4) % 3 });
    if (i % 200 === 0 && i) s.sprites.push({ x: 1.3, k: "km", label: `${(i * SEG / 1000).toFixed(0)} km` });
  });
  let climb = 0; segs.forEach(s => { if (s.y2 > s.y1) climb += s.y2 - s.y1; });
  return { ...r, segs, len: N * SEG, climb, minEl: Math.min(...segs.map(s => s.y1)), maxEl: Math.max(...segs.map(s => s.y1)) };
}
const routes = ROUTES.map(buildRoute);
const wrap = (R, d) => ((d % R.len) + R.len) % R.len;
const segAt = (R, d) => R.segs[Math.floor(wrap(R, d) / SEG) % R.segs.length];
const elevAt = (R, d) => { const p = wrap(R, d) / SEG, s = R.segs[Math.floor(p) % R.segs.length]; return s.y1 + (s.y2 - s.y1) * (p - Math.floor(p)); };

/* ---------- workouts ---------- */
const rep = (n, ...steps) => Array.from({ length: n }, () => steps).flat();
const WORKOUTS = {
  bike: [
    { id: "spin", name: "Easy spin", steps: [[300, .5], [600, .65], [300, .5]] },
    { id: "sweet", name: "Sweet spot builder", steps: [[300, .55], ...rep(3, [360, .88], [180, .55]), [180, .5]] },
    { id: "sprint", name: "Sprint ladder", steps: [[300, .55], ...rep(6, [30, 1.3], [150, .55]), [300, .5]] },
    { id: "pyramid", name: "Pyramid", steps: [[300, .55], [120, .8], [120, .9], [120, 1.0], [120, 1.05], [120, 1.0], [120, .9], [120, .8], [300, .5]] },
  ],
  run: [
    { id: "walkjog", name: "Walk–jog intervals", steps: [[300, .7], ...rep(5, [60, 1.1], [120, .75]), [300, .7]] },
    { id: "steady", name: "Steady run", steps: [[300, .85], [900, 1.0], [300, .85]] },
    { id: "tempo", name: "Tempo builder", steps: [[300, .85], ...rep(3, [240, 1.2], [120, .9]), [300, .8]] },
    { id: "hills", name: "Hill walk", steps: [[240, .7, 1], ...rep(4, [120, .7, 6], [120, .7, 2]), [240, .65, 0]] },
  ],
};
const zoneColor = ["#90a4ae", "#42a5f5", "#66bb6a", "#fdd835", "#fb8c00", "#e53935", "#8e24aa"];
const powerZone = w => { const f = w / ftp(); return f < .55 ? 1 : f < .75 ? 2 : f < .9 ? 3 : f < 1.05 ? 4 : f < 1.2 ? 5 : 6; };
const hrZone = hr => { const f = hr / maxHr(); return f < .6 ? 1 : f < .7 ? 2 : f < .8 ? 3 : f < .9 ? 4 : 5; };

/* ---------- physics ---------- */
export function bikeSpeed(P, gradePct, mass) {
  const th = Math.atan(gradePct / 100), g = 9.81, crr = 0.004, cda = 0.32, rho = 1.225;
  const F = v => mass * g * (crr * Math.cos(th) + Math.sin(th)) * v + 0.5 * rho * cda * v * v * v - P * 0.976;
  let lo = 0, hi = 35; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (F(m) > 0) hi = m; else lo = m; }
  return lo;
}

/* ---------- breathing rate from beat-to-beat (RR) intervals ---------- */
export class BreathEstimator {
  constructor() { this.beats = []; this.rate = null; this.conf = 0; }
  addRR(ms) {
    if (ms < 270 || ms > 2000) return;
    const rec = this.beats.slice(-8).map(b => b.rr);
    if (rec.length >= 4) { const med = rec.slice().sort((a, b) => a - b)[rec.length >> 1]; if (Math.abs(ms - med) / med > 0.25) return; }
    const t = (this.beats.length ? this.beats[this.beats.length - 1].t : 0) + ms / 1000;
    this.beats.push({ t, rr: ms }); while (this.beats.length && this.beats[0].t < t - 64) this.beats.shift();
  }
  estimate() {
    const b = this.beats; if (b.length < 40 || b[b.length - 1].t - b[0].t < 40) return null;
    const fs = 4, t0 = b[0].t, n = Math.floor((b[b.length - 1].t - t0) * fs), x = new Float64Array(n);
    for (let i = 0, j = 0; i < n; i++) {
      const t = t0 + i / fs; while (j < b.length - 2 && b[j + 1].t < t) j++;
      const a = b[j], c = b[j + 1], f = clamp((t - a.t) / (c.t - a.t), 0, 1); x[i] = 60000 / (a.rr + (c.rr - a.rr) * f);
    }
    let sx = 0, sy = 0, sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxy += i * x[i]; sxx += i * i; }
    const sl = (n * sxy - sx * sy) / (n * sxx - sx * sx), ic = (sy - sl * sx) / n;
    for (let i = 0; i < n; i++) x[i] = (x[i] - ic - sl * i) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    const meanHr = 60000 / (b.reduce((s, q) => s + q.rr, 0) / b.length), fmax = Math.min(0.9, meanHr / 60 / 2 * 0.85);
    let best = 0, bf = 0, tot = 0;
    for (let f = 0.1; f <= fmax; f += 0.005) {
      let re = 0, im = 0; const w = 2 * Math.PI * f / fs;
      for (let i = 0; i < n; i++) { re += x[i] * Math.cos(w * i); im -= x[i] * Math.sin(w * i); }
      const p = re * re + im * im; tot += p; if (p > best) { best = p; bf = f; }
    }
    const bins = Math.round((fmax - 0.1) / 0.005) + 1; this.conf = tot ? best / tot * bins / 10 : 0;   // >1 ≈ clear peak
    if (this.conf < 1.2) return this.rate = null;
    const r = bf * 60; this.rate = this.rate ? this.rate * 0.6 + r * 0.4 : r; return this.rate;
  }
}

/* ---------- devices: FTMS machine, heart-rate strap, demo ---------- */
const inp = { power: null, rpm: null, kmh: null, hr: null, kcal: null, incline: null, at: 0, hrAt: 0, rrAt: 0 };
const dev = { machine: null, kind: null, hrDev: null, control: null, feat: { power: false, incline: false, sim: false }, demo: null, q: Promise.resolve() };
const breath = new BreathEstimator();
function chip() {
  const parts = [];
  if (dev.demo) parts.push(`<span class="pill gd">Demo ${dev.kind === "run" ? "treadmill" : "bike"}</span>`);
  if (dev.machine) parts.push(`<span class="pill gd">${esc(dev.machine.name || "Machine")} · ${dev.kind === "run" ? "treadmill" : "bike"}${dev.control ? " · control on" : ""}</span>`);
  if (dev.hrDev) parts.push(`<span class="pill gd">${esc(dev.hrDev.name || "Heart-rate strap")}</span>`);
  $("rideDevices").innerHTML = parts.join(" ") || `<span class="muted">Nothing connected yet.</span>`;
  $("rideStart").disabled = !(dev.machine || dev.demo);
  $("rideKindNote").textContent = dev.machine || dev.demo ? (dev.kind === "run" ? "Treadmill mode: pace, incline and steps." : "Bike mode: power, cadence and virtual hills.") : "";
  renderWorkoutChoices();
}
function msg(t, bad) { const m = $("rideMsg"); m.textContent = t; m.dataset.bad = bad ? "1" : ""; }
const btNeeded = () => msg(window.FormIQNative ? "Bluetooth is off or not allowed. Turn it on and allow Nearby devices for FormIQ." :
  "This browser can't use Bluetooth. Use Chrome on Android, Windows or Mac, or the FormIQ Android app.", true);

function write(bytes) {
  if (!dev.control) return Promise.resolve();
  return dev.q = dev.q.then(() => (dev.control.writeValueWithResponse || dev.control.writeValue).call(dev.control, bytes)).catch(() => {});
}
const cmd = (op, ...vals) => { const b = new DataView(new ArrayBuffer(1 + vals.reduce((t, [n]) => t + n, 0))); b.setUint8(0, op); let o = 1;
  for (const [n, v] of vals) { if (n === 1) b.setUint8(o, v); else b.setInt16(o, v, true); o += n; } return b.buffer; };
const setGrade = g => write(cmd(0x11, [2, 0], [2, Math.round(g * 100)], [1, 40], [1, 51]));      // wind 0, grade, crr .004, cw .51
const setPower = w => write(cmd(0x05, [2, Math.round(w)]));
const setIncline = p => write(cmd(0x03, [2, Math.round(p * 10)]));

async function connectMachine() {
  if (!navigator.bluetooth) return btNeeded();
  try {
    const d = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x1826] }] });
    msg(`Connecting to ${d.name || "machine"}…`);
    const svc = await (await d.gatt.connect()).getPrimaryService(0x1826);
    let ch = null, kind = null;
    for (const [u, k] of [[0x2ad2, "bike"], [0x2acd, "treadmill"], [0x2ace, "cross"]]) { try { ch = await svc.getCharacteristic(u); kind = k; break; } catch {} }
    if (!ch) throw new Error("That machine doesn't share workout data over Bluetooth.");
    stopDemo(); dev.machine = d; dev.kind = kind === "treadmill" ? "run" : "bike"; dev.ftmsKind = kind;
    ch.addEventListener("characteristicvaluechanged", e => onData(parseFTMS(kind, e.target.value)));
    d.addEventListener("gattserverdisconnected", () => { dev.machine = null; dev.control = null; chip(); msg("Machine disconnected.", true); });
    await ch.startNotifications();
    try { const f = await (await svc.getCharacteristic(0x2acc)).readValue(); const t = f.getUint32(4, true);
      dev.feat = { incline: !!(t & 2), power: !!(t & 8), sim: !!(t & 8192) }; } catch { dev.feat = { incline: false, power: false, sim: false }; }
    if (cfg.control || cfg.autoIncline) {
      try { const cp = await svc.getCharacteristic(0x2ad9); await cp.startNotifications(); dev.control = cp; await write(new Uint8Array([0x00]).buffer); } catch { dev.control = null; }
    }
    chip(); msg(`Connected. ${dev.kind === "run" ? "Start walking or running on the treadmill when you begin." : "Pedal to move."}`);
  } catch (e) { if (e.name !== "NotFoundError") msg(e.message || "Couldn't connect.", true); }
}
async function connectHr() {
  if (!navigator.bluetooth) return btNeeded();
  try {
    const d = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x180d] }] });
    const ch = await (await (await d.gatt.connect()).getPrimaryService(0x180d)).getCharacteristic(0x2a37);
    ch.addEventListener("characteristicvaluechanged", e => onHr(e.target.value));
    d.addEventListener("gattserverdisconnected", () => { dev.hrDev = null; chip(); });
    await ch.startNotifications(); dev.hrDev = d; chip(); msg("Heart-rate strap connected. Breathing rate appears after about a minute of data.");
  } catch (e) { if (e.name !== "NotFoundError") msg(e.message || "Couldn't connect.", true); }
}
export function parseHr(dv) {
  const f = dv.getUint8(0); let o = 1; const hr = f & 1 ? dv.getUint16(o, true) : dv.getUint8(o); o += f & 1 ? 2 : 1;
  if (f & 8) o += 2; const rr = []; if (f & 16) for (; o + 1 < dv.byteLength; o += 2) rr.push(dv.getUint16(o, true) / 1024 * 1000);
  return { hr, rr };
}
function onHr(dv) { const { hr, rr } = parseHr(dv); if (hr) { inp.hr = hr; inp.hrAt = performance.now(); } for (const r of rr) breath.addRR(r); if (rr.length) inp.rrAt = performance.now(); }
function onData(d) {
  if (d.watts != null) inp.power = Math.max(0, d.watts); if (d.rpm != null) inp.rpm = d.rpm; if (d.spm != null) inp.rpm = d.spm;
  if (d.kmh != null) inp.kmh = d.kmh; if (d.kcal) inp.kcal = d.kcal; if (d.incline != null) inp.incline = d.incline;
  if (d.hr && !(dev.hrDev && performance.now() - inp.hrAt < 5000)) { inp.hr = d.hr; inp.hrAt = performance.now(); }
  inp.at = performance.now();
}
/* demo machine for trying FormIQ Ride without equipment (clearly labelled) */
function startDemo(kind) {
  stopDemo(); dev.kind = kind; let t = 0, hr = 92, beat = 0;
  dev.demo = setInterval(() => {
    const s = window.__rideScale || 1;
    for (let k = 0; k < s; k++) {
      t += 1;
      const target = kind === "bike" ? 150 + 45 * Math.sin(t / 25) + (live?.target ? (live.target - 150) : 0) : 0;
      const effort = kind === "bike" ? target : (live?.targetKmh || cfg.easyKmh) * 14;
      hr += ((95 + effort * 0.32) - hr) * 0.03;
      onData(kind === "bike" ? { watts: Math.round(target + (Math.random() - .5) * 16), rpm: Math.round(86 + (Math.random() - .5) * 6) }
        : { kmh: live?.targetKmh || cfg.easyKmh, spm: 150 });
      let acc = beat; while (acc < 1000) { const rr = 60000 / hr * (1 + 0.045 * Math.sin(2 * Math.PI * 0.25 * (t + acc / 1000))); breath.addRR(rr); acc += rr; }
      beat = acc - 1000;                                       // carry the partial beat into the next second
      inp.hr = Math.round(hr); inp.hrAt = inp.rrAt = performance.now();
    }
  }, 1000);
  chip(); msg(`Demo ${kind === "bike" ? "bike" : "treadmill"} on. Numbers are simulated so you can try the game.`);
}
function stopDemo() { if (dev.demo) { clearInterval(dev.demo); dev.demo = null; } }

/* ---------- ride state ---------- */
let live = null;
const BOTS = {
  bike: [["Easy Eli", 1.5, "#26a69a"], ["Steady Sam", 2.2, "#5c6bc0"], ["Brisk Bea", 3.0, "#ef5350"], ["Rocket Ro", 4.0, "#ffa000"]],
  run: [["Walker Wren", 5.0, "#26a69a"], ["Jogger Jo", 8.0, "#5c6bc0"], ["Runner Rae", 10.0, "#ef5350"], ["Racer Rex", 12.5, "#ffa000"]],
};
function startRide() {
  const R = routes.find(r => r.id === $("rideRoute").value) || routes[0];
  const mode = $("rideMode").value, kind = dev.kind === "run" ? "run" : "bike";
  const wo = mode === "workout" ? WORKOUTS[kind].find(w => w.id === $("rideWorkout").value) : null;
  const pb = prog.pbs[`${R.id}:${kind}`];
  live = { R, kind, mode, wo, woT: 0, woOn: 0, woSecs: wo ? wo.steps.reduce((t, s) => t + s[0], 0) : 0, d: 0, v: 0, t: 0, climb: 0, lastEl: elevAt(R, 0),
    samples: [], last: performance.now(), sampleAcc: 0, laps: 0, lapStart: 0, trace: [0], pbTrace: pb?.trace || null, pbTime: pb?.time || null,
    bots: mode === "race" ? BOTS[kind].map(([name, val, color], i) => ({ name, val, color, d: 0, v: 0, lane: [-.45, .45, -.2, .2][i] })) : [],
    kcal: 0, work: 0, zoneHr: [0, 0, 0, 0, 0, 0], zonePw: [0, 0, 0, 0, 0, 0, 0], hrHigh: 0, lastGrade: null, lastGradeAt: 0, lastCue: -1,
    target: null, targetKmh: null, crank: 0, start: Date.now(), paused: false, kmCue: 1, beat: false, pb: false, lapTime: null, phase: 0, skyX: 0, startXp: prog.xp };
  $("rideSetup").hidden = true; $("rideSummary").hidden = true; $("rideLive").hidden = false;
  if (live.kind === "run" && cfg.autoIncline && dev.feat.incline && dev.control) msg("Auto-incline is on. Your treadmill's speed is never changed by FormIQ.");
  try { navigator.wakeLock?.request("screen").then(w => live && (live.wake = w)).catch(() => {}); } catch {}
  say(wo ? `${wo.name}. First, ${stepText(wo.steps[0])}.` : `${R.name}. Let's go.`);
  live.timer = setInterval(tick, 250); requestAnimationFrame(frame); resize();
  window.__formiqRide = live;
}
const stepText = s => live?.kind === "run" ? `${hms(s[0])} at ${(s[1] * cfg.easyKmh).toFixed(1)} kilometres an hour${s[2] != null ? `, incline ${s[2]} percent` : ""}` : `${hms(s[0])} at ${Math.round(s[1] * ftp())} watts`;
function say(t) { if (!cfg.voice || !("speechSynthesis" in window)) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.rate = 1.05; speechSynthesis.speak(u); } catch {} }

function tick() {
  const L = live; if (!L) return;
  const now = performance.now(), scale = window.__rideScale || 1; let dt = Math.min(2, (now - L.last) / 1000) * scale; L.last = now;
  if (L.paused) return;
  const fresh = now - inp.at < 5000, grade = segAt(L.R, L.d).grade;
  // workout targets
  let step = null;
  if (L.wo && L.woT < L.woSecs) {
    let acc = 0, idx = 0; for (; idx < L.wo.steps.length; idx++) { if (L.woT < acc + L.wo.steps[idx][0]) break; acc += L.wo.steps[idx][0]; }
    step = L.wo.steps[idx]; L.stepIdx = idx; L.stepLeft = acc + step[0] - L.woT;
    if (L.kind === "bike") L.target = Math.round(step[1] * ftp()); else { L.targetKmh = +(step[1] * cfg.easyKmh).toFixed(1); L.targetIncline = step[2] ?? null; }
    if (idx !== L.lastCue) { L.lastCue = idx; if (idx > 0) say(`Now ${stepText(step)}.`); if (L.kind === "bike" && dev.feat.power && dev.control) setPower(L.target); }
    if (Math.round(L.stepLeft) === 10 && L.wo.steps[idx + 1] && !L.cued10) { L.cued10 = true; say(`Next, ${stepText(L.wo.steps[idx + 1])}.`); } else if (Math.round(L.stepLeft) !== 10) L.cued10 = false;
  } else if (L.wo && L.woT >= L.woSecs && !L.woDone) { L.woDone = true; L.target = L.targetKmh = null; say("Workout complete. Great job."); }
  // movement
  if (L.kind === "bike") {
    const P = fresh && inp.power != null ? inp.power : 0;
    if (inp.power == null && fresh && inp.kmh != null) L.v = inp.kmh / 3.6;
    else { const vt = bikeSpeed(P, grade, +cfg.weight + 9); L.v += (vt - L.v) * Math.min(1, dt / (vt < L.v ? 5 : 2.5)); }
    L.work += P * dt; L.kcal = L.work / 1000;
  } else {
    L.v = fresh && inp.kmh != null ? inp.kmh / 3.6 : 0;
    const kg = +cfg.weight, walk = (inp.kmh || 0) < 7;
    L.kcal += (L.v * dt / 1000) * kg * (walk ? 0.5 : 1.0) + Math.max(0, (inp.incline ?? (cfg.autoIncline ? grade : 0))) / 100 * L.v * dt * kg * 9.81 / 4184 / 0.25;
  }
  const moving = L.v > 0.3 || (L.kind === "bike" && fresh && inp.power > 0);
  if (moving) {
    L.t += dt; if (L.wo) { L.woT += dt; if (step) { const ok = L.kind === "bike" ? Math.abs((inp.power || 0) - L.target) <= L.target * 0.1 : Math.abs((inp.kmh || 0) - L.targetKmh) <= 0.5; if (ok) L.woOn += dt; } }
    if (inp.hr && now - inp.hrAt < 5000) { L.zoneHr[hrZone(inp.hr)] += dt; if (inp.hr > 0.95 * maxHr()) { L.hrHigh += dt; if (L.hrHigh > 10 && now - (L.hrWarnAt || 0) > 60000) { L.hrWarnAt = now; say("Heart rate is very high. Ease off."); } } else L.hrHigh = 0; }
    if (L.kind === "bike" && inp.power != null) L.zonePw[powerZone(inp.power)] += dt;
  }
  L.d += L.v * dt;
  const el = elevAt(L.R, L.d); if (el > L.lastEl) L.climb += el - L.lastEl; L.lastEl = el;
  L.skyX += segAt(L.R, L.d).curve * L.v * dt * 0.004;
  L.crank += ((inp.rpm || 0) / 60) * 2 * Math.PI * dt / scale;
  // lap, PB trace and ghost
  while (L.trace.length * 50 <= L.d - L.lapStart && L.laps === 0) L.trace.push(L.t);
  if (L.d - L.lapStart >= L.R.len) {
    const lapT = L.t - (L.lapT0 || 0); L.laps++; L.lapStart += L.R.len; L.lapT0 = L.t;
    if (L.laps === 1) { L.lapTime = lapT; const key = `${L.R.id}:${L.kind}`;
      if (!L.pbTime || lapT < L.pbTime) { L.pb = true; prog.pbs[key] = { time: lapT, trace: L.trace.slice(0, Math.ceil(L.R.len / 50) + 1), at: Date.now() }; save(PROG_KEY, prog); say(`New personal best on ${L.R.name}: ${hms(lapT)}.`); }
      else say(`Lap done in ${hms(lapT)}.`); }
  }
  if (L.d / 1000 >= L.kmCue) { if (!L.wo) say(`${L.kmCue} kilometre${L.kmCue > 1 ? "s" : ""}. ${L.kind === "bike" ? `Average ${Math.round(L.work / Math.max(1, L.t))} watts.` : `Pace ${pace(L.d / Math.max(1, L.t) * 3.6).replace(":", " minutes ")} seconds per kilometre.`}`); L.kmCue++; }
  // bots
  for (const b of L.bots) {
    if (L.t < 1) continue;
    const g = segAt(L.R, b.d).grade;
    b.v = L.kind === "bike" ? bikeSpeed(b.val * 75 * (1 + 0.04 * Math.sin(b.d / 300)), g, 84) : b.val / 3.6 * (1 - clamp(g, -5, 10) * 0.025);
    b.d += b.v * dt;
  }
  if (L.bots.length && !L.beat && L.t > 60) L.beat = L.bots.some(b => L.d > b.d + 20 && b.val >= (L.kind === "bike" ? 2.2 : 8));
  // trainer control
  if (dev.control && dev.machine) {
    const want = L.kind === "bike" ? (L.wo && dev.feat.power ? null : grade * cfg.difficulty / 100) :
      (cfg.autoIncline && dev.feat.incline ? clamp(L.targetIncline ?? grade, 0, +cfg.maxIncline) : null);
    if (want != null && (L.lastGrade == null || (Math.abs(want - L.lastGrade) >= 0.5 && now - L.lastGradeAt > 1000) || now - L.lastGradeAt > 10000)) {
      L.lastGrade = want; L.lastGradeAt = now; if (L.kind === "bike") { if (dev.feat.sim) setGrade(want); } else setIncline(Math.round(want * 2) / 2);
    }
  }
  // samples once a second
  L.sampleAcc += dt;
  while (L.sampleAcc >= 1) { L.sampleAcc -= 1; L.samples.push({ t: Math.round(L.t), d: Math.round(L.d), p: L.kind === "bike" ? Math.round(inp.power || 0) : null, c: inp.rpm ? Math.round(inp.rpm) : null,
    v: +(L.v * 3.6).toFixed(1), hr: inp.hr && now - inp.hrAt < 5000 ? inp.hr : null, br: breath.rate ? Math.round(breath.rate) : null, el: +el.toFixed(1) });
    if (L.samples.length % 5 === 0 && now - inp.rrAt < 5000) breath.estimate(); }
  hud();
}
function hud() {
  const L = live, now = performance.now(), hrOk = inp.hr && now - inp.hrAt < 5000, kmh = L.v * 3.6;
  const big = L.kind === "bike" ? [`${Math.round(inp.power || 0)}`, "watts", inp.power ? zoneColor[powerZone(inp.power)] : null] : [pace(kmh), "min/km", null];
  const z = hrOk ? hrZone(inp.hr) : 0;
  const br = now - inp.rrAt < 8000 && breath.rate ? `${Math.round(breath.rate)}` : "–";
  $("hudMain").innerHTML = `<b style="${big[2] ? `color:${big[2]}` : ""}">${big[0]}</b><span>${big[1]}</span>`;
  $("hudGrid").innerHTML = [
    L.kind === "bike" ? ["Speed", `${kmh.toFixed(1)}`, "km/h"] : ["Speed", `${kmh.toFixed(1)}`, "km/h"],
    L.kind === "bike" ? ["Cadence", inp.rpm ? Math.round(inp.rpm) : "–", "rpm"] : ["Incline", inp.incline != null ? inp.incline.toFixed(1) : (cfg.autoIncline ? Math.max(0, segAt(L.R, L.d).grade).toFixed(1) : "0.0"), "%"],
    ["Heart", hrOk ? inp.hr : "–", hrOk ? `bpm · Z${z}` : "bpm", hrOk ? zoneColor[z] : null],
    ["Breathing", br, "br/min", null, "Estimated from a chest strap's beat-to-beat data"],
    ["Time", hms(L.t), ""], ["Distance", (L.d / 1000).toFixed(2), "km"], ["Climbed", Math.round(L.climb), "m"],
    L.kind === "bike" ? ["W/kg", ((inp.power || 0) / cfg.weight).toFixed(1), ""] : ["Calories", Math.round(L.kcal), "kcal"],
  ].map(([k, v, u, c, title]) => `<div class="hstat"${title ? ` title="${title}"` : ""}><span>${k}</span><b${c ? ` style="color:${c}"` : ""}>${v}</b><i>${u}</i></div>`).join("");
  const grade = segAt(L.R, L.d).grade;
  $("hudGrade").textContent = `${grade >= 0 ? "▲" : "▼"} ${Math.abs(grade).toFixed(1)}%`;
  $("hudGrade").dataset.steep = grade > 4 ? "up" : grade < -2 ? "down" : "";
  $("hudWarn").hidden = !(L.hrHigh > 10);
  // workout bar
  if (L.wo) {
    const tot = L.woSecs; let acc = 0;
    $("woBar").hidden = false;
    $("woBar").innerHTML = L.wo.steps.map(s => { const w = s[0] / tot * 100, h = clamp(s[1] / 1.4, .2, 1) * 100; const zc = L.kind === "bike" ? zoneColor[powerZone(s[1] * ftp())] : zoneColor[clamp(Math.round(s[1] * 4) - 1, 1, 6)]; acc += s[0];
      return `<i style="width:${w}%;height:${h}%;background:${zc}"></i>`; }).join("") + `<em style="left:${clamp(L.woT / tot * 100, 0, 100)}%"></em>`;
    const st = L.wo.steps[L.stepIdx || 0];
    $("woText").textContent = L.woDone ? `Workout complete · on target ${Math.round(L.woOn / Math.max(1, L.woSecs) * 100)}%` :
      `${L.kind === "bike" ? `Target ${L.target} W` : `Target ${L.targetKmh} km/h${L.targetIncline != null ? ` · incline ${L.targetIncline}%` : ""}`} · ${hms(L.stepLeft || 0)} left${L.wo.steps[(L.stepIdx || 0) + 1] ? ` · next ${L.kind === "bike" ? Math.round(L.wo.steps[L.stepIdx + 1][1] * ftp()) + " W" : (L.wo.steps[L.stepIdx + 1][1] * cfg.easyKmh).toFixed(1) + " km/h"}` : ""}`;
    const on = L.kind === "bike" ? Math.abs((inp.power || 0) - (L.target || 0)) <= (L.target || 0) * 0.1 : Math.abs((inp.kmh || 0) - (L.targetKmh || 0)) <= 0.5;
    $("woText").dataset.on = L.woDone ? "" : on ? "1" : "0";
  } else { $("woBar").hidden = true; $("woText").textContent = ""; }
  // leaderboard
  const rows = [{ name: "You", d: L.d, me: true, color: cfg.jersey || "#1f8a5b" }, ...L.bots.map(b => ({ name: b.name, d: b.d, color: b.color, sub: L.kind === "bike" ? `${b.val} W/kg` : `${pace(b.val)}/km` }))];
  if (L.pbTrace && L.laps === 0) rows.push({ name: "Your best", d: ghostD(L), color: "#9e9e9e", ghost: true });
  rows.sort((a, b) => b.d - a.d);
  $("rideBoard").innerHTML = rows.length > 1 ? rows.map(r => { const gap = r.d - L.d; return `<li${r.me ? ' class="me"' : ""}><i style="background:${r.color}"></i><span>${esc(r.name)}${r.sub ? ` <small>${r.sub}</small>` : ""}</span><b>${r.me ? `${(L.d / 1000).toFixed(2)} km` : `${gap >= 0 ? "+" : "−"}${Math.abs(Math.round(gap))} m`}</b></li>`; }).join("") : "";
  drawMini();
}
function ghostD(L) {
  const tr = L.pbTrace; if (!tr) return 0; if (L.t >= tr[tr.length - 1]) return L.R.len;
  let i = 1; while (i < tr.length && tr[i] < L.t) i++; const a = tr[i - 1], b = tr[i]; return ((i - 1) + (L.t - a) / Math.max(0.001, b - a)) * 50;
}

/* ---------- drawing: pseudo-3D road ---------- */
const CAM_H = 1000, ROAD_W = 2000, SEG_W = 200, DRAW = 200, DEPTH = 1 / Math.tan(50 * Math.PI / 180), EL = 40 * 1.4;
let ctx = null, W = 0, H = 0;
function resize() {
  const c = $("rideCanvas"); if (!c) return; const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  W = c.width = Math.round(r.width * dpr); H = c.height = Math.round(r.height * dpr); ctx = c.getContext("2d");
}
function poly(x1, y1, x2, y2, x3, y3, x4, y4, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill(); }
function frame() {
  if (!live) return; if (!ctx) resize();
  try { draw(); } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}
function draw() {
  const L = live, R = L.R, T = THEMES[R.theme], N = R.segs.length, track = N * SEG_W;
  const sky = ctx.createLinearGradient(0, 0, 0, H * .62); sky.addColorStop(0, T.sky[0]); sky.addColorStop(1, T.sky[1]); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  hills(T.hills[0], H * .5, H * .1, 0.0019, L.skyX * 0.3, 0.6); hills(T.hills[1], H * .56, H * .07, 0.004, L.skyX * 0.6, 2.1);
  const pos = (wrap(R, L.d) / SEG) * SEG_W, bi = Math.floor(pos / SEG_W) % N, pct = (pos % SEG_W) / SEG_W, base = R.segs[bi];
  const camY = (base.y1 + (base.y2 - base.y1) * pct) * EL + CAM_H;
  let x = 0, dx = -(base.curve * pct), maxy = H; const P = [];
  const proj = (tx, ty, tz) => { const s = DEPTH / tz; return { s, X: W / 2 + s * tx * W / 2, Y: H / 2 - s * ty * H / 2, w: s * ROAD_W * W / 2, z: tz }; };
  for (let n = 0; n < DRAW; n++) {
    const i = (bi + n) % N, s = R.segs[i], camZ = pos - (i < bi ? track : 0);
    const p1 = proj(x, s.y1 * EL - camY, i * SEG_W - camZ), p2 = proj(x + dx, s.y2 * EL - camY, (i + 1) * SEG_W - camZ);
    x += dx; dx += s.curve; P.push({ s, p1, clip: maxy, n });
    if (p1.z <= DEPTH || p2.Y >= p1.Y || p2.Y >= maxy) continue;
    const st = Math.floor(i / 3) % 2;
    const y1 = p1.Y + 1, y2 = p2.Y - 0.5;                    // overlap neighbouring strips slightly so no seams show
    ctx.fillStyle = T.grass[st]; ctx.fillRect(0, y2, W, y1 - y2);
    poly(p1.X - p1.w * 1.12, y1, p1.X + p1.w * 1.12, y1, p2.X + p2.w * 1.12, y2, p2.X - p2.w * 1.12, y2, T.rumble[st]);
    poly(p1.X - p1.w, y1, p1.X + p1.w, y1, p2.X + p2.w, y2, p2.X - p2.w, y2, T.road[st]);
    if (st) { const l1 = p1.w / 36, l2 = p2.w / 36; poly(p1.X - l1, y1, p1.X + l1, y1, p2.X + l2, y2, p2.X - l2, y2, T.lane); }
    const fog = Math.pow(n / DRAW, 2.2); if (fog > 0.02) { ctx.globalAlpha = fog * 0.85; ctx.fillStyle = T.fog; ctx.fillRect(0, p2.Y, W, p1.Y - p2.Y + 1); ctx.globalAlpha = 1; }
    maxy = p2.Y;
  }
  // riders ahead on the road (bots and ghost)
  const others = L.bots.map(b => ({ d: b.d, color: b.color, name: b.name, lane: b.lane }));
  if (L.pbTrace && L.laps === 0) others.push({ d: ghostD(L), color: "rgba(255,255,255,.55)", name: "Your best", lane: 0.3, ghost: true });
  const byN = {}; for (const o of others) { let rel = o.d - L.d; if (rel < 3 || rel > DRAW * SEG) continue; const n = Math.floor(rel / SEG); (byN[n] ||= []).push({ ...o, f: (rel / SEG) - n }); }
  for (let n = P.length - 1; n > 0; n--) {
    const e = P[n]; if (e.p1.z <= DEPTH) continue;
    for (const sp of e.s.sprites) sprite(e, sp.x, sp, T);
    for (const o of byN[n] || []) rider(e, o);
  }
  me(L);
}
function hills(color, y, amp, freq, off, seed) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) { const t = x * freq * (1000 / W) + off; ctx.lineTo(x, y - amp * (0.6 * Math.sin(t + seed) + 0.3 * Math.sin(t * 2.3 + seed * 2) + 0.4)); }
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
}
function clipTo(e, fn) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, e.clip); ctx.clip(); fn(); ctx.restore(); }
function sprite(e, sx, sp, T) {
  const s = e.p1.s, X = e.p1.X + s * sx * ROAD_W * W / 2, Y = e.p1.Y, k = s * W / 2;
  if (X < -W * .2 || X > W * 1.2) return;
  clipTo(e, () => {
    if (sp.k === "km") { const h = 900 * k, w = 420 * k; ctx.fillStyle = "#37474f"; ctx.fillRect(X - w * .04, Y - h, w * .08, h); ctx.fillStyle = "#1f8a5b"; ctx.fillRect(X - w / 2, Y - h, w, h * .32);
      if (w > 30) { ctx.fillStyle = "#fff"; ctx.font = `800 ${Math.round(h * .16)}px "Barlow Condensed", sans-serif`; ctx.textAlign = "center"; ctx.fillText(sp.label, X, Y - h * .78); } return; }
    const h = (1300 + sp.v * 350) * k, w = h * .5;
    if (T.tree === "cactus") { ctx.fillStyle = "#4e8b3a"; ctx.fillRect(X - w * .1, Y - h * .8, w * .2, h * .8); ctx.fillRect(X - w * .35, Y - h * .55, w * .25, w * .1); ctx.fillRect(X - w * .35, Y - h * .7, w * .1, h * .2);
      ctx.fillRect(X + w * .1, Y - h * .45, w * .25, w * .1); ctx.fillRect(X + w * .25, Y - h * .62, w * .1, h * .2); return; }
    ctx.fillStyle = "#5d4037"; ctx.fillRect(X - w * .06, Y - h * .3, w * .12, h * .3);
    if (T.tree === "round") { ctx.fillStyle = ["#2e7d32", "#388e3c", "#43a047"][sp.v]; ctx.beginPath(); ctx.ellipse(X, Y - h * .62, w * .55, h * .4, 0, 0, 7); ctx.fill(); return; }
    ctx.fillStyle = T.tree === "snowpine" ? "#2e5e4e" : ["#1b5e20", "#2e7d32", "#245c2b"][sp.v];
    for (let t = 0; t < 3; t++) { const ty = Y - h * (.25 + t * .25); ctx.beginPath(); ctx.moveTo(X - w * (.55 - t * .12), ty); ctx.lineTo(X + w * (.55 - t * .12), ty); ctx.lineTo(X, ty - h * .38); ctx.closePath(); ctx.fill(); }
    if (T.tree === "snowpine") { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(X - w * .16, Y - h * .9); ctx.lineTo(X + w * .16, Y - h * .9); ctx.lineTo(X, Y - h * 1.01); ctx.closePath(); ctx.fill(); }
  });
}
function rider(e, o) {
  const s = e.p1.s, X = e.p1.X + s * o.lane * ROAD_W * W / 2, Y = e.p1.Y, k = s * W / 2, h = 420 * k, w = h * .5;
  if (h < 2) return;
  clipTo(e, () => {
    ctx.globalAlpha = o.ghost ? 0.45 : 1;
    ctx.fillStyle = "#212121"; ctx.fillRect(X - w * .05, Y - h * .4, w * .1, h * .4);             // rear wheel, seen from behind
    ctx.fillStyle = "#37474f"; ctx.fillRect(X - w * .2, Y - h * .55, w * .12, h * .3); ctx.fillRect(X + w * .08, Y - h * .55, w * .12, h * .3);   // legs
    ctx.fillStyle = o.ghost ? "#ffffff" : o.color;
    ctx.beginPath(); ctx.moveTo(X - w * .3, Y - h * .55); ctx.lineTo(X + w * .3, Y - h * .55); ctx.lineTo(X + w * .24, Y - h * .9); ctx.lineTo(X - w * .24, Y - h * .9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#263238"; ctx.beginPath(); ctx.ellipse(X, Y - h * .97, w * .16, h * .08, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    if (h > 40) { ctx.font = `600 ${Math.round(clamp(h * .22, 11, 22))}px "IBM Plex Sans", sans-serif`; ctx.textAlign = "center"; ctx.fillStyle = "rgba(0,0,0,.55)";
      const fh = clamp(h * .2, 14, 28), tw = ctx.measureText(o.name).width + 10; ctx.fillRect(X - tw / 2, Y - h * 1.1 - fh, tw, fh); ctx.fillStyle = "#fff"; ctx.fillText(o.name, X, Y - h * 1.1 - fh * .25); }
  });
}
function me(L) {
  const h = H * .3, X = W / 2, Y = H - H * .02, w = h * .5, c = cfg.jersey || "#1f8a5b", ph = L.crank;
  ctx.save(); ctx.lineCap = "round";
  if (L.kind === "bike") {
    ctx.fillStyle = "#1c1c1c"; ctx.fillRect(X - w * .05, Y - h * .42, w * .1, h * .42);
    for (const sgn of [-1, 1]) { const up = Math.sin(ph + (sgn < 0 ? 0 : Math.PI)) * h * .07; ctx.strokeStyle = "#37474f"; ctx.lineWidth = w * .13;
      ctx.beginPath(); ctx.moveTo(X + sgn * w * .14, Y - h * .62); ctx.lineTo(X + sgn * w * .2, Y - h * .42 + up); ctx.lineTo(X + sgn * w * .12, Y - h * .2 + up); ctx.stroke(); }
  } else {
    for (const sgn of [-1, 1]) { const sw = Math.sin(ph / 2 + (sgn < 0 ? 0 : Math.PI)); ctx.strokeStyle = "#37474f"; ctx.lineWidth = w * .14;
      ctx.beginPath(); ctx.moveTo(X + sgn * w * .12, Y - h * .55); ctx.lineTo(X + sgn * w * .14, Y - h * .28 - sw * h * .05); ctx.lineTo(X + sgn * w * .13, Y - h * .02 - Math.max(0, sw) * h * .08); ctx.stroke(); }
  }
  ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(X - w * .36, Y - h * .62); ctx.lineTo(X + w * .36, Y - h * .62); ctx.lineTo(X + w * .3, Y - h * .98); ctx.lineTo(X - w * .3, Y - h * .98); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = c; ctx.lineWidth = w * .1; for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(X + sgn * w * .3, Y - h * .95); ctx.lineTo(X + sgn * w * .42, Y - h * .7); ctx.stroke(); }
  ctx.fillStyle = "#263238"; ctx.beginPath(); ctx.ellipse(X, Y - h * 1.06, w * .19, h * .1, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function drawMini() {
  const c = $("rideMini"), L = live; if (!c || !L) return;
  const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1), w = c.width = Math.round(r.width * dpr), h = c.height = Math.round(r.height * dpr), g = c.getContext("2d");
  const R = L.R, span = Math.max(20, R.maxEl - R.minEl), y = e => h - 6 * dpr - (e - R.minEl) / span * (h - 22 * dpr), step = Math.max(1, Math.floor(R.segs.length / w));
  const css = getComputedStyle(c), fg = css.getPropertyValue("--muted") || "#888", acc = css.getPropertyValue("--accent") || "#1f8a5b";
  g.fillStyle = fg; g.globalAlpha = .25; g.beginPath(); g.moveTo(0, h);
  for (let i = 0; i < R.segs.length; i += step) g.lineTo(i / R.segs.length * w, y(R.segs[i].y1)); g.lineTo(w, h); g.closePath(); g.fill(); g.globalAlpha = 1;
  const fx = wrap(R, L.d) / R.len * w; g.save(); g.beginPath(); g.rect(0, 0, fx, h); g.clip(); g.fillStyle = acc; g.globalAlpha = .45; g.beginPath(); g.moveTo(0, h);
  for (let i = 0; i < R.segs.length; i += step) g.lineTo(i / R.segs.length * w, y(R.segs[i].y1)); g.lineTo(w, h); g.closePath(); g.fill(); g.restore();
  const dot = (d, col, rad) => { const xx = wrap(R, d) / R.len * w; g.fillStyle = col; g.beginPath(); g.arc(xx, y(elevAt(R, d)), rad * dpr, 0, 7); g.fill(); };
  for (const b of L.bots) dot(b.d, b.color, 4); if (L.pbTrace && L.laps === 0) dot(ghostD(L), "#9e9e9e", 4); dot(L.d, cfg.jersey || "#1f8a5b", 6);
  g.fillStyle = fg; g.font = `${11 * dpr}px "IBM Plex Sans", sans-serif`; g.fillText(`${(R.len / 1000).toFixed(1)} km · ${Math.round(R.climb)} m climbing · lap ${L.laps + 1}`, 6 * dpr, 13 * dpr);
}

/* ---------- finish, rewards, files ---------- */
const BADGES = [
  ["first", "First ride", "Finish any ride or run", r => true],
  ["k10", "Ten kilometres", "10 km in one session", r => r.km >= 10],
  ["climb100", "Hill climber", "Climb 100 m in one session", r => r.climb >= 100],
  ["hour", "Hour of power", "Go for 60 minutes", r => r.minutes >= 60],
  ["pb", "Personal best", "Beat your best time on a route", r => r.pb],
  ["stars", "Three stars", "Stay on target for 85% of a workout", r => r.stars === 3],
  ["beat", "Pace partner beaten", "Finish ahead of Steady Sam or faster", r => r.beat],
  ["z2", "Endurance engine", "20 minutes in heart-rate zone 2", r => r.z2 >= 20],
  ["summit", "Summit", "Complete a lap of Summit Road", r => r.route === "summit" && r.laps >= 1],
];
function endRide() {
  const L = live; if (!L) return; live = null; clearInterval(L.timer); try { L.wake?.release(); } catch {}
  if (dev.control) { if (L.kind === "bike") setGrade(0); else if (cfg.autoIncline) setIncline(0); }
  const km = L.d / 1000, minutes = L.t / 60, hrs = L.samples.filter(s => s.hr), pw = L.samples.filter(s => s.p != null);
  const avg = (a, k) => a.length ? Math.round(a.reduce((t, s) => t + s[k], 0) / a.length) : null;
  const stars = L.wo ? (L.woOn / Math.max(1, Math.min(L.woT, L.woSecs)) >= .85 ? 3 : L.woOn / Math.max(1, L.woT) >= .65 ? 2 : 1) : null;
  const r = { id: "ride-" + L.start, at: L.start, route: L.R.id, routeName: L.R.name, kind: L.kind, km, minutes, climb: Math.round(L.climb), laps: L.laps, lapTime: L.lapTime,
    pb: L.pb, beat: L.beat, stars, workout: L.wo?.name || null, kcal: Math.round(inp.kcal && L.kind === "run" ? Math.max(L.kcal, inp.kcal) : L.kcal),
    avgP: avg(pw, "p"), maxP: pw.length ? Math.max(...pw.map(s => s.p)) : null, avgHr: avg(hrs, "hr"), maxHr: hrs.length ? Math.max(...hrs.map(s => s.hr)) : null,
    avgC: avg(L.samples.filter(s => s.c), "c"), avgBr: avg(L.samples.filter(s => s.br), "br"), z2: L.zoneHr[2] / 60, demo: !!dev.demo };
  if (L.t < 30 || km < 0.05) { showSetup(); msg("Ride was too short to save."); return; }
  // XP: distance, climbing, finishing a lap, PB, workouts
  let xp = Math.round(km * (L.kind === "bike" ? 20 : 60) + L.climb / 5 + L.laps * 100 + (L.pb ? 200 : 0) + (stars ? stars * 50 : 0));
  if (r.demo) xp = Math.min(xp, 50);
  const before = levelOf(prog.xp); prog.xp += xp; prog.rides++;
  const newBadges = r.demo ? [] : BADGES.filter(([id, , , test]) => !prog.badges.includes(id) && test(r)).map(b => b[0]);
  prog.badges.push(...newBadges); prog.xp += newBadges.length * 50; save(PROG_KEY, prog);
  const rides = load(RIDES_KEY, []); rides.unshift(r); save(RIDES_KEY, rides.slice(0, 200));
  if (!r.demo) logWorkout({ id: r.id, source: "FormIQ Ride", type: L.kind === "bike" ? "Virtual ride" : (L.d / Math.max(1, L.t) * 3.6 < 7 ? "Treadmill walk" : "Treadmill run"), name: L.R.name,
    start: L.start, minutes: Math.round(minutes), km, kcal: r.kcal }, L.kind === "run" ? Math.round(L.d / ((L.d / Math.max(1, L.t) * 3.6) > 7 ? 1.1 : 0.75)) : 0);
  lastRide = { r, samples: L.samples };
  showSummary(r, xp + newBadges.length * 50, levelOf(prog.xp) > before, newBadges);
}
let lastRide = null;
function tcx({ r, samples }) {
  const t0 = r.at, iso = s => new Date(t0 + s * 1000).toISOString();
  const pts = samples.map(s => `<Trackpoint><Time>${iso(s.t)}</Time><AltitudeMeters>${s.el}</AltitudeMeters><DistanceMeters>${s.d}</DistanceMeters>${s.hr ? `<HeartRateBpm><Value>${s.hr}</Value></HeartRateBpm>` : ""}${s.c != null && r.kind === "bike" ? `<Cadence>${s.c}</Cadence>` : ""}<Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Speed>${(s.v / 3.6).toFixed(2)}</Speed>${s.p != null ? `<Watts>${s.p}</Watts>` : ""}${s.c != null && r.kind === "run" ? `<RunCadence>${Math.round(s.c / 2)}</RunCadence>` : ""}</TPX></Extensions></Trackpoint>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="${r.kind === "bike" ? "Biking" : "Running"}"><Id>${iso(0)}</Id><Lap StartTime="${iso(0)}"><TotalTimeSeconds>${Math.round(r.minutes * 60)}</TotalTimeSeconds><DistanceMeters>${Math.round(r.km * 1000)}</DistanceMeters><Calories>${r.kcal}</Calories><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod><Track>${pts}</Track></Lap><Notes>FormIQ ${esc(r.routeName)}</Notes></Activity></Activities></TrainingCenterDatabase>`;
}
function chartSvg(samples, key, color, label) {
  const v = samples.map(s => s[key]).filter(x => x != null); if (v.length < 5) return "";
  const W = 320, H = 70, max = Math.max(...v), min = Math.min(...v), n = samples.length, sc = x => H - 8 - (x - min) / Math.max(1, max - min) * (H - 22);
  const pts = samples.map((s, i) => s[key] == null ? null : `${(i / (n - 1) * W).toFixed(1)},${sc(s[key]).toFixed(1)}`).filter(Boolean).join(" ");
  return `<figure class="rchart"><figcaption>${label} <span>${min}–${max}</span></figcaption><svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" role="img" aria-label="${label} over time"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></figure>`;
}
function showSummary(r, xp, levelUp, badges) {
  $("rideLive").hidden = true; $("rideSummary").hidden = false; $("rideSetup").hidden = true;
  const lv = levelOf(prog.xp), b = BADGES.filter(x => badges.includes(x[0]));
  $("rideSumBody").innerHTML = `
    <div class="sumhead"><div><div class="label">${esc(r.routeName)}${r.workout ? ` · ${esc(r.workout)}` : ""}${r.demo ? " · demo" : ""}</div>
      <h3>${r.km.toFixed(2)} km in ${hms(r.minutes * 60)}</h3></div><div class="xpgain">+${xp} XP${levelUp ? `<span>Level ${lv}!</span>` : ""}</div></div>
    ${r.pb ? `<p class="pbline">New personal best: ${hms(r.lapTime)}</p>` : r.lapTime ? `<p class="muted">Lap time ${hms(r.lapTime)}</p>` : ""}
    ${r.stars ? `<p class="stars" aria-label="${r.stars} of 3 stars">${"★".repeat(r.stars)}${"☆".repeat(3 - r.stars)} <span>workout accuracy</span></p>` : ""}
    <div class="stats sumstats">
      ${r.kind === "bike" ? `<div class="stat"><b>${r.avgP ?? "–"}</b><span>avg watts</span></div><div class="stat"><b>${r.maxP ?? "–"}</b><span>max watts</span></div>` :
        `<div class="stat"><b>${pace(r.km / Math.max(.01, r.minutes / 60))}</b><span>avg pace /km</span></div><div class="stat"><b>${(r.km / Math.max(.01, r.minutes / 60)).toFixed(1)}</b><span>avg km/h</span></div>`}
      <div class="stat"><b>${r.climb}</b><span>m climbed</span></div><div class="stat"><b>${r.avgHr ?? "–"}</b><span>avg heart rate</span></div>
      <div class="stat"><b>${r.avgBr ?? "–"}</b><span>avg breaths/min</span></div><div class="stat"><b>${r.kcal}</b><span>kcal</span></div>
    </div>
    ${chartSvg(lastRide.samples, r.kind === "bike" ? "p" : "v", "var(--accent)", r.kind === "bike" ? "Power (W)" : "Speed (km/h)")}
    ${chartSvg(lastRide.samples, "hr", "#e53935", "Heart rate (bpm)")}
    ${chartSvg(lastRide.samples, "br", "#42a5f5", "Breathing (br/min)")}
    ${b.length ? `<div class="label" style="margin-top:12px">New badges</div><ul class="badges">${b.map(([, n, d]) => `<li><b>🏅 ${n}</b><span>${d}</span></li>`).join("")}</ul>` : ""}`;
  $("rideStrava").hidden = !stravaReady() || r.demo;
  $("rideStrava").disabled = false; $("rideStrava").textContent = "Upload to Strava";
  renderProgress();
}
function showSetup() { $("rideLive").hidden = true; $("rideSummary").hidden = true; $("rideSetup").hidden = false; renderRoutes(); renderProgress(); }

/* ---------- setup screen ---------- */
function renderRoutes() {
  const lv = levelOf(prog.xp), kind = dev.kind === "run" ? "run" : "bike", cur = $("rideRoute").value || "lake";
  $("rideRoutes").innerHTML = routes.map(r => { const locked = lv < r.level, pb = prog.pbs[`${r.id}:${kind}`];
    return `<label class="route${locked ? " locked" : ""}" for="route-${r.id}"><input type="radio" name="route" id="route-${r.id}" value="${r.id}" ${locked ? "disabled" : ""} ${r.id === cur && !locked ? "checked" : ""}>
      <span class="rname">${esc(r.name)}</span><span class="rmeta">${(r.len / 1000).toFixed(1)} km · ${Math.round(r.climb)} m climbing</span>
      <span class="rblurb">${locked ? `Unlocks at level ${r.level}` : esc(r.blurb)}</span>${pb ? `<span class="rpb">Best ${hms(pb.time)}</span>` : ""}</label>`; }).join("");
  $("rideRoutes").querySelectorAll("input").forEach(i => i.onchange = () => $("rideRoute").value = i.value);
  if (!$("rideRoute").value) $("rideRoute").value = cur;
}
function renderWorkoutChoices() {
  const kind = dev.kind === "run" ? "run" : "bike", sel = $("rideWorkout"), was = sel.value;
  sel.innerHTML = WORKOUTS[kind].map(w => `<option value="${w.id}">${esc(w.name)} · ${Math.round(w.steps.reduce((t, s) => t + s[0], 0) / 60)} min</option>`).join("");
  if ([...sel.options].some(o => o.value === was)) sel.value = was;
  $("rideWorkout").hidden = $("rideMode").value !== "workout";
}
function renderProgress() {
  const lv = levelOf(prog.xp), a = xpFor(lv), b = xpFor(lv + 1);
  $("rideLevel").innerHTML = `<div class="lvrow"><b>Level ${lv}</b><span>${prog.xp.toLocaleString()} XP · ${(b - prog.xp).toLocaleString()} to level ${lv + 1}</span></div>
    <div class="xpbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((prog.xp - a) / (b - a) * 100)}"><i style="width:${(prog.xp - a) / (b - a) * 100}%"></i></div>
    <ul class="badges">${BADGES.map(([id, n, d]) => `<li class="${prog.badges.includes(id) ? "got" : ""}" title="${d}"><b>${prog.badges.includes(id) ? "🏅" : "○"} ${n}</b><span>${d}</span></li>`).join("")}</ul>
    <div class="jerseys" role="radiogroup" aria-label="Jersey colour">${JERSEYS.map(([c, need, name]) => `<button type="button" role="radio" aria-checked="${(cfg.jersey || "#1f8a5b") === c}" ${lv < need ? "disabled" : ""} data-c="${c}" title="${name}${lv < need ? ` · level ${need}` : ""}" style="--j:${c}"></button>`).join("")}</div>`;
  $("rideLevel").querySelectorAll(".jerseys button").forEach(bt => bt.onclick = () => { cfg.jersey = bt.dataset.c; save(SET_KEY, cfg); renderProgress(); });
}
function renderSettings() {
  for (const k of ["weight", "age", "maxHr", "ftp", "easyKmh", "difficulty", "maxIncline"]) { const el = $("rs_" + k); if (el) el.value = cfg[k] || ""; }
  for (const k of ["control", "autoIncline", "voice"]) { const el = $("rs_" + k); if (el) el.checked = !!cfg[k]; }
  $("rs_hint").textContent = `Using max heart rate ${maxHr()} bpm and FTP ${ftp()} W${cfg.ftp ? "" : " (estimated)"}.`;
}
export function initRide() {
  $("rideMachine").onclick = connectMachine; $("rideHr").onclick = connectHr;
  $("rideDemoBike").onclick = () => { startDemo("bike"); renderRoutes(); }; $("rideDemoRun").onclick = () => { startDemo("run"); renderRoutes(); };
  $("rideMode").onchange = renderWorkoutChoices;
  $("rideStart").onclick = startRide;
  $("ridePause").onclick = () => { if (!live) return; live.paused = !live.paused; $("ridePause").textContent = live.paused ? "Resume" : "Pause"; live.last = performance.now(); };
  $("rideEnd").onclick = () => { const b = $("rideEnd"); if (!b.dataset.arm) { b.dataset.arm = 1; b.textContent = "Tap again to finish"; setTimeout(() => { delete b.dataset.arm; b.textContent = "Finish"; }, 3000); return; } delete b.dataset.arm; b.textContent = "Finish"; endRide(); };
  $("rideDone").onclick = showSetup;
  $("rideTcx").onclick = () => lastRide && saveFile(`formiq-${lastRide.r.route}-${new Date(lastRide.r.at).toISOString().slice(0, 10)}.tcx`, "application/vnd.garmin.tcx+xml", tcx(lastRide));
  $("rideStrava").onclick = async () => { const b = $("rideStrava"); b.disabled = true; b.textContent = "Uploading…";
    try { await stravaUploadTcx(tcx(lastRide), `FormIQ: ${lastRide.r.routeName}`, `${lastRide.r.km.toFixed(2)} km on ${lastRide.r.routeName}${lastRide.r.workout ? ` (${lastRide.r.workout})` : ""}. Recorded with FormIQ.`); b.textContent = "Sent to Strava"; }
    catch (e) { b.disabled = false; b.textContent = "Upload to Strava"; msg(e.message, true); } };
  $("rideFull").onclick = () => { const el = $("rideStage"); (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.())?.catch?.(() => {}); };
  $("rideSettings").addEventListener("change", e => {
    const el = e.target, k = el.id.replace("rs_", ""); if (!(k in DEF)) return;
    cfg[k] = el.type === "checkbox" ? el.checked : el.value === "" ? 0 : +el.value;
    if (k === "autoIncline" && el.checked) msg("Auto-incline changes your treadmill's incline to match the route. FormIQ never changes the belt speed. Keep the safety clip attached.");
    save(SET_KEY, cfg); renderSettings();
  });
  addEventListener("resize", () => live && resize());
  document.addEventListener("fullscreenchange", () => setTimeout(resize, 100));
  renderRoutes(); renderProgress(); renderSettings(); chip();
}
