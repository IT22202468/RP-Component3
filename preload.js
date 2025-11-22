const { contextBridge, ipcRenderer } = require('electron')

// Expose a minimal, safe API to the renderer
contextBridge.exposeInMainWorld('api', {
  // getProcesses returns a promise that resolves to the same shape returned by the main handler
  getProcesses: () => ipcRenderer.invoke('get-processes'),

  // showNotification invokes the main process notification helper
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),

  // Register for notification responses. Returns an unsubscribe function.
  onNotificationResponse: (cb) => {
    const listener = (event, data) => cb(data)
    ipcRenderer.on('notification-response', listener)
    return () => ipcRenderer.removeListener('notification-response', listener)
  }
})
