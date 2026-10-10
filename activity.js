/* FormIQ Activity: step counter, goals, and connections (Apple Health import, Google/Samsung CSV import,
   Strava with the user's own API app, FitShow/FTMS treadmills and bikes over Bluetooth).
   Everything is stored on this device. Network use: Strava only, and only after the user connects it. */

import "./secure.js?v=18";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEY = "formiq.activity.v1", STRAVA = "formiq.strava.v1";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} };
const pad = n => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = n => Math.round(n).toLocaleString();

let A = load(KEY, null) || { goals: { steps: 8000, workouts: 3, minutes: 150 }, days: {}, workouts: [] };
const persist = () => save(KEY, A);
function day(k = dayKey()) { return A.days[k] || (A.days[k] = {}); }
/* steps counted by FormIQ (live + manual + machine) add up; imported totals already include phone-counted steps,
   so the day total is the larger of the two rather than the sum (avoids double counting). */
function stepsFor(k) {
  const d = A.days[k] || {};
  const app = (d.live || 0) + (d.manual || 0) + (d.machine || 0);
  return Math.max(app, d.apple || 0, d.csv || 0, d.phone || 0, d.hc || 0);
}
function addWorkouts(list) {
  const ids = new Set(A.workouts.map(w => w.id));
  let n = 0; for (const w of list) if (!ids.has(w.id)) { A.workouts.push(w); ids.add(w.id); n++; }
  A.workouts.sort((a, b) => b.start - a.start); A.workouts = A.workouts.slice(0, 1000); persist(); return n;
}
/* FormIQ's own strength workouts (saved from the Workout tab) count toward the weekly goal too */
function formiqWorkouts() {
  try {
    return (JSON.parse(localStorage.getItem("formiq.history.v1")) || []).map(w => {
      const reps = w.sets.reduce((t, s) => t + s.reps, 0);
      return { id: "formiq-" + w.at, source: "FormIQ", type: "Strength", name: [...new Set(w.sets.map(s => s.name))].join(", "),
        start: w.at - Math.max(10, w.sets.length * 2.5) * 60000, minutes: Math.max(10, Math.round(w.sets.length * 2.5)), reps, sets: w.sets.length };
    });
  } catch { return [] }
}
/* the same session often arrives from two places (watch → Apple Health and → Strava); keep one */
function allWorkouts() {
  const out = [];
  for (const w of [...A.workouts, ...formiqWorkouts()].sort((a, b) => b.start - a.start)) {
    if (w.source !== "FormIQ" && out.some(o => o.source !== "FormIQ" && o.source !== w.source && Math.abs(o.start - w.start) < 15 * 60000 && Math.abs((o.minutes || 0) - (w.minutes || 0)) <= 10)) continue;
    out.push(w);
  }
  return out;
}
function weekStart(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }

/* ---------- live step counter (motion sensor, only while the app is open) ---------- */
export class StepDetector {
  constructor(onSteps) { this.on = onSteps; this.smooth = 9.8; this.avg = 9.8; this.above = false; this.last = 0; this.run = 0; }
  push(x, y, z, t) {
    const mag = Math.hypot(x, y, z);
    this.smooth = this.smooth * 0.75 + mag * 0.25;          // remove jitter
    this.avg = this.avg * 0.98 + this.smooth * 0.02;          // slow baseline (gravity + posture)
    const hi = this.avg + 1.1, lo = this.avg + 0.3;
    if (!this.above && this.smooth > hi) {
      this.above = true;
      const dt = (t - this.last) / 1000; this.last = t;
      // real steps keep a steady rhythm: each interval within 40% of the previous one
      if (dt >= 0.25 && dt <= 2.0 && (!this.lastDt || Math.abs(dt - this.lastDt) / this.lastDt < 0.4)) {
        this.run++; this.lastDt = this.lastDt ? this.lastDt * 0.7 + dt * 0.3 : dt;
        if (this.run === 4) this.on(4);                       // a steady rhythm of 4 confirms walking
        else if (this.run > 4) this.on(1);
      } else { this.run = 1; this.lastDt = dt >= 0.25 && dt <= 2.0 ? dt : 0; }
    } else if (this.above && this.smooth < lo) this.above = false;
  }
}
let detector = null, wake = null, counting = false;
async function startCounting() {
  if (typeof DeviceMotionEvent === "undefined") return msg("This device has no motion sensor, so steps can't be counted here. Import them from your health app instead.", true);
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    try { if (await DeviceMotionEvent.requestPermission() !== "granted") return msg("Motion access was denied, so steps can't be counted.", true); } catch { return msg("Motion access was denied.", true); }
  }
  detector = new StepDetector(n => { day().live = (day().live || 0) + n; persist(); renderToday(); });
  let got = false;
  window.addEventListener("devicemotion", onMotion);
  function check() { if (!got && counting) msg("No motion data from this device. On a computer, steps can't be counted; import them instead.", true); }
  onMotion.mark = () => got = true; setTimeout(check, 2500);
  counting = true; try { wake = await navigator.wakeLock?.request("screen"); } catch {}
  $("countBtn").textContent = "Stop counting"; $("countBtn").setAttribute("aria-pressed", "true");
  msg("Counting steps while FormIQ stays open. Keep the phone in a pocket or hand.");
}
function onMotion(e) {
  const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
  onMotion.mark?.(); detector.push(a.x, a.y, a.z, e.timeStamp || performance.now());
}
function stopCounting() {
  counting = false; window.removeEventListener("devicemotion", onMotion);
  try { wake?.release(); } catch {} wake = null;
  $("countBtn").textContent = "Count steps now"; $("countBtn").setAttribute("aria-pressed", "false"); msg("");
}

