/* FormIQ optional photo meal analysis.
   Off by default. When the user turns it on, a meal photo goes straight from this device to the AI provider
   they chose, using their own API key. FormIQ has no server and never receives the photo, the key or the result.
   Privacy measures: photo is shrunk to 768 px and re-encoded (drops EXIF, including GPS location);
   every photo needs an explicit "Send" tap; key is kept for this tab only unless the user opts to remember it;
   nothing about the photo is stored except the resulting food estimates. */
import "./secure.js?v=18";
import { analyze, addEstimated, showProduct, setMsg } from "./food.js?v=18";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CFG = "formiq.ai.cfg", KEY = "formiq.ai.key";
let memKey = "";                                            // a key you don't ask us to remember lives only in memory
const PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", model: "claude-haiku-5-5", keyHint: "sk-ant-…", keyUrl: "https://console.anthropic.com/settings/keys",
    privacy: "Anthropic does not use API inputs to train its models by default. It keeps API data for a limited time for safety and abuse monitoring under its commercial terms." },
  gemini: { label: "Gemini (Google)", model: "", keyHint: "AIza…", keyUrl: "https://aistudio.google.com/apikey",
    privacy: "On Google's free tier, Google may use what you send to improve its products, and people may review it. Use a key from a paid (billing-enabled) project to keep photos out of training." },
};

const store = {
  cfg() { try { return JSON.parse(localStorage.getItem(CFG)) || null } catch { return null } },
  setCfg(c) { try { c ? localStorage.setItem(CFG, JSON.stringify(c)) : localStorage.removeItem(CFG) } catch {} },
  key() { try { return memKey || localStorage.getItem(KEY) || "" } catch { return memKey || "" } },
  setKey(k, remember) {
    memKey = remember ? "" : k;
    try { localStorage.removeItem(KEY); if (k && remember) localStorage.setItem(KEY, k); } catch {}
  },
};

/* ---------- photo minimization ---------- */
async function shrink(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 768 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.8));   // re-encoding drops all EXIF/GPS metadata
  const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
  return { url: URL.createObjectURL(blob), b64, w: c.width, h: c.height, kb: Math.round(blob.size / 1024) };
}

/* ---------- AI request ---------- */
const PROMPT = `You are a nutrition estimator. Look only at the food and drinks in this photo. Ignore any people, faces, hands, text, screens and background objects, and never describe them.
Return ONLY JSON, no prose, in this shape:
{"items":[{"name":"short food name","grams":number,"drink":boolean,
"per100g":{"kcal":number,"fat":number,"sat":number,"sugar":number,"salt":number,"fiber":number,"protein":number},
"nova":1|2|3|4,"likely_additives":["E250"],"likely_allergens":["milk"],"ingredients":"main ingredients","confidence":"low"|"medium"|"high"}],
"note":"one short sentence about uncertainty"}
Rules: estimate the visible portion in grams (ml for drinks). per100g values are per 100 g or 100 ml. salt is in grams (not sodium).
nova: 1 unprocessed, 2 culinary ingredient, 3 processed, 4 ultra-processed. Only list additives typical for that kind of food.
If there is no food, return {"items":[],"note":"No food found."}`;

