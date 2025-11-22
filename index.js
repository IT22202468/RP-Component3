const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron')
const path = require('path')
// systeminformation will let us query OS processes in a cross-platform way
const si = require('systeminformation')

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // Use a preload script and enable contextIsolation for a safer renderer.
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// IPC handler to show a native notification with action buttons
ipcMain.handle('show-notification', async (event, { title, body, useDialog } = {}) => {
  // If the caller requests a dialog (or if the platform's notification actions are unreliable),
  // use a native message box which always shows separate buttons.
  if (useDialog) {
    const focused = BrowserWindow.getFocusedWindow()
    const res = await dialog.showMessageBox(focused, {
      type: 'none',
      buttons: ['Okay', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: title || 'Notification',
      message: body || '',
      detail: '',
    })

    // res.response is the index of the button clicked
    try {
      event.sender.send('notification-response', { result: res.response === 0 ? 'okay' : 'cancel', index: res.response })
    } catch (err) {
      // ignore
    }

    return { dialog: true, response: res.response }
  }

  // Otherwise try to show a system notification with actions (may be rendered as a dropdown on some OSes)
  const notif = new Notification({
    title: title || 'Notification',
    body: body || '',
    actions: [
      { type: 'button', text: 'Okay' },
      { type: 'button', text: 'Cancel' },
    ],
  })

  notif.on('action', (eventAction, index) => {
    try {
      event.sender.send('notification-response', { result: index === 0 ? 'okay' : 'cancel', index })
    } catch (err) {
      // ignore
    }
  })

  // Treat closing the notification (e.g. user dismisses it) as a cancel action
  notif.on('close', () => {
    try {
      event.sender.send('notification-response', { result: 'cancel' })
    } catch (err) {
      // ignore
    }
  })

  notif.show()
  return { dialog: false }
})

// IPC handler to return a list of host OS processes with simplified fields
// Returned fields: pid, name, cpu (percent), mem (bytes), started (iso), elapsed (ms), status
ipcMain.handle('get-processes', async () => {
  try {
    const data = await si.processes()
    const now = Date.now()

    // data.list is an array of process infos
    const simplified = (data && data.list ? data.list : []).map(p => {
      const started = p.started || null // may be empty
      let elapsed = null
      if (started) {
        try {
          const s = new Date(started).getTime()
          if (!Number.isNaN(s)) elapsed = Math.max(0, now - s)
        } catch (e) {
          elapsed = null
        }
      }

      // Normalize state into a simple status: 'ongoing' or 'idle' or 'unknown'
      const st = (p.state || '').toString().toLowerCase()
      let status = 'unknown'
      if (st.includes('run') || st === 'r' || st.includes('running')) status = 'ongoing'
      else if (st.includes('sleep') || st.includes('idle') || st === 's') status = 'idle'

      return {
        pid: p.pid,
        name: p.name || p.command || p.cmd || '',
        cpu: typeof p.cpu === 'number' ? p.cpu : (p.pcpu || p.pcpuu || 0),
        mem: typeof p.mem === 'number' ? p.mem : (p.pmem || 0),
        started: started,
        elapsed: elapsed,
        status,
        command: p.command || p.cmd || ''
      }
    })

    // Sort by CPU desc then pid
    simplified.sort((a, b) => (b.cpu || 0) - (a.cpu || 0) || (a.pid - b.pid))
    return { ok: true, list: simplified }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// (Removed) in-app toast handler and related code — using system notifications / dialogs only.