/* ---------- Apple Health export import (parsed on this device) ---------- */
async function zipEntryStream(file, nameEnd) {
  const tail = new DataView(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
  let eocd = -1; for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That file isn't a readable zip. Unzip it and choose export.xml instead.");
  let cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff) {                                   // zip64
    const loc = eocd - 20; if (loc < 0 || tail.getUint32(loc, true) !== 0x07064b50) throw new Error("Unsupported zip. Unzip it and choose export.xml.");
    const z64 = Number(tail.getBigUint64(loc + 8, true));
    const rec = new DataView(await file.slice(z64, z64 + 56).arrayBuffer());
    cdSize = Number(rec.getBigUint64(40, true)); cdOff = Number(rec.getBigUint64(48, true));
  }
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer()), dec = new TextDecoder();
  for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50;) {
    const method = cd.getUint16(p + 10, true); let comp = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
    const nl = cd.getUint16(p + 28, true), el = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    let off = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
    if (name.endsWith(nameEnd) && !name.includes("export_cda")) {
      let e = p + 46 + nl; const end = e + el;                 // zip64 extra field holds the real sizes/offset
      while (e + 4 <= end) {
        const id = cd.getUint16(e, true), sz = cd.getUint16(e + 2, true); let q = e + 4;
        if (id === 1) { if (usize === 0xffffffff) { usize = Number(cd.getBigUint64(q, true)); q += 8; } if (comp === 0xffffffff) { comp = Number(cd.getBigUint64(q, true)); q += 8; } if (off === 0xffffffff) off = Number(cd.getBigUint64(q, true)); }
        e += 4 + sz;
      }
      const lh = new DataView(await file.slice(off, off + 30).arrayBuffer());
      const start = off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = file.slice(start, start + comp).stream();
      if (method === 0) return raw;
      if (method === 8) return raw.pipeThrough(new DecompressionStream("deflate-raw"));
      throw new Error("Unsupported compression. Unzip it and choose export.xml.");
    }
    p += 46 + nl + el + cl;
  }
  throw new Error("No export.xml found in that zip.");
}
const APPLE_TYPES = { Running: "Run", Walking: "Walk", Cycling: "Ride", TraditionalStrengthTraining: "Strength", FunctionalStrengthTraining: "Strength",
  HighIntensityIntervalTraining: "HIIT", Yoga: "Yoga", Swimming: "Swim", Elliptical: "Elliptical", Hiking: "Hike", Rowing: "Row" };
export async function parseAppleExport(stream, onProgress, sinceDays = 365) {
  const since = dayKey(new Date(Date.now() - sinceDays * 864e5));
  const bySource = {}, workouts = []; let buf = "", bytes = 0, recs = 0;
  const attr = (s, n) => { const m = s.match(new RegExp(`\\b${n}="([^"]*)"`)); return m ? m[1] : null; };
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += value; bytes += value.length;
    const cut = buf.lastIndexOf(">"); if (cut < 0) continue;
    const chunk = buf.slice(0, cut + 1); buf = buf.slice(cut + 1);
    for (const m of chunk.matchAll(/<Record type="HKQuantityTypeIdentifierStepCount"[^>]*>/g)) {
      const d = (attr(m[0], "startDate") || "").slice(0, 10); if (d < since) continue;
      const src = attr(m[0], "sourceName") || "?", v = +attr(m[0], "value") || 0;
      ((bySource[d] ||= {})[src] = (bySource[d][src] || 0) + v); recs++;
    }
    for (const m of chunk.matchAll(/<Workout [^>]*>/g)) {
      const sd = attr(m[0], "startDate") || ""; if (sd.slice(0, 10) < since) continue;
      const t = (attr(m[0], "workoutActivityType") || "").replace("HKWorkoutActivityType", "");
      let mins = +attr(m[0], "duration") || 0; if (attr(m[0], "durationUnit") === "s") mins /= 60; if (attr(m[0], "durationUnit") === "hr") mins *= 60;
      const dist = +attr(m[0], "totalDistance") || 0, du = attr(m[0], "totalDistanceUnit");
      const start = Date.parse(sd.replace(" ", "T").replace(/ ([+-]\d\d)(\d\d)$/, "$1:$2"));
      workouts.push({ id: "apple-" + sd, source: "Apple Health", type: APPLE_TYPES[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2") || "Workout",
        start: isNaN(start) ? Date.now() : start, minutes: Math.round(mins), km: du === "mi" ? dist * 1.609 : du === "km" ? dist : dist ? dist / 1000 : 0,
        kcal: Math.round(+attr(m[0], "totalEnergyBurned") || 0) });
    }
    onProgress?.(bytes, recs);
  }
  // iPhone and Apple Watch both record steps; take the larger source per day instead of adding them
  const days = {}; for (const [d, s] of Object.entries(bySource)) days[d] = Math.round(Math.max(...Object.values(s)));
  return { days, workouts };
}
async function importApple(file) {
  msg("Reading your Health export on this device…");
  try {
    const isZip = /\.zip$/i.test(file.name) || new Uint8Array(await file.slice(0, 2).arrayBuffer()).join() === "80,75";
    const stream = isZip ? await zipEntryStream(file, "export.xml") : file.stream();
    const r = await parseAppleExport(stream, (b, n) => msg(`Reading… ${fmt(b / 1e6)} MB, ${fmt(n)} step records`));
    for (const [d, v] of Object.entries(r.days)) day(d).apple = v;
    const n = addWorkouts(r.workouts); persist(); renderAll();
    msg(`Imported steps for ${Object.keys(r.days).length} days and ${n} new workouts from Apple Health. The file never left your device.`);
  } catch (e) { msg(e.message || "Couldn't read that export.", true); }
}

