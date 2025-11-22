const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // For this simple example we enable nodeIntegration. For production
      // apps prefer a preload script and keep contextIsolation=true.
      nodeIntegration: true,
      contextIsolation: false,
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

// (Removed) in-app toast handler and related code — using system notifications / dialogs only.
