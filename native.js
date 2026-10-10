/* FormIQ Android app bridge. Does nothing in a normal browser.
   In the app, the page talks to the phone through a message channel that only this bundled app can use
   (Strava's sign-in pages and other sites can't). Provides Bluetooth (navigator.bluetooth), speech,
   keep-screen-on, file saving, all-day steps, Health Connect and update checks. */
(function () {
  const B = window.FormIQBridge;
  if (!B) return;
  let seq = 0; const pending = new Map(), listeners = {};
  B.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id);
      if (m.ok) p.res(m.result); else p.rej(Object.assign(new Error(m.error || "Something went wrong."), { name: m.name || "Error" })); }
    else if (m.event) (listeners[m.event] || []).forEach(f => { try { f(m); } catch (err) { console.error(err); } });
  };
  const call = (method, args = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); B.postMessage(JSON.stringify({ id, method, args })); });
  const on = (ev, f) => (listeners[ev] ||= []).push(f);
  let info = { version: "" };
  const ready = call("hello").then(r => (info = r || info)).catch(() => info);

  window.FormIQNative = {
    platform: "android", call, on, ready, get version() { return info.version; },
    saveFile: (name, mime, text) => call("saveFile", { name, mime, text }).catch(() => {}),
    openUrl: url => call("openUrl", { url }),
  };
  document.documentElement.dataset.app = "android";

  /* speech for spoken rep counts and ride cues */
  /* Android's web view has no working text-to-speech or wake lock, so use the phone's own */
  try {
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, writable: true, value: function (text) { this.text = text; this.rate = 1; } });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak: u => { call("speak", { text: u.text }); }, cancel: () => { call("speakStop"); }, getVoices: () => [] } });
  } catch {}
  /* keep the screen on during workouts */
  try { Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => { await call("keepAwake", { on: true }); return { release: () => call("keepAwake", { on: false }) }; } } }); } catch {}

  /* navigator.bluetooth on top of the phone's Bluetooth */
  const full = u => typeof u === "number" ? `0000${u.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb` : String(u).toLowerCase();
  const toDV = b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new DataView(a.buffer); };
  const to64 = buf => { const a = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength); let s = ""; for (const x of a) s += String.fromCharCode(x); return btoa(s); };
  const chars = new Map(), devices = new Map();
  class Emitter {
    constructor() { this._l = {}; }
    addEventListener(t, f) { (this._l[t] ||= []).push(f); }
    removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter(x => x !== f); }
    _emit(t) { for (const f of this._l[t] || []) try { f({ type: t, target: this }); } catch (e) { console.error(e); } }
  }
  class Characteristic extends Emitter {
    constructor(dev, svc, uuid) { super(); this.dev = dev; this.svc = svc; this.uuid = uuid; this.value = null; }
    _a(x = {}) { return { dev: this.dev, svc: this.svc, chr: this.uuid, ...x }; }
    startNotifications() { return call("bleNotify", this._a({ on: true })).then(() => this); }
    stopNotifications() { return call("bleNotify", this._a({ on: false })).then(() => this); }
    readValue() { return call("bleRead", this._a()).then(b => (this.value = toDV(b))); }
    writeValue(v) { return call("bleWrite", this._a({ b64: to64(v), resp: true })); }
    writeValueWithResponse(v) { return this.writeValue(v); }
    writeValueWithoutResponse(v) { return call("bleWrite", this._a({ b64: to64(v), resp: false })); }
  }
  class Service {
    constructor(dev, uuid) { this.dev = dev; this.uuid = uuid; }
    async getCharacteristic(u) {
      const chr = full(u);
      if (!await call("bleHasChar", { dev: this.dev, svc: this.uuid, chr })) throw Object.assign(new Error("Not available on this device."), { name: "NotFoundError" });
      const k = `${this.dev}|${this.uuid}|${chr}`; if (!chars.has(k)) chars.set(k, new Characteristic(this.dev, this.uuid, chr)); return chars.get(k);
    }
  }
  class Device extends Emitter {
    constructor(id, name) {
      super(); this.id = id; this.name = name; const dev = this;
      this.gatt = {
        connected: false, device: dev,
        async connect() {
          await call("bleConnect", { dev: id }); this.connected = true;
          return { device: dev, connected: true, getPrimaryService: async u => {
            const svc = full(u);
            if (!await call("bleHasService", { dev: id, svc })) throw Object.assign(new Error("Not available on this device."), { name: "NotFoundError" });
            return new Service(id, svc); } };
        },
        disconnect() { this.connected = false; call("bleDisconnect", { dev: id }).catch(() => {}); },
      };
    }
  }
  on("ble-value", m => { const c = chars.get(`${m.dev}|${m.svc}|${m.chr}`); if (c) { c.value = toDV(m.b64); c._emit("characteristicvaluechanged"); } });
  on("ble-disc", m => { const d = devices.get(m.dev); if (d) { d.gatt.connected = false; d._emit("gattserverdisconnected"); } });
  Object.defineProperty(navigator, "bluetooth", { value: {
    getAvailability: async () => true,
    async requestDevice(opts = {}) {
      const services = (opts.filters || []).flatMap(f => f.services || []).map(full);
      const r = await call("bleRequest", { services });
      const d = new Device(r.id, r.name); devices.set(r.id, d); return d;
    },
  } });

  /* app-only page tweaks */
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('#quality option[value="heavy"]').forEach(o => o.remove());   // the app ships the two lighter tracking models
    document.querySelectorAll("[data-web-only]").forEach(el => el.hidden = true);
    document.querySelectorAll("[data-app-only]").forEach(el => el.hidden = false);
    const wipe = document.getElementById("wipeBtn"); if (wipe) wipe.addEventListener("click", () => { if (wipe.dataset.arm) call("wipe").catch(() => {}); }, true);
    updates();
  });

  /* updates: compares this app's version with the newest FormIQ release on GitHub. No personal data is sent. */
  const UPD = "formiq.updates";
  async function updates(force) {
    let s = {}; try { s = JSON.parse(localStorage.getItem(UPD)) || {}; } catch {}
    const box = document.getElementById("updateBox"), toggle = document.getElementById("updAuto");
    if (toggle) { toggle.checked = s.auto !== false; toggle.onchange = () => { s.auto = toggle.checked; try { localStorage.setItem(UPD, JSON.stringify(s)); } catch {} }; }
    const btn = document.getElementById("updCheck"); if (btn && !btn.onclick) btn.onclick = () => updates(true);
    await ready; const ver = document.getElementById("appVersion"); if (ver) ver.textContent = info.version || "";
    if (!force && (s.auto === false || Date.now() - (s.at || 0) < 864e5)) return show(s.latest);
    try {
      const r = await fetch("https://api.github.com/repos/superclearice97-droid/FormIQ/releases/latest", { credentials: "omit", referrerPolicy: "no-referrer", headers: { Accept: "application/vnd.github+json" } });
      const j = await r.json(); s.latest = (j.tag_name || "").replace(/^v/, ""); s.at = Date.now();
      try { localStorage.setItem(UPD, JSON.stringify(s)); } catch {}
      show(s.latest, force);
    } catch { if (force && box) { box.hidden = false; box.querySelector("p").textContent = "Couldn't check for updates. Check your connection."; } }
    function show(latest, told) {
      if (!box) return;
      const newer = latest && newerThan(latest, info.version);
      box.hidden = !(newer || told);
      box.querySelector("p").textContent = newer ? `FormIQ ${latest} is available. You have ${info.version}.` : `You have the latest version (${info.version}).`;
      box.querySelector("a").hidden = !newer;
    }
  }
  function newerThan(a, b) { const x = String(a).split(".").map(Number), y = String(b).split(/[.-]/).map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; }
  window.FormIQNative.checkUpdates = () => updates(true);
})();
