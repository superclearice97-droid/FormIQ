/* FormIQ tracking recorder (optional, off by default).
   Keeps the last few minutes of the body-point data the tracker saw (33 points per frame, as numbers) in memory only.
   No video or images are ever recorded. Nothing is sent anywhere: the person can save it as a small .json file and share it
   if they choose, so a miscount can be replayed and fixed. */
const MAX = 5400;   // about 3 minutes at 30 fps
const r = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };

export function createRecorder() {
  let on = false, frames = [], events = [], t0 = null;
  return {
    get on() { return on; },
    get frames() { return frames.length; },
    get seconds() { return frames.length ? Math.round((frames[frames.length - 1][0] - frames[0][0]) / 1000) : 0; },
    start() { on = true; },
    stop() { on = false; },
    clear() { frames = []; events = []; t0 = null; },
    /* lm / world: the raw landmark arrays from the pose model, or null when nobody was seen */
    push(t, lm, world) {
      if (!on) return;
      if (t0 == null) t0 = t;
      const f = [Math.round(t - t0)];
      f.push(lm ? lm.flatMap(p => [r(p.x, 4), r(p.y, 4), r(p.z, 3), r(p.visibility ?? 1, 2)]) : null);
      f.push(world ? world.flatMap(p => [r(p.x, 3), r(p.y, 3), r(p.z, 3)]) : null);
      frames.push(f); if (frames.length > MAX) frames.shift();
    },
    event(t, kind, extra) { if (on && t0 != null) events.push({ t: Math.round(t - t0), kind, ...extra }); },
    toJSON(meta) { return JSON.stringify({ format: "formiq-recording-1", meta, events, frames }); },
  };
}
