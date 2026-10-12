/* FormIQ exercise catalog: what each exercise measures with the camera and how a rep or hold is judged.

   kind "swing": a rep is one movement away from rest and back (squat, push-up, curl...).
   kind "alt":   alternating sides; each side counts (high knees, twists, side bends...).
   kind "hold":  a pose held still; counts seconds held in good form (yoga, plank).
   No equipment is needed: exercises that are usually done with a ring, band or bar of weight are measured by
   the arm, leg or body movement the camera can see. Units: angles in degrees; body distances in torso lengths.
*/

export const L = { ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 };
export const VIS = 0.35;
export const seen = (lm, ids) => ids.every(i => (lm[i].visibility ?? 1) > VIS);
export const angle3 = (a, b, c) => {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z], v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], m = Math.hypot(...u) * Math.hypot(...v) || 1;
  return Math.acos(Math.max(-1, Math.min(1, d / m))) * 180 / Math.PI;
};
export const angle2 = (a, b, c, asp) => {
  const ab = Math.atan2(a.y - b.y, (a.x - b.x) * asp), cb = Math.atan2(c.y - b.y, (c.x - b.x) * asp);
  let d = Math.abs((ab - cb) * 180 / Math.PI); return d > 180 ? 360 - d : d;
};
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });
const avg = a => { const v = a.filter(x => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

/* Geometry for one frame. T = torso length (shoulders to hips) learned over the session, used as the body's size. */
export function geometry(img, world, asp, T) {
  const P = i => ({ x: img[i].x * asp, y: img[i].y });
  const ok = (...ids) => seen(img, ids);
  const pair = (a, b) => ok(a, b) ? mid(P(a), P(b)) : ok(a) ? P(a) : ok(b) ? P(b) : null;
  const ang = (i, j, k) => ok(i, j, k) ? (world ? angle3(world[i], world[j], world[k]) : angle2(img[i], img[j], img[k], asp)) : null;
  const sh = pair(11, 12), hp = pair(23, 24), an = pair(27, 28), kn = pair(25, 26), wr = pair(15, 16);
  const g = {
    img, world, asp, T, P, ok, sh, hp, an, kn, wr, ang,
    elbow: s => s === "l" ? ang(11, 13, 15) : ang(12, 14, 16),
    knee: s => s === "l" ? ang(23, 25, 27) : ang(24, 26, 28),
    hip: s => s === "l" ? ang(11, 23, 25) : ang(12, 24, 26),
    elbows: () => avg([g.elbow("l"), g.elbow("r")]),
    knees: () => avg([g.knee("l"), g.knee("r")]),
    kneeMin: () => { const a = [g.knee("l"), g.knee("r")].filter(x => x != null); return a.length ? Math.min(...a) : null; },
    // hands above shoulders (0 = shoulder height, ~1.2 overhead, ~-1 at the hips)
    armsUp: () => avg([[11, 15], [12, 16]].map(([s, w]) => ok(s, w) ? (img[s].y - img[w].y) / T : null)),
    // knee height: ~0 standing, ~1 thigh level with hip
    kneeUp: s => { const [h, k] = s === "l" ? [23, 25] : [24, 26]; return ok(h, k) ? (img[h].y - img[k].y) / T + 0.9 : null; },
    kneeDiff: () => { const a = g.kneeUp("l"), b = g.kneeUp("r"); return a != null && b != null ? a - b : null; },
    // torso turn relative to the hips (needs the 3D pose); +/- = left/right
    twist: () => {
      if (!world || !ok(11, 12, 23, 24)) return null;
      const s = Math.atan2(world[12].z - world[11].z, world[12].x - world[11].x), h = Math.atan2(world[24].z - world[23].z, world[24].x - world[23].x);
      let d = (s - h) * 180 / Math.PI; while (d > 180) d -= 360; while (d < -180) d += 360; return d;
    },
    // sideways lean of the torso as seen by the camera; +/- = left/right
    sideBend: () => sh && hp ? Math.atan2(sh.x - hp.x, hp.y - sh.y) * 180 / Math.PI : null,
    // forward lean from upright, 0-180 (uses 3D so it also works facing the camera)
    lean: () => {
      if (!ok(11, 23) && !ok(12, 24)) return null;
      const W = world || img, k = world ? 1 : asp;
      const s = ok(11, 12) ? mid(W[11], W[12]) : W[ok(11) ? 11 : 12], h = ok(23, 24) ? mid(W[23], W[24]) : W[ok(23) ? 23 : 24];
      const dx = (s.x - h.x) * k, dy = s.y - h.y, dz = world ? s.z - h.z : 0;
      return Math.acos(Math.max(-1, Math.min(1, -dy / (Math.hypot(dx, dy, dz) || 1)))) * 180 / Math.PI;
    },
    hipShift: () => hp && an ? (hp.x - an.x) / T : null,
    hipX: () => hp ? hp.x / T : null,
    footSpread: () => ok(27, 28) ? Math.abs(P(27).x - P(28).x) / T : null,
    kneeGap: () => ok(25, 26) ? Math.abs(P(25).x - P(26).x) / T : null,
    handSpread: () => ok(15, 16) ? Math.abs(P(15).x - P(16).x) / T : null,
    handsX: () => wr && hp ? (wr.x - hp.x) / T : null,
    handsTilt: () => wr && sh ? (wr.x - sh.x) / T : null,
    // jump height: how far both feet AND the hips are above their resting level, so lifting one foot (a knee
    // lift, a jog step), bending down (a squat) or sitting up never reads as a jump.
    feetUp: mem => {
      if (!ok(27, 28) || !hp) return null;
      const ground = i => {   // each foot's resting spot: its lowest recent position
        const y = img[i].y, k = "g" + i;
        mem[k] = mem[k] == null || y > mem[k] ? y : mem[k] + (y - mem[k]) * 0.004;
        return mem[k] - y;
      };
      mem.hip = mem.hip == null ? hp.y : mem.hip + (hp.y - mem.hip) * 0.02;   // the hips' usual height
      return Math.min(ground(27), ground(28), mem.hip - hp.y) / T;
    },
    anklesUp: () => an && hp ? (hp.y - an.y) / T : null,
    ankleDiffY: () => ok(27, 28) ? (img[27].y - img[28].y) / T : null,
    ankleDiffX: () => ok(27, 28) ? (P(27).x - P(28).x) / T : null,
    bridge: () => avg([g.hip("l"), g.hip("r")]),
    pike: () => avg([ang(11, 23, 27), ang(12, 24, 28)]),
    climber: () => { const a = g.hip("l"), b = g.hip("r"); return a != null && b != null ? a - b : null; },
    // hip height over shin length: ~2 standing straight, ~1 at a parallel squat
    legRatio: () => avg([[23, 25, 27], [24, 26, 28]].map(([h, k, a]) => {
      if (!ok(h, k, a)) return null; const sh = Math.hypot((img[k].x - img[a].x) * asp, img[k].y - img[a].y);
      return sh > 0.03 ? (img[a].y - img[h].y) / sh : null; })),
    shoulderLift: () => sh && hp ? (hp.y - sh.y) / T : null,
    headUp: () => sh && ok(0) ? (sh.y - img[0].y) / T : null,
    armReachUp: () => { const a = [[11, 15], [12, 16]].filter(([s, w]) => ok(s, w)).map(([s, w]) => (img[s].y - img[w].y) / T); return a.length ? Math.max(...a) : null; },
    elbowsBack: () => world ? avg([[11, 13], [12, 14]].map(([s, e]) => ok(s, e) ? world[e].z - world[s].z : null)) : null,
    feetX: () => an && hp ? (an.x - hp.x) / T : null,
    // a hand pulled across the body: 1 = at its own shoulder, 0 = middle of the chest, below 0 = crossed over
    crossed: () => {
      if (!ok(11, 12) || !sh) return null;
      const r = [[11, 15], [12, 16]].filter(([s, w]) => ok(w)).map(([s, w]) => (P(w).x - sh.x) / ((P(s).x - sh.x) || 1e-6));
      return r.length ? Math.min(...r) : null;
    },
    // one elbow pointing up with the hand dropped behind the head
    tricepsUp: () => [[11, 13, 15], [12, 14, 16]].some(([s, e, w]) => ok(s, e, w) && img[e].y < img[s].y - 0.25 * T && img[w].y > img[e].y),
    // one upper arm out to the side at shoulder height with the elbow bent (forearm up, as on a doorframe)
    armOnFrame: () => [[11, 13, 15], [12, 14, 16]].some(([s, e, w]) => ok(s, e, w) && Math.abs(img[e].y - img[s].y) < 0.3 * T && Math.abs(P(e).x - P(s).x) > 0.3 * T && img[w].y < img[e].y),
    // one arm straight out in front at shoulder height
    armForward: () => [[11, 13, 15], [12, 14, 16]].some(([s, e, w]) => ok(s, e, w) && (ang(s, e, w) ?? 0) > 145 && Math.abs(img[w].y - img[s].y) < 0.35 * T),
    // forward lean toward the feet (side view): + leaning over the legs, - leaning back
    leanToFeet: () => {
      if (!sh || !hp || !an) return null;
      const dir = Math.sign(an.x - hp.x) || 1;
      return Math.atan2((sh.x - hp.x) * dir, hp.y - sh.y) * 180 / Math.PI;
    },
    kneeMax: () => { const a = [g.knee("l"), g.knee("r")].filter(x => x != null); return a.length ? Math.max(...a) : null; },
    // a heel pulled up behind (standing quad stretch)
    heelUp: () => [[23, 25, 27, 28], [24, 26, 28, 27]].some(([h, k, a, o]) => ok(h, k, a, o) && (ang(h, k, a) ?? 180) < 80 && img[o].y - img[a].y > 0.5 * T),
    // one shin flat on the floor (half-kneeling)
    shinDown: () => [[25, 27], [26, 28]].some(([k, a]) => ok(k, a) && Math.abs(img[k].y - img[a].y) < 0.2 * T),
    // an ankle resting on the other knee (figure-four)
    ankleOnKnee: () => [[27, 26], [28, 25]].some(([a, k]) => ok(a, k) && Math.hypot(P(a).x - P(k).x, img[a].y - img[k].y) < 0.45 * T),
    feetApartX: () => ok(27, 28) ? Math.abs(P(27).x - P(28).x) / T : null,
    footHigh: () => ok(27, 28) ? Math.abs(img[27].y - img[28].y) / T : null,
  };
  return g;
}

/* Body positions. vert: 1 = torso upright, 0 = horizontal. */
const propped = g => {
  const below = (a, b) => g.ok(a, b) && g.img[b].y - g.img[a].y > 0.45 * g.T;
  return below(11, 15) || below(12, 16) || below(11, 13) || below(12, 14);
};
export const POSTURES = {
  upright: { ok: (g, v) => v > 0.55, hint: "Stand up straight to start", lost: v => v < 0.15 },
  plank: { ok: (g, v) => Math.abs(v) < 0.5, hint: "Get into push-up position", lost: v => Math.abs(v) > 0.75 },
  // on your back: horizontal and not propped up on your hands or elbows (that's a plank)
  lying: { ok: (g, v) => Math.abs(v) < 0.5 && !propped(g), hint: "Lie down on your back", lost: v => v > 0.8 },
  situp: { ok: (g, v) => v < 0.7 && v > -0.5 && !propped(g), hint: "Lie down on your back", lost: () => false },
  floor: {   // sitting or lying on the floor: feet not far below the hips
    ok: (g, v) => { const a = g.anklesUp(); return v < 0.95 && (a != null ? a > -0.9 : (g.kn && g.hp ? (g.kn.y - g.hp.y) / g.T < 0.5 : false)); },
    hint: "Sit on the floor to start", lost: () => false },
  seated: {
    ok: (g, v) => { const a = g.anklesUp(); return v > 0.2 && (a != null ? a > -0.9 : (g.kn && g.hp ? (g.kn.y - g.hp.y) / g.T < 0.5 : false)); },
    hint: "Sit on the floor to start", lost: () => false },
  hanging: { ok: g => g.wr && g.sh && g.wr.y < g.sh.y - 0.4 * g.T, hint: "Hang from the bar to start", lost: () => false },
  any: { ok: () => true, hint: "", lost: () => false },
};

/* ---------- the catalog ---------- */
const S = (o) => ({ kind: "swing", posture: "upright", unit: "reps", target: 10, extra: () => ({}), track() {}, faults: () => [], ...o });
const A = (o) => ({ kind: "alt", posture: "upright", unit: "reps", target: 20, center: true, ...o });
const H = (o) => ({ kind: "hold", posture: "any", unit: "sec", target: 30, ...o });

const squatValue = (c) => {   // depth: 0 standing, ~0.5 hips level with knees
  const g = c.g, r = [], th = [];
  for (const [h, k, a] of [[23, 25, 27], [24, 26, 28]]) {
    if (!g.ok(h, k)) continue;
    th.push(g.img[k].y - g.img[h].y);
    if (!g.ok(a)) continue;
    const shin = Math.hypot((g.img[k].x - g.img[a].x) * g.asp, g.img[k].y - g.img[a].y);
    if (shin > 0.03) r.push((g.img[a].y - g.img[h].y) / shin);
  }
  if (r.length) {
    const ratio = avg(r);
    if (th.length) c.calib("thigh", avg(th), c.resting);
    const ref = c.calib("stand", ratio, c.resting);
    return ref ? Math.max(0, 1 - ratio / ref) : 0;
  }
  if (th.length) {   // feet out of the picture: use how far the hips drop toward the knees
    const ref = c.calib("thigh", avg(th), c.resting, true);
    return ref ? Math.max(0, 0.5 * (1 - avg(th) / ref)) : null;
  }
  return null;
};
const leanFault = (f) => f.maxLean > 50 ? ["Chest up, too much forward lean"] : [];
const squatExtra = (c) => {
  const s = c.side, g = c.g;
  if (!g.ok(L[s + "h"], L[s + "s"])) return {};
  const h = g.img[L[s + "h"]], sh = g.img[L[s + "s"]];
  return { lean: Math.abs(Math.atan2((sh.x - h.x) * g.asp, h.y - sh.y) * 180 / Math.PI), spread: g.footSpread(), arms: g.armsUp() };
};
const squatTrack = (f, m, phase) => {
  if (phase !== "bottom") return;
  if (m.lean != null) f.maxLean = Math.max(f.maxLean || 0, m.lean);
  if (m.spread != null) f.minSpread = Math.min(f.minSpread ?? 9, m.spread);
  if (m.arms != null) f.minArms = Math.min(f.minArms ?? 9, m.arms);
};
const lunging = g => { const k = g.kneeMin(); return k != null && k < 140; };

export const CATS = [
  ["strength", "Strength"], ["arms", "Arms"], ["core", "Core"], ["legs", "Legs"], ["cardio", "Cardio"], ["stretch", "Stretch"], ["yoga", "Yoga & holds"],
];

export const EX = {
  /* ----- strength ----- */
  squat: S({ name: "Squat", cat: "strength", view: "front or side", dir: "up", travel: 0.13, full: 0.42, show: "depth", anchor: "feet",
    how: "Feet shoulder-width apart. Sit your hips back and down until your thighs are about level with the floor, then stand tall.",
    value: squatValue, extra: squatExtra, track: squatTrack, faults: leanFault }),
  pushup: S({ name: "Push-up", cat: "strength", view: "side", dir: "down", travel: 28, full: 60, abs: [115, 85], posture: "plank", anchor: "hands", bothArms: true,
    how: "Hands under your shoulders, body in a straight line. Lower your chest toward the floor and push back up.",
    value: c => c.ang("s", "e", "w"), extra: c => ({ line: c.ang("s", "h", "a") }),
    track(f, m) { if (m.line != null) f.minLine = Math.min(f.minLine ?? 180, m.line); },
    faults: f => f.minLine < 150 ? ["Keep hips in line with shoulders and ankles"] : [] }),
  pullup: S({ name: "Pull-up", cat: "strength", view: "front or back", dir: "down", travel: 45, full: 80, abs: [110, 70], posture: "hanging", bothArms: true, target: 8,
    how: "Hang from a bar with straight arms. Pull until your chin passes the bar, then lower all the way down.",
    value: c => c.ang("s", "e", "w") }),
  curl: S({ name: "Bicep curl", cat: "strength", view: "front", dir: "down", travel: 40, full: 65, abs: [90, 50], anchor: "feet", eitherArm: true,
    how: "Elbows at your sides. Curl your hands up to your shoulders and lower slowly. Works with dumbbells, bottles or no weight.",
    value: c => c.ang("s", "e", "w"),
    extra(c) {
      const s = c.side, g = c.g;
      if (!g.ok(L[s + "s"], L[s + "e"], L[s + "h"])) return {};
      const sh = g.img[L[s + "s"]], e = g.img[L[s + "e"]], h = g.img[L[s + "h"]];
      return { drift: Math.abs(e.x - sh.x) * g.asp / (Math.hypot((sh.x - h.x) * g.asp, sh.y - h.y) || 1) };
    },
    track(f, m) { if (m.drift != null) f.maxDrift = Math.max(f.maxDrift || 0, m.drift); },
    faults: f => f.maxDrift > 0.4 ? ["Pin elbows to your sides"] : [] }),
  press: S({ name: "Overhead press", cat: "arms", view: "front", dir: "up", travel: 40, full: 65, abs: [145, 170], anchor: "feet", bothArms: true,
    how: "Hands at shoulder height. Press straight up until your arms are straight overhead, then lower.",
    value: c => c.ang("s", "e", "w") }),
  lunge: S({ name: "Lunge", cat: "strength", view: "side or front", dir: "down", travel: 30, full: 60, abs: [125, 95],
    how: "Step one foot forward and lower until both knees bend to about 90°. Push back up. Alternate legs.",
    value: c => c.g.kneeMin() }),

  /* ----- arms ----- */
  frontraise: S({ name: "Front raise", cat: "arms", view: "side or front", dir: "up", travel: 0.55, full: 0.9, bothArms: false,
    how: "Arms straight down in front of you. Raise them to shoulder height, then lower slowly.",
    value: c => c.g.armsUp() }),
  behindhead: S({ name: "Behind-the-head press", cat: "arms", view: "front", dir: "up", travel: 35, full: 65, abs: [130, 165], bothArms: true,
    how: "Hands behind your head, elbows pointing up. Straighten your arms overhead, then bend them back down behind your head.",
    value: c => c.ang("s", "e", "w") }),
  bowpull: S({ name: "Bow pull", cat: "arms", view: "front", dir: "down", travel: 50, full: 80, eitherArm: true,
    how: "One foot forward, both arms out in front. Draw one hand back to your cheek like pulling a bow, then return. Alternate sides.",
    value: c => c.ang("s", "e", "w") }),
  shoulderpress: S({ name: "One-arm shoulder press", cat: "arms", view: "front", dir: "up", travel: 40, full: 65, abs: [145, 170], eitherArm: true,
    how: "One hand at your shoulder. Press it straight up overhead and lower. Alternate arms or do one side at a time.",
    value: c => c.ang("s", "e", "w") }),
  kickback: S({ name: "Triceps kickback", cat: "arms", view: "side", dir: "up", travel: 40, full: 70, posture: "any", bothArms: true,
    how: "Lean forward with a flat back, upper arms along your body. Straighten your elbows to push your hands back, then bend.",
    value: c => c.ang("s", "e", "w") }),
  armtwist: A({ name: "Overhead arm twist", cat: "arms", view: "front", thr: 0.22, full: 0.6,
    how: "Arms straight up, hands together. Swing your hands left and right overhead.",
    value: c => (c.g.armsUp() ?? 0) > 0.5 ? c.g.handsTilt() : null }),
  armspin: A({ name: "Overhead arm circles", cat: "arms", view: "front", thr: 0.18, full: 0.5, perPair: true,
    how: "Arms up, hands together. Draw big circles overhead. Each full circle counts.",
    value: c => (c.g.armsUp() ?? 0) > 0.4 ? c.g.handsTilt() : null }),

  /* ----- core ----- */
  sidebend: A({ name: "Overhead side bend", cat: "core", view: "front", thr: 12, full: 30,
    how: "Arms overhead, feet hip-width apart. Bend to one side, back to the middle, then the other side.",
    value: c => c.g.sideBend() }),
  standtwist: A({ name: "Standing twist", cat: "core", view: "front", thr: 20, full: 45,
    how: "Feet planted, arms out in front. Turn your upper body left and right while your hips face forward.",
    value: c => c.g.twist() }),
  lungetwist: A({ name: "Lunge twist", cat: "core", view: "front", thr: 20, full: 45,
    how: "Hold a lunge with arms overhead. Twist your upper body toward your front leg, then the other way.",
    value: c => lunging(c.g) || c.g.kneeMin() == null ? c.g.twist() : null }),
  pendulum: A({ name: "Pendulum bend", cat: "core", view: "front", thr: 0.35, full: 0.8, posture: "any",
    how: "Lean forward from the hips with arms hanging down. Swing your hands side to side like a pendulum.",
    value: c => c.g.handsX() }),
  overheadbend: S({ name: "Overhead bend", cat: "core", view: "side", dir: "up", travel: 30, full: 60,
    how: "Arms overhead. Hinge forward from the hips with a flat back, then rise back up.",
    value: c => c.g.lean() }),
  hipshake: A({ name: "Overhead hip shake", cat: "core", view: "front", thr: 0.1, full: 0.25,
    how: "Arms overhead, feet planted. Shift your hips side to side.",
    value: c => c.g.hipShift() }),
  kneetochest: S({ name: "Knee-to-chest", cat: "core", view: "side", dir: "down", travel: 30, full: 60, posture: "floor",
    how: "Sit with legs out, leaning back on your hands. Pull your knees in to your chest, then stretch your legs out.",
    value: c => c.g.bridge() }),
  seatedpress: S({ name: "Seated forward press", cat: "core", view: "side", dir: "up", travel: 40, full: 70, posture: "seated", bothArms: true,
    how: "Sit with legs apart. Start with hands at your chest and press them straight out in front, then pull back.",
    value: c => c.ang("s", "e", "w") }),
  plankpike: S({ name: "Plank hip lift", cat: "core", view: "side", dir: "down", travel: 22, full: 45, posture: "plank",
    how: "Forearm plank. Raise your hips up toward the ceiling, then lower back to a straight line.",
    value: c => c.g.pike() }),
  legraise: S({ name: "Leg raise", cat: "core", view: "side", dir: "up", travel: 0.3, full: 0.7, posture: "floor",
    how: "Sit or lie back with legs straight. Lift both feet off the floor, then lower without resting.",
    value: c => c.g.anklesUp() }),
  openclose: S({ name: "Open & close leg raise", cat: "core", view: "front", dir: "up", travel: 0.4, full: 1.0, posture: "floor",
    how: "Sit leaning back with feet lifted. Open your legs wide, then bring them together.",
    value: c => c.g.footSpread() }),
  russiantwist: A({ name: "Russian twist", cat: "core", view: "front", thr: 18, full: 40, posture: "seated",
    how: "Sit with knees bent and feet down or lifted, leaning back slightly. Turn your upper body side to side.",
    value: c => c.g.twist() }),
  flutter: A({ name: "Flutter kick", cat: "core", view: "side", thr: 0.12, full: 0.35, posture: "floor",
    how: "Lie or sit back with legs straight and lifted a little. Kick your feet up and down, one then the other.",
    value: c => c.g.ankleDiffY() }),
  seatedraise: S({ name: "Seated arm raise", cat: "core", view: "front or side", dir: "up", travel: 0.6, full: 1.0, posture: "seated",
    how: "Sit with knees bent. Raise your arms from your knees to straight overhead, then lower.",
    value: c => c.g.armsUp() }),
  scissors: A({ name: "Leg scissors", cat: "core", view: "front", thr: 0.12, full: 0.35, posture: "floor",
    how: "Sit back with legs lifted. Cross your legs over each other quickly, alternating which is on top.",
    value: c => c.g.ankleDiffX() }),
  crunch: S({ name: "Crunch", cat: "core", view: "side", dir: "down", travel: 9, full: 18, posture: "lying",
    how: "Lie on your back, knees bent. Curl your shoulders up off the floor, then lower.",
    value: c => c.g.lean() }),

  situp: S({ name: "Sit-up", cat: "core", view: "side", dir: "down", travel: 30, full: 60, posture: "situp",
    how: "Lie on your back, knees bent, feet flat. Sit all the way up, then lower back down with control.",
    value: c => c.g.lean() }),

  /* ----- legs ----- */
  widesquat: S({ name: "Wide squat", cat: "legs", view: "front", dir: "up", travel: 0.13, full: 0.4, show: "depth", anchor: "feet",
    how: "Feet wider than your shoulders, toes turned out. Squat down keeping knees over toes, then stand.",
    value: squatValue, extra: squatExtra, track: squatTrack,
    faults: f => [...leanFault(f), ...(f.minSpread != null && f.minSpread < 0.9 ? ["Take a wider stance"] : [])] }),
  overheadsquat: S({ name: "Overhead squat", cat: "legs", view: "front or side", dir: "up", travel: 0.13, full: 0.4, show: "depth", anchor: "feet",
    how: "Arms straight overhead the whole time. Squat down and stand back up.",
    value: squatValue, extra: squatExtra, track: squatTrack,
    faults: f => [...leanFault(f), ...(f.minArms != null && f.minArms < 0.5 ? ["Keep your arms overhead"] : [])] }),
  kneesqueeze: S({ name: "Seated knee squeeze", cat: "legs", view: "front", dir: "down", travel: 0.15, full: 0.35, posture: "seated",
    how: "Sit with knees bent and apart (a cushion or ball between them helps). Squeeze your knees together, then release.",
    value: c => c.g.kneeGap() }),
  bridge: S({ name: "Hip lift (glute bridge)", cat: "legs", view: "side", dir: "up", travel: 18, full: 40, posture: "lying",
    how: "Lie on your back, knees bent, feet flat. Lift your hips until your body is straight from shoulders to knees, then lower.",
    value: c => c.g.bridge() }),
  kneelift: A({ name: "Knee lift", cat: "legs", view: "front or side", thr: 0.3, full: 0.8,
    how: "Stand tall. Lift one knee to hip height, lower it, then the other.",
    value: c => c.g.kneeDiff() }),
  sidestep: A({ name: "Side step", cat: "legs", view: "front", thr: 0.35, full: 0.8,
    how: "Step to the side and bring your feet together, then step the other way. Raise your arms as you step if you like.",
    value: c => c.g.hipX() }),
  armraisecombo: S({ name: "Arm raise combo", cat: "legs", view: "front", dir: "up", travel: 0.8, full: 1.4,
    how: "Stand tall. Raise both arms from your sides to straight overhead and lower, keeping a steady rhythm.",
    value: c => c.g.armsUp() }),
  kneeliftcombo: A({ name: "Knee lift & arm raise", cat: "legs", view: "front", thr: 0.3, full: 0.8,
    how: "Lift one knee while raising your arms overhead, lower both, then switch knees.",
    value: c => c.g.kneeDiff() }),

  /* ----- cardio ----- */
  jog: A({ name: "Jog in place", cat: "cardio", view: "front or side", thr: 0.06, full: 0.3, target: 60,
    how: "Jog on the spot, lifting your knees a little. Each step counts.",
    value: c => c.g.kneeDiff() }),
  highknees: A({ name: "High knees", cat: "cardio", view: "front or side", thr: 0.35, full: 0.9, target: 40,
    how: "Run on the spot, driving each knee up to hip height. Each knee counts.",
    value: c => c.g.kneeDiff() }),
  jumprope: S({ name: "Jump rope", cat: "cardio", view: "front or side", dir: "up", travel: 0.035, full: 0.12, target: 50, slowRest: true, minDur: 80, maxDur: 700,
    how: "Small, quick hops on both feet, with or without a rope. Each jump counts. Keep your whole body, feet included, in view.",
    value: c => c.g.feetUp(c.mem) }),
  jacks: S({ name: "Jumping jacks", cat: "cardio", view: "front", dir: "up", travel: 0.9, full: 1.6, target: 30,
    how: "Jump your feet apart while raising your arms overhead, then jump back together with arms down.",
    value: c => c.g.armsUp() }),
  climber: A({ name: "Mountain climber", cat: "cardio", view: "side", thr: 25, full: 60, posture: "plank", target: 30,
    how: "Push-up position. Drive one knee toward your chest, then switch legs quickly.",
    value: c => c.g.climber() }),


  /* ----- stretch & mobility: moving (dynamic) stretches count reps or sides, still (static) ones are timed ----- */
  armcircles: A({ name: "Arm circles", cat: "stretch", stretch: "dynamic", view: "front", thr: 0.1, full: 0.3, perPair: true, target: 10,
    how: "Stand tall with arms straight out to the sides. Make controlled circles; reverse halfway. Each circle counts.",
    value: c => (c.g.handSpread() ?? 0) > 1.5 ? c.g.armsUp() : null }),
  shoulderrolls: S({ name: "Shoulder rolls", cat: "stretch", stretch: "dynamic", view: "front", dir: "up", travel: 0.05, full: 0.12, target: 10, cardioPace: true,
    how: "Arms relaxed. Roll your shoulders up, back and down. Reverse direction halfway.",
    value: c => c.g.shoulderLift() }),
  armswings: S({ name: "Cross-body arm swings", cat: "stretch", stretch: "dynamic", view: "front", dir: "up", travel: 1.0, full: 1.8, target: 12, cardioPace: true,
    how: "Swing both arms across your chest, then open them wide. Stay relaxed.",
    value: c => c.g.handSpread() }),
  scapsqueeze: S({ name: "Shoulder blade squeezes", cat: "stretch", stretch: "dynamic", view: "front", dir: "up", travel: 0.05, full: 0.1, target: 12,
    how: "Elbows bent at your sides. Draw your elbows and shoulder blades back together, then release. Don't shrug.",
    value: c => c.g.elbowsBack() }),
  trunkrot: A({ name: "Standing trunk rotations", cat: "stretch", stretch: "dynamic", view: "front", thr: 18, full: 40, target: 16,
    how: "Rotate your upper body gently left and right, keeping your hips facing forward.",
    value: c => c.g.twist() }),
  catcow: A({ name: "Cat-cow", cat: "stretch", stretch: "dynamic", view: "side", thr: 0.12, full: 0.3, perPair: true, posture: "plank", target: 8,
    how: "On hands and knees. Round your back and drop your head (cat), then arch and look up (cow). Each cat and cow counts once.",
    value: c => c.g.headUp() }),
  threadneedle: S({ name: "Thread the needle", cat: "stretch", stretch: "dynamic", view: "side or front", dir: "up", travel: 0.6, full: 1.0, posture: "plank", target: 8,
    how: "On hands and knees. Reach one arm under your body, then rotate and reach it up to the ceiling. Alternate sides.",
    value: c => c.g.armReachUp() }),
  hipcircles: A({ name: "Hip circles", cat: "stretch", stretch: "dynamic", view: "front", thr: 0.06, full: 0.15, perPair: true, target: 10,
    how: "Hands on hips, feet planted. Circle your hips slowly; switch direction halfway. Each circle counts.",
    value: c => c.g.hipShift() }),
  legswingfb: A({ name: "Front-to-back leg swings", cat: "stretch", stretch: "dynamic", view: "side", thr: 0.2, full: 0.7, perPair: true, target: 10,
    how: "Hold a chair or wall for balance. Swing one leg forward and back comfortably, then switch legs. Each swing counts.",
    value: c => c.g.feetX() }),
  legswingside: A({ name: "Side-to-side leg swings", cat: "stretch", stretch: "dynamic", view: "front", thr: 0.2, full: 0.6, perPair: true, target: 10,
    how: "Hold a support. Swing one leg across your body and out to the side, then switch legs. Each swing counts.",
    value: c => c.g.feetX() }),
  kneehugs: A({ name: "Knee hugs", cat: "stretch", stretch: "dynamic", view: "front or side", thr: 0.45, full: 1.0, target: 10,
    how: "Lift one knee and hug it to your chest for a moment, then switch. Step forward between hugs if you have room.",
    value: c => c.g.kneeDiff() }),
  laterallunge: A({ name: "Alternating side lunges", cat: "stretch", stretch: "dynamic", view: "front", thr: 0.22, full: 0.5, target: 10,
    how: "Feet wide. Shift to one side, bending that knee and keeping the other leg straight. Then shift to the other side.",
    value: c => c.g.hipShift() }),
  crossbody: H({ name: "Cross-body shoulder stretch", cat: "stretch", stretch: "static", view: "front", posture: "upright",
    how: "Bring one arm across your chest and hold it above the elbow with the other hand. Hold, then switch sides.",
    check: g => (g.crossed() ?? 1) > -0.2 ? "Pull one arm across your chest" : "" }),
  tricepsstretch: H({ name: "Overhead triceps stretch", cat: "stretch", stretch: "static", view: "front", posture: "upright",
    how: "Raise one arm, bend the elbow so your hand drops behind your head, and gently hold the elbow. Switch sides.",
    check: g => g.tricepsUp() ? "" : "Point one elbow up with the hand behind your head" }),
  chest: H({ name: "Doorway chest stretch", cat: "stretch", stretch: "static", view: "front", posture: "upright",
    how: "Forearm on a doorframe or wall, elbow at shoulder height. Gently turn your body away. Switch sides.",
    check: g => g.armOnFrame() ? "" : "Raise one arm out to the side, elbow bent at shoulder height" }),
  wrist: H({ name: "Wrist flexor stretch", cat: "stretch", stretch: "static", view: "side", posture: "upright",
    how: "Hold one arm straight out in front, palm up, and gently pull the fingers down with the other hand. Switch sides.",
    check: g => g.armForward() ? "" : "Hold one arm straight out in front" }),
  child: H({ name: "Child's pose", cat: "stretch", stretch: "static", view: "side",
    how: "Kneel, sit back toward your heels and reach your arms forward on the floor. Breathe steadily.",
    check: g => { const l = g.lean(), a = g.anklesUp(); return l == null ? "Turn side-on" : l < 70 ? "Fold forward, arms reaching ahead" : a != null && a < -0.6 ? "Sit back toward your heels" : ""; } }),
  supinetwist: H({ name: "Lying spinal twist", cat: "stretch", stretch: "static", view: "front or side", posture: "lying",
    how: "Lie on your back and guide one bent knee across your body toward the floor. Hold, then switch sides.",
    check: g => Math.abs(g.twist() ?? 0) < 20 ? "Let your knee drop across your body" : "" }),
  hamstring: H({ name: "Seated hamstring stretch", cat: "stretch", stretch: "static", view: "side", posture: "floor",
    how: "Sit with one leg straight out. Hinge forward from the hips toward your foot without rounding your back. Switch legs.",
    check: g => (g.kneeMax() ?? 0) < 150 ? "Straighten one leg out in front" : (g.leanToFeet() ?? 0) < 20 ? "Lean forward over your straight leg" : "" }),
  quad: H({ name: "Standing quad stretch", cat: "stretch", stretch: "static", view: "side", posture: "upright",
    how: "Hold a chair or wall. Bend one knee and bring your heel toward your seat, knees side by side. Switch legs.",
    check: g => g.heelUp() ? "" : "Pull one heel up behind you" }),
  calf: H({ name: "Wall calf stretch", cat: "stretch", stretch: "static", view: "side",
    how: "Hands on a wall, step one leg back and press that heel down with the knee straight. Switch legs.",
    check: g => (g.feetApartX() ?? 0) < 0.6 ? "Step one foot back" : (g.kneeMax() ?? 0) < 155 ? "Straighten your back leg" : (g.kneeMin() ?? 180) > 150 ? "Bend your front knee, leaning into the wall" : "" }),
  hipflexor: H({ name: "Kneeling hip flexor stretch", cat: "stretch", stretch: "static", view: "side",
    how: "Kneel on one knee with the other foot in front. Tuck your hips and shift gently forward. Switch sides.",
    check: g => !g.shinDown() ? "Kneel with one shin on the floor" : (g.kneeMin() ?? 180) > 130 ? "Front foot forward, knee bent" : (g.lean() ?? 90) > 35 ? "Keep your chest up" : "" }),
  figure4: H({ name: "Figure-four glute stretch", cat: "stretch", stretch: "static", view: "side", posture: "lying",
    how: "Lie on your back, cross one ankle over the other knee and gently draw both legs toward your chest. Switch sides.",
    check: g => g.ankleOnKnee() ? "" : "Rest one ankle on the other knee" }),

  /* ----- yoga & holds ----- */
  plank: H({ name: "Plank", cat: "yoga", view: "side", posture: "plank",
    how: "Forearms or hands on the floor, body in a straight line from head to heels. Hold.",
    check: g => { const p = g.pike(); return p == null || p > 150 ? "" : "Lower your hips into a straight line"; } }),
  chair: H({ name: "Chair pose", cat: "yoga", view: "front or side", posture: "upright",
    how: "Feet together, bend your knees as if sitting back into a chair, arms reaching up. Hold.",
    check: g => (g.legRatio() ?? 9) > 1.75 ? "Bend your knees more" : (g.armsUp() ?? 0) < 0.4 ? "Reach your arms up" : "" }),
  tree: H({ name: "Tree pose", cat: "yoga", view: "front", posture: "upright",
    how: "Stand on one leg with the other foot on your inner calf or thigh, hands together. Hold, then switch legs.",
    check: g => (g.footHigh() ?? 0) < 0.3 ? "Lift one foot onto your other leg" : "" }),
  hinge: H({ name: "Hinge pose", cat: "yoga", view: "side",
    how: "Stand with soft knees and hinge forward until your back is nearly flat, one arm reaching forward. Hold.",
    check: g => { const l = g.lean(); return l == null ? "Turn side-on" : l < 45 ? "Hinge further forward" : l > 115 ? "Lift your chest a little" : ""; } }),
  crescent: H({ name: "Revolved crescent lunge", cat: "yoga", view: "front",
    how: "Lunge with your back heel lifted, palms together, and twist your chest toward your front leg. Hold, then switch.",
    check: g => !lunging(g) ? "Bend into a lunge" : Math.abs(g.twist() ?? 0) < 18 ? "Twist your upper body" : "" }),
  warrior1: H({ name: "Warrior I", cat: "yoga", view: "front or side",
    how: "Lunge with your back foot turned out and arms straight overhead. Hold, then switch.",
    check: g => !lunging(g) ? "Bend your front knee" : (g.armsUp() ?? 0) < 0.6 ? "Reach your arms overhead" : "" }),
  warrior2: H({ name: "Warrior II", cat: "yoga", view: "front",
    how: "Wide stance, front knee bent, arms stretched out to the sides at shoulder height. Hold, then switch.",
    check: g => !lunging(g) ? "Bend your front knee" : (g.handSpread() ?? 0) < 1.8 || Math.abs(g.armsUp() ?? 9) > 0.4 ? "Stretch your arms out to the sides" : "" }),
  warrior3: H({ name: "Warrior III", cat: "yoga", view: "side",
    how: "Balance on one leg, lean forward and lift the other leg behind you until your body is level. Hold, then switch.",
    check: g => (g.footHigh() ?? 0) < 0.7 ? "Lift your back leg higher" : (g.lean() ?? 0) < 55 ? "Lean your chest forward" : "" }),
  fan: H({ name: "Seated side bend", cat: "stretch", view: "front", posture: "seated", stretch: "static",
    how: "Sit with legs wide. Reach one arm overhead and lean to the side. Hold, then switch.",
    check: g => Math.abs(g.sideBend() ?? 0) < 15 ? "Lean further to the side" : "" }),
  boat: H({ name: "Boat pose", cat: "yoga", view: "side", posture: "floor",
    how: "Sit, lean back and lift your legs so your body makes a V. Arms forward or on the floor. Hold.",
    check: g => (g.anklesUp() ?? -9) < 0.1 ? "Lift your feet higher" : "" }),
  forwardfold: H({ name: "Standing forward fold", cat: "yoga", view: "side",
    how: "Feet hip-width, fold forward from the hips and let your head and arms hang. Hold.",
    check: g => (g.lean() ?? 0) < 70 ? "Fold further forward" : "" }),
};

/* Ready-made circuits: each step is [exercise, target]. */
for (const k in EX) EX[k].key = k;

export const CIRCUITS = [
  { id: "starter", name: "Starter full body (≈10 min)", steps: [["jog", 60], ["squat", 10], ["pushup", 8], ["standtwist", 20], ["bridge", 12], ["plank", 20], ["forwardfold", 20]] },
  { id: "legs", name: "Leg day", steps: [["jog", 60], ["squat", 12], ["widesquat", 10], ["lunge", 12], ["kneelift", 20], ["bridge", 15], ["chair", 30]] },
  { id: "core", name: "Core burner", steps: [["standtwist", 20], ["sidebend", 16], ["legraise", 10], ["russiantwist", 20], ["flutter", 30], ["plank", 30], ["boat", 20]] },
  { id: "arms", name: "Arms & shoulders", steps: [["press", 12], ["curl", 16], ["frontraise", 10], ["bowpull", 12], ["kickback", 12], ["armspin", 10], ["pushup", 8]] },
  { id: "cardio", name: "Cardio blast", steps: [["jog", 60], ["jacks", 30], ["highknees", 40], ["jumprope", 60], ["climber", 30], ["jog", 60]] },
  { id: "warmup", name: "Warm-up (moving stretches)", steps: [["armcircles", 10], ["shoulderrolls", 10], ["trunkrot", 16], ["hipcircles", 10], ["legswingfb", 10], ["legswingside", 10], ["kneehugs", 10], ["laterallunge", 10]] },
  { id: "cooldown", name: "Cool-down (still stretches)", steps: [["crossbody", 30], ["tricepsstretch", 30], ["quad", 30], ["calf", 30], ["hamstring", 40], ["child", 40], ["figure4", 40]] },
  { id: "yoga", name: "Yoga flow", steps: [["tree", 20], ["warrior1", 20], ["warrior2", 20], ["warrior3", 15], ["chair", 20], ["hinge", 20], ["forwardfold", 30]] },
];
