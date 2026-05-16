const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lyrikana", {
  onOverlayUpdate: (callback) => {
    ipcRenderer.on("overlay:update", (_event, payload) => callback(payload));
  },
  onSettingsUpdate: (callback) => {
    ipcRenderer.on("settings:update", (_event, payload) => callback(payload));
  },
  onClickThroughUpdate: (callback) => {
    ipcRenderer.on("click-through:update", (_event, enabled) => callback(enabled));
  },
  close: () => ipcRenderer.send("window:close"),
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleIgnoreMouse: (ignoreMouse) =>
    ipcRenderer.send("window:toggle-ignore-mouse", ignoreMouse),
});
