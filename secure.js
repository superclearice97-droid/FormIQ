/* FormIQ encrypted storage.
   Everything FormIQ saves is encrypted with AES-256-GCM before it touches the disk.
   - Browser: the key is a non-extractable WebCrypto key kept in this site's IndexedDB (scripts can use it
     but nobody can read it out), or, with a passcode lock, derived from the passcode and never stored.
   - Android app: the key is protected by the phone's hardware-backed Android Keystore.
   The rest of the app keeps using localStorage as before: this module swaps in an encrypted store
   and every module that reads storage imports this one first, so nothing runs until data is decrypted. */

const DB_NAME = "formiq-secure", STORE = "kv", PREFIX = "formiq.", PBKDF2_ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = buf => { let s = ""; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const native = () => window.FormIQNative?.call ? window.FormIQNative : null;

/* refuse to run inside someone else's frame (clickjacking) */
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
  try { window.top.location.replace(window.self.location.href); } catch {}
  throw new Error("FormIQ can't run inside a frame.");
}

let realLS = null; try { realLS = window.localStorage; } catch {}
const data = new Map();
let key = null, mode = "device", saving = null, dirty = false, persistent = true, db = null;

function idb() {
  if (db) return Promise.resolve(db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(db = r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error("blocked"));
  });
}
const tx = (m, f) => idb().then(d => new Promise((res, rej) => { const t = d.transaction(STORE, m), st = t.objectStore(STORE), r = f(st); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }));
const get = k => tx("readonly", s => s.get(k));
const put = (k, v) => tx("readwrite", s => s.put(v, k));
const del = k => tx("readwrite", s => s.delete(k));

async function deviceKey() {
  const n = native();
  if (n) {                                                   // Android Keystore unwraps the data key for this session only
    const raw = unb64(await n.call("secureKey"));
    const k = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); raw.fill(0); return k;
  }
  let k = await get("key");
  if (!k) { k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); await put("key", k); }
  return k;
}
async function passKey(pass, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(k) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("formiq-v1") }, k, enc.encode(JSON.stringify(Object.fromEntries(data))));
  return { iv, ct };
}
async function open(k, blob) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv, additionalData: enc.encode("formiq-v1") }, k, blob.ct);
  return JSON.parse(dec.decode(pt));
}

async function save() {
  if (!persistent || !key) return;
  if (saving) { dirty = true; return saving; }
  saving = (async () => {
    do { dirty = false; const s = await seal(key); await put("blob", { v: 1, mode, salt: blobSalt, iv: s.iv, ct: s.ct }); } while (dirty);
    try { bc?.postMessage("saved"); } catch {}
  })().catch(e => console.error("FormIQ couldn't save", e)).finally(() => { saving = null; });
  return saving;
}
let timer = null;
const schedule = () => { clearTimeout(timer); timer = setTimeout(save, 120); };
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { clearTimeout(timer); save(); } });
addEventListener("pagehide", () => { clearTimeout(timer); save(); });

/* the encrypted store, shaped like localStorage so the rest of the app is unchanged */
const api = {
  getItem: k => data.has(String(k)) ? data.get(String(k)) : null,
  setItem: (k, v) => { data.set(String(k), String(v)); schedule(); },
  removeItem: k => { if (data.delete(String(k))) schedule(); },
  clear: () => { data.clear(); schedule(); },
  key: i => [...data.keys()][i] ?? null,
  get length() { return data.size; },
};
const store = new Proxy(api, {
  get: (t, k) => k in api ? api[k] : (typeof k === "string" && data.has(k) ? data.get(k) : undefined),
  set: (t, k, v) => { api.setItem(k, v); return true; },
  deleteProperty: (t, k) => { api.removeItem(k); return true; },
  has: (t, k) => k in api || data.has(k),
  ownKeys: () => [...data.keys()],
  getOwnPropertyDescriptor: (t, k) => data.has(k) ? { value: data.get(k), enumerable: true, configurable: true, writable: true } : undefined,
});

