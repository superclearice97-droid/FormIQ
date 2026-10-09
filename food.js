/* FormIQ Food: barcode scan, product score, pros/cons, estimated health risks, food library, meal builder.
   Product data: Open Food Facts (ODbL). Scoring is FormIQ's own method:
   nutrition 60 pts (Nutri-Score grade or nutrient levels) + additives 30 pts + organic 10 pts,
   capped at 49 when a high-risk additive is present. */

const $ = id => document.getElementById(id);
const OFF = "https://world.openfoodfacts.org";
const FIELDS = "code,product_name,generic_name,brands,image_front_small_url,nutriscore_grade,nutriscore_score,nova_group,additives_tags,labels_tags,allergens_tags,traces_tags,categories_tags,nutriments,ingredients_text,quantity";
const LIB_KEY = "formiq.foods.v1", MEAL_KEY = "formiq.meal.v1", MEALS_KEY = "formiq.meals.v1";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- additive risk table (FormIQ's own classification from public regulator and research findings) ---------- */
const ADD = {
  e249: ["Potassium nitrite", "high", "Nitrites in processed meat form nitrosamines; processed meat is an IARC Group 1 carcinogen (colorectal cancer)."],
  e250: ["Sodium nitrite", "high", "Nitrites in processed meat form nitrosamines; processed meat is an IARC Group 1 carcinogen (colorectal cancer)."],
  e251: ["Sodium nitrate", "high", "Converts to nitrite; linked with processed-meat cancer risk."],
  e252: ["Potassium nitrate", "high", "Converts to nitrite; linked with processed-meat cancer risk."],
  e171: ["Titanium dioxide", "high", "Banned as a food additive in the EU since 2022; EFSA could not rule out genotoxicity."],
  e320: ["BHA", "high", "Classified by IARC as possibly carcinogenic (Group 2B)."],
  e924: ["Potassium bromate", "high", "IARC Group 2B; banned in the EU, UK, Canada and other countries."],
  e321: ["BHT", "moderate", "Antioxidant with mixed animal-study results on liver and thyroid."],
  e319: ["TBHQ", "moderate", "Animal studies raise immune-system concerns at high intake."],
  e951: ["Aspartame", "moderate", "IARC Group 2B (2023); WHO/JECFA kept the acceptable daily intake."],
  e950: ["Acesulfame K", "moderate", "Artificial sweetener; cohort studies link sweeteners with cardiovascular risk."],
  e955: ["Sucralose", "moderate", "Artificial sweetener; studies suggest effects on gut bacteria and glucose response."],
  e954: ["Saccharin", "limited", "Artificial sweetener; earlier cancer concerns were not confirmed in humans."],
  e102: ["Tartrazine", "moderate", "EU requires a warning: may affect activity and attention in children."],
  e104: ["Quinoline yellow", "moderate", "EU requires a warning: may affect activity and attention in children."],
  e110: ["Sunset yellow", "moderate", "EU requires a warning: may affect activity and attention in children."],
  e122: ["Azorubine", "moderate", "EU requires a warning: may affect activity and attention in children."],
  e124: ["Ponceau 4R", "moderate", "EU requires a warning: may affect activity and attention in children."],
  e129: ["Allura red", "moderate", "EU requires a warning: may affect activity and attention in children."],
  e127: ["Erythrosine", "high", "Thyroid tumors in animal studies; US FDA revoked its food authorization in 2025."],
  e150c: ["Ammonia caramel", "moderate", "Can contain 4-MEI, possibly carcinogenic (IARC 2B)."],
  e150d: ["Sulfite ammonia caramel", "moderate", "Can contain 4-MEI, possibly carcinogenic (IARC 2B)."],
  e211: ["Sodium benzoate", "moderate", "Can form benzene with vitamin C; linked with hyperactivity in one UK study."],
  e220: ["Sulfur dioxide", "moderate", "Sulfites can trigger asthma and allergic-type reactions."],
  e221: ["Sodium sulfite", "moderate", "Sulfites can trigger asthma and allergic-type reactions."],
  e223: ["Sodium metabisulfite", "moderate", "Sulfites can trigger asthma and allergic-type reactions."],
  e224: ["Potassium metabisulfite", "moderate", "Sulfites can trigger asthma and allergic-type reactions."],
  e407: ["Carrageenan", "moderate", "Animal and lab studies suggest gut inflammation."],
  e433: ["Polysorbate 80", "moderate", "Emulsifier; studies link it to gut-bacteria disruption and inflammation."],
  e466: ["Carboxymethyl cellulose", "moderate", "Emulsifier; human trial showed gut-bacteria changes."],
  e471: ["Mono- and diglycerides", "limited", "Emulsifier; a 2023 cohort study linked emulsifiers to higher heart-disease risk."],
  e338: ["Phosphoric acid", "moderate", "High phosphate intake is linked to kidney and bone concerns."],
  e339: ["Sodium phosphates", "moderate", "High phosphate intake is linked to kidney and heart concerns."],
  e340: ["Potassium phosphates", "moderate", "High phosphate intake is linked to kidney and heart concerns."],
  e341: ["Calcium phosphates", "limited", "Phosphate additive; concern mainly at high total intake."],
  e450: ["Diphosphates", "moderate", "High phosphate intake is linked to kidney and heart concerns."],
  e451: ["Triphosphates", "moderate", "High phosphate intake is linked to kidney and heart concerns."],
  e452: ["Polyphosphates", "moderate", "High phosphate intake is linked to kidney and heart concerns."],
  e621: ["Monosodium glutamate", "limited", "Generally recognized as safe; some people report sensitivity."],
  e202: ["Potassium sorbate", "limited", "Low risk preservative; rare skin sensitivity."],
  e330: ["Citric acid", "none", "Considered safe."],
  e300: ["Ascorbic acid (vitamin C)", "none", "Considered safe."],
  e322: ["Lecithins", "none", "Considered safe."],
  e440: ["Pectins", "none", "Considered safe."],
  e301: ["Sodium ascorbate", "none", "Form of vitamin C; considered safe."],
  e306: ["Tocopherols (vitamin E)", "none", "Considered safe."], e307: ["Alpha-tocopherol", "none", "Considered safe."],
  e270: ["Lactic acid", "none", "Considered safe."], e290: ["Carbon dioxide", "none", "Considered safe."],
  e296: ["Malic acid", "none", "Considered safe."], e260: ["Acetic acid", "none", "Considered safe."],
  e331: ["Sodium citrates", "none", "Considered safe."], e500: ["Sodium carbonates", "none", "Considered safe."],
  e503: ["Ammonium carbonates", "none", "Considered safe."], e100: ["Curcumin", "none", "Considered safe."],
  e160a: ["Carotenes", "none", "Considered safe."], e160c: ["Paprika extract", "none", "Considered safe."],
  e162: ["Beetroot red", "none", "Considered safe."], e140: ["Chlorophylls", "none", "Considered safe."],
  e410: ["Locust bean gum", "none", "Considered safe."], e412: ["Guar gum", "none", "Considered safe."],
  e414: ["Gum arabic", "none", "Considered safe."], e415: ["Xanthan gum", "none", "Considered safe."],
  e418: ["Gellan gum", "none", "Considered safe."], e406: ["Agar", "none", "Considered safe."],
  e960: ["Steviol glycosides", "limited", "Plant-based sweetener; considered safe at normal intake."],
  e420: ["Sorbitol", "limited", "Can have a laxative effect in large amounts."],
  e965: ["Maltitol", "limited", "Can have a laxative effect in large amounts."],
  e967: ["Xylitol", "limited", "Can have a laxative effect; very toxic to dogs."],
  e200: ["Sorbic acid", "limited", "Low risk preservative."], e282: ["Calcium propionate", "limited", "Low risk preservative; some reports of irritability in children."],
  e472e: ["DATEM", "limited", "Emulsifier; low risk at normal intake."], e476: ["PGPR", "limited", "Emulsifier; low risk at normal intake."],
  e481: ["Sodium stearoyl lactylate", "limited", "Emulsifier; low risk at normal intake."],
  e1422: ["Modified starch", "limited", "Considered low risk."], e1442: ["Modified starch", "limited", "Considered low risk."],
};
const RISK_PTS = { high: 15, moderate: 6, limited: 2, none: 0 };

/* ---------- scoring ---------- */
const ORGANIC = ["en:organic", "en:eu-organic", "en:usda-organic", "fr:ab-agriculture-biologique", "en:canada-organic"];
function levels(n, drink) {
  const T = drink
    ? { sugars: [2.5, 11.25], fat: [1.5, 8.75], sat: [0.75, 2.5], salt: [0.3, 0.75] }
    : { sugars: [5, 22.5], fat: [3, 17.5], sat: [1.5, 5], salt: [0.3, 1.5] };
  const lv = (v, [lo, hi]) => v == null ? null : v <= lo ? "low" : v > hi ? "high" : "medium";
  return { sugars: lv(n.sugar, T.sugars), fat: lv(n.fat, T.fat), sat: lv(n.sat, T.sat), salt: lv(n.salt, T.salt) };
}
function analyze(p) {
  const nm = p.nutriments || {}, num = k => { const v = nm[k]; return v == null || v === "" ? null : +v; };
  const n = { kcal: num("energy-kcal_100g"), fat: num("fat_100g"), sat: num("saturated-fat_100g"), sugar: num("sugars_100g"),
              salt: num("salt_100g"), fiber: num("fiber_100g"), protein: num("proteins_100g") };
  const cats = p.categories_tags || [], labels = p.labels_tags || [];
  const drink = cats.includes("en:beverages") && !cats.includes("en:plant-based-foods");
  const L = levels(n, drink);
  const seen = new Set();
  const additives = (p.additives_tags || []).map(t => {
    const code = t.replace(/^en:/, "").toLowerCase(), base = code.replace(/[a-z]+$/, m => m.length > 1 ? "" : m);
    const info = ADD[code] || ADD[base] || ADD[code.replace(/[a-z]+$/, "")];
    const pretty = "E" + code.slice(1);
    return { code: pretty, name: info?.[0] || pretty, risk: info?.[1] || "unknown", note: info?.[2] || "Not yet rated by FormIQ." };
  }).filter(a => { const k = a.name; if (seen.has(k)) return false; seen.add(k); return true; });
  const organic = labels.some(l => ORGANIC.includes(l));
  const grade = (p.nutriscore_grade || "").toLowerCase();

  // nutrition: 60 pts
  let nutrition, nutritionBasis;
  if ("abcde".includes(grade) && grade) { nutrition = { a: 60, b: 48, c: 33, d: 18, e: 6 }[grade]; nutritionBasis = `Nutri-Score ${grade.toUpperCase()}`; }
  else if (n.sugar != null || n.salt != null || n.fat != null) {
    nutrition = 60;
    for (const v of Object.values(L)) nutrition -= v === "high" ? 15 : v === "medium" ? 6 : 0;
    if (!drink && (n.kcal ?? 0) > 400) nutrition -= 8;
    if (drink && (n.sugar ?? 0) > 5) nutrition -= 20;
    if ((n.fiber ?? 0) >= 6) nutrition += 4; if (!drink && (n.protein ?? 0) >= 8) nutrition += 4;
    nutrition = Math.max(0, Math.min(60, nutrition)); nutritionBasis = "nutrient levels";
  } else { nutrition = null; nutritionBasis = "not enough nutrition data"; }
  const addPts = Math.max(0, 30 - additives.reduce((t, a) => t + (RISK_PTS[a.risk] ?? 3), 0));
  const hasHigh = additives.some(a => a.risk === "high");
  let score = nutrition == null ? null : nutrition + addPts + (organic ? 10 : 0);
  if (score != null && hasHigh) score = Math.min(score, 49);

  // pros & cons
  const pros = [], cons = [], unit = drink ? "100 ml" : "100 g", f = v => (Math.round(v * 10) / 10);
  const pc = (k, label, v, lowTxt, highTxt) => {
    if (L[k] === "low") pros.push(`${lowTxt} (${f(v)} g per ${unit})`);
    if (L[k] === "high") cons.push(`${highTxt} (${f(v)} g per ${unit})`);
  };
  pc("sugars", "sugar", n.sugar, "Low in sugar", "High in sugar");
  pc("sat", "sat", n.sat, "Low in saturated fat", "High in saturated fat");
  pc("salt", "salt", n.salt, "Low in salt", "High in salt");
  const sugaryDrink = drink && L.sugars !== "high" && (n.sugar ?? 0) > 5;
  if (sugaryDrink) cons.push(`Sugary drink (${f(n.sugar)} g per 100 ml, about ${Math.round(n.sugar * 3.3)} g in a 330 ml can)`);
  if (L.fat === "high" && L.sat !== "high") cons.push(`High in fat (${f(n.fat)} g per ${unit})`);
  if ((n.fiber ?? 0) >= 6) pros.push(`High in fiber (${f(n.fiber)} g)`); else if ((n.fiber ?? 0) >= 3) pros.push(`Source of fiber (${f(n.fiber)} g)`);
  if (!drink && (n.protein ?? 0) >= 12) pros.push(`High in protein (${f(n.protein)} g)`); else if (!drink && (n.protein ?? 0) >= 8) pros.push(`Good protein (${f(n.protein)} g)`);
  if (!drink && (n.kcal ?? 0) > 400) cons.push(`Calorie dense (${Math.round(n.kcal)} kcal per 100 g)`);
  if (!drink && n.kcal != null && n.kcal < 100) pros.push(`Low in calories (${Math.round(n.kcal)} kcal)`);
  if (!additives.length && p.ingredients_text) pros.push("No additives");
  const risky = additives.filter(a => a.risk === "high" || a.risk === "moderate");
  if (risky.length) cons.push(`${risky.length} additive${risky.length > 1 ? "s" : ""} of concern`);
  if (organic) pros.push("Organic");
  if (p.nova_group == 4) cons.push("Ultra-processed (NOVA 4)");
  else if (p.nova_group == 1) pros.push("Unprocessed or minimally processed");

  // estimated health risks
  const risks = [];
  const ing = (p.ingredients_text || "").toLowerCase();
  if (L.salt === "high") risks.push(["Blood pressure", "high", "Diets high in salt raise blood pressure, a leading risk factor for heart disease and stroke."]);
  if (sugaryDrink) risks.push(["Weight gain, type 2 diabetes, tooth decay", "high", "Sugary drinks are among the strongest dietary links to weight gain and type 2 diabetes."]);
  if (L.sugars === "high") risks.push(["Weight gain, type 2 diabetes, tooth decay", drink ? "high" : "moderate", drink ? "Sugary drinks are among the strongest dietary links to weight gain and type 2 diabetes." : "Frequent high-sugar foods are linked to weight gain, tooth decay and type 2 diabetes."]);
  if (L.sat === "high") risks.push(["LDL cholesterol and heart disease", "moderate", "Saturated fat raises LDL cholesterol; most guidelines advise under 10% of daily calories."]);
  if (/partially hydrogenated|hydrogenated vegetable/.test(ing)) risks.push(["Heart disease (trans fat)", "high", "Partially hydrogenated oils contain trans fats, which raise LDL and lower HDL cholesterol."]);
  if (additives.some(a => ["E249", "E250", "E251", "E252"].includes(a.code)) || cats.includes("en:processed-meats"))
    risks.push(["Colorectal cancer", "high", "Processed meat is classified by IARC as Group 1 (carcinogenic); about 50 g a day is linked to an 18% higher risk."]);
  if (p.nova_group == 4) risks.push(["Ultra-processed food", "moderate", "Large studies link high ultra-processed food intake with heart disease, type 2 diabetes and early death. One item is not a diagnosis; overall pattern matters."]);
  if (additives.some(a => ["E950", "E951", "E955"].includes(a.code))) risks.push(["Artificial sweeteners", "low", "Evidence is still developing; WHO advises against using sweeteners for weight control."]);
  for (const a of additives.filter(a => a.risk === "high" && !["E249", "E250", "E251", "E252"].includes(a.code))) if (!risks.some(r => r[2] === a.note)) risks.push([`${a.name} (${a.code})`, "high", a.note]);
  if (!risks.length && score != null) risks.push(["No major flags", "low", "Nothing in this product's nutrition or additives stands out as a known risk at normal portions."]);

  const allergens = [...new Set([...(p.allergens_tags || []), ...(p.traces_tags || []).map(t => t + " (traces)")])].map(t => t.replace(/^\w\w:/, "").replace(/-/g, " "));
  return {
    code: p.code, name: p.product_name || p.generic_name || "Unnamed product", brand: (p.brands || "").split(",")[0].trim(),
    img: p.image_front_small_url || "", qty: p.quantity || "", drink, n, L, nova: p.nova_group ?? null, grade,
    additives, organic, allergens, pros, cons, risks, score, parts: { nutrition, nutritionBasis, additives: addPts, organic: organic ? 10 : 0, capped: hasHigh },
    at: Date.now(),
  };
}
const rating = s => s == null ? ["No score", "na"] : s >= 75 ? ["Excellent", "ex"] : s >= 50 ? ["Good", "gd"] : s >= 25 ? ["Poor", "pr"] : ["Bad", "bd"];

/* ---------- Open Food Facts ---------- */
async function fetchProduct(code) {
  const r = await fetch(`${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (!r.ok && r.status !== 404) throw new Error("Open Food Facts is not responding. Try again in a moment.");
  const j = await r.json();
  if (j.status !== 1 || !j.product) return null;
  return analyze({ ...j.product, code });
}
async function searchProducts(q) {
  const u = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=15&fields=code,product_name,brands,image_front_small_url,nutriscore_grade`;
  const r = await fetch(u); if (!r.ok) throw new Error("Search is busy. Try again in a few seconds.");
  return ((await r.json()).products || []).filter(p => p.code && p.product_name);
}

/* ---------- barcode scanning ---------- */
let scanStream = null, scanning = false, detector = null;
async function getDetector() {
  if (detector) return detector;
  const fmts = ["ean_13", "ean_8", "upc_a", "upc_e"];
  if ("BarcodeDetector" in window) {
    try { const ok = await BarcodeDetector.getSupportedFormats(); if (fmts.some(f => ok.includes(f))) return detector = new BarcodeDetector({ formats: fmts }); } catch {}
  }
  const mod = await import("https://cdn.jsdelivr.net/npm/barcode-detector@3.0.8/dist/es/ponyfill.js/+esm");
  return detector = new mod.BarcodeDetector({ formats: fmts });
}
async function startScan() {
  if (window.formiqEnsureConsent && !(await window.formiqEnsureConsent())) return;
  document.dispatchEvent(new CustomEvent("formiq:camera", { detail: "food" }));
  const v = $("scanVideo"); setMsg("Starting camera…");
  try {
    const det = await getDetector();
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    v.srcObject = scanStream; await v.play(); $("scanBox").hidden = false; $("scanBtn").textContent = "Stop scanning"; scanning = true;
    setMsg("Point the camera at a barcode.");
    const tick = async () => {
      if (!scanning) return;
      try {
        const codes = await det.detect(v);
        const c = codes.find(c => /^\d{8,14}$/.test(c.rawValue));
        if (c) { stopScan(); navigator.vibrate?.(60); return lookup(c.rawValue); }
      } catch {}
      setTimeout(tick, 180);
    };
    tick();
  } catch (e) {
    stopScan();
    setMsg(e.name === "NotAllowedError" ? "Camera permission was denied. Allow it in site settings, or type the barcode number below." : "Couldn't start the scanner. Type the barcode number below instead.", true);
  }
}
function stopScan() { scanning = false; scanStream?.getTracks().forEach(t => t.stop()); scanStream = null; $("scanBox").hidden = true; $("scanBtn").textContent = "Scan a barcode"; }
document.addEventListener("formiq:camera", e => { if (e.detail !== "food" && scanning) stopScan(); });

/* ---------- library & meal state ---------- */
let lib = load(LIB_KEY, []), meal = load(MEAL_KEY, []), meals = load(MEALS_KEY, []);
function remember(item) { lib = [item, ...lib.filter(x => x.code !== item.code)].slice(0, 300); save(LIB_KEY, lib); renderLib(); }
const findLib = code => lib.find(x => x.code === code);

async function lookup(code) {
  setMsg("Looking up " + code + "…");
  try {
    const item = await fetchProduct(code);
    if (!item) return setMsg(`No product found for ${code}. You can add it at openfoodfacts.org so it works next time.`, true);
    remember(item); showProduct(item); setMsg("");
  } catch (e) { const cached = findLib(code); if (cached) { showProduct(cached); setMsg("Offline: showing your saved copy."); } else setMsg(e.message || "Lookup failed.", true); }
}

/* ---------- rendering ---------- */
function setMsg(t, bad) { const m = $("foodMsg"); m.textContent = t; m.dataset.bad = bad ? "1" : ""; }
function ring(score, size = 76) {
  const [, cls] = rating(score), r = size / 2 - 6, c = 2 * Math.PI * r, pct = score == null ? 0 : score / 100;
  return `<svg class="ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Score ${score ?? "unavailable"} out of 100">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="7"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${c * pct} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="var(--fg)" font-family="var(--display)" font-weight="800" font-size="${size * 0.34}">${score ?? "–"}</text></svg>`;
}
const riskCls = { high: "bd", moderate: "pr", limited: "gd", low: "gd", none: "ex", unknown: "na" };
function showProduct(it) {
  const [label, cls] = rating(it.score), n = it.n, u = it.drink ? "100 ml" : "100 g";
  const row = (k, name, v, unit) => v == null ? "" : `<tr><td>${name}</td><td class="num">${Math.round(v * 10) / 10} ${unit}</td><td>${it.L[k] ? `<span class="lvl ${it.L[k]}">${it.L[k]}</span>` : ""}</td></tr>`;
  $("product").innerHTML = `
  <div class="phead">
    ${it.img ? `<img src="${esc(it.img)}" alt="" width="64" height="64" loading="lazy">` : `<div class="noimg" aria-hidden="true"></div>`}
    <div class="pname"><strong>${esc(it.name)}</strong><span>${esc([it.brand, it.qty].filter(Boolean).join(" · "))}</span></div>
    ${ring(it.score)}
  </div>
  <div class="verdict ${cls}"><b>${label}</b><span>${it.score == null ? "Not enough nutrition data to score this product." :
    `Nutrition ${it.parts.nutrition}/60 (${it.parts.nutritionBasis}) · Additives ${it.parts.additives}/30 · Organic ${it.parts.organic}/10${it.parts.capped ? " · capped at 49 for a high-risk additive" : ""}`}</span></div>
  <div class="pc">
    <div><div class="label">Pros</div><ul>${it.pros.map(p => `<li class="pro">${esc(p)}</li>`).join("") || `<li class="muted">None found</li>`}</ul></div>
    <div><div class="label">Cons</div><ul>${it.cons.map(p => `<li class="con">${esc(p)}</li>`).join("") || `<li class="muted">None found</li>`}</ul></div>
  </div>
  <div class="label">Estimated health risks</div>
  <ul class="risks">${it.risks.map(([t, lv, d]) => `<li><span class="pill ${riskCls[lv]}">${lv}</span><div><b>${esc(t)}</b><span>${esc(d)}</span></div></li>`).join("")}</ul>
  ${it.allergens.length ? `<div class="allergy"><b>Allergens:</b> ${esc(it.allergens.join(", "))}. Always check the package label.</div>` : ""}
  <details ${it.additives.length ? "open" : ""}><summary>Additives (${it.additives.length})</summary>
    ${it.additives.length ? `<ul class="adds">${it.additives.map(a => `<li><span class="pill ${riskCls[a.risk]}">${a.risk}</span><div><b>${esc(a.code)} ${esc(a.name)}</b><span>${esc(a.note)}</span></div></li>`).join("")}</ul>` : `<p class="muted">No additives listed.</p>`}
  </details>
  <details><summary>Nutrition per ${u}</summary><div style="overflow-x:auto"><table>
    ${n.kcal != null ? `<tr><td>Energy</td><td class="num">${Math.round(n.kcal)} kcal</td><td></td></tr>` : ""}
    ${row("fat", "Fat", n.fat, "g")}${row("sat", "Saturated fat", n.sat, "g")}${row("sugars", "Sugars", n.sugar, "g")}${row("salt", "Salt", n.salt, "g")}
    ${n.fiber != null ? `<tr><td>Fiber</td><td class="num">${n.fiber} g</td><td></td></tr>` : ""}${n.protein != null ? `<tr><td>Protein</td><td class="num">${n.protein} g</td><td></td></tr>` : ""}
    ${it.nova ? `<tr><td>Processing</td><td class="num">NOVA ${it.nova}</td><td></td></tr>` : ""}</table></div></details>
  <div class="controls" style="margin-top:12px"><label class="field" for="mealGrams">Portion <input id="mealGrams" type="number" min="1" max="2000" value="100"> ${it.drink ? "ml" : "g"}</label><button class="primary" id="addMeal">Add to meal</button></div>
  <p class="attrib">Product data from <a href="https://world.openfoodfacts.org/product/${esc(it.code)}" target="_blank" rel="noopener">Open Food Facts</a> (ODbL), contributed by its community. Score and risks are FormIQ estimates, not medical advice.</p>`;
  $("product").hidden = false;
  $("addMeal").onclick = () => { const g = Math.max(1, +$("mealGrams").value || 100); meal.push({ code: it.code, g }); save(MEAL_KEY, meal); renderMeal(); setMsg(`Added ${g} ${it.drink ? "ml" : "g"} to your meal.`); };
  $("product").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function renderLib() {
  const q = ($("libFilter")?.value || "").toLowerCase();
  const items = lib.filter(x => !q || (x.name + " " + x.brand).toLowerCase().includes(q));
  $("libList").innerHTML = items.length ? items.map(x => { const [l, c] = rating(x.score); return `<li><button type="button" data-code="${esc(x.code)}">
    <span class="sc ${c}">${x.score ?? "–"}</span><span class="nm"><b>${esc(x.name)}</b><small>${esc(x.brand || l)}</small></span></button></li>`; }).join("")
    : `<li class="muted">${lib.length ? "No matches." : "Foods you scan or look up are saved here, on this device."}</li>`;
  $("libList").querySelectorAll("button[data-code]").forEach(b => b.onclick = () => showProduct(findLib(b.dataset.code)));
}

function mealSummary(list) {
  const rows = list.map(m => ({ ...m, it: findLib(m.code) })).filter(r => r.it);
  const g = rows.reduce((t, r) => t + r.g, 0);
  const scored = rows.filter(r => r.it.score != null), sg = scored.reduce((t, r) => t + r.g, 0);
  let score = sg ? Math.round(scored.reduce((t, r) => t + r.it.score * r.g, 0) / sg) : null;
  if (score != null && rows.some(r => r.it.parts.capped)) score = Math.min(score, 49);
  const tot = k => rows.reduce((t, r) => t + (r.it.n[k] ?? 0) * r.g / 100, 0);
  return { rows, g, score, kcal: tot("kcal"), protein: tot("protein"), sugar: tot("sugar"), salt: tot("salt"), sat: tot("sat"), fiber: tot("fiber") };
}
function renderMeal() {
  const s = mealSummary(meal), [label, cls] = rating(s.score);
  if (!s.rows.length) { $("mealBox").innerHTML = `<p class="muted">Add foods from a scan or your library to score a whole meal.</p>`; return; }
  const flags = [];
  if (s.salt > 2) flags.push(`${s.salt.toFixed(1)} g salt is a third or more of the 6 g daily limit`);
  if (s.sugar > 25) flags.push(`${Math.round(s.sugar)} g sugar is over half a day's 50 g guideline`);
  if (s.sat > 10) flags.push(`${Math.round(s.sat)} g saturated fat is about half a day's limit`);
  if (s.protein >= 25) flags.unshift(`${Math.round(s.protein)} g protein supports recovery after training`);
  $("mealBox").innerHTML = `<div class="phead">${ring(s.score, 64)}<div class="pname"><strong>${label} meal</strong><span>${Math.round(s.kcal)} kcal · ${Math.round(s.protein)} g protein · ${Math.round(s.fiber)} g fiber</span></div></div>
    ${flags.length ? `<ul class="tips">${flags.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    <ul class="mealitems">${s.rows.map((r, i) => { const [, c] = rating(r.it.score); return `<li><span class="sc ${c}">${r.it.score ?? "–"}</span><span class="nm"><b>${esc(r.it.name)}</b><small>${r.g} ${r.it.drink ? "ml" : "g"}</small></span><button type="button" data-i="${i}" aria-label="Remove ${esc(r.it.name)}">Remove</button></li>`; }).join("")}</ul>
    <div class="controls"><button id="saveMeal" class="primary">Save meal</button><button id="clearMeal">Clear</button></div>
    ${meals.length ? `<details><summary>Saved meals (${meals.length})</summary><ul class="mealitems">${meals.slice().reverse().map(m => { const [, c] = rating(m.score); return `<li><span class="sc ${c}">${m.score ?? "–"}</span><span class="nm"><b>${esc(m.name)}</b><small>${new Date(m.at).toLocaleDateString()} · ${Math.round(m.kcal)} kcal</small></span></li>`; }).join("")}</ul></details>` : ""}`;
  $("mealBox").querySelectorAll("button[data-i]").forEach(b => b.onclick = () => { meal.splice(+b.dataset.i, 1); save(MEAL_KEY, meal); renderMeal(); });
  $("clearMeal").onclick = () => { meal = []; save(MEAL_KEY, meal); renderMeal(); };
  $("saveMeal").onclick = () => {
    const name = s.rows.map(r => r.it.name).slice(0, 2).join(" + ") + (s.rows.length > 2 ? ` +${s.rows.length - 2}` : "");
    meals.push({ name, at: Date.now(), score: s.score, kcal: s.kcal, items: meal.slice() }); meals = meals.slice(-100); save(MEALS_KEY, meals);
    meal = []; save(MEAL_KEY, meal); renderMeal(); setMsg("Meal saved.");
  };
}

/* ---------- wire up ---------- */
export function initFood() {
  $("scanBtn").onclick = () => scanning ? stopScan() : startScan();
  $("codeForm").onsubmit = async e => { e.preventDefault(); const c = $("codeInput").value.replace(/\D/g, ""); if (c.length < 8) return setMsg("Enter the 8–14 digit number under the barcode.", true);
    if (window.formiqEnsureConsent && !(await window.formiqEnsureConsent())) return; lookup(c); };
  $("searchForm").onsubmit = async e => {
    e.preventDefault(); const q = $("searchInput").value.trim(); if (q.length < 2) return;
    if (window.formiqEnsureConsent && !(await window.formiqEnsureConsent())) return;
    setMsg("Searching…"); $("results").innerHTML = "";
    try {
      const res = await searchProducts(q);
      setMsg(res.length ? "" : "No products found. Try a brand name or scan the barcode.");
      $("results").innerHTML = res.map(p => `<li><button type="button" data-code="${esc(p.code)}">${p.image_front_small_url ? `<img src="${esc(p.image_front_small_url)}" alt="" width="36" height="36" loading="lazy">` : `<span class="noimg sm"></span>`}<span class="nm"><b>${esc(p.product_name)}</b><small>${esc((p.brands || "").split(",")[0])}</small></span></button></li>`).join("");
      $("results").querySelectorAll("button").forEach(b => b.onclick = () => lookup(b.dataset.code));
    } catch (err) { setMsg(err.message, true); }
  };
  $("libFilter").oninput = renderLib;
  $("clearLib").onclick = () => { const b = $("clearLib"); if (b.dataset.arm) { lib = []; save(LIB_KEY, lib); renderLib(); delete b.dataset.arm; b.textContent = "Clear"; } else { b.dataset.arm = 1; b.textContent = "Tap again to clear"; setTimeout(() => { delete b.dataset.arm; b.textContent = "Clear"; }, 3000); } };
  renderLib(); renderMeal();
}
export { analyze, mealSummary }; // exported for testing
