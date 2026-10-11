/* FormIQ rep counter: turns pose landmarks into reps, depth and form feedback.
   Pure logic (no page access), so it can be tested on recorded pose data.

   Why it works the way it does
   - Phones are usually propped in front of you, and from the front the pose model can't see how far a knee
     or elbow really bends: a straight leg reads 150-165°, a full curl only about 85°. Fixed angle limits
     therefore miss reps or count wobbles. So every exercise now calibrates to YOU: it learns your
     starting position and counts a rep when you move a set distance away from it and come back.
   - Squats are measured by how far your hips drop, relative to your shin length. That works the same
     from the front, the side or at an angle, and whatever your distance from the camera.
*/

const L = { ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 };
export const VIS = 0.35;
const vis = (lm, ids) => ids.every(i => (lm[i].visibility ?? 1) > VIS);
const angle3 = (a, b, c) => {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z], v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], m = Math.hypot(...u) * Math.hypot(...v) || 1;
  return Math.acos(Math.max(-1, Math.min(1, d / m))) * 180 / Math.PI;
};
const angle2 = (a, b, c, asp) => {
  const ab = Math.atan2(a.y - b.y, (a.x - b.x) * asp), cb = Math.atan2(c.y - b.y, (c.x - b.x) * asp);
  let d = Math.abs((ab - cb) * 180 / Math.PI); return d > 180 ? 360 - d : d;
};

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
   value(ctx) -> number or null. dir: "down" = the value falls during a rep (from its start level), "up" = it rises.
   travel: how far the value must move from your start position to count as a rep.
   full: the movement that scores 100% range (from your start position). abs: optional absolute
   [worst, target] levels that also earn full range (used when the camera sees the joint clearly).
   fmt: how the live value is shown. */
export const EX = {
  squat: {
    name: "Squat", hint: "front or side view", dir: "up", travel: 0.2, full: 0.42, show: "depth",
    // depth 0 = standing, 0.5 = hips about level with knees
    value(c) {
      const r = [];
      for (const s of ["l", "r"]) {
        const h = c.img[L[s + "h"]], k = c.img[L[s + "k"]], a = c.img[L[s + "a"]];
        if (!vis(c.img, [L[s + "h"], L[s + "k"], L[s + "a"]])) continue;
        const shin = Math.hypot((k.x - a.x) * c.asp, k.y - a.y);
        if (shin < 0.03) continue;
        r.push({ v: (a.y - h.y) / shin, w: Math.min(h.visibility ?? 1, k.visibility ?? 1, a.visibility ?? 1) });
      }
      if (!r.length) return null;
      const ratio = r.reduce((t, x) => t + x.v * x.w, 0) / r.reduce((t, x) => t + x.w, 0);
      return c.calib("stand", ratio, "max", ratio2 => Math.max(0, 1 - ratio / ratio2));
    },
    extra(c) {
      const s = c.side, h = c.img[L[s + "h"]], sh = c.img[L[s + "s"]];
      if (!vis(c.img, [L[s + "h"], L[s + "s"]])) return {};
      return { lean: Math.abs(Math.atan2((sh.x - h.x) * c.asp, h.y - sh.y) * 180 / Math.PI) };
    },
    track(f, m, phase) { if (phase === "bottom" && m.lean != null && m.side) f.maxLean = Math.max(f.maxLean || 0, m.lean); },
    faults(f) { return f.maxLean > 50 ? ["Chest up, too much forward lean"] : []; },
    need: ["h", "k", "a"],
  },
  pushup: {
    name: "Push-up", hint: "side view", dir: "down", travel: 35, full: 70, abs: [115, 85], show: "angle",
    value(c) { return c.ang("s", "e", "w"); },
    extra(c) { return { line: c.ang("s", "h", "a") }; },
    track(f, m) { if (m.line != null) f.minLine = Math.min(f.minLine ?? 180, m.line); },
    faults(f) { return f.minLine < 150 ? ["Keep hips in line with shoulders and ankles"] : []; },
    need: ["s", "e", "w"],
  },
  curl: {
    name: "Bicep curl", hint: "face camera", dir: "down", travel: 40, full: 65, abs: [90, 50], show: "angle", eitherArm: true,
    value(c) { return c.ang("s", "e", "w"); },
    extra(c) {
      const s = c.side, sh = c.img[L[s + "s"]], e = c.img[L[s + "e"]], h = c.img[L[s + "h"]];
      if (!vis(c.img, [L[s + "s"], L[s + "e"], L[s + "h"]])) return {};
      const torso = Math.hypot((sh.x - h.x) * c.asp, sh.y - h.y) || 1;
      return { drift: Math.abs(e.x - sh.x) * c.asp / torso };
    },
    track(f, m) { if (m.drift != null) f.maxDrift = Math.max(f.maxDrift || 0, m.drift); },
    faults(f) { return f.maxDrift > 0.4 ? ["Pin elbows to your sides"] : []; },
    need: ["s", "e", "w"],
  },
  press: {
    name: "Overhead press", hint: "face camera", dir: "up", travel: 40, full: 65, abs: [145, 170], show: "angle", bothArms: true,
    value(c) { return c.ang("s", "e", "w"); },
    extra() { return {}; }, track() {}, faults() { return []; },
    need: ["s", "e", "w"],
  },
};

