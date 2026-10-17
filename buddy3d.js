/* FormIQ 3D coach: the same original character as buddy.js, built from real 3D shapes (three.js, bundled in vendor/).
   It plays the same pose keyframes (demos.js), so every exercise has a 3D demo. You can drag it sideways to walk around it.
   Cel-shaded (toon) with an ink outline to keep the anime look. If WebGL isn't available it quietly falls back to the 2D coach.
   Scene units are the 2D coach's units (about 1 unit = 1 cm of a cartoon person); x right, y up, z toward the viewer. */
import * as B from "./buddy.js?v=31";
import { HAIR_STYLES, HAIR_COLORS, SKIN, EYES, TOP_COLORS, BOTTOM_COLORS, SHOE_COLORS, ACCENT_COLORS } from "./looks.js?v=31";

let T = null;
try { T = await import("./vendor/three/three.module.min.js"); } catch { T = null; }

export const mirrorPose = B.mirrorPose, buildSequence = B.buildSequence, sequenceBounds = B.sequenceBounds;
export const getLook = B.getLook;
const instances = new Set();
export function setLook(look) { B.setLook(look); for (const i of instances) i.rebuild(); }
export const has3D = () => !!T;

const INK = 0x2d2540;
let toonMap = null, outlineMat = null;
function shared() {
  if (toonMap) return;
  toonMap = new T.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, T.RedFormat);
  toonMap.minFilter = toonMap.magFilter = T.NearestFilter; toonMap.needsUpdate = true;
  outlineMat = new T.ShaderMaterial({
    side: T.BackSide, uniforms: { uThick: { value: 1.15 }, uCol: { value: new T.Color(INK) } },
    vertexShader: "uniform float uThick; void main(){ vec4 p = modelViewMatrix * vec4(position,1.0); vec3 n = normalize(normalMatrix * normal); p.xyz += n * uThick; gl_Position = projectionMatrix * p; }",
    fragmentShader: "uniform vec3 uCol; void main(){ gl_FragColor = vec4(uCol,1.0); }",
  });
}
const toon = (hex) => new T.MeshToonMaterial({ color: hex, gradientMap: toonMap });
const flat = (hex, extra = {}) => new T.MeshBasicMaterial({ color: hex, ...extra });
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const Y = V(0, 1, 0);

function mesh(geo, mat, parent, outline = true) {
  const m = new T.Mesh(geo, mat);
  if (outline) { const o = new T.Mesh(geo, outlineMat); m.add(o); m.userData.outline = o; }
  if (parent) parent.add(m);
  return m;
}
/* a cylinder lying between two points */
function seg(m, a, b, sx = 1) {
  const d = b.clone().sub(a), len = Math.max(0.001, d.length());
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Y, d.multiplyScalar(1 / len));
  m.scale.set(sx, len, sx);
}
const cyl = (r0, r1, n = 14) => new T.CylinderGeometry(r1, r0, 1, n, 1);   // r0 at the start point, r1 at the end point
const sph = (r = 1, n = 18) => new T.SphereGeometry(r, n, Math.round(n * 0.75));

