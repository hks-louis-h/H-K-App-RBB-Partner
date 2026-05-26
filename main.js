const { app, BrowserWindow, shell } = require('electron')
const path = require('path')

function createWindow () {
  const win = new BrowserWindow({
    width:     1440,
    height:    900,
    minWidth:  1100,
    minHeight: 700,
    title: 'H&K Automation – RBB & Partner',
    backgroundColor: '#ecedf1',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged
    }
  })

  win.setMenuBarVisibility(false)

  // Externe Links im System-Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.loadFile(path.join(__dirname, 'kanzlei.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