/* ---------- CSV import (Google Takeout Fit, Samsung Health, others) ---------- */
export function parseStepsCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const split = l => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
  const stepFile = /step/i.test(lines.slice(0, 2).join(" "));
  const isDate = h => /^(date|day)$|^date|day_time|start_time/.test(h);
  const isSteps = h => /step/.test(h) && !/(goal|target|length|speed)/.test(h) || (stepFile && h === "count");
  const hi = lines.slice(0, 20).findIndex(l => { const h = split(l).map(x => x.toLowerCase()); return h.some(isDate) && h.some(isSteps); });
  if (hi < 0) throw new Error("Couldn't find date and step columns in that file.");
  const head = split(lines[hi]).map(h => h.toLowerCase());
  const di = head.findIndex(isDate), si = head.findIndex(isSteps);
  if (di < 0 || si < 0) throw new Error("Couldn't find date and step columns in that file.");
  const days = {};
  for (const l of lines.slice(hi + 1)) {
    const c = split(l); const m = (c[di] || "").match(/(\d{4})-(\d{2})-(\d{2})/); const v = parseFloat(c[si]);
    if (m && Number.isFinite(v) && v >= 0 && v < 200000) days[`${m[1]}-${m[2]}-${m[3]}`] = (days[`${m[1]}-${m[2]}-${m[3]}`] || 0) + v;
  }
  return days;
}
async function importCsv(files) {
  let total = 0;
  try {
    for (const f of files) { const days = parseStepsCsv(await f.text()); for (const [d, v] of Object.entries(days)) { day(d).csv = Math.max(day(d).csv || 0, Math.round(v)); total++; } }
    persist(); renderAll(); msg(`Imported steps for ${total} days. The file never left your device.`);
  } catch (e) { msg(e.message, true); }
}