/* hair that swings: a chain of tapered pieces that follows the head with a little lag */
class Strand {
  constructor(parent, def, mat, R) {
    this.def = def; this.n = def.n || 6; this.R = R; this.mat = mat;
    this.rest = []; this.p = []; this.q = []; this.segs = []; this.joints = [];
    const at = V(...def.at), dir = V(...def.dir).normalize();
    for (let i = 0; i <= this.n; i++) {
      const k = i / this.n, bend = def.curl ? Math.sin(k * Math.PI) * def.curl : 0;
      this.rest.push(at.clone().addScaledVector(dir, def.len * k).add(V(def.out ? Math.sign(at.x || 1) * bend : 0, 0, def.out ? 0 : -bend)));
    }
    for (let i = 0; i < this.n; i++) {
      const r0 = def.w * (1 - 0.55 * i / this.n) * R, r1 = def.w * (1 - 0.55 * (i + 1) / this.n) * R;
      this.segs.push(mesh(cyl(r0, r1, 9), mat, parent));
      this.joints.push(mesh(sph(r0, 9), mat, parent));
    }
    this.joints.push(mesh(sph(def.w * 0.45 * R, 9), mat, parent));
    this.fresh = true;
  }
  update(unit, dt) {
    const n = this.n, R = this.R, segLen = this.def.len * R / n;
    const tg = this.rest.map(r => unit.localToWorld(r.clone()));
    if (this.fresh || !this.p.length) { this.p = tg.map(x => x.clone()); this.q = tg.map(x => x.clone()); this.fresh = false; }
    const k = Math.min(1, dt / 16);
    this.p[0].copy(tg[0]); this.q[0].copy(tg[0]);
    for (let i = 1; i <= n; i++) {
      const p = this.p[i], q = this.q[i], vx = (p.x - q.x) * 0.86, vy = (p.y - q.y) * 0.86, vz = (p.z - q.z) * 0.86;
      q.copy(p); p.x += vx * k; p.y += vy * k - 0.045 * R * k; p.z += vz * k;
      p.lerp(tg[i], Math.min(1, (this.def.stiff ?? 0.1) * k * (1 + i * 0.1)));
    }
    for (let it = 0; it < 3; it++) for (let i = 1; i <= n; i++) { const d = this.p[i].clone().sub(this.p[i - 1]), l = d.length() || 1; this.p[i].copy(this.p[i - 1]).addScaledVector(d, segLen / l); }
    for (let i = 0; i < n; i++) { seg(this.segs[i], this.p[i], this.p[i + 1]); this.joints[i].position.copy(this.p[i]); }
    this.joints[n].position.copy(this.p[n]);
  }
  snap() { this.fresh = true; }
}

