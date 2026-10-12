/* FormIQ coach buddy: an original chibi, anime-style character drawn as SVG and animated from a tiny skeleton.
   Poses are joint angles in degrees (0 = limb pointing straight down, positive = toward the right of the picture).
   pose = { t: torso lean (0 upright, + leans right), h: head tilt, a:[armL upper, lower, armR upper, lower],
            l:[legL thigh, shin, legR thigh, shin], x: hip offset, y: lift off the ground, sh: shoulder lift }
   In side views index 0/1 is the far limb and 2/3 the near limb, the character faces right. */
import { DEMOS } from "./demos.js?v=25";

const NS = "http://www.w3.org/2000/svg";
const W = 220, H = 170, GROUND = 148, BAR = 26;
const LEN = { torso: 30, thigh: 24, shin: 24, up: 17, low: 16, head: 21 };
const C = { line: "#2d2540", skin: "#ffe0cc", hair: "#ff8fb3", hairDark: "#e8658f", shirt: "#ffffff", shirtTrim: "#3cc78f", shorts: "#3a4a8c", shoe: "#ff6b81", eye: "#33306b", blush: "#ff9fb0" };

const BASE = {
  front: { t: 0, h: 0, a: [-8, -8, 8, 8], l: [-4, -4, 4, 4], x: 0, y: 0, sh: 0 },
  side: { t: 0, h: 0, a: [3, 8, 3, 8], l: [0, 0, 0, 0], x: 0, y: 0, sh: 0 },
};
const rad = d => d * Math.PI / 180;
const dirDown = d => [Math.sin(rad(d)), Math.cos(rad(d))];          // limb direction (0 = down)
const dirUp = d => [Math.sin(rad(d)), -Math.cos(rad(d))];           // torso / head direction (0 = up)
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const mergePose = (view, o, extra = {}) => { const b = BASE[view]; return { ...b, ...o, ...extra, a: o.a || b.a, l: o.l || b.l }; };

export function mirrorPose(p, view) {
  const sw = (arr, neg) => [arr[2] * neg, arr[3] * neg, arr[0] * neg, arr[1] * neg];
  const n = view === "front" ? -1 : 1;
  return { ...p, t: (p.t ?? 0) * n, h: (p.h ?? 0) * n, x: (p.x ?? 0) * n, a: sw(p.a, n), l: sw(p.l, n) };
}

/* forward kinematics: every joint position for a pose */
export function solve(p, view) {
  const hip = [W / 2 + p.x, 0];
  const u = dirUp(p.t), perp = [Math.cos(rad(p.t)), Math.sin(rad(p.t))];
  const front = view === "front";
  const sho = add(hip, u, LEN.torso);
  const hw = front ? 6 : 0, sw = front ? 10 : 0;
  const hipL = add(hip, perp, -hw), hipR = add(hip, perp, hw);
  const shL = add(add(sho, perp, -sw), [0, -p.sh]), shR = add(add(sho, perp, sw), [0, -p.sh]);
  const k = p.armK || 1;
  const limb = (o, a1, a2, l1, l2) => { const m = add(o, dirDown(a1), l1); return [o, m, add(m, dirDown(a2), l2)]; };
  const J = {
    hip, sho,
    aL: limb(shL, p.a[0], p.a[1], LEN.up * k, LEN.low * k), aR: limb(shR, p.a[2], p.a[3], LEN.up * k, LEN.low * k),
    lL: limb(hipL, p.l[0], p.l[1], LEN.thigh, LEN.shin), lR: limb(hipR, p.l[2], p.l[3], LEN.thigh, LEN.shin),
    head: add(sho, dirUp(p.t + p.h), LEN.head + 3), headAng: p.t + p.h,
  };
  return J;
}
const shiftJ = (J, dx, dy) => {
  const f = q => [q[0] + dx, q[1] + dy], r = {};
  for (const k in J) r[k] = Array.isArray(J[k]) ? (Array.isArray(J[k][0]) ? J[k].map(f) : f(J[k])) : J[k];
  return r;
};
const allPts = J => [[J.hip, 8], [J.sho, 8], [J.head, LEN.head], ...["aL", "aR"].map(k => [J[k][2], 5]), ...["lL", "lR"].map(k => [J[k][2], 5]), ...["lL", "lR"].map(k => [J[k][1], 5])];
function place(p, view, hang) {
  let J = solve(p, view);
  if (hang) { const wy = (J.aL[2][1] + J.aR[2][1]) / 2; return shiftJ(J, 0, BAR + 4 - wy); }
  const low = Math.max(...allPts(J).map(([q, r]) => q[1] + r));
  return shiftJ(J, 0, GROUND - low - (p.y || 0));
}
const lerp = (a, b, k) => a + (b - a) * k;
const lerpPose = (A, B, k) => ({ armK: lerp(A.armK || 1, B.armK || 1, k), t: lerp(A.t, B.t, k), h: lerp(A.h, B.h, k), x: lerp(A.x, B.x, k), y: lerp(A.y, B.y, k), sh: lerp(A.sh, B.sh, k),
  a: A.a.map((v, i) => lerp(v, B.a[i], k)), l: A.l.map((v, i) => lerp(v, B.l[i], k)) });
const ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

/* ---------- build the keyframe loop for an exercise ---------- */
export function buildSequence(key) {
  const d = DEMOS[key]; if (!d) return null;
  const view = d.v === "s" ? "side" : "front";
  let frames = d.p.map(o => mergePose(view, o, d.hang ? { armK: 1.7 } : {}));
  if (d.hold) {   // breathe gently in the pose
    const f = frames[frames.length - 1];
    frames = frames.concat([{ ...f, t: f.t + 1.5, h: f.h - 2, sh: f.sh + 0.5 }]);
  }
  let loop = frames;
  if (d.alt) loop = frames.concat(frames.map(f => mirrorPose(f, view)));
  const hold = !!d.hold;
  const step = d.fast ? 330 : hold ? 1400 : d.slow ? 1100 : 700;
  return { view, loop, step, hold, alt: !!d.alt, prop: d.prop || null, hang: !!d.hang, still: loop };
}
export function sequenceBounds(seq) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9;
  for (const f of seq.loop) { const J = place(f, seq.view, seq.hang); for (const [q, r] of allPts(J)) { x0 = Math.min(x0, q[0] - r); x1 = Math.max(x1, q[0] + r); y0 = Math.min(y0, q[1] - r); } }
  return { x0, x1, y0 };
}

/* ---------- drawing ---------- */
const el = (n, a = {}, parent) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (parent) parent.appendChild(e); return e; };
const pathOf = pts => "M" + pts.map(q => q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" L");

