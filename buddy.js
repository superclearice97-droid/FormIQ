/* FormIQ coach buddy: an original chibi, anime-style character drawn as SVG and animated from a tiny skeleton.
   Poses are joint angles in degrees (0 = limb pointing straight down, positive = toward the right of the picture).
   pose = { t: torso lean (0 upright, + leans right), h: head tilt, a:[armL upper, lower, armR upper, lower],
            l:[legL thigh, shin, legR thigh, shin], x: hip offset, y: lift off the ground, sh: shoulder lift }
   In side views index 0/1 is the far limb and 2/3 the near limb, the character faces right. */
import { DEMOS } from "./demos.js?v=28";
import { CAPS, HAIR_STYLES, HAIR_COLORS, SKIN, EYES, TOP_COLORS, BOTTOM_COLORS, SHOE_COLORS, ACCENT_COLORS, PROPORTIONS, BUILDS, DEFAULT_LOOK, loadLook, sanitizeLook } from "./looks.js?v=28";

const NS = "http://www.w3.org/2000/svg";
const W = 220, H = 170, GROUND = 148, BAR = 26;
const LEN = { torso: 30, thigh: 24, shin: 24, up: 17, low: 16, head: 21 };
let BUILD = BUILDS.average, LOOK = loadLook();
const C = { line: "#2d2540" };

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
  const hw = front ? 6 : 0, sw = front ? BUILD.sw : 0;
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
export function place(p, view, hang) {
  let J = solve(p, view);
  if (hang) { const wy = (J.aL[2][1] + J.aR[2][1]) / 2; return shiftJ(J, 0, BAR + 4 - wy); }
  const low = Math.max(...allPts(J).map(([q, r]) => q[1] + r));
  return shiftJ(J, 0, GROUND - low - (p.y || 0));
}
export const lerp = (a, b, k) => a + (b - a) * k;
export const lerpPose = (A, B, k) => ({ armK: lerp(A.armK || 1, B.armK || 1, k), t: lerp(A.t, B.t, k), h: lerp(A.h, B.h, k), x: lerp(A.x, B.x, k), y: lerp(A.y, B.y, k), sh: lerp(A.sh, B.sh, k),
  a: A.a.map((v, i) => lerp(v, B.a[i], k)), l: A.l.map((v, i) => lerp(v, B.l[i], k)) });
export const ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

/* ---------- build the keyframe loop for an exercise ---------- */
export function buildSequence(key) {
  const d = DEMOS[key]; if (!d) return null;
  const view = d.v === "s" ? "side" : "front";
  let frames = d.p.map(o => mergePose(view, o, d.hang ? { armK: 1.3 } : {}));
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
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const f of seq.loop) { const J = place(f, seq.view, seq.hang); for (const [q, r] of allPts(J)) { x0 = Math.min(x0, q[0] - r); x1 = Math.max(x1, q[0] + r); y0 = Math.min(y0, q[1] - r); y1 = Math.max(y1, q[1] + r); } }
  return { x0, x1, y0, y1 };
}

/* ---------- drawing ---------- */
const el = (n, a = {}, parent) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (parent) parent.appendChild(e); return e; };
const pathOf = pts => "M" + pts.map(q => q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" L");
const mix = (hex, to, k) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), a = p(hex), b = p(to); return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, "0")).join(""); };
function partial(pts, frac) {
  const segs = []; let tot = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push(l); tot += l; }
  let rem = tot * frac; const out = [pts[0]];
  for (let i = 0; i < segs.length; i++) {
    if (rem >= segs[i]) { out.push(pts[i + 1]); rem -= segs[i]; }
    else { const k = rem / segs[i]; out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]); break; }
  }
  return out;
}
const tailSpec = (spec, side) => spec.map(([ox, oy, dx, dy, w]) => side ? [-12 + ox * 0.3, oy, dx * 0.4 - 8, dy, w] : [ox, oy, dx, dy, w]);