async function callAnthropic(key, model, b64) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", referrerPolicy: "no-referrer", credentials: "omit",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }, { type: "text", text: PROMPT }] }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message ? `Claude: ${j.error.message}` : `Claude returned an error (${r.status}).`);
  return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
}
async function pickGeminiModel(key) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, referrerPolicy: "no-referrer", credentials: "omit" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message ? `Gemini: ${j.error.message}` : `Gemini returned an error (${r.status}).`);
  const ok = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent") && /flash/.test(m.name) && !/(lite|image|tts|live|audio|thinking|exp|embedding)/.test(m.name));
  const ver = n => (n.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
  ok.sort((a, b) => (/preview/.test(a.name) - /preview/.test(b.name)) || ver(b.name) - ver(a.name));
  if (!ok.length) throw new Error("No Gemini Flash model is available for this key.");
  return ok[0].name.replace(/^models\//, "");
}
async function callGemini(key, model, b64) {
  model = model || await pickGeminiModel(key);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", referrerPolicy: "no-referrer", credentials: "omit",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: b64 } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message ? `Gemini: ${j.error.message}` : `Gemini returned an error (${r.status}).`);
  return { text: (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join(""), model };
}
function parse(text) {
  const m = String(text).match(/\{[\s\S]*\}/); if (!m) throw new Error("The AI reply wasn't in the expected format. Try another photo.");
  const j = JSON.parse(m[0]); if (!Array.isArray(j.items)) throw new Error("The AI reply wasn't in the expected format.");
  return j;
}
const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null; };
function toItems(j, by) {
  const t = Date.now();
  return j.items.slice(0, 12).map((x, i) => {
    const p = x.per100g || {};
    const prod = {
      code: `photo-${t}-${i}`, product_name: String(x.name || "Food").slice(0, 80), brands: "Photo estimate",
      nutriments: { "energy-kcal_100g": num(p.kcal, 900), "fat_100g": num(p.fat, 100), "saturated-fat_100g": num(p.sat, 100), "sugars_100g": num(p.sugar, 100),
        "salt_100g": num(p.salt, 100), "fiber_100g": num(p.fiber, 100), "proteins_100g": num(p.protein, 100) },
      nova_group: [1, 2, 3, 4].includes(+x.nova) ? +x.nova : null,
      additives_tags: (x.likely_additives || []).filter(a => /^E\d{3,4}[a-z]{0,3}$/i.test(a)).slice(0, 10).map(a => "en:" + a.toLowerCase()),
      allergens_tags: (x.likely_allergens || []).slice(0, 10).map(a => "en:" + String(a).toLowerCase().replace(/\s+/g, "-")),
      categories_tags: x.drink ? ["en:beverages"] : [], labels_tags: [], ingredients_text: String(x.ingredients || "").slice(0, 300),
    };
    const it = analyze(prod);
    return { ...it, est: true, estBy: by, confidence: ["low", "medium", "high"].includes(x.confidence) ? x.confidence : "low", portion: Math.round(num(x.grams, 3000) || 100) };
  });
}

/* ---------- UI ---------- */
let pending = null;
function render() {
  const cfg = store.cfg(), box = $("aiBox");
  if (!cfg) {
    box.innerHTML = `<p class="muted">Off. Optional: score a home-cooked plate from a photo, using your own AI key. Nothing is sent anywhere unless you turn this on.</p>
      <div class="controls"><button id="aiSetup">Set up photo analysis</button></div>`;
    $("aiSetup").onclick = setup; return;
  }
  const P = PROVIDERS[cfg.provider], hasKey = !!store.key();
  box.innerHTML = `<p class="muted">On · ${esc(P.label)}${hasKey ? "" : " · key needed (it was kept only until FormIQ closed)"}.</p>
    <div class="controls">
      <button class="primary" id="aiPhoto">Photo a meal</button>
      <button id="aiOff">Turn off and forget key</button>
    </div>
    <input id="aiFile" type="file" accept="image/*" capture="environment" hidden>
    <div id="aiPreview"></div>`;
  $("aiPhoto").onclick = () => hasKey ? $("aiFile").click() : setup(cfg.provider);
  $("aiOff").onclick = () => { store.setKey(""); store.setCfg(null); pending && URL.revokeObjectURL(pending.url); pending = null; render(); setMsg("Photo analysis is off and your key was deleted from this device."); };
  $("aiFile").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { pending && URL.revokeObjectURL(pending.url); pending = await shrink(f); } catch { return setMsg("Couldn't read that photo.", true); }
    $("aiPreview").innerHTML = `<figure class="aiprev"><img src="${pending.url}" alt="Meal photo to analyze" width="${pending.w}" height="${pending.h}">
      <figcaption>Shrunk to ${pending.w}×${pending.h} (${pending.kb} KB), location and camera data removed. Only this image will be sent to ${esc(P.label)}.</figcaption></figure>
      <div class="controls"><button class="primary" id="aiSend">Send for analysis</button><button id="aiCancel">Discard</button></div>`;
    $("aiCancel").onclick = () => { URL.revokeObjectURL(pending.url); pending = null; $("aiPreview").innerHTML = ""; };
    $("aiSend").onclick = send;
  };
}
async function send() {
  const cfg = store.cfg(), key = store.key(); if (!cfg || !key || !pending) return;
  const P = PROVIDERS[cfg.provider]; $("aiSend").disabled = true; setMsg(`Analyzing with ${P.label}…`);
  try {
    let text, by = P.label;
    if (cfg.provider === "anthropic") { text = await callAnthropic(key, cfg.model || P.model, pending.b64); by += ` (${cfg.model || P.model})`; }
    else { const r = await callGemini(key, cfg.model, pending.b64); text = r.text; by += ` (${r.model})`; }
    const j = parse(text), items = toItems(j, by);
    URL.revokeObjectURL(pending.url); pending = null;      // the photo is discarded right after the reply
    if (!items.length) { $("aiPreview").innerHTML = ""; return setMsg(j.note || "No food found in that photo.", true); }
    $("aiPreview").innerHTML = `<p class="muted">${esc(j.note || "Estimates from a photo can be well off. Adjust portions in your meal if needed.")}</p>
      <ul class="list">${items.map((it, i) => `<li><button type="button" data-i="${i}"><span class="sc ${it.score >= 75 ? "ex" : it.score >= 50 ? "gd" : it.score >= 25 ? "pr" : it.score == null ? "na" : "bd"}">${it.score ?? "–"}</span>
        <span class="nm"><b>${esc(it.name)}</b><small>about ${it.portion} ${it.drink ? "ml" : "g"} · ${esc(it.confidence)} confidence</small></span></button></li>`).join("")}</ul>
      <div class="controls"><button class="primary" id="aiAddAll">Add all to meal</button><button id="aiSaveOnly">Save to library only</button></div>`;
    $("aiPreview").querySelectorAll("button[data-i]").forEach(b => b.onclick = () => showProduct(items[+b.dataset.i]));
    $("aiAddAll").onclick = () => { addEstimated(items, true); $("aiPreview").innerHTML = ""; setMsg(`Added ${items.length} item${items.length > 1 ? "s" : ""} to your meal.`); };
    $("aiSaveOnly").onclick = () => { addEstimated(items, false); $("aiPreview").innerHTML = ""; setMsg("Saved to your food library."); };
    setMsg("");
  } catch (e) {
    setMsg(/Failed to fetch|NetworkError/.test(e.message) ? "Couldn't reach the AI provider. Check your connection." : e.message, true);
    const b = $("aiSend"); if (b) b.disabled = false;
  }
}
function setup(pre) {
  const m = $("aiDialog"); m.hidden = false;
  const sel = $("aiProvider"), info = () => { const P = PROVIDERS[sel.value]; $("aiPrivacy").textContent = P.privacy; $("aiKey").placeholder = P.keyHint; $("aiKeyLink").href = P.keyUrl; };
  if (typeof pre === "string") sel.value = pre; info(); sel.onchange = info;
  $("aiKey").value = ""; $("aiAgree").checked = false; $("aiRemember").checked = false; $("aiModel").value = store.cfg()?.model || "";
  const valid = () => $("aiOk").disabled = !($("aiAgree").checked && $("aiKey").value.trim().length > 10);
  $("aiAgree").onchange = valid; $("aiKey").oninput = valid; valid();
  $("aiCancelSetup").onclick = () => { m.hidden = true; };
  $("aiOk").onclick = () => {
    store.setCfg({ provider: sel.value, model: $("aiModel").value.trim(), agreed: new Date().toISOString().slice(0, 10) });
    store.setKey($("aiKey").value.trim(), $("aiRemember").checked); $("aiKey").value = "";
    m.hidden = true; render(); setMsg("Photo analysis is on. Take or choose a photo of your meal.");
  };
}
export function initAI() { render(); }
