import { join } from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { registerIpcHandlers } from './ipc'
import { LocalJsonStore } from './local-json-store'
import { ProjectCatalog } from './project-catalog'
import { ProjectMigrationService } from './project-migration'

let removeIpcHandlers: (() => void) | undefined

const appIconPath = (): string => app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../resources/icon.png')

const createWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f6fb',
    title: '项目管理器',
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  const userDataDirectory = app.getPath('userData')
  const store = new LocalJsonStore(userDataDirectory)
  const migrationManager = new ProjectMigrationService(userDataDirectory, {
    trashItem: (path) => shell.trashItem(path)
  })
  const catalog = new ProjectCatalog(store, { migrationManager })
  removeIpcHandlers?.()
  removeIpcHandlers = registerIpcHandlers(mainWindow, catalog)

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.setAppUserModelId('com.local.project-manager')

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(appIconPath())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => removeIpcHandlers?.())