/* hair recipes in head units (the head is a ball of radius 1 facing +z, +y up) */
function hairFor(id) {
  const ring = (n, y, rad, fn) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return fn(Math.sin(a) * rad, y, Math.cos(a) * rad, a, i); });
  const S = { cap: null, shell: 1.06, tilt: 25, theta: 88, parts: [], strands: [], fringe: false, sides: false, panel: null };
  switch (id) {
    case "buzz": Object.assign(S, { cap: 1, shell: 1.025, theta: 80, tilt: 20 }); break;
    case "crop": Object.assign(S, { cap: 1 }); break;
    case "hightop": Object.assign(S, { cap: 1, parts: [{ g: "cyl", r: 0.8, h: 0.62, p: [0, 1.0, -0.08], s: [1, 1, 1.05] }] }); break;
    case "waves": Object.assign(S, { cap: 1, shell: 1.09, fringe: true }); break;
    case "curly": Object.assign(S, { cap: 1, shell: 1.07, parts: ring(7, 0.95, 0.62, (x, y, z) => ({ g: "sph", r: 0.34, p: [x, y + 0.05, z - 0.08] })).concat([{ g: "sph", r: 0.38, p: [0, 1.28, -0.05] }]) }); break;
    case "afro": Object.assign(S, { afro: 1.5 }); break;
    case "twa": Object.assign(S, { afro: 1.26 }); break;
    case "puffs": Object.assign(S, { cap: 1, sides: true, parts: [{ g: "sph", r: 0.5, p: [-0.82, 0.95, -0.1] }, { g: "sph", r: 0.5, p: [0.82, 0.95, -0.1] }] }); break;
    case "knots": Object.assign(S, { cap: 1, parts: ring(8, 0.78, 0.7, (x, y, z, a) => ({ g: "cone", r: 0.2, h: 0.4, p: [x * 1.02, y + 0.12, z * 0.95 - 0.18], look: [x * 2, y + 1.3, z * 2 - 0.2] })) }); break;
    case "cornrows": Object.assign(S, { cap: 1, shell: 1.075, rows: 5 }); break;
    case "braids": Object.assign(S, { cap: 1, sides: true, strands: [-0.95, -0.62, -0.28, 0.28, 0.62, 0.95].map((x, i) => ({ at: [x, 0.05 - Math.abs(x) * 0.0, -0.15 - (1 - Math.abs(x)) * 0.55], dir: [x * 0.12, -1, -0.12], len: 2.4, w: 0.11, n: 7, stiff: 0.07 })) }); break;
    case "locs": Object.assign(S, { cap: 1, shell: 1.08, strands: [-0.98, -0.66, -0.3, 0.3, 0.66, 0.98].map((x, i) => ({ at: [x, 0.1, -0.1 - (1 - Math.abs(x)) * 0.55], dir: [x * 0.2, -1, -0.1], len: 2.0 - (i % 2) * 0.35, w: 0.16, n: 6, stiff: 0.08 })) }); break;
    case "braidpony": Object.assign(S, { cap: 1, strands: [{ at: [0, 0.62, -0.88], dir: [0, -0.55, -0.85], len: 2.6, w: 0.12, n: 8, stiff: 0.07 }] }); break;
    case "ponytail": Object.assign(S, { cap: 1, parts: [{ g: "sph", r: 0.2, p: [0, 0.7, -0.92] }], strands: [{ at: [0, 0.7, -0.92], dir: [0, -0.5, -0.9], len: 2.4, w: 0.3, n: 8, stiff: 0.06 }] }); break;
    case "twintails": Object.assign(S, { cap: 1, sides: true, strands: [-1, 1].map(s => ({ at: [s * 0.98, 0.35, -0.12], dir: [s * 0.35, -1, -0.15], len: 2.3, w: 0.27, n: 7, stiff: 0.06 })) }); break;
    case "spacebuns": Object.assign(S, { cap: 1, sides: true, parts: [{ g: "sph", r: 0.42, p: [-0.62, 1.02, -0.2] }, { g: "sph", r: 0.42, p: [0.62, 1.02, -0.2] }] }); break;
    case "topknot": Object.assign(S, { cap: 1, parts: [{ g: "sph", r: 0.42, p: [0, 1.18, -0.12] }] }); break;
    case "manbun": Object.assign(S, { cap: 1, parts: [{ g: "sph", r: 0.4, p: [0, 0.5, -1.1] }] }); break;
    case "long": Object.assign(S, { cap: 1, sides: true, panel: { p: [0, -0.9, -0.62], s: [1.05, 1.95, 0.45] }, strands: [-1, 1].map(s => ({ at: [s * 1.0, 0.0, -0.02], dir: [s * 0.1, -1, 0], len: 2.5, w: 0.3, n: 7, stiff: 0.07 })) }); break;
    case "bob": Object.assign(S, { cap: 1, shell: 1.09, sides: true, panel: { p: [0, -0.28, -0.52], s: [1.14, 0.95, 0.72] } }); break;
    case "pixie": Object.assign(S, { cap: 1, fringe: true }); break;
    case "mohawk": Object.assign(S, { cap: 1, shell: 1.02, theta: 70 }); break;
    case "spiky": Object.assign(S, { cap: 1, parts: [[0, 1, 0], [0.55, 0.9, 0.2], [-0.55, 0.9, 0.2], [0.5, 0.85, -0.45], [-0.5, 0.85, -0.45], [0, 0.85, -0.6], [0, 0.8, 0.5], [0.85, 0.5, -0.1], [-0.85, 0.5, -0.1]].map(([x, y, z]) => ({ g: "cone", r: 0.24, h: 0.8, p: [x * 1.02, y * 1.02, z * 1.02], look: [x * 3, y * 3, z * 3] })) }); break;
    case "undercut": Object.assign(S, { cap: 1, shell: 1.04, parts: [{ g: "sph", r: 1, sc: [0.96, 0.5, 1.05], p: [0, 0.72, -0.08] }] }); break;
    case "bald": break;
    default: S.cap = 1;
  }
  if (id === "mohawk") S.parts = Array.from({ length: 8 }, (_, i) => { const a = (-0.95 + i * 0.3); return { g: "sph", r: 0.22, sc: [0.5, 1.7, 0.9], p: [0, Math.cos(a) * 1.12, Math.sin(a) * 1.12] }; });
  return S;
}