export function createBuddy(host) {
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Animated coach demonstrating the exercise", focusable: "false" });
  svg.style.cssText = "width:100%;height:100%;display:block";
  host.replaceChildren(svg);
  const root = el("g", {}, svg);
  const bgProp = el("g", {}, root), shadow = el("ellipse", { cx: W / 2, cy: GROUND + 2, rx: 38, ry: 5, fill: "rgba(0,0,0,.18)" }, root);
  const ground = el("path", { d: `M10 ${GROUND + 3} H${W - 10}`, stroke: "rgba(120,140,130,.55)", "stroke-width": 2, "stroke-linecap": "round", "stroke-dasharray": "2 5" }, root);
  const fig = el("g", {}, root);
  const layers = {};
  for (const n of ["farArm", "farLeg", "tailBack", "torso", "nearLeg", "head", "nearArm"]) layers[n] = el("g", {}, fig);
  const limbs = {};
  const mkLimb = (layer, color, w, shoe, hand) => {
    const g = layers[layer];
    const o = el("path", { fill: "none", stroke: C.line, "stroke-width": w + 3.2, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    const f = el("path", { fill: "none", stroke: color, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    const extra = shoe ? el("ellipse", { rx: 8, ry: 5, fill: C.shoe, stroke: C.line, "stroke-width": 1.6 }, g) : hand ? el("circle", { r: 4.6, fill: C.skin, stroke: C.line, "stroke-width": 1.6 }, g) : null;
    return { o, f, extra };
  };
  limbs.aL = mkLimb("farArm", C.skin, 7, false, true); limbs.aR = mkLimb("nearArm", C.skin, 7, false, true);
  limbs.lL = mkLimb("farLeg", C.skin, 8, true); limbs.lR = mkLimb("nearLeg", C.skin, 8, true);
  const shorts = ["farLeg", "nearLeg"].map(n => el("path", { fill: "none", stroke: C.shorts, "stroke-width": 11.5, "stroke-linecap": "round" }, layers[n]));
  const torsoO = el("path", { fill: "none", stroke: C.line, "stroke-width": 21.5, "stroke-linecap": "round" }, layers.torso);
  const torsoF = el("path", { fill: "none", stroke: C.shirt, "stroke-width": 18, "stroke-linecap": "round" }, layers.torso);
  const trim = el("path", { fill: "none", stroke: C.shirtTrim, "stroke-width": 18, "stroke-linecap": "butt", "stroke-dasharray": "0" }, layers.torso);
  const shortsT = el("path", { fill: "none", stroke: C.shorts, "stroke-width": 18, "stroke-linecap": "round" }, layers.torso);
  /* head, drawn upright in its own coordinates then rotated into place */
  const hg = el("g", {}, layers.head), hin = el("g", {}, hg);
  const tails = [el("path", { fill: C.hair, stroke: C.line, "stroke-width": 1.8, "stroke-linejoin": "round" }, layers.tailBack), el("path", { fill: C.hair, stroke: C.line, "stroke-width": 1.8, "stroke-linejoin": "round" }, layers.tailBack)];
  const hairBack = el("circle", { r: LEN.head + 1.5, cy: -1, fill: C.hair, stroke: C.line, "stroke-width": 2 }, hin);
  const face = el("circle", { r: LEN.head - 1, cy: 1, fill: C.skin, stroke: C.line, "stroke-width": 2 }, hin);
  const eyes = el("g", {}, hin), blush = el("g", {}, hin), mouth = el("path", { fill: "none", stroke: C.line, "stroke-width": 1.8, "stroke-linecap": "round" }, hin);
  const bangs = el("path", { fill: C.hair, stroke: C.line, "stroke-width": 1.8, "stroke-linejoin": "round" }, hin);
  const ribbon = el("g", {}, hin);

  const state = { seq: null, view: "front", t0: 0, raf: 0, playing: false, fit: { dx: 0, s: 1 }, reduced: false, tailV: [[0, 0], [0, 0]], lastHead: null, blinkAt: 2500, mood: 0 };

  function drawFace(view) {
    eyes.replaceChildren(); blush.replaceChildren();
    const front = view === "front";
    const eye = (cx, rx, ry) => { const g = el("g", { transform: `translate(${cx} 3)` }, eyes);
      el("ellipse", { rx, ry, fill: C.eye, stroke: C.line, "stroke-width": 1.4 }, g);
      el("ellipse", { rx: rx * .62, ry: ry * .5, cy: ry * .28, fill: "#6f6bd6", opacity: .8 }, g);
      el("circle", { r: rx * .36, cx: -rx * .3, cy: -ry * .4, fill: "#fff" }, g); el("circle", { r: rx * .17, cx: rx * .35, cy: ry * .35, fill: "#fff" }, g);
      el("path", { d: `M${-rx - 1} ${-ry * .55} Q0 ${-ry * 1.25} ${rx + 1} ${-ry * .45}`, fill: "none", stroke: C.line, "stroke-width": 2, "stroke-linecap": "round" }, g); return g; };
    if (front) { state.eyeEls = [eye(-8.5, 5, 6.5), eye(8.5, 5, 6.5)]; for (const cx of [-13, 13]) el("ellipse", { cx, cy: 11, rx: 4, ry: 2.4, fill: C.blush, opacity: .75 }, blush); mouth.setAttribute("d", "M-3 12.5 Q0 15.5 3 12.5"); }
    else { state.eyeEls = [eye(9, 5, 6.5), eye(18, 3.3, 5.2)]; el("ellipse", { cx: 12, cy: 11.5, rx: 4, ry: 2.3, fill: C.blush, opacity: .75 }, blush); mouth.setAttribute("d", "M14 13 Q17 15.5 19.5 12.5"); }
    // bangs
    const b = front ? "M-21 -3 Q-20 -20 0 -21 Q20 -20 21 -3 Q16 -12 11 -9 Q9 -15 3 -10 Q-2 -17 -6 -9 Q-12 -13 -15 -5 Q-18 -7 -21 -3Z"
      : "M-21 0 Q-22 -20 0 -22 Q19 -21 22 -4 Q17 -12 13 -8 Q10 -15 4 -9 Q-1 -16 -6 -8 Q-13 -13 -17 -3Z";
    bangs.setAttribute("d", b);
    ribbon.replaceChildren();
    const rb = (cx, cy) => { const g = el("g", { transform: `translate(${cx} ${cy})` }, ribbon); el("path", { d: "M0 0 L-7 -5 L-7 5Z M0 0 L7 -5 L7 5Z", fill: "#ffd166", stroke: C.line, "stroke-width": 1.4, "stroke-linejoin": "round" }, g); el("circle", { r: 2.2, fill: "#ffb703", stroke: C.line, "stroke-width": 1.2 }, g); };
    if (front) { rb(-19, -9); rb(19, -9); } else rb(-17, -11);
  }

  function setBlink(on) { for (const g of state.eyeEls || []) g.setAttribute("transform", g.getAttribute("transform").replace(/ scale\(.*\)/, "") + (on ? " scale(1 .12)" : "")); }

  function render(p, now) {
    const seq = state.seq, view = seq.view;
    let J = place(p, view, seq.hang);
    J = shiftJ(J, state.fit.dx, 0);
    root.setAttribute("transform", `translate(${W / 2} ${GROUND}) scale(${state.fit.s}) translate(${-W / 2} ${-GROUND})`);
    const side = view === "side";
    // keep the arm that matters in front: in side view index 2/3 is the near limb
    layers.farArm.setAttribute("opacity", side ? .92 : 1);
    const setLimb = (L, pts, extra) => { const d = pathOf(pts); L.o.setAttribute("d", d); L.f.setAttribute("d", d); if (L.extra) { const e = pts[2]; if (L.extra.tagName === "ellipse") { L.extra.setAttribute("cx", e[0] + 3); L.extra.setAttribute("cy", e[1] + 2); } else { L.extra.setAttribute("cx", e[0]); L.extra.setAttribute("cy", e[1]); } } };
    setLimb(limbs.aL, J.aL); setLimb(limbs.aR, J.aR); setLimb(limbs.lL, J.lL); setLimb(limbs.lR, J.lR);
    // shorts on the top of each thigh
    [["lL", 0], ["lR", 1]].forEach(([k, i]) => { const [a, b] = J[k]; const f = add(a, [b[0] - a[0], b[1] - a[1]], 0.38); shorts[i].setAttribute("d", pathOf([a, f])); });
    const td = pathOf([J.hip, J.sho]); torsoO.setAttribute("d", td); torsoF.setAttribute("d", td);
    const sh = add(J.hip, [J.sho[0] - J.hip[0], J.sho[1] - J.hip[1]], 0.32); shortsT.setAttribute("d", pathOf([J.hip, sh]));
    const tr = add(J.sho, [J.hip[0] - J.sho[0], J.hip[1] - J.sho[1]], 0.14); trim.setAttribute("d", pathOf([J.sho, tr])); trim.setAttribute("stroke-width", 18.6); trim.setAttribute("opacity", .95);
    // the order of limbs in the layers: arms above the torso in front view
    hg.setAttribute("transform", `translate(${J.head[0].toFixed(1)} ${J.head[1].toFixed(1)}) rotate(${J.headAng.toFixed(1)})`);
    // twin tails (front) or ponytail (side) with a little bounce from head movement
    const hv = state.lastHead ? [J.head[0] - state.lastHead[0], J.head[1] - state.lastHead[1]] : [0, 0]; state.lastHead = J.head;
    const ang = rad(J.headAng);
    const tailAt = (i, ox, oy, dx, dy) => {
      const b = [J.head[0] + Math.cos(ang) * ox - Math.sin(ang) * oy, J.head[1] + Math.sin(ang) * ox + Math.cos(ang) * oy];
      const v = state.tailV[i]; v[0] = v[0] * 0.8 - hv[0] * 0.9; v[1] = v[1] * 0.8 - hv[1] * 0.9;
      const kx = Math.max(-14, Math.min(14, v[0])), ky = Math.max(-14, Math.min(14, v[1]));
      const end = [b[0] + Math.cos(ang) * dx - Math.sin(ang) * dy + kx, b[1] + Math.sin(ang) * dx + Math.cos(ang) * dy + ky + 2];
      const mid = [(b[0] + end[0]) / 2 + (dx < 0 ? -5 : 5), (b[1] + end[1]) / 2 - 3];
      return `M${b[0].toFixed(1)} ${b[1].toFixed(1)} Q${mid[0].toFixed(1)} ${(mid[1] - 6).toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)} Q${(mid[0] + 7).toFixed(1)} ${(mid[1] + 7).toFixed(1)} ${b[0].toFixed(1)} ${(b[1] + 8).toFixed(1)}Z`;
    };
    if (view === "front") { tails[0].setAttribute("d", tailAt(0, -19, -6, -9, 30)); tails[1].setAttribute("d", tailAt(1, 19, -6, 9, 30)); tails[1].style.display = ""; }
    else { tails[0].setAttribute("d", tailAt(0, -17, -9, -20, 24)); tails[1].style.display = "none"; }
    // ground shadow
    const lift = p.y || 0; shadow.setAttribute("rx", Math.max(22, 40 - lift * .8)); shadow.setAttribute("opacity", seq.hang ? 0 : Math.max(.35, 1 - lift / 40));
    ground.style.display = seq.hang ? "none" : "";
    // blink
    if (now > state.blinkAt) { setBlink(true); if (now > state.blinkAt + 130) { setBlink(false); state.blinkAt = now + 2200 + Math.random() * 2500; } }
  }

  function drawProp(seq) {
    bgProp.replaceChildren();
    if (seq.hang) { el("rect", { x: 40, y: BAR - 3, width: W - 80, height: 6, rx: 3, fill: "#9aa5a0", stroke: C.line, "stroke-width": 1.8 }, bgProp); for (const x of [40, W - 40]) el("rect", { x: x - 3, y: BAR - 3, width: 6, height: GROUND - BAR + 6, fill: "#b8c2bd", stroke: C.line, "stroke-width": 1.5 }, bgProp); }
    if (seq.prop === "wall") el("rect", { x: W - 34, y: 10, width: 18, height: GROUND - 6, rx: 3, fill: "#d8e0dc", stroke: C.line, "stroke-width": 1.8 }, bgProp);
  }

  function frameAt(ms) {
    const s = state.seq, n = s.loop.length; if (n === 1) return s.loop[0];
    const total = n * s.step, tt = ms % total, i = Math.floor(tt / s.step), k = (tt - i * s.step) / s.step;
    const A = s.loop[i], B = s.loop[(i + 1) % n];
    const m = s.hold ? .0 : 0;   // holds just breathe
    const e = ease(Math.min(1, k / 0.78));
    return lerpPose(A, B, s.hold ? ease(k) : e + m);
  }
  function tick(now) {
    if (!state.playing) return;
    render(frameAt(Math.max(0, now - state.t0)), now);
    state.raf = requestAnimationFrame(tick);
  }
  const api = {
    set(key) {
      const seq = buildSequence(key); if (!seq) { host.hidden = true; return false; }
      host.hidden = false; state.seq = seq; state.view = seq.view; state.lastHead = null;
      const b = sequenceBounds(seq), w = b.x1 - b.x0, hgt = GROUND - b.y0 + 6;
      const s = Math.min(1, 196 / w, 150 / hgt); state.fit = { s, dx: W / 2 - (b.x0 + b.x1) / 2 };
      drawFace(seq.view); drawProp(seq); state.t0 = performance.now();
      if (state.playing) return true;
      render(seq.loop[Math.min(1, seq.loop.length - 1)], 0); return true;
    },
    play() {
      if (!state.seq || state.playing) return;
      if (matchMedia?.("(prefers-reduced-motion: reduce)").matches) { render(state.seq.loop[Math.min(1, state.seq.loop.length - 1)], 0); return; }
      state.playing = true; state.t0 = performance.now(); state.raf = requestAnimationFrame(tick);
    },
    show(i) { if (state.seq) render(state.seq.loop[Math.min(i, state.seq.loop.length - 1)], 0); },
    stop() { state.playing = false; cancelAnimationFrame(state.raf); },
    get playing() { return state.playing; },
  };
  return api;
}
