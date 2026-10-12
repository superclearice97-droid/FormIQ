/* FormIQ rep counter: turns pose landmarks into reps, holds, depth and form feedback.
   Pure logic (no page access), so it can be tested on pose data recorded from real workout videos.
   The exercises themselves are described in exercises.js.

   How it counts
   - "swing" exercises: each rep is one movement away from your resting position and back. The resting level
     is learned as you go, so it works however straight your arms or legs read on camera, and for fast reps
     that don't fully lock out.
   - "alt" exercises: each side counts (left knee, right knee...). Counting happens when you come back from
     a side, so the size of the movement can be scored.
   - "hold" exercises: seconds held in the right pose.
   - Posture check: every exercise has a starting position (standing, push-up position, seated, lying,
     hanging) and nothing counts outside it. Planted feet (or hands) must stay put during a rep, so walking,
     kneeling down or stepping toward the camera never counts.
*/
import { EX, CATS, CIRCUITS, POSTURES, L, VIS, seen, mid, geometry } from "./exercises.js?v=26";
export { EX, CATS, CIRCUITS, VIS };

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

/* ---------- tracker ---------- */
export function createTracker(exKey = "squat") {
  const smImg = smoother(), smW = smoother();
  let def = EX[exKey], key = exKey, st, lostSince = 0;
  const newDet = (lo = null) => ({ phase: "top", lo, hi: 0, startedAt: 0, f: {}, extreme: null, anchor: null });
  const fresh = (keepT) => ({ mem: {}, cal: {}, ema: null, vert: null, det: newDet(), armSide: null, upSince: 0, T: keepT ?? null,
    alt: { center: null, side: 0, peak: 0, since: 0, visits: 0, lastT: 0 }, hold: { held: 0, last: 0, secs: 0, good: 0 } });
  st = fresh();

  function setExercise(k) { key = k; def = EX[k]; st = fresh(st.T); }
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

  // 1 = torso upright, 0 = horizontal, negative = upside down (works head-on too, using the 3D pose)
  function verticality(img, world, asp) {
    if (!(seen(img, [11, 23]) || seen(img, [12, 24]))) return null;
    const P = world || img, k = world ? 1 : asp;
    const s = seen(img, [11, 12]) ? mid(P[11], P[12]) : seen(img, [11]) ? P[11] : P[12];
    const h = seen(img, [23, 24]) ? mid(P[23], P[24]) : seen(img, [23]) ? P[23] : P[24];
    const dx = (s.x - h.x) * k, dy = s.y - h.y, dz = world ? s.z - h.z : 0;
    return -dy / (Math.hypot(dx, dy, dz) || 1);
  }

  // Body size: the longest shoulders-to-hips length seen recently (it looks shorter when you lean or turn).
  function torso(img, asp) {
    if (!(seen(img, [11, 23]) || seen(img, [12, 24]))) return st.T;
    const s = seen(img, [11, 12]) ? mid(img[11], img[12]) : img[seen(img, [11]) ? 11 : 12];
    const h = seen(img, [23, 24]) ? mid(img[23], img[24]) : img[seen(img, [23]) ? 23 : 24];
    const len = Math.hypot((s.x - h.x) * asp, s.y - h.y);
    if (st.T == null || len > st.T) st.T = st.T == null ? len : st.T + (len - st.T) * 0.3;
    else st.T += (len - st.T) * 0.003;
    return Math.max(st.T, 0.02);
  }

  // Where the planted body parts are (each foot, or each hand) plus a body-size scale. A model can misplace
  // a hidden hand or foot for a moment, so a part only counts as "moved" if every visible one moved.
  function anchorOf(img, asp) {
    if (!def.anchor) return null;
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
      resetSmoothing(); st.det = newDet(); st.upSince = 0; st.badSince = 0; st.vert = null; st.ema = null;
      st.alt.side = 0; st.alt.since = 0; st.hold.last = 0;
      return { state: "noperson" };
    }
    const img = smImg.f(rawImg, t), world = rawWorld ? smW.f(rawWorld, t) : null;
    const T = torso(img, asp);
    const g = geometry(img, world, asp, T);
    const q = Math.max(...["l", "r"].map(s => ["s", "e", "w", "h", "k", "a"].reduce((t2, n) => t2 + (img[L[s + n]].visibility ?? 0), 0) / 6));

    const v0 = verticality(img, world, asp);
    if (v0 != null) st.vert = st.vert == null ? v0 : st.vert * 0.7 + v0 * 0.3;
    const P = POSTURES[def.posture] || POSTURES.any;
    const vert = st.vert ?? (def.posture === "upright" ? 1 : 0);
    const postureOk = P.ok(g, vert);
    // "ready" after half a second in position; a short moment out of it (sitting up between sit-ups) doesn't reset that
    if (postureOk) { if (!st.upSince) st.upSince = t; st.badSince = 0; }
    else if (def.kind !== "swing" || st.det.phase === "top") {
      if (!st.badSince) st.badSince = t;
      if (t - st.badSince > 1500) st.upSince = 0;
    }
    const ready = !!st.upSince && t - st.upSince >= 500;
    const common = { img, quality: q, framing: framing(img, def), postureOk, postureHint: P.hint };

    if (def.kind === "hold") return holdStep(g, t, postureOk, ready, common);

    const det = st.det;
    const resting = def.kind === "swing" ? det.phase === "top" && postureOk : postureOk;
    const ang = (s) => (a, b, c) => {
      const i = L[s + a], j = L[s + b], k = L[s + c];
      if (!seen(img, [i, j, k])) return null;
      return world ? g.ang(i, j, k) : g.ang(i, j, k);
    };
    const ctx = side => ({ g, img, world, asp, side, calib, ang: ang(side), resting, mem: st.mem });

    let v = null, side = "l";
    if (def.bothArms) {
      const a = def.value(ctx("l")), b = def.value(ctx("r"));
      v = a != null && b != null ? (a + b) / 2 : (a ?? b);
    } else if (def.eitherArm) {   // alternating or one-arm: follow the working arm until its rep ends
      const a = def.value(ctx("l")), b = def.value(ctx("r"));
      const flexes = def.dir === "down";
      if (det.phase !== "top" && st.armSide) side = st.armSide;
      else if (a != null && b != null) side = (flexes ? a <= b : a >= b) ? "l" : "r";
      else side = a != null ? "l" : "r";
      v = side === "l" ? a : b;
      if (v == null) { v = side === "l" ? b : a; side = side === "l" ? "r" : "l"; }
    } else {
      const ls = img[11].visibility + img[23].visibility, rs = img[12].visibility + img[24].visibility;
      side = ls >= rs ? "l" : "r";
      v = def.value(ctx(side));
    }

    if (v == null) {
      if (!lostSince) lostSince = t;
      return { ...common, state: t - lostSince > 600 ? "lost" : "hold" };
    }
    lostSince = 0;
    st.ema = st.ema == null ? v : st.ema * 0.35 + v * 0.65;
    const val = st.ema;
    if (def.kind === "alt") return altStep(val, t, postureOk, ready, vert, common);

    /* ----- swing ----- */
    const sign = def.dir === "down" ? -1 : 1, s = sign * val;   // s rises during a rep
    const m = { ...def.extra(ctx(side)), side };
    const anchor = anchorOf(img, asp);
    let done = null, cancel = null;
    if (det.phase === "top") {
      if (!postureOk) det.lo = null;
      else {
        // resting level: follows dips at once, except for jumps, where it is the standing level (a knee
        // lift or a step down shouldn't become the new "floor" that the next landing rises from)
        if (det.lo == null) det.lo = s;
        else if (s < det.lo && !def.slowRest) det.lo = s;
        else det.lo += (s - det.lo) * (def.slowRest ? 0.05 : 0.02);
        if (ready && s - det.lo > def.travel * 0.4) {
          Object.assign(det, { phase: "moving", hi: s, startedAt: t, f: {}, extreme: val, anchor });
          st.armSide = side;
        }
      }
    }
    if (det.phase !== "top") {
      if (s > det.hi) { det.hi = s; det.extreme = val; }
      if (det.phase === "moving" && det.hi - det.lo >= def.travel) det.phase = "bottom";
      def.track(det.f, m, det.phase);
      const exc = det.hi - det.lo;
      if (P.lost(vert) || anchorMoved(det.anchor, anchor)) cancel = true;
      else if (det.phase === "moving" && s - det.lo < def.travel * 0.15) cancel = true;      // went back without a real rep
      else if (det.phase === "bottom" && det.hi - s >= Math.max(exc * 0.45, def.travel * 0.6)) {
        if (t - det.startedAt >= (def.minDur ?? 180)) done = swingScore(det, t);
        st.det = newDet(s); st.armSide = null;
      } else if (t - det.startedAt > (def.maxDur ?? 12000)) cancel = true;
      if (cancel) { st.det = newDet(postureOk ? s : null); st.armSide = null; }
    }
    const d = st.det, live = d.lo == null ? 0 : Math.max(0, s - d.lo);
    return {
      ...common, state: postureOk || d.phase !== "top" ? "ok" : "posture", hint: postureOk ? null : P.hint,
      phase: !ready && d.phase === "top" ? "calibrating" : d.phase, value: val, side,
      label: def.show === "depth" ? `Depth ${Math.round(Math.min(1, val / 0.5) * 100)}%` : fmt(val),
      prog: Math.max(0, Math.min(1, live / def.full)), rep: done,
    };
  }

  function fmt(v) { return Math.abs(v) >= 5 ? `${Math.round(v)}°` : v.toFixed(2); }

  /* ----- alternating sides ----- */
  function altStep(v, t, postureOk, ready, vert, common) {
    const A = st.alt, P = POSTURES[def.posture] || POSTURES.any;
    // slow-moving middle, so a camera tilt or a stance that isn't centred doesn't favour one side
    if (A.center == null || !def.center) A.center = def.center ? v : 0;
    else A.center += (v - A.center) * 0.01;
    const d = v - A.center;
    let done = null;
    if (!postureOk || !ready) { A.side = 0; A.since = 0; }
    else {
      const sd = d > def.thr ? 1 : d < -def.thr ? -1 : 0;
      if (A.side === 0 && sd) { A.side = sd; A.peak = Math.abs(d); A.since = t; }
      else if (A.side) {
        A.peak = Math.max(A.peak, A.side * d);
        if (A.side * d < def.thr * 0.5) {           // came back from that side: one rep
          if (t - A.since >= 120 && t - A.lastT >= 150) {
            A.visits++;
            if (!def.perPair || A.visits % 2 === 0) {
              const rom = Math.max(0, Math.min(1, A.peak / def.full)), faults = [];
              if (rom < 0.6) faults.push("Make the movement bigger");
              done = { score: Math.round(rom * 100), faults, dur: +((t - A.since) / 1000).toFixed(1), rom: Math.round(rom * 100), side: A.side > 0 ? "L" : "R" };
            }
            A.lastT = t;
          }
          A.side = 0; A.peak = 0;
          if (sd && sd !== 0) { A.side = sd; A.since = t; A.peak = Math.abs(d); }   // swung straight through to the other side
        }
      }
    }
    return {
      ...common, state: postureOk ? "ok" : "posture", hint: postureOk ? null : P.hint,
      phase: !ready ? "calibrating" : A.side ? "bottom" : "top", value: v, label: fmt(d),
      prog: Math.max(0, Math.min(1, Math.abs(d) / def.full)), rep: done,
    };
  }

  /* ----- holds: one "rep" per second held in the right position ----- */
  function holdStep(g, t, postureOk, ready, common) {
    const H = st.hold, P = POSTURES[def.posture] || POSTURES.any;
    const why = !postureOk ? P.hint || "Get into position" : def.check(g) || "";
    const good = postureOk && !why;
    const dt = H.last ? Math.min(200, t - H.last) : 0;
    H.last = t;
    let done = null;
    if (good && ready) {
      H.held += dt;
      if (H.held >= (H.secs + 1) * 1000) { H.secs++; done = { score: 100, faults: [], dur: 1, rom: 100, sec: true }; }
    }
    return {
      ...common, state: "ok", hint: why || null, phase: good ? (ready ? "holding" : "calibrating") : "top",
      label: `${(H.held / 1000).toFixed(0)} s`, prog: good ? 1 : 0, rep: done, holdOk: good,
    };
  }

  function swingScore(d, t) {
    let rom = (d.hi - d.lo) / def.full;
    if (def.abs) {   // an absolute angle clearly past the target also counts as full range
      const [worst, target] = def.abs;
      rom = Math.max(rom, (d.extreme - worst) / (target - worst));
    }
    rom = Math.max(0, Math.min(1, rom));
    const faults = def.faults(d.f);
    const dur = (t - d.startedAt) / 1000;
    if (dur < 0.6 && def.cat !== "cardio") faults.push("Slow down, control the movement");
    if (rom < 0.6) faults.unshift(def.dir === "up" && def.show !== "depth" ? "Go further for full range" : "Go deeper for full range");
    const sc = Math.round(Math.max(0, rom * 100 - (faults.length - (rom < 0.6 ? 1 : 0)) * 15));
    return { score: sc, faults, dur: +dur.toFixed(1), rom: Math.round(rom * 100) };
  }

  /* Start counting from now on (after the setup guide), keeping what was learned about the person. */
  function rearm() {
    st.det = newDet(); st.armSide = null;
    st.alt.side = 0; st.alt.since = 0; st.alt.visits = 0;
    st.hold = { held: 0, last: 0, secs: 0, good: 0 };
  }

  return { update, setExercise, resetSmoothing, rearm, get exercise() { return key; } };
}

export function framing(lm, def) {
  const level = def?.frame || "full";
  const ids = level === "full" ? [0, 11, 12, 23, 24, 27, 28] : level === "knees" ? [0, 11, 12, 23, 24, 25, 26] : [0, 11, 12, 23, 24];
  const ys = ids.map(i => lm[i]).filter(p => (p.visibility ?? 0) > VIS).map(p => p.y);
  if (ys.length < 3) return null;
  const top = Math.min(...ys), bot = Math.max(...ys);
  const standing = !def || def.posture === "upright";
  if (level === "full" && standing && (def?.anchor === "feet" || def?.cat === "cardio") && !seen(lm, [27]) && !seen(lm, [28])) return "Step back so your feet are in the picture";
  if (top < 0.02 || (level === "full" && bot > 0.98)) return level === "full" ? "Step back so your whole body fits" : "Step back so your head and shoulders fit";
  if (bot - top < (level === "full" ? 0.35 : 0.18) && standing) return "Move closer to the camera";
  return null;
}
