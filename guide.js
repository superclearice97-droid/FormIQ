/* FormIQ setup guide: walks you into the picture before a set starts.
   Pure logic (no page access). evaluate() looks at one frame of pose landmarks and says what to fix next,
   in order: be in view -> whole body in the picture -> right distance -> centred -> facing the right way ->
   starting position. When everything is right, the app counts down 3-2-1 and only then counts reps.

   Directions are given as you face the camera ("step to your left"), which is the same whether or not the
   preview is mirrored. On screen an arrow points the way your image needs to move. */
import { VIS } from "./exercises.js?v=24";

const ok = (p) => p && (p.visibility ?? 1) > VIS;
const NEEDS = {
  full: [0, 11, 12, 23, 24, 25, 26, 27, 28],          // head to ankles
  upper: [0, 11, 12, 13, 14, 15, 16],                 // head, shoulders, arms (pull-ups)
  torso: [0, 11, 12, 13, 14, 23, 24],                 // head to hips (arm and seated moves: legs may be out of shot)
};
/* moves done from the waist up: the camera only has to see head to hips */
const UPPER_ONLY = new Set(["curl", "armcircles", "shoulderrolls", "armswings", "scapsqueeze", "crossbody", "tricepsstretch", "chest", "wrist", "fan", "trunkrot"]);
const isTorso = (def) => def.cat === "arms" || def.posture === "seated" || UPPER_ONLY.has(def.key);

/* def: the exercise (from exercises.js). asp: video width / height.
   Returns { ok, step, msg, say, arrow: "left"|"right"|null, box: {x0,y0,x1,y1} of the body in 0..1 }. */
export function evaluate(lm, def, asp = 16 / 9, postureOk = true, postureHint = "") {
  if (!lm) return { ok: false, step: "find", msg: "Step into view of the camera", say: "Step into view of the camera" };
  const torsoOnly = isTorso(def);
  const need = def.posture === "hanging" ? NEEDS.upper : torsoOnly ? NEEDS.torso : NEEDS.full;
  const pts = lm.filter((p, i) => i <= 32 && ok(p));
  if (pts.length < 6) return { ok: false, step: "find", msg: "Step into view of the camera", say: "Step into view of the camera" };

  // body box from everything visible (head to feet), with a little room for the top of the head
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - 0.06, y1: Math.max(...ys) };
  const lying = ["plank", "lying", "floor", "seated", "situp"].includes(def.posture);

  // 1. whole body in the picture
  const missing = need.filter(i => !ok(lm[i]));
  const feetGone = missing.some(i => i >= 25), headGone = missing.includes(0);
  const atEdge = { top: box.y0 < 0.0, bottom: box.y1 > 0.985, left: box.x0 < 0.015, right: box.x1 > 0.985 };
  if (missing.length || atEdge.top || (atEdge.bottom && !torsoOnly) || ((atEdge.left || atEdge.right) && lying)) {
    const what = torsoOnly ? (headGone ? "your head" : "your body") : feetGone && !headGone ? "your feet" : headGone && !feetGone ? "your head" : "your whole body";
    const m = `Step back so ${what} ${what === "your feet" ? "are" : "is"} in the picture`;
    return { ok: false, step: "fit", msg: m, say: m, box };
  }

  // 2. distance: big enough to track well, but with some room around you
  const size = lying ? Math.max(box.x1 - box.x0, (box.y1 - box.y0) / asp * asp) : box.y1 - box.y0;
  if (size < (lying ? 0.45 : torsoOnly ? 0.28 : 0.5)) return { ok: false, step: "near", msg: "Come a little closer", say: "Come a little closer", box };
  if (!lying && size > 0.97) return { ok: false, step: "far", msg: "Take a step back", say: "Take a step back", box };

  // 3. centred left to right (people side-on to the camera often stand off to one side)
  const cx = (box.x0 + box.x1) / 2;
  if (!lying && (cx < 0.3 || cx > 0.7)) {
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
  let started = false, goodSince = 0, badSince = 0, lastSay = "", lastSayAt = 0, stepName = "", stepSince = 0;
  return {
    get started() { return started; },
    reset() { started = false; goodSince = 0; badSince = 0; stepName = ""; },
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
