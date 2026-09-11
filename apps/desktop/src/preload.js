// Preload: the only bridge between the trusted main process and the web renderer.
//
// Everything here is exposed on `window.virtexDesktop` behind contextBridge, so the renderer can
// tell it is running inside the desktop shell (and read the app version) without gaining any Node
// capability. Nothing that can touch the filesystem, spawn a process, or open arbitrary URLs is
// exposed — that is the whole point of a preload over `nodeIntegration: true`.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('virtexDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