export function createBuddy(host) {
  let r2d = null, disposed = false;
  const fallback = () => { if (!r2d) r2d = B.createBuddy(host); return r2d; };
  if (!T) return fallback();
  shared();
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch { return fallback(); }
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Animated 3D coach demonstrating the exercise. Drag sideways to look around it.");
  canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab";
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  host.replaceChildren(canvas);

  const scene = new T.Scene(), cam = new T.PerspectiveCamera(28, 1, 1, 2000);
  scene.add(new T.AmbientLight(0xffffff, 2.1));
  const sun = new T.DirectionalLight(0xffffff, 2.2); sun.position.set(-120, 220, 260); scene.add(sun);
  const rim = new T.DirectionalLight(0xbfe8ff, 0.8); rim.position.set(160, 80, -200); scene.add(rim);

  const st = { seq: null, view: "front", t0: 0, raf: 0, playing: false, key: "", yaw: 0, yaw0: 0.45, drag: 0, dragged: false, blinkAt: 2500, target: V(), dist: 300, last: 0, size: [0, 0], strands: [] };
  let world = null, P = null;

  function dispose(o) { o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material && c.material !== outlineMat) c.material.dispose?.(); }); }

  function build() {
    if (world) { scene.remove(world); dispose(world); }
    world = new T.Group(); scene.add(world);
    const L = B.getLook(), { LEN, BUILD } = B.dims();
    const skinC = SKIN[L.skin].hex, hairC = HAIR_COLORS[L.hairColor].hex, eyeC = EYES[L.eyes].hex;
    const shirtC = TOP_COLORS[L.topColor].hex, pantsC = BOTTOM_COLORS[L.bottomColor].hex, shoeC = SHOE_COLORS[L.shoes].hex;
    const skin = toon(skinC), shirt = toon(shirtC), pants = toon(pantsC), shoe = toon(shoeC), hairM = toon(hairC);
    hairM.side = T.DoubleSide;
    const glove = toon(L.gloves ? 0x2d2d3a : skinC);
    const lw = BUILD.limb / 2, gw = BUILD.leg / 2;
    P = { L, LEN, BUILD, limbs: {}, strands: [] };

    // floor and shadow
    const floor = mesh(new T.CircleGeometry(56, 48), flat(0x8fb7a8, { transparent: true, opacity: 0.22 }), world, false);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.3; P.floor = floor;
    const sh = mesh(new T.CircleGeometry(30, 32), flat(0x000000, { transparent: true, opacity: 0.22 }), world, false);
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.1; P.shadow = sh;
    P.props = new T.Group(); world.add(P.props);

    // limbs
    const mkLimb = (kind, r) => {
      const o = { kind, up: mesh(cyl(r, r * 0.9), skin, world), lo: mesh(cyl(r * 0.9, r * 0.8), skin, world), j: mesh(sph(r * 0.92), skin, world), end: null, c1: null, c2: null, band: null };
      if (kind === "leg") {
        o.end = mesh(sph(1, 14), shoe, world); o.c1 = mesh(cyl(r * 1.1, r * 1.04), pants, world); o.c2 = mesh(cyl(r * 1.04, r * 0.96), pants, world);
        o.knee = mesh(sph(r * 1.06), pants, world);
      } else {
        o.end = mesh(sph(r * (L.gloves ? 1.5 : 1.28), 14), glove, world);
        if (L.top === "tee") { o.c1 = mesh(cyl(r * 1.28, r * 1.2), shirt, world); o.c2 = null; }
        if (L.wrist) o.band = mesh(cyl(r * 1.22, r * 1.22, 14), flat(ACCENT_COLORS[L.wristColor].hex), world);
      }
      return o;
    };
    P.limbs = { aL: mkLimb("arm", lw), aR: mkLimb("arm", lw), lL: mkLimb("leg", gw), lR: mkLimb("leg", gw) };
    // torso: wider at the shoulders, with the shirt and waistband over it
    const rt = BUILD.sw * 0.92, rb = BUILD.torso * 0.4;
    P.torso = mesh(new T.CylinderGeometry(1, rb / rt, 1, 24, 1), skin, world);
    P.shirt = mesh(new T.CylinderGeometry(1, rb / rt, 1, 24, 1), shirt, world);
    P.waist = mesh(new T.CylinderGeometry(1, 1, 1, 24, 1), pants, world);
    P.hips = mesh(sph(1, 20), pants, world);
    P.shoulders = [mesh(sph(lw * 1.05), L.top === "tee" ? shirt : skin, world), mesh(sph(lw * 1.05), L.top === "tee" ? shirt : skin, world)];
    P.neck = mesh(cyl(1, 1, 12), skin, world);

    // head
    const R = LEN.head * 0.98; P.R = R;
    const head = new T.Group(), unit = new T.Group(), face = new T.Group();
    unit.scale.setScalar(R); head.add(unit); unit.add(face); world.add(head);
    P.head = head; P.unit = unit; P.face = face;
    const skull = mesh(sph(1, 36), skin, face); skull.scale.set(1, 1.02, 1.0);
    for (const s of [-1, 1]) { const ear = mesh(sph(0.2, 12), skin, face); ear.position.set(s * 0.97, -0.06, -0.02); ear.scale.set(0.5, 1, 0.8); }
    // eyes, brows, mouth, blush
    const onFace = (x, y, off = 0) => { const z = Math.sqrt(Math.max(0.05, 1 - x * x - y * y)); const p = V(x, y, z).multiplyScalar(1 + off); return p; };
    const faceObj = (x, y, off) => { const g = new T.Object3D(); g.position.copy(onFace(x, y, off)); g.lookAt(g.position.clone().multiplyScalar(2)); face.add(g); return g; };
    const disc = (g, col, w, h, x, y, z, op = 1) => { const m = new T.Mesh(new T.CircleGeometry(1, 28), flat(col, { transparent: op < 1, opacity: op })); m.scale.set(w, h, 1); m.position.set(x, y, z); g.add(m); return m; };
    P.eyes = [];
    for (const s of [-1, 1]) {
      const g = faceObj(s * 0.42, -0.06, 0.012); P.eyes.push(g);
      disc(g, INK, 0.265, 0.34, 0, 0.0, 0); disc(g, 0x1d1a2b, 0.235, 0.31, 0, 0, 0.004);
      disc(g, eyeC, 0.19, 0.235, 0, -0.04, 0.008); disc(g, new T.Color(eyeC).lerp(new T.Color(0xffffff), 0.45).getHex(), 0.13, 0.1, 0, -0.14, 0.012, 0.8);
      disc(g, 0xffffff, 0.085, 0.1, -0.075, 0.1, 0.016); disc(g, 0xffffff, 0.04, 0.045, 0.07, -0.1, 0.02);
    }
    const browM = flat(new T.Color(hairC).lerp(new T.Color(0x000000), 0.3).getHex());
    for (const s of [-1, 1]) { const g = faceObj(s * 0.45, 0.3, 0.012); const b = new T.Mesh(new T.PlaneGeometry(0.3, 0.06), browM); b.rotation.z = s * -0.12; g.add(b); }
    { const g = faceObj(0, -0.46, 0.012); const m = new T.Mesh(new T.TorusGeometry(0.1, 0.014, 6, 16, Math.PI), flat(INK)); m.rotation.z = Math.PI; g.add(m); m.position.y = 0.05; }
    const blushC = L.skin >= 5 ? 0xe0707f : 0xff9fb0;
    for (const s of [-1, 1]) { const g = faceObj(s * 0.62, -0.3, 0.008); disc(g, blushC, 0.15, 0.085, 0, 0, 0, 0.55); }

    // accessories
    if (L.glasses) {
      for (const s of [-1, 1]) { const g = faceObj(s * 0.42, -0.06, 0.03); const t = new T.Mesh(new T.TorusGeometry(0.3, 0.025, 8, 28), flat(INK)); g.add(t); disc(g, 0xffffff, 0.29, 0.29, 0, 0, -0.01, 0.16); }
      const br = faceObj(0, -0.04, 0.03); const bb = new T.Mesh(new T.BoxGeometry(0.16, 0.03, 0.03), flat(INK)); br.add(bb);
      for (const s of [-1, 1]) { const arm = new T.Mesh(new T.BoxGeometry(0.03, 0.03, 0.95), flat(INK)); arm.position.set(s * 0.96, -0.02, 0.45); arm.rotation.y = s * -0.1; face.add(arm); }
    }
    if (L.band) {
      const hb = mesh(new T.TorusGeometry(0.91, 0.1, 8, 40), flat(ACCENT_COLORS[L.bandColor].hex), face); hb.position.set(0, 0.52, -0.06); hb.rotation.x = Math.PI / 2 - 0.22;
    }

    // hair
    const S = hairFor(L.hair); P.hairSpec = S;
    const hair = new T.Group(); face.add(hair);
    const tilt = (S.tilt ?? 25) * Math.PI / 180;
    if (S.afro) {
      const a = mesh(new T.SphereGeometry(S.afro, 36, 26, 0, Math.PI * 2, 0, 118 * Math.PI / 180), hairM, hair); a.position.set(0, S.afro > 1.4 ? 0.3 : 0.18, -0.3); a.rotation.x = -33 * Math.PI / 180;
    } else if (S.cap) {
      const c = mesh(new T.SphereGeometry(S.shell, 36, 24, 0, Math.PI * 2, 0, (S.theta ?? 88) * Math.PI / 180), hairM, hair); c.rotation.x = -tilt;
      if (S.fringe) { const f = mesh(sph(1, 16), hairM, hair); f.scale.set(0.95, 0.22, 0.42); f.position.set(0.08, 0.66, 0.72); f.rotation.set(-0.45, 0, -0.18); }
    }
    if (S.sides) for (const s of [-1, 1]) { const w = mesh(sph(1, 14), hairM, hair); w.scale.set(0.12, 0.48, 0.52); w.position.set(s * 1.0, 0.2, -0.2); }
    if (S.panel) { const w = mesh(sph(1, 20), hairM, hair); w.scale.set(...S.panel.s); w.position.set(...S.panel.p); }
    for (const pt of S.parts) {
      let m;
      if (pt.g === "cyl") m = mesh(new T.CylinderGeometry(pt.r * 0.92, pt.r, pt.h, 20), hairM, hair);
      else if (pt.g === "cone") { m = mesh(new T.ConeGeometry(pt.r, pt.h, 12), hairM, hair); }
      else m = mesh(sph(pt.r, 14), hairM, hair);
      m.position.set(...pt.p);
      if (pt.sc) m.scale.set(...pt.sc); else if (pt.s) m.scale.set(...pt.s);
      if (pt.look) { const d = V(...pt.look).sub(m.position).normalize(); m.quaternion.setFromUnitVectors(Y, d); }
    }
    if (S.rows) {
      const rowM = toon(new T.Color(hairC).lerp(new T.Color(0x000000), 0.35).getHex());
      for (let i = 0; i < S.rows; i++) {
        const x = -0.6 + i * 0.3, lat = x * 1.1;
        const q = Array.from({ length: 14 }, (_, k) => { const t = 1.0 - k * (2.9 / 13); return V(Math.sin(lat) * 1.1, 1.1 * Math.cos(t) * Math.cos(lat), 1.1 * Math.sin(t) * Math.cos(lat)); });
        const tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(q), 24, 0.035, 6), rowM); hair.add(tube);
      }
    }
    for (const sd of S.strands) P.strands.push(new Strand(world, sd, hairM, R));
    face.userData.baseY = 0;
    // neck
    P.neckR = R * 0.3;
    return P;
  }

  const lerp3 = (a, b, k) => a.clone().lerp(b, k);
  function render(p, now, dt = 16) {
    const seq = st.seq; if (!seq || !P) return;
    const { LEN, BUILD, L } = P, view = seq.view, side = view === "side";
    const w = host.clientWidth || 220, h = host.clientHeight || 170;
    if (st.size[0] !== w || st.size[1] !== h) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); st.size = [w, h]; frameCamera(); }
    const J = B.place(p, view, seq.hang), G = B.dims().GROUND, W2 = B.dims().W / 2;
    const to3 = (q, z = 0) => V(q[0] - W2, G - q[1], z);
    const lat = BUILD.sw * 0.9, hz = 6;
    const zArm = side ? [-lat, lat] : [0, 0], zLeg = side ? [-hz, hz] : [0, 0];
    const set = (Lb, pts, z, hipSide) => {
      const a = to3(pts[0], z), b = to3(pts[1], z), c = to3(pts[2], z);
      seg(Lb.up, a, b); seg(Lb.lo, b, c); Lb.j.position.copy(b);
      const l1 = a.distanceTo(b), l2 = b.distanceTo(c), tot = l1 + l2;
      const clothTo = (m1, m2, frac) => {
        const cov = tot * frac;
        if (m1) { m1.visible = true; seg(m1, a, lerp3(a, b, Math.min(1, cov / l1))); }
        if (m2) { m2.visible = cov > l1 + 0.5; if (m2.visible) seg(m2, b, lerp3(b, c, Math.min(1, (cov - l1) / l2))); }
      };
      if (Lb.kind === "leg") {
        clothTo(Lb.c1, Lb.c2, L.bottom === "shorts" ? 0.34 : L.bottom === "capris" ? 0.8 : 0.985);
        Lb.knee.visible = Lb.c2.visible; Lb.knee.position.copy(b);
        const fwd = side ? V(1, 0, 0) : V(0, 0, 1), Wd = BUILD.leg * 0.62, Lg = 7.6;
        Lb.end.position.copy(c).addScaledVector(fwd, 3.2).add(V(0, -1.6, 0));
        Lb.end.scale.set(side ? Lg : Wd, 3.4, side ? Wd : Lg);
      } else {
        if (Lb.c1) seg(Lb.c1, a, lerp3(a, b, 0.92));
        Lb.end.position.copy(c);
        if (Lb.band) { seg(Lb.band, lerp3(b, c, 0.58), lerp3(b, c, 0.86)); }
      }
    };
    set(P.limbs.aL, J.aL, zArm[0]); set(P.limbs.aR, J.aR, zArm[1]); set(P.limbs.lL, J.lL, zLeg[0]); set(P.limbs.lR, J.lR, zLeg[1]);
    P.shoulders[0].position.copy(to3(J.aL[0], zArm[0])); P.shoulders[1].position.copy(to3(J.aR[0], zArm[1]));
    const hip = to3(J.hip), sho = to3(J.sho), axis = sho.clone().sub(hip), tl = axis.length();
    const rt = BUILD.sw * 0.92, rb = BUILD.torso * 0.4, depthK = 0.64;
    const tor = (m, from, to, top, bot) => { seg(m, from, to); m.scale.set(side ? top * depthK : top, m.scale.y, side ? top : top * depthK); };
    tor(P.torso, hip, sho, rt, rb);
    const shirtFrom = L.top === "crop" ? lerp3(hip, sho, 0.42) : hip;
    tor(P.shirt, shirtFrom, lerp3(hip, sho, 0.93), rt + 0.9, rb);
    P.shirt.scale.x *= 1; P.shirt.scale.z *= 1;
    const wTo = lerp3(hip, sho, 0.26);
    seg(P.waist, hip, wTo); P.waist.scale.set(side ? rb * 0.66 : rb * 1.1, P.waist.scale.y, side ? rb * 1.1 : rb * 0.66);
    P.hips.position.copy(hip); P.hips.scale.set(side ? rb * 0.7 : rb * 1.22, 5.5, side ? rb * 1.22 : rb * 0.72);
    // head
    const hd = to3(J.head), R = P.R;
    P.head.position.copy(hd); P.head.rotation.set(0, 0, -J.headAng * Math.PI / 180);
    P.face.rotation.y = side ? Math.PI / 2 : 0;
    const nd = sho.clone().sub(hd).normalize();
    seg(P.neck, sho.clone().addScaledVector(nd, -0.5), hd.clone().addScaledVector(nd, R * 0.5), P.neckR);
    P.head.updateMatrixWorld(true);
    for (const s of P.strands) s.update(P.unit, Math.min(50, dt));
    // blink
    if (now > st.blinkAt) { for (const e of P.eyes) e.scale.y = 0.12; if (now > st.blinkAt + 130) { for (const e of P.eyes) e.scale.y = 1; st.blinkAt = now + 2200 + Math.random() * 2500; } }
    // shadow follows the body and shrinks when you jump
    const lift = p.y || 0, c = to3(J.hip);
    P.shadow.visible = !seq.hang; P.floor.visible = !seq.hang;
    P.shadow.position.x = c.x; P.shadow.scale.setScalar(Math.max(0.65, 1 - lift / 70));
    P.shadow.material.opacity = 0.22 * Math.max(0.4, 1 - lift / 60);
    // camera orbit
    if (!st.drag && !st.dragged) st.yaw = st.yaw0 + Math.sin(now / 1700) * 0.2;
    const pitch = 0.1;
    cam.position.set(st.target.x + st.dist * Math.sin(st.yaw) * Math.cos(pitch), st.target.y + st.dist * Math.sin(pitch), st.target.z + st.dist * Math.cos(st.yaw) * Math.cos(pitch));
    cam.lookAt(st.target);
    renderer.render(scene, cam);
  }

  function frameCamera() {
    const seq = st.seq; if (!seq) return;
    const b = B.sequenceBounds(seq), G = B.dims().GROUND, W2 = B.dims().W / 2, BAR = B.dims().BAR;
    const y0 = seq.hang ? Math.min(b.y0, BAR - 8) : b.y0, y1 = seq.hang ? Math.max(b.y1, BAR + 20) : Math.max(b.y1, G + 2);
    st.target.set((b.x0 + b.x1) / 2 - W2, G - (y0 + y1) / 2, 0);
    const hN = (y1 - y0) + 14, wN = (b.x1 - b.x0) + 44, asp = cam.aspect || 1.3;
    const fov = cam.fov * Math.PI / 180;
    st.dist = Math.max(hN / 2, wN / 2 / asp) / Math.tan(fov / 2) * 1.04 + 12;
  }

  function drawProps(seq) {
    P.props.clear();
    const G = B.dims().GROUND, BAR = B.dims().BAR, W2 = B.dims().W / 2;
    if (seq.hang) {
      const bar = mesh(new T.CylinderGeometry(2.4, 2.4, W2 * 2 - 80, 16), toon(0x9aa5a0), P.props); bar.rotation.z = Math.PI / 2; bar.position.set(0, G - BAR, 0);
      for (const s of [-1, 1]) { const u = mesh(new T.CylinderGeometry(2.4, 2.4, G - BAR + 3, 12), toon(0xb8c2bd), P.props); u.position.set(s * (W2 - 40), (G - BAR + 3) / 2 - 3, 0); }
    }
    if (seq.prop === "wall") { const w = mesh(new T.BoxGeometry(14, G - 6, 80), toon(0xd8e0dc), P.props); w.position.set(W2 - 30, (G - 6) / 2, 0); }
  }

  /* orbit by dragging */
  let down = null;
  canvas.addEventListener("pointerdown", e => { down = { x: e.clientX, yaw: st.yaw }; st.drag = 1; try { canvas.setPointerCapture(e.pointerId); } catch { } canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", e => { if (!down) return; st.yaw = Math.max(-1.45, Math.min(1.45, down.yaw - (e.clientX - down.x) * 0.012)); st.dragged = true; if (!st.playing) api.show(st.lastIdx || 0); });
  const up = () => { down = null; st.drag = 0; canvas.style.cursor = "grab"; };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("dblclick", () => { st.dragged = false; if (!st.playing) api.show(st.lastIdx || 0); });

  function frameAt(ms) {
    const s = st.seq, n = s.loop.length; if (n === 1) return s.loop[0];
    const total = n * s.step, tt = ms % total, i = Math.floor(tt / s.step), k = (tt - i * s.step) / s.step;
    return B.lerpPose(s.loop[i], s.loop[(i + 1) % n], s.hold ? B.ease(k) : B.ease(Math.min(1, k / 0.78)));
  }
  function tick(now) {
    if (!st.playing) return;
    const dt = st.last ? now - st.last : 16; st.last = now;
    render(frameAt(Math.max(0, now - st.t0)), now, dt);
    st.raf = requestAnimationFrame(tick);
  }

  const api = {
    set(key) {
      st.key = key;
      const seq = B.buildSequence(key); if (!seq) { host.hidden = true; return false; }
      host.hidden = false; st.seq = seq; st.view = seq.view; st.yaw0 = seq.view === "side" ? 0.55 : 0.4; st.dragged = false;
      if (!P) build();
      drawProps(seq); st.size = [0, 0]; for (const s of P.strands) s.snap();
      st.t0 = performance.now();
      if (!st.playing) { st.lastIdx = Math.min(1, seq.loop.length - 1); render(seq.loop[st.lastIdx], 0); }
      return true;
    },
    rebuild() { const was = st.playing; build(); if (st.key) api.set(st.key); if (was && !st.playing) api.play(); },
    play() {
      if (!st.seq || st.playing) return;
      if (matchMedia?.("(prefers-reduced-motion: reduce)").matches) { api.show(1); return; }
      st.playing = true; st.t0 = performance.now(); st.last = 0; st.raf = requestAnimationFrame(tick);
    },
    show(i) { if (st.seq) { st.lastIdx = Math.min(i, st.seq.loop.length - 1); render(st.seq.loop[st.lastIdx], 0); } },
    stop() { st.playing = false; cancelAnimationFrame(st.raf); },
    destroy() { api.stop(); instances.delete(api); disposed = true; if (world) dispose(world); renderer.dispose(); renderer.forceContextLoss?.(); },
    get playing() { return st.playing; },
    get is3D() { return true; },
    _renderer: renderer,
  };
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); api.stop(); });
  canvas.addEventListener("webglcontextrestored", () => { api.rebuild(); api.play(); });
  build(); instances.add(api);
  return api;
}
