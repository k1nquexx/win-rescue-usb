const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rescueApi', {
  getDisks: () => ipcRenderer.invoke('get-disks'),
  exportUsbBundle: (payload) => ipcRenderer.invoke('export-usb-bundle', payload),
  openExportFolder: (folderPath) => ipcRenderer.invoke('open-export-folder', folderPath),
  closeWindow: () => ipcRenderer.invoke('close-window'),
});
