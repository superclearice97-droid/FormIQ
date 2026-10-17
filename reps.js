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
import { EX, CATS, CIRCUITS, POSTURES, L, VIS, seen, mid, geometry } from "./exercises.js?v=31";
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
  let F = null, hold = null;
  return {
    reset() { F = null; hold = null; },
    /* a landmark whose confidence flickers below the threshold for a few frames keeps its last good position
       for 100 ms instead of jumping, which would otherwise look like a movement (and double count) */
    f(lm, t) {
      if (!F || F.length !== lm.length) { F = lm.map(() => ({ x: new OneEuro(mc, beta), y: new OneEuro(mc, beta), z: new OneEuro(mc, beta) })); hold = lm.map(() => ({ t: -1e9, p: null })); }
      return lm.map((p, i) => {
        const good = (p.visibility ?? 1) > VIS, H = hold[i];
        if (!good && H.p && t - H.t < 100) return { ...H.p, visibility: VIS + 0.01 };
        const o = { x: F[i].x.f(p.x, t), y: F[i].y.f(p.y, t), z: F[i].z.f(p.z, t), visibility: p.visibility };
        if (good) { H.t = t; H.p = o; }
        return o;
      });
    },
  };
}

/* ---------- tracker ---------- */
export function createTracker(exKey = "squat") {
  const smImg = smoother(), smW = smoother();
  let def = EX[exKey], key = exKey, st, lostSince = 0;
  const newDet = (lo = null) => ({ phase: "top", lo, hi: 0, startedAt: 0, f: {}, extreme: null, anchor: null });
  const fresh = (keepT) => ({ size: null, hist: [], mem: {}, cal: {}, ema: null, vert: null, det: newDet(), armSide: null, upSince: 0, T: keepT ?? null,
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

  /* Body size right now, two ways: shoulders-to-hips length and shoulder width. Leaning forward (a squat) shortens the
     first but not the second; stepping toward or away from the camera changes both. Returns true once, when you have
     clearly settled at a new distance. */
  function repositioned(img, asp, t) {
    if (!seen(img, [11, 12]) || !(seen(img, [23]) || seen(img, [24]))) return false;
    const s = mid(img[11], img[12]), h = seen(img, [23, 24]) ? mid(img[23], img[24]) : img[seen(img, [23]) ? 23 : 24];
    const Lnow = Math.hypot((s.x - h.x) * asp, s.y - h.y), Wnow = Math.abs(img[11].x - img[12].x) * asp;
    const R = st.size || (st.size = { L: Lnow, W: Wnow, n: 0, off: 0 });
    const rL = Lnow / R.L, frontal = R.W > 0.35 * R.L && Wnow > 0.2 * Lnow, rW = frontal ? Wnow / R.W : null;
    const far = x => x < 0.78 || x > 1.28;
    const moved = rW != null ? far(rW) && far(rL) : (rL < 0.65 || rL > 1.55);
    if (!moved) {
      R.off = 0;
      if (st.det.phase === "top") { R.L += (Lnow - R.L) * 0.05; R.W += (Wnow - R.W) * 0.05; }
      return false;
    }
    if (!R.off) R.off = t;
    if (t - R.off < 350) return false;
    st.size = { L: Lnow, W: Wnow, n: 0, off: 0 };
    return true;
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
    return { p, scale: sg.reduce((a, b) => a + b, 0) / sg.length };
  }
  function anchorMoved(a0, a1) {
    if (!a0 || !a1 || a0.scale < 0.02) return false;
    const r = a1.scale / a0.scale;
    if (def.anchor === "feet" && (r < 0.68 || r > 1.47)) return true;   // stepped toward or away from the camera
    const common = Object.keys(a0.p).filter(k => a1.p[k]);
    if (!common.length) return false;
    return Math.min(...common.map(k => Math.hypot(a1.p[k].x - a0.p[k].x, a1.p[k].y - a0.p[k].y))) > 0.6 * a0.scale;
  }

  /* rawImg/rawWorld: landmarks for this frame (or null when nobody is seen). t: ms. asp: width / height. */
  function update(rawImg, rawWorld, t, asp = 4 / 3) {
    if (!rawImg) {
      // a short dropout (a few frames of lost tracking) just pauses the rep; only a real absence starts over
      if (!st.gapAt) st.gapAt = t;
      if (t - st.gapAt < 800 && st.det.phase !== undefined && st.seen) return { state: "hold" };
      resetSmoothing(); st.det = newDet(); st.upSince = 0; st.badSince = 0; st.vert = null; st.ema = null;
      st.alt.side = 0; st.alt.since = 0; st.hold.last = 0;
      st.seen = false;
      return { state: "noperson" };
    }
    st.gapAt = 0; st.seen = true;
    // a knee or foot the model places outside the picture (below the bottom edge at the bottom of a squat) is a guess:
    // treat it as unseen so it can't drag the movement around
    rawImg = rawImg.map((p, i) => i >= 25 && (p.y > 1.0 || p.y < -0.03 || p.x < -0.03 || p.x > 1.03) ? { ...p, visibility: Math.min(p.visibility ?? 1, 0.1) } : p);
    const img = smImg.f(rawImg, t), world = rawWorld ? smW.f(rawWorld, t) : null;
    if (def.posture === "upright" && repositioned(img, asp, t)) {
      // you stepped toward or away from the camera: whatever was in progress isn't a rep, and the standing references
      // (hip height, body size) are relearned at the new distance
      st.det = newDet(); st.cal = {}; st.mem = {}; st.T = null; st.upSince = t; st.ema = null; st.hist = [];
      st.alt.side = 0; st.alt.since = 0; st.alt.center = null;
    }
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
    // knee lifts read the unsmoothed points: a fast lift is up for only a few frames and smoothing would flatten it
    if (def.lifts) return liftStep(geometry(rawImg, rawWorld, asp, T), g, t, postureOk, ready, common);

    const det = st.det;
    const resting = def.kind === "swing" ? det.phase === "top" && postureOk : postureOk;
    const ang = (s) => (a, b, c) => {
      const i = L[s + a], j = L[s + b], k = L[s + c];
      if (!seen(img, [i, j, k])) return null;
      return world ? g.ang(i, j, k) : g.ang(i, j, k);
    };
    const ctx = side => ({ g, img, world, asp, side, calib, ang: ang(side), resting, mem: st.mem, cal: st.cal, t });

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
    // median of the last three readings: a single bad frame (a model glitch) can't move the count. Only used when
    // those frames are close together (about 15 fps or better); at lower rates it would clip real peaks.
    const hist = st.hist || (st.hist = []); hist.push([t, v]); if (hist.length > 3) hist.shift();
    if (hist.length === 3 && hist[2][0] - hist[0][0] < 170 && !def.quick) v = hist.map(h => h[1]).sort((a, b) => a - b)[1];
    // quick moves (a knee lift can be up for two or three frames): no extra smoothing, both cues already have to agree
    st.ema = def.quick || st.ema == null ? v : st.ema * 0.35 + v * 0.65;
    const val = st.ema;
    if (def.kind === "alt") return altStep(val, t, postureOk, ready, vert, common);

    /* ----- swing ----- */
    const sign = def.dir === "down" ? -1 : 1, s = sign * val;   // s rises during a rep
    const m = { ...def.extra(ctx(side)), side };
    const anchor = anchorOf(img, asp);
    let done = null, cancel = null, skip = null;
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
      else if (det.phase === "moving" && s - det.lo < def.travel * 0.15) { cancel = true; if (det.hi - det.lo >= def.travel * 0.55) skip = "Almost, go a little further so it counts"; }      // went back without a real rep
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
      prog: Math.max(0, Math.min(1, live / def.full)), rep: done, skip,
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
          if (t - A.since >= (def.quick ? 0 : 120) && t - A.lastT >= 150) {
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

  /* ----- knee lifts (and high knees): each lift of either knee is one rep ----------------------------------------
     Fast lifts are only up for a few frames, and the pose model often drops the lifted leg back to "standing" for a
     frame or three mid-lift. So: a lift counts as soon as one frame clearly shows it; the same knee can't count again
     until it has been down for a moment (flicker inside one lift is merged); and a lift that appears right as the other
     knee is up is the model mixing up the legs, not a new lift. */
  function liftStep(g, gs, t, postureOk, ready, common) {   // g: unsmoothed points, gs: smoothed
    const S = st.lift || (st.lift = { lastUp: [-1e9, -1e9], on: [false, false], ok: [false, false], peak: [0, 0], bar: [0, 0], seen: t,
      step: [-1e9, -1e9], swayX: null, sway: 0, lastT: t });
    const P = POSTURES[def.posture] || POSTURES.any;
    const UP = def.liftOn ?? 0.25, COUNT = def.liftCount ?? 0.35, MERGE = 450, SWAP = 200;
    const v = [g.lift("l"), g.lift("r")];
    if (v[0] == null || v[1] == null) return { ...common, state: t - S.seen > 600 ? "lost" : "hold" };
    S.seen = t;
    const dt = Math.min(200, t - S.lastT); S.lastT = t;
    let done = null;
    // one step on side s (0 = left knee up). A knee lift and a hip sway can report the same step: merge them.
    const step = (s, peak, seen) => {
      if (t - S.step[s] < MERGE || !postureOk || !ready) { if (seen) S.seenPeak = Math.max(S.seenPeak || 0, peak); S.step[s] = Math.max(S.step[s], t - MERGE + 150); return; }
      S.step[s] = t;
      const rom = seen ? Math.max(0, Math.min(1, peak / def.full)) : 0.6, faults = rom < 0.7 ? ["Lift your knees higher"] : [];
      done = { score: Math.round(rom * 100), faults, dur: 0.5, rom: Math.round(rom * 100), side: s ? "R" : "L" };
    };
    for (const s of [0, 1]) {
      const o = 1 - s, above = v[s] >= UP && v[o] < 0.2;          // one knee up, the other one down
      if (above && !S.on[s]) {          // this knee goes up
        S.on[s] = true;
        // flicker inside the same lift continues it; a lift that starts just as the other knee comes down has to be a
        // clear one (the model sometimes swaps the legs for a frame)
        if (t - S.lastUp[s] >= MERGE) { S.peak[s] = 0; S.ok[s] = true; S.bar[s] = t - S.lastUp[o] < SWAP ? Math.max(0.6, COUNT) : COUNT; }
      }
      if (above) {
        S.peak[s] = Math.max(S.peak[s], v[s]); S.lastUp[s] = t;
        if (S.ok[s] && S.peak[s] >= S.bar[s]) { step(s, S.peak[s], true); S.ok[s] = false; }
      } else if (v[s] < UP) S.on[s] = false;
    }
    /* Running in place fast, the model often can't see the knees rise at all (motion blur), but the hips still shift
       toward the standing leg on every step. Each swing of the hips to one side is a step of the other knee. */
    // Only trusted while the knees are being seen to lift now and then, so walking or jogging doesn't count.
    if (Math.max(v[0], v[1]) >= 0.35) S.anyLift = t;
    if (def.sway && gs.hp && gs.T) {
      const k = 1 - Math.exp(-dt / 900);
      S.swayX = S.swayX == null ? gs.hp.x : S.swayX + (gs.hp.x - S.swayX) * k;
      let side = (gs.hp.x - S.swayX) * gs.asp / gs.T; const TH = def.swayOn ?? 0.035;
      if (!(t - (S.anyLift ?? -1e9) < 3500)) side = 0;
      // hips toward the left of the picture (x smaller) = weight on the right leg = left knee up, as you face the camera
      if (side < -TH && S.sway !== -1) { if (S.sway) step(0, 0, false); S.sway = -1; }
      else if (side > TH && S.sway !== 1) { if (S.sway) step(1, 0, false); S.sway = 1; }
    }
    const cur = Math.max(v[0], v[1]);
    return {
      ...common, state: postureOk ? "ok" : "posture", hint: postureOk ? null : P.hint,
      phase: !ready ? "calibrating" : cur >= UP ? "bottom" : "top", value: v[0] - v[1], label: `${Math.round(Math.max(0, cur) * 100)}%`,
      prog: Math.max(0, Math.min(1, cur / def.full)), rep: done,
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
    st.hold = { held: 0, last: 0, secs: 0, good: 0 }; st.lift = null;
  }

  return { update, setExercise, resetSmoothing, rearm, get exercise() { return key; } };
}

export function framing(lm, def) {
  const level = def?.frame || "full";
  const ids = level === "full" ? [11, 12, 23, 24, 27, 28] : level === "knees" ? [11, 12, 23, 24, 25, 26] : [11, 12, 23, 24];
  const ys = ids.map(i => lm[i]).filter(p => (p.visibility ?? 0) > VIS).map(p => p.y);
  if (ys.length < 3) return null;
  const top = Math.min(...ys), bot = Math.max(...ys);
  const standing = !def || def.posture === "upright";
  if (level === "full" && standing && (def?.anchor === "feet" || def?.cat === "cardio") && !seen(lm, [27]) && !seen(lm, [28])) return "Step back so your feet are in the picture";
  if (top < 0.02 || (level === "full" && bot > 0.98)) return level === "full" ? "Step back so your whole body fits" : "Step back so your head and shoulders fit";
  if (bot - top < (level === "full" ? 0.35 : 0.18) && standing) return "Move closer to the camera";
  return null;
}
