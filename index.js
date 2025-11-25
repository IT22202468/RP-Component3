const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron')
const path = require('path')
// systeminformation will let us query OS processes in a cross-platform way
const si = require('systeminformation')
// active-win lets us detect the foreground (focused) application
let activeWin
try {
  activeWin = require('active-win')
} catch (e) {
  activeWin = null
}

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

app.whenReady().then(() => {
  createWindow()
  // start active window watcher if available
  if (activeWin) startActiveWatcher()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Helper: show a notification (system notification preferred; dialog fallback).
// Returns an object { dialog: boolean, response?: number, error?: string }
async function showNotificationInternal(browserWindow, { title, body } = {}) {
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
      const win = BrowserWindow.getFocusedWindow()
      if (win && win.webContents) win.webContents.send('notification-response', { result: index === 0 ? 'okay' : 'cancel', index })
    } catch (err) {}
  })

  notif.on('close', () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (win && win.webContents) win.webContents.send('notification-response', { result: 'cancel' })
    } catch (err) {}
  })

  try {
    notif.show()
    return { dialog: false }
  } catch (err) {
    try {
      const focused = browserWindow || BrowserWindow.getFocusedWindow()
      const res = await dialog.showMessageBox(focused, {
        type: 'none',
        buttons: ['Okay', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: title || 'Notification',
        message: body || '',
        detail: '',
      })
      try {
        const win = BrowserWindow.getFocusedWindow()
        if (win && win.webContents) win.webContents.send('notification-response', { result: res.response === 0 ? 'okay' : 'cancel', index: res.response })
      } catch (e) {}
      return { dialog: true, response: res.response }
    } catch (e2) {
      return { dialog: true, error: String(e2) }
    }
  }
}

ipcMain.handle('show-notification', async (event, { title, body, useDialog } = {}) => {
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
    try { event.sender.send('notification-response', { result: res.response === 0 ? 'okay' : 'cancel', index: res.response }) } catch (err) {}
    return { dialog: true, response: res.response }
  }
  return await showNotificationInternal(null, { title, body })
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

// Active window watcher: polls the foreground application and notifies
// the user if they stay focused on the same app for more than 10 seconds.
function startActiveWatcher() {
  if (!activeWin) return

  const activeSince = { name: null, ts: null }
  const lastNotified = {}
  const cooldownMs = 5 * 60 * 1000 // 5 minutes per app

  setInterval(async () => {
    try {
      const aw = await activeWin()
      if (!aw) return
      const appName = (aw.owner && (aw.owner.name || aw.owner.ownerName)) || aw.title || 'Unknown'

      if (activeSince.name === appName) {
        // continue counting
      } else {
        activeSince.name = appName
        activeSince.ts = Date.now()
      }

      const elapsed = Date.now() - (activeSince.ts || Date.now())
      // Trigger when focused for more than 10 seconds
      if (elapsed > 10 * 1000) {
        const last = lastNotified[appName] || 0
        if (Date.now() - last > cooldownMs) {
          // Prefer seconds for short durations, otherwise show minutes
          let timeText
          if (elapsed < 60 * 1000) {
            const secs = Math.floor(elapsed / 1000)
            timeText = `${secs} second${secs === 1 ? '' : 's'}`
          } else {
            const mins = Math.floor(elapsed / 60000)
            timeText = `${mins} minute${mins === 1 ? '' : 's'}`
          }
          const title = `You've been using ${appName}`
          const body = `You are on ${appName} for ${timeText}. Let's get back to work.`
          // Try to show a system notification; don't block the watcher
          showNotificationInternal(BrowserWindow.getFocusedWindow(), { title, body }).catch(() => {})
          lastNotified[appName] = Date.now()
        }
      }
    } catch (e) {
      // ignore polling errors
    }
  }, 2000)
}

// (Watcher is started after app.whenReady to ensure windows exist)

// (Removed) in-app toast handler and related code — using system notifications / dialogs only.