/* ---------- Strava (user's own API application; secret and tokens stay on this device) ---------- */
let S = load(STRAVA, null);
const saveS = () => save(STRAVA, S);
const NATIVE = () => !!window.FormIQNative?.call;
const PUBLIC_URL = "https://superclearice97-droid.github.io/FormIQ/";
const redirect = () => NATIVE() ? PUBLIC_URL : location.origin + location.pathname;
const callbackDomain = () => NATIVE() ? "superclearice97-droid.github.io" : location.hostname;
/* body: {form: {...}} or {multipart: {fields, file: {field, name, mime, text}}} */
async function sfetch(url, { method = "GET", headers = {}, form, multipart } = {}) {
  if (NATIVE()) {
    const body = form ? { type: "form", fields: form } : multipart ? { type: "multipart", ...multipart } : null;
    const r = await window.FormIQNative.call("stravaFetch", { url, method, headers, body });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { try { return JSON.parse(r.body || "{}"); } catch { return {}; } } };
  }
  let body;
  if (form) body = new URLSearchParams(form);
  if (multipart) { body = new FormData(); for (const [k, v] of Object.entries(multipart.fields || {})) body.append(k, v);
    if (multipart.file) body.append(multipart.file.field, new Blob([multipart.file.text], { type: multipart.file.mime }), multipart.file.name); }
  return fetch(url, { method, headers, body, credentials: "omit", referrerPolicy: "no-referrer" });
}
async function stravaToken() {
  if (!S?.refresh) throw new Error("Connect Strava first.");
  if (S.access && S.expires * 1000 > Date.now() + 120000) return S.access;
  const r = await sfetch("https://www.strava.com/oauth/token", { method: "POST", form: { client_id: S.id, client_secret: S.secret, grant_type: "refresh_token", refresh_token: S.refresh } });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error("Strava sign-in expired. Connect again.");
  Object.assign(S, { access: j.access_token, refresh: j.refresh_token, expires: j.expires_at }); saveS(); return S.access;
}
async function strava(path, opt = {}) {
  const t = await stravaToken();
  const r = await sfetch("https://www.strava.com/api/v3" + path, { ...opt, headers: { Authorization: "Bearer " + t } });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`Strava: ${j.message || r.status}`); return j;
}
function stravaConnect() {
  const st = crypto.getRandomValues(new Uint32Array(4)).join("-"); try { sessionStorage.setItem("formiq.strava.state", st); } catch {}
  location.href = "https://www.strava.com/oauth/authorize?" + new URLSearchParams({ client_id: S.id, redirect_uri: redirect(), response_type: "code",
    approval_prompt: "auto", scope: "activity:read,activity:write", state: st });
}
async function stravaCallback() {
  const q = new URLSearchParams(location.search); if (!q.has("code") && !q.has("error")) return false;
  let st = null; try { st = sessionStorage.getItem("formiq.strava.state"); sessionStorage.removeItem("formiq.strava.state"); } catch {}
  history.replaceState(null, "", location.pathname + "#activity");          // remove the code from the address bar
  if (q.get("error") || !S?.id || q.get("state") !== st) { msg("Strava connection was cancelled.", true); return true; }
  try {
    const r = await sfetch("https://www.strava.com/oauth/token", { method: "POST", form: { client_id: S.id, client_secret: S.secret, code: q.get("code"), grant_type: "authorization_code" } });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Strava didn't accept the connection. Check your Client ID and Secret.");
    Object.assign(S, { access: j.access_token, refresh: j.refresh_token, expires: j.expires_at, scope: q.get("scope") || "", athlete: j.athlete?.firstname || "" }); saveS();
    msg("Strava connected."); await stravaSync();
  } catch (e) { msg(/fetch/i.test(e.message) ? "Your browser couldn't reach Strava. Try again, or use file export." : e.message, true); }
  return true;
}
async function stravaSync() {
  msg("Syncing with Strava…");
  try {
    const after = Math.floor((Date.now() - 60 * 864e5) / 1000);
    const acts = await strava(`/athlete/activities?after=${after}&per_page=100`);
    const n = addWorkouts(acts.map(a => ({ id: "strava-" + a.id, source: "Strava", type: a.sport_type || a.type, name: a.name,
      start: Date.parse(a.start_date), minutes: Math.round((a.moving_time || a.elapsed_time || 0) / 60), km: (a.distance || 0) / 1000, kcal: Math.round(a.kilojoules || 0) })));
    let up = 0;
    if ((S.scope || "").includes("activity:write") && S.upload !== false) {
      S.uploaded ||= [];
      for (const w of formiqWorkouts().filter(w => !S.uploaded.includes(w.id) && Date.now() - w.start < 30 * 864e5)) {
        await strava("/activities", { method: "POST", form: { name: `FormIQ: ${w.name}`, sport_type: "WeightTraining",
          start_date_local: new Date(w.start - new Date(w.start).getTimezoneOffset() * 60000).toISOString().slice(0, 19), elapsed_time: String(w.minutes * 60),
          description: `${w.sets} sets, ${w.reps} reps. Logged with FormIQ.` } });
        S.uploaded.push(w.id); up++;
      }
    }
    S.synced = Date.now(); saveS(); renderAll();
    msg(`Strava synced: ${n} new activities in, ${up} FormIQ workouts sent.`);
  } catch (e) { msg(/fetch/i.test(e.message) ? "Couldn't reach Strava. Check your connection." : e.message, true); }
}
async function stravaDisconnect() {
  try { if (S?.access) await sfetch("https://www.strava.com/oauth/deauthorize", { method: "POST", form: { access_token: S.access } }); } catch {}
  S = null; try { localStorage.removeItem(STRAVA); } catch {} A.workouts = A.workouts.filter(w => w.source !== "Strava"); persist(); renderAll();
  msg("Strava disconnected. Your Strava keys and synced activities were deleted from this device.");
}

