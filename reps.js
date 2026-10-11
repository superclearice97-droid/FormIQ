/* FormIQ rep counter: turns pose landmarks into reps, depth and form feedback.
   Pure logic (no page access), so it can be tested on pose data recorded from real workout videos.

   How it counts
   - Each rep is one swing away from your resting position and back. The resting level is learned as you
     go, so it works however straight your arms or legs read on camera, and for fast reps that don't fully
     lock out. (From the front, the pose model reads a straight leg as 150-165° and a full curl as ~85°, so
     fixed angle limits miss reps.)
   - Squat depth is how far your hips drop relative to your shin length: the same from the front, the side
     or at an angle, and at any distance from the camera.
   - Posture check: push-ups only count with your body horizontal; squats, curls and presses only start
     while you're upright. Feet (or hands, for push-ups) must stay put during a rep, so walking, kneeling
     down or stepping toward the camera never counts.
*/

const L = { ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 };
export const VIS = 0.35;
const seen = (lm, ids) => ids.every(i => (lm[i].visibility ?? 1) > VIS);
const angle3 = (a, b, c) => {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z], v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], m = Math.hypot(...u) * Math.hypot(...v) || 1;
  return Math.acos(Math.max(-1, Math.min(1, d / m))) * 180 / Math.PI;
};
const angle2 = (a, b, c, asp) => {
  const ab = Math.atan2(a.y - b.y, (a.x - b.x) * asp), cb = Math.atan2(c.y - b.y, (c.x - b.x) * asp);
  let d = Math.abs((ab - cb) * 180 / Math.PI); return d > 180 ? 360 - d : d;
};
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });

/* One Euro filter: removes jitter when still, stays responsive when moving fast */
class OneEuro {
  constructor(mc, beta, dc = 1) { this.mc = mc; this.beta = beta; this.dc = dc; this.x = null; this.dx = 0; this.t = 0; }
  a(c, dt) { const r = 2 * Math.PI * c * dt; return r / (r + 1); }
  f(x, t) {
    if (this.x == null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const dx = (x - this.x) / dt; this.dx += this.a(this.dc, dt) * (dx - this.dx);
    const c = this.mc + this.beta * Math.abs(this.dx); this.x += this.a(c, dt) * (x - this.x); return this.x;
  }
}
function smoother(mc = 1.7, beta = 0.8) {
  let F = null;
  return {
    reset() { F = null; },
    f(lm, t) {
      if (!F || F.length !== lm.length) F = lm.map(() => ({ x: new OneEuro(mc, beta), y: new OneEuro(mc, beta), z: new OneEuro(mc, beta) }));
      return lm.map((p, i) => ({ x: F[i].x.f(p.x, t), y: F[i].y.f(p.y, t), z: F[i].z.f(p.z, t), visibility: p.visibility }));
    },
  };
}

/* ---------- exercises ----------
   value(c): the reading, or null. dir: "down" = it falls during a rep, "up" = it rises.
   travel: minimum swing that counts as a rep. full: the swing that scores 100% range.
   abs: optional [worst, target] absolute levels that also earn full range.
   posture: "upright" or "plank". anchor: body part that must stay put during a rep. */
export const EX = {
  squat: {
    name: "Squat", hint: "front or side view", dir: "up", travel: 0.13, full: 0.42, show: "depth",
    posture: "upright", anchor: "feet",
    value(c) {   // depth: 0 standing, ~0.5 hips level with knees
      const r = [], th = [];
      for (const s of ["l", "r"]) {
        const h = c.img[L[s + "h"]], k = c.img[L[s + "k"]], a = c.img[L[s + "a"]];
        if (!seen(c.img, [L[s + "h"], L[s + "k"]])) continue;
        th.push(k.y - h.y);
        if (!seen(c.img, [L[s + "a"]])) continue;
        const shin = Math.hypot((k.x - a.x) * c.asp, k.y - a.y);
        if (shin > 0.03) r.push((a.y - h.y) / shin);
      }
      const calm = c.resting;
      if (r.length) {
        const ratio = r.reduce((x, y) => x + y) / r.length;
        if (th.length) c.calib("thigh", th.reduce((x, y) => x + y) / th.length, calm);
        const ref = c.calib("stand", ratio, calm);
        return ref ? Math.max(0, 1 - ratio / ref) : 0;
      }
      if (th.length) {   // feet out of the picture: use how far the hips drop toward the knees
        const ref = c.calib("thigh", th.reduce((x, y) => x + y) / th.length, calm, true);
        return ref ? Math.max(0, 0.5 * (1 - th.reduce((x, y) => x + y) / th.length / ref)) : null;
      }
      return null;
    },
    extra(c) {
      const s = c.side;
      if (!seen(c.img, [L[s + "h"], L[s + "s"]])) return {};
      const h = c.img[L[s + "h"]], sh = c.img[L[s + "s"]];
      return { lean: Math.abs(Math.atan2((sh.x - h.x) * c.asp, h.y - sh.y) * 180 / Math.PI) };
    },
    track(f, m, phase) { if (phase === "bottom" && m.lean != null) f.maxLean = Math.max(f.maxLean || 0, m.lean); },
    faults(f) { return f.maxLean > 50 ? ["Chest up, too much forward lean"] : []; },
    need: ["h", "k"],
  },
  pushup: {
    name: "Push-up", hint: "side view", dir: "down", travel: 28, full: 60, abs: [115, 85], show: "angle",
    posture: "plank", anchor: "hands", bothArms: true,
    value(c) { return c.ang("s", "e", "w"); },
    extra(c) { return { line: c.ang("s", "h", "a") }; },
    track(f, m) { if (m.line != null) f.minLine = Math.min(f.minLine ?? 180, m.line); },
    faults(f) { return f.minLine < 150 ? ["Keep hips in line with shoulders and ankles"] : []; },
    need: ["s", "e", "w"],
  },
  curl: {
    name: "Bicep curl", hint: "face camera", dir: "down", travel: 40, full: 65, abs: [90, 50], show: "angle",
    posture: "upright", anchor: "feet", eitherArm: true,
    value(c) { return c.ang("s", "e", "w"); },
    extra(c) {
      const s = c.side;
      if (!seen(c.img, [L[s + "s"], L[s + "e"], L[s + "h"]])) return {};
      const sh = c.img[L[s + "s"]], e = c.img[L[s + "e"]], h = c.img[L[s + "h"]];
      const torso = Math.hypot((sh.x - h.x) * c.asp, sh.y - h.y) || 1;
      return { drift: Math.abs(e.x - sh.x) * c.asp / torso };
    },
    track(f, m) { if (m.drift != null) f.maxDrift = Math.max(f.maxDrift || 0, m.drift); },
    faults(f) { return f.maxDrift > 0.4 ? ["Pin elbows to your sides"] : []; },
    need: ["s", "e", "w"],
  },
  press: {
    name: "Overhead press", hint: "face camera", dir: "up", travel: 40, full: 65, abs: [145, 170], show: "angle",
    posture: "upright", anchor: "feet", bothArms: true,
    value(c) { return c.ang("s", "e", "w"); },
    extra() { return {}; }, track() {}, faults() { return []; },
    need: ["s", "e", "w"],
  },
};

/* ---------- tracker ---------- */
export function createTracker(exKey = "squat") {
  const smImg = smoother(), smW = smoother();
  let def = EX[exKey], key = exKey, st, lostSince = 0;
  const fresh = () => ({ cal: {}, ema: null, vert: null, det: newDet(), armSide: null, upSince: 0 });
  const newDet = (lo = null) => ({ phase: "top", lo, hi: 0, startedAt: 0, f: {}, extreme: null, anchor: null, n: 0 });
  st = fresh();

  function setExercise(k) { key = k; def = EX[k]; st = fresh(); }
  function resetSmoothing() { smImg.reset(); smW.reset(); }

  /* Person-specific reference that is the largest recent reading (e.g. standing hip height).
     Learns only while resting; returns null until it has seen enough. */
  function calib(name, raw, resting, peek) {
    const c = st.cal[name] || (st.cal[name] = { ref: null, n: 0 });
    if (peek) return c.n >= 8 ? c.ref : null;
    if (resting) {
      if (c.ref == null) c.ref = raw;
      else if (raw > c.ref) c.ref += (raw - c.ref) * 0.3;
      else if (c.n > 15) c.ref += (raw - c.ref) * 0.01;   // drift if the person changes stance or position
      c.n++;
    }
    return c.n >= 8 ? c.ref : null;
  }

  function sideScore(img, s) { return def.need.reduce((t, n) => t + (img[L[s + n]].visibility ?? 0), 0) / def.need.length; }

  // 1 = torso upright, 0 = horizontal (works head-on too, using the 3D pose)
  function verticality(img, world, asp) {
    if (!seen(img, [11, 12, 23, 24]) && !(seen(img, [11, 23]) || seen(img, [12, 24]))) return null;
    const P = world || img, k = world ? 1 : asp;
    const s = seen(img, [11, 12]) ? mid(P[11], P[12]) : seen(img, [11]) ? P[11] : P[12];
    const h = seen(img, [23, 24]) ? mid(P[23], P[24]) : seen(img, [23]) ? P[23] : P[24];
    const dx = (s.x - h.x) * k, dy = s.y - h.y, dz = world ? s.z - h.z : 0;
    const len = Math.hypot(dx, dy, dz) || 1;
    return -dy / len;
  }

  // Where the planted body parts are (each foot, or each hand) plus a body-size scale. A model can misplace
  // a hidden hand or foot for a moment, so a part only counts as "moved" if every visible one moved.
  function anchorOf(img, asp) {
    const [pts, seg] = def.anchor === "feet" ? [[27, 28], [[25, 27], [26, 28]]] : [[15, 16], [[13, 15], [14, 16]]];
    const p = {};
    for (const i of pts) if (seen(img, [i])) p[i] = { x: img[i].x * asp, y: img[i].y };
    const sg = seg.filter(([a, b]) => seen(img, [a, b])).map(([a, b]) => Math.hypot((img[a].x - img[b].x) * asp, img[a].y - img[b].y));
    if (!Object.keys(p).length || !sg.length) return null;
    return { p, scale: Math.max(...sg) };
  }
  function anchorMoved(a0, a1) {
    if (!a0 || !a1 || a0.scale < 0.02) return false;
    const r = a1.scale / a0.scale;
    if (def.anchor === "feet" && (r < 0.75 || r > 1.33)) return true;   // stepped toward or away from the camera
    const common = Object.keys(a0.p).filter(k => a1.p[k]);
    if (!common.length) return false;
    return Math.min(...common.map(k => Math.hypot(a1.p[k].x - a0.p[k].x, a1.p[k].y - a0.p[k].y))) > 0.6 * a0.scale;
  }

  /* rawImg/rawWorld: landmarks for this frame (or null when nobody is seen). t: ms. asp: width / height. */
  function update(rawImg, rawWorld, t, asp = 4 / 3) {
    if (!rawImg) {   // tracking lost: start over rather than trust a half-finished movement
      resetSmoothing(); st.det = newDet(); st.upSince = 0; st.vert = null; st.ema = null;
      return { state: "noperson" };
    }
    const img = smImg.f(rawImg, t), world = rawWorld ? smW.f(rawWorld, t) : null;
    const ls = sideScore(img, "l"), rs = sideScore(img, "r"), q = Math.max(ls, rs);
    const det = st.det;

    // posture
    const v0 = verticality(img, world, asp);
    if (v0 != null) st.vert = st.vert == null ? v0 : st.vert * 0.7 + v0 * 0.3;
    const vert = st.vert ?? (def.posture === "upright" ? 1 : 0);
    const upright = vert > 0.55, flat = Math.abs(vert) < 0.5;
    const postureOk = def.posture === "plank" ? flat : upright;
    const resting = det.phase === "top" && postureOk;

    const ang = (s) => (a, b, c) => {
      const i = L[s + a], j = L[s + b], k = L[s + c];
      if (!seen(img, [i, j, k])) return null;
      return world ? angle3(world[i], world[j], world[k]) : angle2(img[i], img[j], img[k], asp);
    };
    const ctx = side => ({ img, world, asp, side, calib, ang: ang(side), resting });

    let v = null, side = ls >= rs ? "l" : "r";
    if (def.bothArms) {
      const a = def.value(ctx("l")), b = def.value(ctx("r"));
      v = a != null && b != null ? (a + b) / 2 : (a ?? b);
    } else if (def.eitherArm) {   // alternating or one-arm curls: follow the working arm until its rep ends
      const a = def.value(ctx("l")), b = def.value(ctx("r"));
      if (det.phase !== "top" && st.armSide) side = st.armSide;
      else if (a != null && b != null) side = a <= b ? "l" : "r";
      else side = a != null ? "l" : "r";
      v = side === "l" ? a : b;
      if (v == null) { v = side === "l" ? b : a; side = side === "l" ? "r" : "l"; }
    } else {
      v = def.value(ctx(side));
    }

    if (v == null) {
      if (!lostSince) lostSince = t;
      return { state: t - lostSince > 600 ? "lost" : "hold", quality: q, framing: framing(img, def), img };
    }
    lostSince = 0;
    st.ema = st.ema == null ? v : st.ema * 0.35 + v * 0.65;
    const val = st.ema, sign = def.dir === "down" ? -1 : 1, s = sign * val;   // s rises during a rep
    const m = { ...def.extra(ctx(side)), side };
    const anchor = anchorOf(img, asp);

    let done = null, cancel = null;
    if (det.phase === "top") {
      if (!postureOk) { st.upSince = 0; det.lo = null; }
      else {
        if (!st.upSince) st.upSince = t;
        if (det.lo == null || s < det.lo) det.lo = s;
        else det.lo += (s - det.lo) * 0.02;
        if (t - st.upSince >= 500 && s - det.lo > def.travel * 0.4) {
          Object.assign(det, { phase: "moving", hi: s, startedAt: t, f: {}, extreme: val, anchor, n: 0 });
          st.armSide = side;
        }
      }
    }
    if (det.phase !== "top") {
      det.n++;
      if (s > det.hi) { det.hi = s; det.extreme = val; }
      if (det.phase === "moving" && det.hi - det.lo >= def.travel) det.phase = "bottom";
      def.track(det.f, m, det.phase);
      const exc = det.hi - det.lo;
      const badPosture = def.posture === "plank" ? Math.abs(vert) > 0.75 : vert < 0.15;
      if (badPosture || anchorMoved(det.anchor, anchor)) cancel = true;
      else if (det.phase === "moving" && s - det.lo < def.travel * 0.15) cancel = true;      // went back without a real rep
      else if (det.phase === "bottom" && det.hi - s >= Math.max(exc * 0.45, def.travel * 0.6)) {
        if (t - det.startedAt >= 180) done = score(det, t);
        st.det = newDet(s); st.armSide = null;
      } else if (t - det.startedAt > 12000) cancel = true;
      if (cancel) { st.det = newDet(postureOk ? s : null); st.armSide = null; }
    }

    const d = st.det;
    const live = d.lo == null ? 0 : Math.max(0, s - d.lo);
    const ready = st.upSince && t - st.upSince >= 500;
    return {
      state: postureOk || d.phase !== "top" ? "ok" : "posture", hint: postureOk ? null : postureHint(),
      phase: !ready && d.phase === "top" ? "calibrating" : d.phase, value: val, side, quality: q, framing: framing(img, def),
      label: def.show === "depth" ? `Depth ${Math.round(Math.min(1, (key === "squat" ? val : live) / 0.5) * 100)}%` : `${Math.round(val)}°`,
      prog: Math.max(0, Math.min(1, live / def.full)), rep: done, img,
    };
  }

  function postureHint() {
    return def.posture === "plank" ? "Get into push-up position" : "Stand up straight to start";
  }

  function score(d, t) {
    let rom = (d.hi - d.lo) / def.full;
    if (def.abs) {   // an absolute angle clearly past the target also counts as full range
      const [worst, target] = def.abs;
      rom = Math.max(rom, (d.extreme - worst) / (target - worst));
    }
    rom = Math.max(0, Math.min(1, rom));
    const faults = def.faults(d.f);
    const dur = (t - d.startedAt) / 1000;
    if (dur < 0.6) faults.push("Slow down, control the movement");
    if (rom < 0.6) faults.unshift(key === "press" ? "Press higher for full range" : "Go deeper for full range");
    const sc = Math.round(Math.max(0, rom * 100 - (faults.length - (rom < 0.6 ? 1 : 0)) * 15));
    return { score: sc, faults, dur: +dur.toFixed(1), rom: Math.round(rom * 100) };
  }

  return { update, setExercise, resetSmoothing, get exercise() { return key; } };
}

export function framing(lm, def) {
  const ys = [0, 11, 12, 23, 24, 27, 28].map(i => lm[i]).filter(p => (p.visibility ?? 0) > VIS).map(p => p.y);
  if (ys.length < 3) return null;
  const top = Math.min(...ys), bot = Math.max(...ys);
  if (def && def.anchor === "feet" && !seen(lm, [27]) && !seen(lm, [28])) return "Step back so your feet are in the picture";
  if (top < 0.02 || bot > 0.98) return "Step back so your whole body fits";
  if (bot - top < 0.35 && (!def || def.posture !== "plank")) return "Move closer to the camera";
  return null;
}
