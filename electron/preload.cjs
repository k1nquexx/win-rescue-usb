const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rescueApi', {
  getDisks: () => ipcRenderer.invoke('get-disks'),
  exportUsbBundle: (payload) => ipcRenderer.invoke('export-usb-bundle', payload),
  openExportFolder: () => ipcRenderer.invoke('open-export-folder'),
  setWindowTitle: (brandName) => ipcRenderer.invoke('set-window-title', brandName),
  closeWindow: () => ipcRenderer.invoke('close-window'),
});