/* ---------- FitShow and other FTMS treadmills, bikes, cross trainers (Bluetooth, no internet) ---------- */
export function parseFTMS(kind, dv) {
  let o = 0; const out = {};
  const u8 = () => dv.getUint8(o++), u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; }, s16 = () => { const v = dv.getInt16(o, true); o += 2; return v; };
  const u24 = () => { const v = dv.getUint16(o, true) | (dv.getUint8(o + 2) << 16); o += 3; return v; };
  if (kind === "treadmill") {
    const f = u16();
    if (!(f & 1)) out.kmh = u16() / 100; if (f & 2) u16(); if (f & 4) out.meters = u24(); if (f & 8) { out.incline = s16() / 10; s16(); } if (f & 16) { u16(); u16(); }
    if (f & 32) u8(); if (f & 64) u8(); if (f & 128) { out.kcal = u16(); u16(); u8(); } if (f & 256) out.hr = u8(); if (f & 512) u8(); if (f & 1024) out.secs = u16();
  } else if (kind === "bike") {
    const f = u16();
    if (!(f & 1)) out.kmh = u16() / 100; if (f & 2) u16(); if (f & 4) out.rpm = u16() / 2; if (f & 8) u16(); if (f & 16) out.meters = u24();
    if (f & 32) s16(); if (f & 64) out.watts = s16(); if (f & 128) s16(); if (f & 256) { out.kcal = u16(); u16(); u8(); } if (f & 512) out.hr = u8(); if (f & 1024) u8(); if (f & 2048) out.secs = u16();
  } else {
    const f = dv.getUint16(0, true) | (dv.getUint8(2) << 16); o = 3;
    if (!(f & 1)) out.kmh = u16() / 100; if (f & 2) u16(); if (f & 4) out.meters = u24(); if (f & 8) { out.spm = u16(); u16(); } if (f & 16) out.strides = u16();
    if (f & 32) { u16(); u16(); } if (f & 64) { s16(); s16(); } if (f & 128) s16(); if (f & 256) s16(); if (f & 512) s16(); if (f & 1024) { out.kcal = u16(); u16(); u8(); }
    if (f & 2048) out.hr = u8(); if (f & 4096) u8(); if (f & 8192) out.secs = u16();
  }
  return out;
}
let machine = null;
async function connectMachine() {
  if (!navigator.bluetooth) return msg("This browser can't use Bluetooth. Use the FormIQ Android app, or Chrome on Android, Windows or Mac (on Linux, turn on chrome://flags/#enable-experimental-web-platform-features; in Brave, turn on brave://flags/#brave-web-bluetooth-api).", true);
  try {
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x1826] }] });
    msg(`Connecting to ${dev.name || "machine"}…`);
    const svc = await (await dev.gatt.connect()).getPrimaryService(0x1826);
    let ch = null, kind = null;
    for (const [uuid, k] of [[0x2acd, "treadmill"], [0x2ad2, "bike"], [0x2ace, "cross"]]) { try { ch = await svc.getCharacteristic(uuid); kind = k; break; } catch {} }
    if (!ch) throw new Error("That machine doesn't share workout data over Bluetooth.");
    machine = { dev, ch, kind, data: {}, started: Date.now(), name: dev.name || "Machine" };
    ch.addEventListener("characteristicvaluechanged", e => { Object.assign(machine.data, parseFTMS(kind, e.target.value)); renderMachine(); });
    dev.addEventListener("gattserverdisconnected", () => { if (machine) finishMachine(); });
    await ch.startNotifications(); renderMachine(); msg(`Connected. Start your ${kind === "bike" ? "ride" : kind === "treadmill" ? "walk or run" : "session"} on the machine.`);
  } catch (e) { if (e.name !== "NotFoundError") msg(e.message || "Couldn't connect.", true); }
}
function finishMachine() {
  const m = machine; machine = null; if (!m) return;
  try { m.ch.stopNotifications(); m.dev.gatt.disconnect(); } catch {}
  const d = m.data, mins = Math.round((d.secs || (Date.now() - m.started) / 1000) / 60);
  if (mins >= 1) {
    const km = (d.meters || 0) / 1000;
    const steps = m.kind === "cross" ? (d.strides || 0) * 2 : m.kind === "treadmill" ? Math.round((d.meters || 0) / (d.kmh > 7 ? 1.1 : 0.75)) : 0;
    if (steps) { day().machine = (day().machine || 0) + steps; }
    addWorkouts([{ id: "ftms-" + m.started, source: m.name, type: m.kind === "bike" ? "Ride" : m.kind === "treadmill" ? (d.kmh > 7 ? "Run" : "Walk") : "Elliptical",
      start: m.started, minutes: mins, km, kcal: d.kcal || 0, steps }]);
    msg(`Saved ${mins} min${km ? `, ${km.toFixed(2)} km` : ""}${steps ? `, about ${fmt(steps)} steps` : ""}.`);
  }
  renderAll();
}
function renderMachine() {
  const box = $("machineLive"); if (!machine) { box.hidden = true; $("machineBtn").textContent = "Connect treadmill or bike"; return; }
  const d = machine.data; box.hidden = false; $("machineBtn").textContent = "Finish and save";
  box.innerHTML = [["Speed", d.kmh != null ? d.kmh.toFixed(1) + " km/h" : "–"], ["Distance", d.meters != null ? (d.meters / 1000).toFixed(2) + " km" : "–"],
    ["Time", d.secs != null ? `${Math.floor(d.secs / 60)}:${pad(d.secs % 60)}` : "–"], ["Energy", d.kcal ? d.kcal + " kcal" : "–"], ...(d.hr ? [["Heart rate", d.hr + " bpm"]] : [])]
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");
}

