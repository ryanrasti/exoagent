import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { setupIpc } from './ipc'

app.setName('exoagent')
const isDev = !app.isPackaged

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/index.cjs')
  console.log('Preload path:', preloadPath)

  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for preload on some Linux setups
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  }
  else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  setupIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin')
    app.quit()
})
