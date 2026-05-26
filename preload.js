const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  saveAndOpen: (buffer, filename) => ipcRenderer.invoke('save-and-open', buffer, filename),
  onDemoReset: (cb) => ipcRenderer.on('demo-reset', cb)
})
