/* FormIQ setup guide: walks you into the picture before a set starts.
   Pure logic (no page access). evaluate() looks at one frame of pose landmarks and says what to fix next,
   in order: be in view -> whole body in the picture -> right distance -> centred -> facing the right way ->
   starting position. When everything is right, the app counts down 3-2-1 and only then counts reps.

   Directions are given as you face the camera ("step to your left"), which is the same whether or not the
   preview is mirrored. On screen an arrow points the way your image needs to move. */
import { VIS } from "./exercises.js?v=27";

const ok = (p) => p && (p.visibility ?? 1) > VIS;
/* what the camera has to see, per exercise level (see "frame" in exercises.js). Each group needs at least one of its landmarks,
   so a side-on body (far shoulder hidden) still counts. */
const GROUPS = {
  full: [[11, 12], [23, 24], [25, 26], [27, 28]],               // shoulders to ankles
  knees: [[11, 12], [23, 24], [25, 26]],                         // shoulders to knees (head and feet are optional)
  upper: [[11, 12], [13, 14], [23, 24]],                         // shoulders, arms, hips
  hang: [[11, 12], [13, 14], [15, 16]],                          // shoulders and arms on the bar
  core: [[11, 12], [23, 24]],                                    // the least we can track with: a shoulder and a hip
};
const LABEL = { full: "your whole body", knees: "you down to your knees", upper: "you down to your hips", hang: "your arms", core: "your shoulders and hips" };
const MIN_SIZE = { full: 0.42, knees: 0.3, upper: 0.2, hang: 0.25, core: 0.15 };
export const levelOf = (def) => def.frame || "full";

export function evaluate(lm, def, asp = 16 / 9, postureOk = true, postureHint = "", opts = {}) {
  if (!lm) return { ok: false, step: "find", msg: "Step into view of the camera", say: "Step into view of the camera" };
  const base = levelOf(def), level = opts.relax ? (base === "knees" || def.anchor === "feet" ? "knees" : "core") : base, groups = GROUPS[level];
  const pts = lm.filter((p, i) => i <= 32 && ok(p));
  if (pts.length < 5) return { ok: false, step: "find", msg: "Step into view of the camera", say: "Step into view of the camera" };

  // body box from everything visible, with a little room for the top of the head
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - 0.06, y1: Math.max(...ys) };
  const lying = ["plank", "lying", "floor", "seated", "situp"].includes(def.posture);
  const lowerNeeded = level === "full";

  // 1. the body parts this exercise needs are in the picture
  const missing = groups.filter(g => !g.some(i => ok(lm[i])));
  const feetGone = missing.some(g => g[0] >= 25), headGone = missing.some(g => g[0] === 0);
  const atEdge = { top: box.y0 < 0.0, bottom: box.y1 > 0.985, left: box.x0 < 0.015, right: box.x1 > 0.985 };
  if (missing.length || atEdge.top || (atEdge.bottom && lowerNeeded) || ((atEdge.left || atEdge.right) && lying)) {
    const what = level !== "full" ? LABEL[level] : feetGone ? "your feet" : LABEL.full;
    const small = pts.length >= 12 && !atEdge.top;      // nearly all of you is there: only a small step
    const m = atEdge.top && !missing.length ? "Lower the camera or step back a little so your head fits" : `Step back${small ? " a little" : ""} so I can see ${what}`;
    return { ok: false, step: "fit", msg: m, say: m, box };
  }

  // 2. distance: big enough to track well, but with some room around you (auto-frame zooms in for you)
  const size = lying ? Math.max(box.x1 - box.x0, (box.y1 - box.y0)) : box.y1 - box.y0;
  if (!opts.auto && size < (lying ? 0.45 : MIN_SIZE[level])) return { ok: false, step: "near", msg: "Come a little closer", say: "Come a little closer", box };
  if (!lying && level !== "hang" && size > 0.99) return { ok: false, step: "far", msg: "Take a step back", say: "Take a step back", box };

  // 3. centred left to right (people side-on to the camera often stand off to one side)
  const cx = (box.x0 + box.x1) / 2;
  if (!opts.auto && !lying && (cx < 0.3 || cx > 0.7)) {
    // raw image: small x = the camera's left = your right when you face it, so you step to your left
    const yourWay = cx < 0.5 ? "left" : "right";
    const m = def.view === "side" ? "Move toward the middle of the picture" : `Take a step to your ${yourWay}`;
    return { ok: false, step: "centre", msg: m, say: m, arrow: cx < 0.5 ? "toRight" : "toLeft", box };
  }

  // 4. facing the right way: side-on exercises need a side view, front ones a front view
  const sw = ok(lm[11]) && ok(lm[12]) ? Math.abs(lm[11].x - lm[12].x) * asp : null;
  const torso = ok(lm[11]) && ok(lm[23]) ? Math.hypot((lm[11].x - lm[23].x) * asp, lm[11].y - lm[23].y) : null;
  if (sw != null && torso && !lying && def.posture !== "hanging") {
    const turned = sw / torso;                         // ~0.7+ facing the camera, ~0.3- side-on
    if (def.view === "side" && turned > 0.55) return { ok: false, step: "turn", msg: "Turn sideways to the camera", say: "Turn sideways to the camera", box };
    if (def.view === "front" && turned < 0.35) return { ok: false, step: "turn", msg: "Turn to face the camera", say: "Turn to face the camera", box };
  }

  // 5. starting position (standing, push-up position, lying...)
  if (!postureOk) return { ok: false, step: "pose", msg: postureHint || "Get into the starting position", say: postureHint || "Get into the starting position", box };

  return { ok: true, step: "ready", msg: "Hold still…", box };
}