/* passcode lock screen (browser). Built with DOM methods only. */
function lockScreen(onTry, onErase) {
  return new Promise(resolve => {
    const wrap = document.createElement("div"); wrap.className = "lockscreen"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML = `<form class="lockcard"><h2>FormIQ is locked</h2><p>Enter your passcode to open your data.</p>
      <input type="password" id="lockPass" autocomplete="current-password" aria-label="Passcode" required minlength="6">
      <p class="lockerr" role="alert"></p><button class="primary" type="submit">Unlock</button>
      <button type="button" class="linkbtn lockforgot">Forgot passcode?</button></form>`;
    document.body.appendChild(wrap);
    const f = wrap.querySelector("form"), inp = wrap.querySelector("#lockPass"), err = wrap.querySelector(".lockerr");
    inp.focus();
    f.onsubmit = async e => {
      e.preventDefault(); err.textContent = "Checking…"; f.querySelector("button").disabled = true;
      const ok = await onTry(inp.value); inp.value = "";
      if (ok) { wrap.remove(); resolve(); } else { err.textContent = "That passcode didn't work. Try again."; f.querySelector("button").disabled = false; inp.focus(); }
    };
    wrap.querySelector(".lockforgot").onclick = () => {
      err.textContent = "Without the passcode your data can't be opened by anyone, including us. Tap again to erase it and start fresh.";
      const b = wrap.querySelector(".lockforgot"); b.textContent = "Erase all FormIQ data"; b.onclick = onErase;
    };
  });
}

let blobSalt = null, bc = null;
async function init() {
  try { await idb(); } catch { persistent = false; }
  if (!persistent || !crypto?.subtle) {                      // private window or very old browser: keep data in memory only
    persistent = false; window.FormIQSecure.status = "memory"; return;
  }
  const blob = await get("blob");
  if (blob?.mode === "pass") {
    mode = "pass"; blobSalt = blob.salt;
    await new Promise(r => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", r, { once: true }) : r());
    await lockScreen(async pass => {
      try { const k = await passKey(pass, blob.salt); const obj = await open(k, blob); key = k; for (const [a, b] of Object.entries(obj)) data.set(a, b); return true; }
      catch { await new Promise(r => setTimeout(r, 800)); return false; }
    }, wipe);
  } else {
    key = await deviceKey();
    if (blob) { try { for (const [a, b] of Object.entries(await open(key, blob))) data.set(a, b); }
      catch (e) { console.error(e); window.FormIQSecure.status = "unreadable"; } }
  }
  // move any older unencrypted FormIQ data into the encrypted store, then remove the plaintext copy
  if (realLS) {
    const old = []; try { for (let i = 0; i < realLS.length; i++) { const k = realLS.key(i); if (k?.startsWith(PREFIX)) old.push(k); } } catch {}
    if (old.length) { for (const k of old) if (!data.has(k)) data.set(k, realLS.getItem(k)); await save(); for (const k of old) realLS.removeItem(k); }
  }
  try { bc = new BroadcastChannel("formiq-secure"); bc.onmessage = () => { if (document.visibilityState === "hidden") location.reload(); }; } catch {}
}

async function wipe() {
  clearTimeout(timer); persistent = false; data.clear();
  try { db?.close(); db = null; } catch {}
  await new Promise(r => { const q = indexedDB.deleteDatabase(DB_NAME); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  try { if (realLS) for (const k of Object.keys(realLS)) if (k.startsWith(PREFIX)) realLS.removeItem(k); } catch {}
  try { sessionStorage.clear(); } catch {}
  try { await native()?.call("wipe"); } catch {}
  location.reload();
}

window.FormIQSecure = {
  status: "encrypted",
  get mode() { return mode; },
  get locked() { return mode === "pass"; },
  async setPasscode(pass) {
    if (!pass || pass.length < 6) throw new Error("Use at least 6 characters.");
    blobSalt = crypto.getRandomValues(new Uint8Array(16)); key = await passKey(pass, blobSalt); mode = "pass"; await save();
  },
  async removePasscode() { key = await deviceKey(); mode = "device"; blobSalt = null; await save(); },
  flush: () => { clearTimeout(timer); return save(); },
  wipe,
};

Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, get: () => store });
window.FormIQSecure.ready = init();
await window.FormIQSecure.ready;
