/* FormIQ run tracking without extra gear: turns steps into a running speed for the runner on screen.
   Three ways to get steps, all on this device:
   - Camera: the pose model watches your feet (or arms, or the bounce of your body when only your top half is in view)
     and counts each step as your feet swap over.
   - Phone in a pocket or armband: the motion sensor counts steps while FormIQ is open.
   - Fitness app (Android app only): steps your watch, phone or fitness app saves to Health Connect.
   Speed comes from cadence and a stride estimated from your height, with an optional calibration. */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* metres per step at a cadence: short steps when walking, longer when running faster */
export function stepLength(spm, heightCm = 170) {
  const h = clamp(+heightCm || 170, 120, 220) / 100;
  if (spm < 125) return h * 0.41;
  return h * (0.41 + (clamp(spm, 125, 195) - 125) / 70 * 0.3);
}
export const kmhFrom = (spm, heightCm, calPct = 100) => spm > 0 ? spm * stepLength(spm, heightCm) * 60 / 1000 * (+calPct || 100) / 100 : 0;

/* steps per minute from step events, over a short sliding window so it follows changes of pace */
export class StepRate {
  constructor(windowS = 6) { this.win = windowS; this.times = []; this.total = 0; }
  add(n, t) {                                    // t in seconds
    this.total += n;
    const last = this.times.length ? this.times[this.times.length - 1] : t - 0.4 * n;
    for (let i = 1; i <= n; i++) this.times.push(last + (t - last) * i / n);
    while (this.times.length && this.times[0] < t - this.win) this.times.shift();
  }
  spm(t) {
    const ts = this.times.filter(x => x > t - this.win);
    if (ts.length < 3 || t - ts[ts.length - 1] > 2) return 0;   // stopped: no step for 2 seconds
    return clamp((ts.length - 1) / Math.max(0.5, ts[ts.length - 1] - ts[0]) * 60, 0, 240);
  }
}

/* camera: counts steps from pose landmarks (MediaPipe's 33-point body model, coordinates 0..1) */
const VIS = 0.5;
export class CameraStepDetector {
  constructor(onStep) {
    this.on = onStep; this.sign = 0; this.lastStep = -1; this.intervals = []; this.run = 0;
    this.base = null; this.up = false; this.source = "none"; this.seen = 0;
  }
  /* returns what it used: "legs", "arms", "bounce" or "none" */
  push(lm, t) {
    if (!lm) { this.source = "none"; return this.source; }
    const v = i => (lm[i]?.visibility ?? 1) >= VIS;
    const mid = (a, b) => ({ x: (lm[a].x + lm[b].x) / 2, y: (lm[a].y + lm[b].y) / 2 });
    if (!(v(11) && v(12))) { this.source = "none"; return this.source; }
    const sh = mid(11, 12), hip = v(23) && v(24) ? mid(23, 24) : null;
    const scale = hip ? Math.hypot(sh.x - hip.x, sh.y - hip.y) : Math.abs(lm[11].x - lm[12].x) * 1.4;
    if (scale < 0.02) { this.source = "none"; return this.source; }
    this.seen = t;
    // feet (or knees) take turns being higher: each swap is one step. Arms swing opposite and work the same way.
    let pair = null, src = "none";
    if (v(27) && v(28)) { pair = [27, 28]; src = "legs"; }
    else if (v(25) && v(26)) { pair = [25, 26]; src = "legs"; }
    else if (v(15) && v(16)) { pair = [15, 16]; src = "arms"; }
    if (pair) {
      const d = (lm[pair[0]].y - lm[pair[1]].y) / scale, th = src === "legs" ? 0.05 : 0.08;
      const s = d > th ? 1 : d < -th ? -1 : 0;
      if (s && s !== this.sign) { if (this.sign) this.step(t); this.sign = s; }
      this.source = src; return src;
    }
    // only the top half in view and arms out of shot: the body bounces up once per step
    const y = sh.y / scale;
    if (this.base == null) this.base = y;
    this.base = this.base * 0.93 + y * 0.07;
    const off = this.base - y;                       // higher on screen = smaller y
    if (!this.up && off > 0.035) { this.up = true; this.step(t); } else if (this.up && off < 0.005) this.up = false;
    this.source = "bounce"; return "bounce";
  }
  step(t) {
    const dt = this.lastStep < 0 ? 0 : t - this.lastStep;
    if (this.lastStep >= 0 && dt < 0.2) return;                    // faster than 300 steps/min: noise
    this.lastStep = t;
    // a real run keeps a rhythm: each gap within half of the recent ones
    const med = this.intervals.length ? this.intervals.slice().sort((a, b) => a - b)[this.intervals.length >> 1] : 0;
    if (dt > 0 && dt <= 1.3 && (!med || Math.abs(dt - med) / med < 0.5)) {
      this.intervals.push(dt); if (this.intervals.length > 8) this.intervals.shift();
      this.run++;
      if (this.run === 3) this.on(3, t); else if (this.run > 3) this.on(1, t);
    } else { this.run = 1; this.intervals = dt > 0 && dt <= 1.3 ? [dt] : []; }
  }
}

/* fitness app via Health Connect: other apps save steps in batches (often every few minutes from a watch),
   so each batch is queued and played out at the pace it was actually run, a batch behind real time */
export class StepQueue {
  constructor() { this.queue = 0; this.played = 0; this.rate = 0; this.batchRate = 0; this.lastTotal = null; this.lastBatch = null; }
  report(total, t) {                                  // total steps since the start, t in seconds
    if (this.lastTotal == null) { this.lastTotal = total; this.lastBatch = t; return; }
    const d = Math.max(0, total - this.lastTotal); this.lastTotal = total;
    if (!d) return;
    this.batchRate = clamp(d / Math.max(10, t - this.lastBatch), 0, 3.4);   // steps per second while those steps were taken
    this.lastBatch = t; this.queue += d;
  }
  /* advance by dt seconds; returns steps per minute being played right now */
  tick(dt) {
    if (this.queue <= 0) { this.rate = 0; return 0; }
    let r = this.batchRate || 2.5;
    if (this.queue > r * 200) r = Math.min(3.4, r * 1.25);                  // far behind (a big late sync): speed up a little
    const n = Math.min(this.queue, r * dt); this.queue -= n; this.played += n;
    this.rate = r * 60; return this.rate;
  }
}