/* ---------- tracker ---------- */
export function createTracker(exKey = "squat") {
  const smImg = smoother(), smW = smoother();
  let def = EX[exKey], key = exKey;
  let st;              // per-exercise state
  let lostSince = 0;
  const fresh = () => ({ base: null, baseN: 0, cal: {}, ema: null, rep: newRep(), armSide: null, lastSide: null });
  const newRep = () => ({ phase: "start", peak: 0, startedAt: 0, f: {}, extreme: null });
  st = fresh();

  function setExercise(k) { key = k; def = EX[k]; st = fresh(); }
  function resetSmoothing() { smImg.reset(); smW.reset(); }

  // Learns a person-specific reference level (e.g. standing hip height) and converts the raw reading with it.
  function calib(name, raw, mode, conv) {
    const c = st.cal[name] || (st.cal[name] = { ref: null, n: 0 });
    const resting = st.rep.phase === "start";
    if (c.ref == null) c.ref = raw;
    else if (mode === "max" ? raw > c.ref : raw < c.ref) c.ref += (raw - c.ref) * (resting ? 0.3 : 0.05); // rise quickly, but not on one spike
    else if (resting && c.n > 15) c.ref += (raw - c.ref) * 0.01;   // drift slowly if the person changes stance or position
    if (resting) c.n++;
    return c.n < 8 ? 0 : conv(c.ref);   // needs a moment of standing still before the first rep
  }

  function sideScore(img, s) { return def.need.reduce((t, n) => t + (img[L[s + n]].visibility ?? 0), 0) / def.need.length; }

  /* img/world: raw landmarks (or null when no person). t: ms. asp: video width / height. */
  function update(rawImg, rawWorld, t, asp = 4 / 3) {
    if (!rawImg) { resetSmoothing(); return { state: "noperson" }; }
    const img = smImg.f(rawImg, t), world = rawWorld ? smW.f(rawWorld, t) : null;
    const ls = sideScore(img, "l"), rs = sideScore(img, "r"), q = Math.max(ls, rs);
    const ang = (s) => (a, b, c) => {
      const i = L[s + a], j = L[s + b], k = L[s + c];
      if (!vis(img, [i, j, k])) return null;
      return world ? angle3(world[i], world[j], world[k]) : angle2(img[i], img[j], img[k], asp);
    };
    const ctx = side => ({ img, world, asp, side, calib, ang: ang(side) });

    // pick the reading: per side, or both arms
    let v = null, side = ls >= rs ? "l" : "r";
    if (def.bothArms) {
      const a = def.value(ctx("l")), b = def.value(ctx("r"));
      v = a != null && b != null ? (a + b) / 2 : (a ?? b);
    } else if (def.eitherArm) {
      // alternating or single-arm curls: follow whichever arm is curling; stick with it until the rep ends
      const a = def.value(ctx("l")), b = def.value(ctx("r"));
      if (st.rep.phase !== "start" && st.armSide) side = st.armSide;
      else if (a != null && b != null) side = a <= b ? "l" : "r";
      else side = a != null ? "l" : "r";
      v = side === "l" ? a : b;
      if (v == null) v = side === "l" ? b : a;
    } else {
      v = def.value(ctx(side));
      if (v == null) { const o = side === "l" ? "r" : "l"; v = def.value(ctx(o)); if (v != null) side = o; }
    }

    if (v == null) {
      if (!lostSince) lostSince = t;
      return { state: t - lostSince > 600 ? "lost" : "hold", quality: q, framing: framing(img), img };
    }
    lostSince = 0;
    st.ema = st.ema == null ? v : st.ema * 0.35 + v * 0.65;
    const val = st.ema;
    const m = { ...def.extra(ctx(side)), side };

    // start position: the resting end of the movement, learned while you're at rest
    const sign = def.dir === "down" ? -1 : 1;              // +1 when the value rises during a rep
    const rep = st.rep;
    if (rep.phase === "start") {
      if (st.base == null) st.base = val;
      else if (sign * (st.base - val) > 0) st.base += (val - st.base) * 0.3;   // more "at rest" than we thought
      else st.base += (val - st.base) * 0.02;                                 // slow drift toward where you're resting
      st.baseN++;
    }
    const ready = st.baseN >= 8;
    const exc = Math.max(0, sign * (val - st.base));       // how far from the start position

    let done = null;
    if (ready) {
      if (rep.phase === "start" && exc > def.travel * 0.35) {
        rep.phase = "moving"; rep.startedAt = t; rep.peak = exc; rep.f = {}; rep.extreme = val; st.armSide = side;
      }
      if (rep.phase !== "start") {
        if (exc > rep.peak) { rep.peak = exc; rep.extreme = val; }
        if (rep.phase === "moving" && rep.peak >= def.travel) rep.phase = "bottom";
        def.track(rep.f, m, rep.phase);
        const back = exc <= Math.max(def.travel * 0.3, rep.peak * 0.3);
        if (back) {
          if (rep.phase === "bottom" && t - rep.startedAt >= 400) done = score(rep, t);
          st.rep = newRep(); st.armSide = null;
        } else if (t - rep.startedAt > 15000) { st.rep = newRep(); st.armSide = null; }   // stuck: start over
      }
    }
    const prog = ready ? Math.max(0, Math.min(1, exc / def.full)) : 0;
    return {
      state: "ok", phase: ready ? st.rep.phase : "calibrating", value: val, side, quality: q, framing: framing(img),
      label: def.show === "depth" ? `Depth ${Math.round(Math.min(1, exc / 0.5) * 100)}%` : `${Math.round(val)}°`,
      prog, rep: done, img,
    };
  }

  function score(rep, t) {
    let rom = rep.peak / def.full;
    if (def.abs) {   // an absolute angle clearly past the target also counts as full range
      const [worst, target] = def.abs;
      rom = Math.max(rom, (rep.extreme - worst) / (target - worst));
    }
    rom = Math.max(0, Math.min(1, rom));
    const faults = def.faults(rep.f);
    const dur = (t - rep.startedAt) / 1000;
    if (dur < 0.8) faults.push("Slow down, control the movement");
    if (rom < 0.6) faults.unshift(def.dir === "up" && key !== "squat" ? "Press higher for full range" : "Go deeper for full range");
    const s = Math.round(Math.max(0, rom * 100 - (faults.length - (rom < 0.6 ? 1 : 0)) * 15));
    return { score: s, faults, dur: +dur.toFixed(1), rom: Math.round(rom * 100) };
  }

  return { update, setExercise, resetSmoothing, get exercise() { return key; } };
}

export function framing(lm) {
  const ys = [0, 11, 12, 23, 24, 27, 28].map(i => lm[i]).filter(p => (p.visibility ?? 0) > VIS).map(p => p.y);
  if (ys.length < 3) return null;
  const top = Math.min(...ys), bot = Math.max(...ys);
  if (top < 0.02 || bot > 0.98) return "Step back so your whole body fits";
  if (bot - top < 0.35) return "Move closer to the camera";
  return null;
}