/* The guide's moment-to-moment state: needs the checks to pass for a steady 3 seconds (the countdown),
   tolerates a single bad frame, and once started only pauses if you're out of position for 2 seconds. */
export function createGuide() {
  let started = false, goodSince = 0, badSince = 0, lastSay = "", lastSayAt = 0, stepName = "", stepSince = 0, relax = false;
  const FRAMEY = ["fit", "near", "far"];
  return {
    get started() { return started; },
    /* true once you have been stuck on a framing step for a few seconds: the guide then settles for what it can see */
    get relax() { return relax; },
    reset() { started = false; goodSince = 0; badSince = 0; stepName = ""; relax = false; },
    start() { started = true; goodSince = 0; badSince = 0; },
    /* returns { phase: "guide"|"count"|"go"|"live"|"paused", msg, count, say?, arrow, box } */
    step(e, t) {
      let say = null;
      const speakOnce = (s) => { if (s && (s !== lastSay || t - lastSayAt > 6000) && t - lastSayAt > 2500) { lastSay = s; lastSayAt = t; say = s; } };
      if (started) {
        if (e.ok || e.step === "pose") { badSince = 0; return { phase: "live", box: e.box }; }   // posture is the counter's job once going
        if (!badSince) badSince = t;
        if (t - badSince < 2000) return { phase: "live", box: e.box };
        started = false; goodSince = 0;
        speakOnce("Paused. " + e.say);
        return { phase: "paused", msg: e.msg, arrow: e.arrow, box: e.box, say };
      }
      if (!e.ok) {
        if (goodSince && t - goodSince > 300) { if (!badSince) badSince = t; if (t - badSince < 250) return { phase: "count", count: 3 - Math.floor((t - goodSince) / 1000), box: e.box }; }
        goodSince = 0; badSince = 0;
        if (e.step !== stepName) { stepName = e.step; stepSince = t; }
        if (!relax && FRAMEY.includes(e.step) && t - stepSince > 4500) { relax = true; speakOnce("That's fine, I'll track what I can see"); }
        const stuck = t - stepSince > 9000 && e.step !== "find";
        speakOnce(stuck ? e.say + ". Or tap Start now to begin anyway" : e.say);
        return { phase: "guide", stuck, msg: e.msg + (stuck ? " · or tap Start now" : ""), arrow: e.arrow, box: e.box, step: e.step, say };
      }
      badSince = 0;
      if (!goodSince) { goodSince = t; speakOnce("Hold still. 3"); }
      const left = 3 - Math.floor((t - goodSince) / 1000);
      if (left <= 0) { started = true; goodSince = 0; lastSay = "Go"; lastSayAt = t; return { phase: "go", say: "Go!", box: e.box }; }
      if (left !== 3 && t - lastSayAt > 700) { lastSay = String(left); lastSayAt = t; say = String(left); }
      return { phase: "count", count: left, box: e.box, say };
    },
  };
}
