/* Replay a FormIQ tracking recording (saved from the app's "Record tracking" button) through the rep counter.
   usage: node tools/rep-tests/replay.mjs recording.json [exercise]
   Prints the counts next to what the person says they really did, and when each rep was counted. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mod = await import(path.join(root, "reps.js"));
const file = process.argv[2]; if (!file) { console.error("usage: replay.mjs recording.json [exercise]"); process.exit(1); }
const d = JSON.parse(fs.readFileSync(file, "utf8"));
const ex = process.argv[3] || d.meta.exercise, asp = d.meta.video?.[0] && d.meta.video?.[1] ? d.meta.video[0] / d.meta.video[1] : 16 / 9;
const lm = a => a && Array.from({ length: a.length / 4 }, (_, i) => ({ x: a[i * 4], y: a[i * 4 + 1], z: a[i * 4 + 2], visibility: a[i * 4 + 3] }));
const wl = a => a && Array.from({ length: a.length / 3 }, (_, i) => ({ x: a[i * 3], y: a[i * 3 + 1], z: a[i * 3 + 2] }));
const tr = mod.createTracker(ex); const at = []; let nulls = 0, lost = 0, n = 0;
for (const [t, l, w] of d.frames) {
  const r = tr.update(lm(l), wl(w), t, asp); n++; if (!l) nulls++; if (r.state === "lost" || r.state === "noperson") lost++;
  if (r.rep) at.push((t / 1000).toFixed(1));
}
const secs = d.frames.at(-1)[0] / 1000;
console.log(`exercise ${ex} · ${d.meta.platform} · ${d.meta.model} model · ${n} frames over ${secs.toFixed(0)} s (${(n / secs).toFixed(1)} fps) · no-person frames ${nulls} · lost ${lost}`);
console.log(`counted now: ${at.length}  · counted in the app: ${d.events.filter(e => e.kind === "rep").length}  · person says: ${d.meta.realReps ?? "?"}`);
console.log(`rep times (s): ${at.join(" ")}`);
if (d.meta.note) console.log(`note: ${d.meta.note}`);