/* ---------- Android app only: all-day steps (on-device) and Health Connect ---------- */
const HC_KEY = "formiq.hc.v1";
let HC = load(HC_KEY, { write: true, written: [] });
const nat = (m, a) => window.FormIQNative.call(m, a);
async function phoneStepsRefresh() {
  try { const r = await nat("stepsRead", { days: 10 }); for (const [d, v] of Object.entries(r || {})) day(d).phone = Math.round(v); persist(); renderToday(); renderWeek(); } catch {}
}
async function hcSync(quiet) {
  try {
    const r = await nat("hcRead", { days: 30 });
    for (const [d, v] of Object.entries(r.steps || {})) day(d).hc = Math.round(v);
    const n = addWorkouts((r.sessions || []).map(x => ({ id: x.id, source: x.app, type: x.type, name: x.title || "", start: x.start, minutes: x.minutes })));
    let out = 0;
    if (HC.write) {
      const mine = allWorkouts().filter(w => (w.source === "FormIQ" || w.source === "FormIQ Ride") && !HC.written.includes(w.id) && Date.now() - w.start < 30 * 864e5);
      for (const w of mine) {
        await nat("hcWrite", { id: w.id, start: w.start, seconds: Math.max(60, (w.minutes || 1) * 60), title: w.source === "FormIQ" ? `FormIQ: ${w.name}` : `FormIQ Ride: ${w.name}`,
          type: w.source === "FormIQ" ? "strength" : /ride/i.test(w.type) ? "ride" : /walk/i.test(w.type) ? "walk" : "run", meters: (w.km || 0) * 1000 });
        HC.written.push(w.id); out++;
      }
      HC.written = HC.written.slice(-500); save(HC_KEY, HC);
    }
    persist(); renderAll(); if (!quiet) msg(`Health Connect synced: ${n} new workouts in, ${out} FormIQ workouts saved.`);
  } catch (e) { if (!quiet) msg(e.message || "Health Connect sync failed.", true); }
}
async function renderNative() {
  const box = $("nativeBox"); if (!box) return;
  if (!NATIVE()) { box.hidden = true; return; }
  box.hidden = false;
  let st = {}, hc = {};
  try { st = await nat("stepsStatus"); } catch {}
  try { hc = await nat("hcStatus"); } catch {}
  $("phoneSteps").innerHTML = !st.available ? `<p class="muted">All-day steps need Google Play services, which this phone doesn't have. Use Health Connect or "Count steps now".</p>` :
    st.enabled ? `<p class="muted">On. Your phone counts steps all day, even when FormIQ is closed. The count stays on your phone.</p><div class="controls"><button id="psOff">Turn off</button></div>`
    : `<p class="muted">Count steps all day without opening FormIQ. Uses your phone's built-in step sensor through Google Play services; nothing leaves your phone.</p><div class="controls"><button class="primary" id="psOn">Turn on all-day steps</button></div>`;
  $("psOn") && ($("psOn").onclick = async () => { try { await nat("stepsEnable"); msg("All-day steps are on. Steps from now on will appear here."); await phoneStepsRefresh(); } catch (e) { msg(e.message, true); } renderNative(); });
  $("psOff") && ($("psOff").onclick = async () => { await nat("stepsDisable").catch(() => {}); renderNative(); });
  $("hcBox").innerHTML = hc.status === "unavailable" ? `<p class="muted">Health Connect isn't available on this phone.</p>` :
    hc.connected ? `<p class="muted">Connected. FormIQ reads your daily steps and workouts from other apps (Google Fit, Samsung Health, Fitbit and more)${hc.write ? " and saves your FormIQ workouts there" : ""}.</p>
      <label class="check" for="hcWrite"><input type="checkbox" id="hcWrite" ${HC.write ? "checked" : ""}> Save my FormIQ workouts and rides to Health Connect</label>
      <div class="controls"><button class="primary" id="hcSync">Sync now</button><button id="hcOff">Disconnect</button></div>`
    : `<p class="muted">Share steps and workouts with Google Fit, Samsung Health, Fitbit and other apps through Android's Health Connect. You choose exactly what FormIQ may read and write.${hc.status === "update" ? " You'll be asked to install or update Health Connect first." : ""}</p>
      <div class="controls"><button class="primary" id="hcOn">Connect Health Connect</button></div>`;
  $("hcOn") && ($("hcOn").onclick = async () => { try { const r = await nat("hcConnect"); if (r.connected) { msg("Health Connect connected."); await hcSync(true); } } catch (e) { msg(e.message, true); } renderNative(); });
  $("hcSync") && ($("hcSync").onclick = () => hcSync(false));
  $("hcWrite") && ($("hcWrite").onchange = e => { HC.write = e.target.checked; save(HC_KEY, HC); });
  $("hcOff") && ($("hcOff").onclick = async () => { await nat("hcDisconnect").catch(() => {}); A.workouts = A.workouts.filter(w => !String(w.id).startsWith("hc-"));
    for (const d of Object.values(A.days)) delete d.hc; persist(); renderAll(); renderNative(); msg("Health Connect disconnected. Data FormIQ had read from it was removed from this device."); });
}
async function nativeRefresh() {
  if (!NATIVE()) return;
  try { if ((await nat("stepsStatus")).enabled) await phoneStepsRefresh(); } catch {}
  try { if ((await nat("hcStatus")).connected) await hcSync(true); } catch {}
}

