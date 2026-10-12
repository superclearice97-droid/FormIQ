/* Exposes a tiny, fixed interface to the page. The page itself gets no Node.js and no file access. */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("FormIQDesktop", {
  platform: process.platform,
  version: ipcRenderer.sendSync("formiq:version"),
  openUrl: (url) => ipcRenderer.invoke("formiq:open-url", String(url)),
});
