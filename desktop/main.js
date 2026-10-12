/* FormIQ desktop shell (Electron). Loads the bundled web app from disk, so it works offline and nothing is fetched on start.
   Security: sandboxed page with no Node.js, one fixed origin, camera-only permission (no microphone), navigation locked
   to the app itself, links open in your normal browser. No analytics, no crash reporting, no auto-update pings. */
const { app, BrowserWindow, protocol, session, shell, Menu, dialog, net, ipcMain } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const WWW = path.join(__dirname, "www");
const ORIGIN = "app://formiq";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".wasm": "application/wasm", ".task": "application/octet-stream", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const LINKS = ["https://superclearice97-droid.github.io/", "https://github.com/superclearice97-droid/", "https://www.strava.com/", "https://world.openfoodfacts.org/"];

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.enableSandbox();
app.commandLine.appendSwitch("enable-web-bluetooth");
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
const smoke = process.env.FORMIQ_SMOKE === "1";

function serve(req) {
  try {
    const u = new URL(req.url);
    if (u.host !== "formiq") return new Response("Not found", { status: 404 });
    let p = decodeURIComponent(u.pathname); if (p === "/" || p === "") p = "/index.html";
    const f = path.normalize(path.join(WWW, p));
    if (!f.startsWith(WWW + path.sep)) return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(f).toString()).then(r => {
      const h = new Headers(r.headers); h.set("Content-Type", MIME[path.extname(f).toLowerCase()] || h.get("content-type") || "application/octet-stream");
      h.set("X-Content-Type-Options", "nosniff");
      return new Response(r.body, { status: r.status, headers: h });
    }).catch(() => new Response("Not found", { status: 404 }));
  } catch { return new Response("Bad request", { status: 400 }); }
}

function openExternal(url) {
  try { const u = new URL(url); if (u.protocol === "https:" && LINKS.some(a => url.startsWith(a))) { shell.openExternal(url); return true; } } catch { /* ignore */ }
  return false;
}

/* Bluetooth sensors (heart-rate straps, treadmills, bikes): collect nearby devices for a few seconds, then let you pick */
function bluetoothPicker(wc) {
  let cb = null, list = new Map(), timer = null;
  wc.on("select-bluetooth-device", (e, devices, callback) => {
    e.preventDefault();
    cb = callback; devices.forEach(d => list.set(d.deviceId, d.deviceName || "Unnamed device"));
    if (timer) return;
    timer = setTimeout(async () => {
      const items = [...list.entries()].slice(0, 8), done = cb; timer = null; cb = null; list = new Map();
      if (!done) return;
      if (!items.length) { done(""); dialog.showMessageBox(win, { type: "info", message: "No Bluetooth devices found", detail: "Turn the sensor on, wake it up, and make sure Bluetooth is on for this computer. Then try again.", buttons: ["OK"] }); return; }
      const r = await dialog.showMessageBox(win, { type: "question", message: "Choose a Bluetooth device", detail: "FormIQ only connects to the device you pick.", buttons: [...items.map(i => i[1]), "Cancel"], cancelId: items.length, defaultId: 0, noLink: true });
      done(r.response < items.length ? items[r.response][0] : "");
    }, 3500);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 420, minHeight: 600, show: false, backgroundColor: "#0b1210", title: "FormIQ",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false, backgroundThrottling: false },
  });
  win.once("ready-to-show", () => { if (!smoke) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(ORIGIN + "/")) { e.preventDefault(); openExternal(url); } });
  win.webContents.on("will-attach-webview", e => e.preventDefault());
  bluetoothPicker(win.webContents);
  win.loadURL(ORIGIN + "/index.html");
  win.on("closed", () => { win = null; });
}

function menu() {
  const mac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [mac ? { role: "close" } : { role: "quit" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
    { label: "Help", submenu: [
      { label: "Privacy policy", click: () => win?.loadURL(ORIGIN + "/privacy.html") },
      { label: "Terms", click: () => win?.loadURL(ORIGIN + "/terms.html") },
      { label: "Open-source licenses", click: () => win?.loadURL(ORIGIN + "/licenses.html") },
      { label: "Back to the app", click: () => win?.loadURL(ORIGIN + "/index.html") },
      { type: "separator" }, { label: "FormIQ website", click: () => openExternal("https://superclearice97-droid.github.io/FormIQ/") } ] },
  ]));
}

ipcMain.on("formiq:version", e => { e.returnValue = app.getVersion(); });
ipcMain.handle("formiq:open-url", (e, url) => (e.senderFrame.url.startsWith(ORIGIN + "/") ? openExternal(url) : false));

app.whenReady().then(async () => {
  protocol.handle("app", serve);
  const ses = session.defaultSession, mine = wc => !!wc && wc.getURL().startsWith(ORIGIN + "/");
  // camera only (never the microphone), fullscreen, and copying text; everything else is refused
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    const types = details?.mediaTypes || [];
    cb(mine(wc) && ((perm === "media" && types.every(t => t === "video")) || perm === "fullscreen" || perm === "clipboard-sanitized-write"));
  });
  ses.setPermissionCheckHandler((wc, perm, origin, details) => {
    if (!mine(wc) && !String(origin).startsWith(ORIGIN)) return false;
    return (perm === "media" && (details?.mediaType === "video" || details?.mediaType === undefined)) || perm === "fullscreen" || perm === "clipboard-sanitized-write";
  });
  ses.setDevicePermissionHandler(d => d.deviceType === "bluetooth" && String(d.origin).startsWith(ORIGIN));
  ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "ws://*/*", "wss://*/*"] }, (d, cb) => cb({ cancel: true }));   // nothing unencrypted ever leaves the app
  menu(); createWindow();
  if (smoke) {
    win.webContents.on("did-finish-load", async () => {
      try {
        await new Promise(r => setTimeout(r, 2500));
        const r = await win.webContents.executeJavaScript(`JSON.stringify({cam: !!document.getElementById("camBtn"), exercises: document.querySelectorAll("#exList button").length, desktop: !!window.FormIQDesktop, webgl: !!document.createElement("canvas").getContext("webgl2"), secure: window.isSecureContext})`);
        console.log("FORMIQ_SMOKE " + r);
        const j = JSON.parse(r); app.exit(j.cam && j.exercises > 3 && j.desktop && j.secure ? 0 : 3);
      } catch (e) { console.log("FORMIQ_SMOKE_ERROR " + e.message); app.exit(4); }
    });
    win.webContents.on("did-fail-load", (e, c, d) => { console.log("FORMIQ_SMOKE_LOADFAIL " + c + " " + d); app.exit(5); });
  }
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
app.on("web-contents-created", (e, wc) => wc.on("will-attach-webview", ev => ev.preventDefault()));