const instances = new Set();
/* change the coach's look everywhere (exercise panel and camera pop-up) */
export function setLook(look) {
  LOOK = sanitizeLook(look);
  const pr = PROPORTIONS[LOOK.prop]; Object.assign(LEN, { head: pr.head, torso: pr.torso, thigh: pr.thigh, shin: pr.shin, up: pr.up, low: pr.low });
  BUILD = BUILDS[LOOK.build];
  for (const i of instances) i.rebuild();
}
export const getLook = () => ({ ...LOOK });
export const dims = () => ({ LEN, BUILD, W, H, GROUND, BAR });
setLook(LOOK);

export function createBuddy(host) {
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Animated coach demonstrating the exercise", focusable: "false" });
  svg.style.cssText = "width:100%;height:100%;display:block";
  host.replaceChildren(svg);
  const state = { seq: null, view: "front", t0: 0, raf: 0, playing: false, fit: { dx: 0, s: 1 }, tailV: [], lastHead: null, blinkAt: 2500, key: "" };
  let P = {};   // the current set of SVG elements

  function build() {
    svg.replaceChildren();
    const L = LOOK, skin = SKIN[L.skin].hex, hair = HAIR_COLORS[L.hairColor].hex, eyeC = EYES[L.eyes].hex;
    const shirt = TOP_COLORS[L.topColor].hex, pants = BOTTOM_COLORS[L.bottomColor].hex, shoe = SHOE_COLORS[L.shoes].hex;
    const darkSkin = L.skin >= 5, blushC = darkSkin ? "#e0707f" : "#ff9fb0";
    const root = el("g", {}, svg);
    const bgProp = el("g", {}, root), shadow = el("ellipse", { cx: W / 2, cy: GROUND + 2, rx: 38, ry: 5, fill: "rgba(0,0,0,.18)" }, root);
    const ground = el("path", { d: `M10 ${GROUND + 3} H${W - 10}`, stroke: "rgba(120,140,130,.55)", "stroke-width": 2, "stroke-linecap": "round", "stroke-dasharray": "2 5" }, root);
    const fig = el("g", {}, root), layers = {};
    for (const n of ["farArm", "farLeg", "tailBack", "torso", "nearLeg", "head", "nearArm"]) layers[n] = el("g", {}, fig);
    const lw = BUILD.limb, gw = BUILD.leg, glove = L.gloves ? "#2d2d3a" : skin;
    const mk = (layer, w, kind) => {
      const g = layers[layer];
      const o = el("path", { fill: "none", stroke: C.line, "stroke-width": w + 3.2, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
      const f = el("path", { fill: "none", stroke: skin, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
      const cloth = kind === "leg" ? el("path", { fill: "none", stroke: pants, "stroke-width": w + 1.4, "stroke-linecap": "butt", "stroke-linejoin": "round" }, g)
        : L.top === "tee" ? el("path", { fill: "none", stroke: shirt, "stroke-width": w + 1.8, "stroke-linecap": "butt", "stroke-linejoin": "round" }, g) : null;
      const band = kind === "arm" && L.wrist ? [el("path", { fill: "none", stroke: C.line, "stroke-width": w + 4.6, "stroke-linecap": "butt" }, g), el("path", { fill: "none", stroke: ACCENT_COLORS[L.wristColor].hex, "stroke-width": w + 2.2, "stroke-linecap": "butt" }, g)] : null;
      const extra = kind === "leg" ? el("ellipse", { rx: 8.4, ry: 5.2, fill: shoe, stroke: C.line, "stroke-width": 1.6 }, g) : el("circle", { r: 4.8 * (L.gloves ? 1.05 : 1), fill: glove, stroke: C.line, "stroke-width": 1.6 }, g);
      return { o, f, cloth, band, extra, w, kind };
    };
    const limbs = { aL: mk("farArm", lw, "arm"), aR: mk("nearArm", lw, "arm"), lL: mk("farLeg", gw, "leg"), lR: mk("nearLeg", gw, "leg") };
    const bw = BUILD.torso;
    const torsoO = el("path", { fill: "none", stroke: C.line, "stroke-width": bw + 3.5, "stroke-linecap": "round" }, layers.torso);
    const torsoSkin = el("path", { fill: "none", stroke: skin, "stroke-width": bw, "stroke-linecap": "round" }, layers.torso);
    const torsoShirt = el("path", { fill: "none", stroke: shirt, "stroke-width": bw, "stroke-linecap": "round" }, layers.torso);
    const trim = el("path", { fill: "none", stroke: mix(shirt, "#000000", 0.18), "stroke-width": bw + 0.6, "stroke-linecap": "butt" }, layers.torso);
    const waist = el("path", { fill: "none", stroke: pants, "stroke-width": bw - 0.6, "stroke-linecap": "round" }, layers.torso);

    /* head */
    const style = HAIR_STYLES.find(h => h.id === L.hair) || HAIR_STYLES[0];
    const hs = LEN.head / 21;
    const hg = el("g", {}, layers.head), hin = el("g", { transform: `scale(${hs})` }, hg);
    const side = () => state.view === "side";
    const strand = style.tails || [];
    const tails = strand.map(() => el("path", { fill: hair, stroke: C.line, "stroke-width": 1.7, "stroke-linejoin": "round" }, layers.tailBack));
    state.tailV = strand.map(() => [0, 0]);
    const vols = el("g", {}, hin);
    const face = el("circle", { r: 20, cy: 1, fill: skin, stroke: C.line, "stroke-width": 2 }, hin);
    const eyes = el("g", {}, hin), brows = el("g", {}, hin), blush = el("g", {}, hin);
    const mouth = el("path", { fill: "none", stroke: C.line, "stroke-width": 1.8, "stroke-linecap": "round" }, hin);
    const hairTop = el("g", {}, hin), acc = el("g", {}, hin);
    P = { root, bgProp, shadow, ground, layers, limbs, torsoO, torsoSkin, torsoShirt, trim, waist, hg, hin, tails, vols, eyes, brows, blush, mouth, hairTop, acc, style, hair, eyeC, blushC, skin, shirt, pants, strand };
    P.vols = vols;
  }

  function drawHead() {
    const { style, hair, eyeC, blushC, eyes, brows, blush, mouth, hairTop, acc, vols } = P, L = LOOK, view = state.view, front = view === "front";
    // hair volume behind the face
    vols.replaceChildren();
    const g = el("g", front ? {} : { transform: "translate(-4 0)" }, vols);
    for (const v of style.vol) {
      if (v[0] === "p") el("path", { d: v[1], fill: hair, stroke: C.line, "stroke-width": 2, "stroke-linejoin": "round", transform: front ? "" : "scale(.8 1)" }, g);
      else { const [, cx, cy, rx, ry] = v; el("ellipse", { cx: front ? cx : cx * 0.5 - 1, cy, rx: front ? rx : rx * 0.92, ry, fill: hair, stroke: C.line, "stroke-width": 2 }, g); }
    }
    // face
    eyes.replaceChildren(); blush.replaceChildren(); brows.replaceChildren(); hairTop.replaceChildren(); acc.replaceChildren();
    const eye = (cx, rx, ry) => { const e = el("g", { transform: `translate(${cx} 3)` }, eyes);
      el("ellipse", { rx, ry, fill: "#1d1a2b", stroke: C.line, "stroke-width": 1.4 }, e);
      el("ellipse", { rx: rx * .72, ry: ry * .66, cy: ry * .22, fill: eyeC }, e);
      el("ellipse", { rx: rx * .5, ry: ry * .3, cy: ry * .45, fill: mix(eyeC, "#ffffff", .45), opacity: .8 }, e);
      el("circle", { r: rx * .36, cx: -rx * .3, cy: -ry * .4, fill: "#fff" }, e); el("circle", { r: rx * .16, cx: rx * .35, cy: ry * .35, fill: "#fff" }, e);
      el("path", { d: `M${-rx - 1} ${-ry * .5} Q0 ${-ry * 1.3} ${rx + 1} ${-ry * .45}`, fill: "none", stroke: C.line, "stroke-width": 2, "stroke-linecap": "round" }, e); return e; };
    const brow = (x1, y1, x2, y2) => el("path", { d: `M${x1} ${y1} Q${(x1 + x2) / 2} ${Math.min(y1, y2) - 2.5} ${x2} ${y2}`, fill: "none", stroke: mix(hair, "#000000", .3), "stroke-width": 2.2, "stroke-linecap": "round" }, brows);
    if (front) { state.eyeEls = [eye(-8.5, 4.8, 6.4), eye(8.5, 4.8, 6.4)]; brow(-13, -6, -4, -6.5); brow(4, -6.5, 13, -6); for (const cx of [-13, 13]) el("ellipse", { cx, cy: 11, rx: 4, ry: 2.3, fill: blushC, opacity: .6 }, blush); mouth.setAttribute("d", "M-3.5 12.5 Q0 16 3.5 12.5"); }
    else { state.eyeEls = [eye(9, 4.8, 6.4), eye(17.5, 3.2, 5.2)]; brow(4, -6, 13, -6.5); brow(15, -5.5, 20, -5); el("ellipse", { cx: 12, cy: 11.5, rx: 4, ry: 2.2, fill: blushC, opacity: .6 }, blush); mouth.setAttribute("d", "M13.5 13 Q17 16 20 12.5"); }
    // hairline / fringe
    const cap = style.cap && CAPS[style.cap];
    if (cap) {
      const t = front ? "" : "translate(-3 0)";
      el("path", { d: cap, fill: hair, stroke: C.line, "stroke-width": 1.8, "stroke-linejoin": "round", transform: t }, hairTop);
      el("path", { d: "M-11 -16.5 Q-3 -20.5 7 -18.5", fill: "none", stroke: mix(hair, "#ffffff", .38), "stroke-width": 2.6, "stroke-linecap": "round", opacity: .6, transform: t }, hairTop);
      if (style.lines) for (const x of [-13, -8, -3, 3, 8, 13]) el("path", { d: `M${x} -12 Q${x * 1.1} -17 ${x * 0.9} -21.5`, fill: "none", stroke: mix(hair, "#ffffff", .3), "stroke-width": 1.3, opacity: .7, transform: t }, hairTop);
    }
    // accessories
    if (L.band) el("path", { d: front ? "M-20.5 -8 Q0 -14 20.5 -8 L20.4 -13 Q0 -19.5 -20.4 -13Z" : "M-21 -8 Q-2 -13 20 -8 L19.8 -13 Q-2 -19.5 -21 -13Z", fill: ACCENT_COLORS[L.bandColor].hex, stroke: C.line, "stroke-width": 1.6, "stroke-linejoin": "round" }, acc);
    if (L.glasses) {
      const gl = (cx, r) => el("circle", { cx, cy: 3, r, fill: "rgba(255,255,255,.18)", stroke: C.line, "stroke-width": 1.8 }, acc);
      if (front) { gl(-8.5, 7.6); gl(8.5, 7.6); el("path", { d: "M-1 3 Q0 1.5 1 3", fill: "none", stroke: C.line, "stroke-width": 1.8 }, acc); }
      else { gl(9, 7.4); el("path", { d: "M2 3 L-18 1", fill: "none", stroke: C.line, "stroke-width": 1.8, "stroke-linecap": "round" }, acc); }
    }
    setBlink(false);
  }

  function setBlink(on) { for (const g of state.eyeEls || []) g.setAttribute("transform", g.getAttribute("transform").replace(/ scale\(.*\)/, "") + (on ? " scale(1 .12)" : "")); }

  function drawProp(seq) {
    const bg = P.bgProp; bg.replaceChildren();
    if (seq.hang) { el("rect", { x: 40, y: BAR - 3, width: W - 80, height: 6, rx: 3, fill: "#9aa5a0", stroke: C.line, "stroke-width": 1.8 }, bg); for (const x of [40, W - 40]) el("rect", { x: x - 3, y: BAR - 3, width: 6, height: GROUND - BAR + 6, fill: "#b8c2bd", stroke: C.line, "stroke-width": 1.5 }, bg); }
    if (seq.prop === "wall") el("rect", { x: W - 34, y: 10, width: 18, height: GROUND - 6, rx: 3, fill: "#d8e0dc", stroke: C.line, "stroke-width": 1.8 }, bg);
  }

  function render(p, now) {
    const seq = state.seq, view = seq.view, { limbs, layers } = P, L = LOOK;
    let J = shiftJ(place(p, view, seq.hang), state.fit.dx, 0);
    const ay = state.fit.ay ?? GROUND; P.root.setAttribute("transform", `translate(${W / 2} ${ay}) scale(${state.fit.s}) translate(${-W / 2} ${-ay})`);
    layers.farArm.setAttribute("opacity", view === "side" ? .94 : 1);
    const setLimb = (Lb, pts) => {
      const d = pathOf(pts); Lb.o.setAttribute("d", d); Lb.f.setAttribute("d", d);
      if (Lb.cloth) {
        if (Lb.kind === "leg") Lb.cloth.setAttribute("d", pathOf(partial(pts, L.bottom === "shorts" ? 0.34 : L.bottom === "capris" ? 0.8 : 0.97)));
        else Lb.cloth.setAttribute("d", pathOf(partial(pts, 0.5)));
      }
      if (Lb.band) { const lo = [pts[1], pts[2]], a = partial(lo, 0.86), b = partial(lo, 0.58); const seg = [b[b.length - 1], a[a.length - 1]]; const dd = pathOf(seg); Lb.band.forEach(x => x.setAttribute("d", dd)); }
      const e = pts[2];
      if (Lb.kind === "leg") { Lb.extra.setAttribute("cx", e[0] + 3); Lb.extra.setAttribute("cy", e[1] + 2); } else { Lb.extra.setAttribute("cx", e[0]); Lb.extra.setAttribute("cy", e[1]); }
    };
    setLimb(limbs.aL, J.aL); setLimb(limbs.aR, J.aR); setLimb(limbs.lL, J.lL); setLimb(limbs.lR, J.lR);
    const td = pathOf([J.hip, J.sho]); P.torsoO.setAttribute("d", td); P.torsoSkin.setAttribute("d", td);
    const shirtFrom = L.top === "crop" ? add(J.hip, [J.sho[0] - J.hip[0], J.sho[1] - J.hip[1]], 0.42) : J.hip;
    P.torsoShirt.setAttribute("d", pathOf([shirtFrom, J.sho]));
    P.waist.setAttribute("d", pathOf([J.hip, add(J.hip, [J.sho[0] - J.hip[0], J.sho[1] - J.hip[1]], 0.24)]));
    const tr = add(J.sho, [J.hip[0] - J.sho[0], J.hip[1] - J.sho[1]], 0.13); P.trim.setAttribute("d", pathOf([J.sho, tr]));
    P.hg.setAttribute("transform", `translate(${J.head[0].toFixed(1)} ${J.head[1].toFixed(1)}) rotate(${J.headAng.toFixed(1)})`);
    // hair strands swing a little with head movement
    const hv = state.lastHead ? [J.head[0] - state.lastHead[0], J.head[1] - state.lastHead[1]] : [0, 0]; state.lastHead = J.head;
    const ang = rad(J.headAng), hs = LEN.head / 21, spec = tailSpec(P.strand, view === "side");
    spec.forEach(([ox, oy, dx, dy, w], i) => {
      ox *= hs; oy *= hs; dx *= hs; dy *= hs; w *= hs;
      const b = [J.head[0] + Math.cos(ang) * ox - Math.sin(ang) * oy, J.head[1] + Math.sin(ang) * ox + Math.cos(ang) * oy];
      const v = state.tailV[i]; v[0] = v[0] * 0.8 - hv[0] * 0.9; v[1] = v[1] * 0.8 - hv[1] * 0.9;
      const kx = Math.max(-14, Math.min(14, v[0])), ky = Math.max(-14, Math.min(14, v[1]));
      const end = [b[0] + Math.cos(ang) * dx - Math.sin(ang) * dy + kx, b[1] + Math.sin(ang) * dx + Math.cos(ang) * dy + ky + 2];
      const mid = [(b[0] + end[0]) / 2 + (dx < 0 ? -2 : 2), (b[1] + end[1]) / 2];
      const hw = Math.max(1.6, w / 2);
      P.tails[i].setAttribute("d", `M${(b[0] - hw).toFixed(1)} ${b[1].toFixed(1)} Q${(mid[0] - hw).toFixed(1)} ${mid[1].toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)} Q${(mid[0] + hw).toFixed(1)} ${mid[1].toFixed(1)} ${(b[0] + hw).toFixed(1)} ${b[1].toFixed(1)}Z`);
    });
    const lift = p.y || 0; P.shadow.setAttribute("rx", Math.max(22, 40 - lift * .8)); P.shadow.setAttribute("opacity", seq.hang ? 0 : Math.max(.35, 1 - lift / 40));
    P.ground.style.display = seq.hang ? "none" : "";
    if (now > state.blinkAt) { setBlink(true); if (now > state.blinkAt + 130) { setBlink(false); state.blinkAt = now + 2200 + Math.random() * 2500; } }
  }

  function frameAt(ms) {
    const s = state.seq, n = s.loop.length; if (n === 1) return s.loop[0];
    const total = n * s.step, tt = ms % total, i = Math.floor(tt / s.step), k = (tt - i * s.step) / s.step;
    const A = s.loop[i], B = s.loop[(i + 1) % n];
    return lerpPose(A, B, s.hold ? ease(k) : ease(Math.min(1, k / 0.78)));
  }
  function tick(now) { if (!state.playing) return; render(frameAt(Math.max(0, now - state.t0)), now); state.raf = requestAnimationFrame(tick); }

  const api = {
    set(key) {
      state.key = key;
      const seq = buildSequence(key); if (!seq) { host.hidden = true; return false; }
      host.hidden = false; state.seq = seq; state.view = seq.view; state.lastHead = null;
      const b = sequenceBounds(seq), w = b.x1 - b.x0, hgt = GROUND - b.y0 + 6;
      state.fit = seq.hang ? { s: Math.min(1, 196 / w, (GROUND - BAR) / (b.y1 - BAR + 4)), dx: W / 2 - (b.x0 + b.x1) / 2, ay: BAR }
        : { s: Math.min(1, 196 / w, 150 / hgt), dx: W / 2 - (b.x0 + b.x1) / 2, ay: GROUND };
      drawHead(); drawProp(seq); state.t0 = performance.now();
      if (!state.playing) render(seq.loop[Math.min(1, seq.loop.length - 1)], 0);
      return true;
    },
    rebuild() { const playing = state.playing; build(); if (state.key) api.set(state.key); if (playing && !state.playing) api.play(); },
    play() {
      if (!state.seq || state.playing) return;
      if (matchMedia?.("(prefers-reduced-motion: reduce)").matches) { render(state.seq.loop[Math.min(1, state.seq.loop.length - 1)], 0); return; }
      state.playing = true; state.t0 = performance.now(); state.raf = requestAnimationFrame(tick);
    },
    show(i) { if (state.seq) render(state.seq.loop[Math.min(i, state.seq.loop.length - 1)], 0); },
    stop() { state.playing = false; cancelAnimationFrame(state.raf); },
    destroy() { api.stop(); instances.delete(api); },
    get playing() { return state.playing; },
  };
  build(); instances.add(api);
  return api;
}