/* ---------- export (data portability) ---------- */
/* save a file: Android app uses the native save dialog; browsers download it */
export function saveFile(name, mime, text) {
  if (window.FormIQNative?.saveFile) { window.FormIQNative.saveFile(name, mime, text); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/* used by the Ride tab */
export function logWorkout(w, steps) { addWorkouts([w]); if (steps) { day().machine = (day().machine || 0) + steps; persist(); } renderAll(); }
export const stravaReady = () => !!(S?.refresh && (S.scope || "").includes("activity:write"));
export async function stravaUploadTcx(tcx, name, description) {
  return strava("/uploads", { method: "POST", multipart: { fields: { data_type: "tcx", name, description, trainer: "1" },
    file: { field: "file", name: "formiq.tcx", mime: "application/vnd.garmin.tcx+xml", text: tcx } } });
}
function exportData() {
  const all = {}; try { for (const k of Object.keys(localStorage)) if (k.startsWith("formiq.") && !/key|strava|ai\.cfg/.test(k)) all[k] = JSON.parse(localStorage.getItem(k)); } catch {}
  saveFile(`formiq-data-${dayKey()}.json`, "application/json", JSON.stringify({ exported: new Date().toISOString(), app: "FormIQ", data: all }, null, 2));
}

/* ---------- rendering ---------- */
function msg(t, bad) { const m = $("actMsg"); if (m) { m.textContent = t; m.dataset.bad = bad ? "1" : ""; } }
function ringSvg(pct, label, sub) {
  const r = 52, c = 2 * Math.PI * r, p = Math.min(1, pct);
  return `<svg class="bigring${pct >= 1 ? " done" : ""}" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="${label} ${sub}">
    <circle cx="64" cy="64" r="${r}" fill="none" stroke="var(--line)" stroke-width="10"/>
    <circle cx="64" cy="64" r="${r}" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 64 64)"/>
    <text x="64" y="62" text-anchor="middle" fill="var(--fg)" font-family="var(--display)" font-weight="800" font-size="26">${label}</text>
    <text x="64" y="84" text-anchor="middle" fill="var(--muted)" font-family="var(--body)" font-size="11">${sub}</text></svg>`;
}
function renderToday() {
  const k = dayKey(), s = stepsFor(k), g = A.goals.steps, d = A.days[k] || {};
  $("stepRing").innerHTML = ringSvg(s / g, fmt(s), `of ${fmt(g)} steps`);
  const parts = [["Counted here", (d.live || 0) + (d.manual || 0)], ["All-day (phone)", d.phone || 0], ["Health Connect", d.hc || 0], ["Machines", d.machine || 0], ["Apple Health", d.apple || 0], ["Imported file", d.csv || 0]].filter(([, v]) => v);
  $("stepSources").innerHTML = parts.length ? parts.map(([n, v]) => `<li><span>${n}</span><b>${fmt(v)}</b></li>`).join("") : `<li class="muted">No steps yet today.</li>`;
  let streak = 0; for (let i = 0; i < 365; i++) { const dd = new Date(); dd.setDate(dd.getDate() - i); const ok = stepsFor(dayKey(dd)) >= g; if (ok) streak++; else if (i > 0) break; }
  $("stepStreak").textContent = s >= g ? `Goal reached. ${streak}-day streak.` : `${fmt(g - s)} to go${streak ? ` · ${streak}-day streak` : ""}`;
}
function renderWeek() {
  const ws = weekStart(), days = [...Array(7)].map((_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return d; });
  const vals = days.map(d => stepsFor(dayKey(d))), g = A.goals.steps, max = Math.max(g * 1.2, ...vals), W = 300, H = 120, bw = 28, gap = (W - 7 * bw) / 6;
  const gy = H - 18 - (g / max) * (H - 30), today = dayKey();
  $("weekChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Steps this week">
    <line x1="0" x2="${W}" y1="${gy}" y2="${gy}" stroke="var(--accent)" stroke-dasharray="4 4" stroke-width="1"/>
    <text x="${W}" y="${gy - 4}" text-anchor="end" font-size="10" fill="var(--muted)">goal ${fmt(g)}</text>
    ${vals.map((v, i) => { const h = (v / max) * (H - 30), x = i * (bw + gap); const isT = dayKey(days[i]) === today;
      return `<rect x="${x}" y="${H - 18 - h}" width="${bw}" height="${Math.max(h, 1)}" rx="4" fill="${v >= g ? "var(--accent)" : "var(--muted)"}" opacity="${isT ? 1 : 0.7}"><title>${fmt(v)} steps</title></rect>
        <text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="${isT ? "var(--fg)" : "var(--muted)"}">${"MTWTFSS"[i]}</text>`; }).join("")}</svg>`;
  const wk = allWorkouts().filter(w => w.start >= ws.getTime()), mins = wk.reduce((t, w) => t + (w.minutes || 0), 0);
  $("weekStats").innerHTML = `<div class="stat"><b>${wk.length}<small>/${A.goals.workouts}</small></b><span>workouts</span></div>
    <div class="stat"><b>${mins}<small>/${A.goals.minutes}</small></b><span>active min</span></div>
    <div class="stat"><b>${fmt(vals.reduce((a, b) => a + b, 0))}</b><span>steps</span></div>`;
}
function renderList() {
  const list = allWorkouts().slice(0, 25);
  $("actList").innerHTML = list.length ? list.map(w => `<li><div class="nm"><b>${esc(w.type)}${w.name && w.source !== "FormIQ" ? " · " + esc(w.name) : w.source === "FormIQ" ? " · " + esc(w.name) : ""}</b>
    <small>${new Date(w.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${esc(w.source)}</small></div>
    <span class="num">${w.minutes ? w.minutes + " min" : ""}${w.km ? ` · ${w.km.toFixed(1)} km` : ""}${w.reps ? ` · ${w.reps} reps` : ""}</span></li>`).join("")
    : `<li class="muted">Workouts from FormIQ, Apple Health, Strava and connected machines appear here.</li>`;
}
function renderStrava() {
  const box = $("stravaBox");
  if (!S?.id) {
    box.innerHTML = `<p class="muted">Sync activities both ways using your own free Strava API app. Its keys stay on this device.</p>
      <details><summary>Set up (2 minutes)</summary><ol class="steps">
        <li>Open <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener noreferrer">strava.com/settings/api</a> and create an app (any name and website).</li>
        <li>Set <b>Authorization Callback Domain</b> to <code>${esc(callbackDomain())}</code>.</li>
        <li>Copy the Client ID and Client Secret here.</li></ol>
        <div class="formrow"><input id="stravaId" inputmode="numeric" placeholder="Client ID" aria-label="Strava Client ID">
        <input id="stravaSecret" type="password" placeholder="Client Secret" aria-label="Strava Client Secret" autocomplete="off"></div>
        <label for="stravaOk" class="check"><input type="checkbox" id="stravaOk"> I agree that activities will be exchanged with Strava under Strava's terms and privacy policy.</label>
        <button class="primary" id="stravaGo" disabled>Connect with Strava</button></details>`;
    const v = () => $("stravaGo").disabled = !($("stravaOk").checked && /^\d+$/.test($("stravaId").value.trim()) && $("stravaSecret").value.trim().length > 20);
    ["stravaId", "stravaSecret"].forEach(i => $(i).oninput = v); $("stravaOk").onchange = v;
    $("stravaGo").onclick = () => { S = { id: $("stravaId").value.trim(), secret: $("stravaSecret").value.trim() }; saveS(); stravaConnect(); };
    return;
  }
  if (!S.refresh) { box.innerHTML = `<p class="muted">Keys saved, not connected yet.</p><div class="controls"><button class="primary" id="stravaGo">Connect with Strava</button><button id="stravaOff">Remove keys</button></div>`;
    $("stravaGo").onclick = stravaConnect; $("stravaOff").onclick = stravaDisconnect; return; }
  box.innerHTML = `<p class="muted">Connected${S.athlete ? " as " + esc(S.athlete) : ""}${S.synced ? ` · last sync ${new Date(S.synced).toLocaleString()}` : ""}.</p>
    <label for="stravaUp" class="check"><input type="checkbox" id="stravaUp" ${S.upload !== false ? "checked" : ""}> Send my FormIQ strength workouts to Strava</label>
    <div class="controls"><button class="primary" id="stravaSync">Sync now</button><button id="stravaOff">Disconnect</button></div>
    <p class="attrib">Powered by Strava</p>`;
  $("stravaUp").onchange = e => { S.upload = e.target.checked; saveS(); };
  $("stravaSync").onclick = stravaSync; $("stravaOff").onclick = stravaDisconnect;
}
function renderGoals() { $("goalSteps").value = A.goals.steps; $("goalWorkouts").value = A.goals.workouts; $("goalMinutes").value = A.goals.minutes; }
function renderAll() { renderToday(); renderWeek(); renderList(); renderStrava(); renderGoals(); }

export async function initActivity() {
  $("countBtn").onclick = () => counting ? stopCounting() : startCounting();
  $("addStepsForm").onsubmit = e => { e.preventDefault(); const v = Math.round(+$("addSteps").value); if (v > 0 && v < 100000) { day().manual = (day().manual || 0) + v; persist(); renderAll(); $("addSteps").value = ""; msg(`Added ${fmt(v)} steps.`); } };
  for (const [id, k, min, max] of [["goalSteps", "steps", 500, 100000], ["goalWorkouts", "workouts", 1, 21], ["goalMinutes", "minutes", 10, 2000]])
    $(id).onchange = () => { const v = Math.round(+$(id).value); if (v >= min && v <= max) { A.goals[k] = v; persist(); renderAll(); } else renderGoals(); };
  $("appleBtn").onclick = () => $("appleFile").click(); $("csvBtn").onclick = () => $("csvFile").click();
  $("appleFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) importApple(f); };
  $("csvFile").onchange = e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) importCsv(f); };
  $("machineBtn").onclick = () => machine ? finishMachine() : connectMachine();
  $("exportBtn").onclick = exportData;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && counting) msg("Counting paused while FormIQ is in the background. Imported steps fill the gaps.", true); });
  renderAll();
  if (NATIVE()) { renderNative(); nativeRefresh(); window.FormIQNative.on("resume", () => nativeRefresh()); }
  if (await stravaCallback()) document.dispatchEvent(new CustomEvent("formiq:showtab", { detail: "activity" }));
}
