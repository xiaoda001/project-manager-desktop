import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type {
  AppSettingsDto,
  CatalogError,
  CatalogResult,
  CreateCategoryInput,
  ImportExistingProjectInput,
  MigrationBatchResult,
  MigrationPlanResult
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import { CatalogOperationError } from './errors'
import { isCreateEmptyProjectInput, isExecuteMigrationsInput } from './ipc-validation'
import type { ProjectCatalog } from './project-catalog'

const isImportInput = (value: unknown): value is ImportExistingProjectInput => {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  return (
    keys.length === 6 &&
    keys.every((key) => ['name', 'description', 'categoryName', 'path', 'expectedTargetPath', 'migrationConfirmed'].includes(key)) &&
    typeof input.name === 'string' &&
    typeof input.description === 'string' &&
    typeof input.categoryName === 'string' &&
    typeof input.path === 'string' &&
    typeof input.expectedTargetPath === 'string' &&
    input.migrationConfirmed === true
  )
}

const isCreateCategoryInput = (value: unknown): value is CreateCategoryInput => {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false
  const input = value as Record<string, unknown>
  return Object.keys(input).length === 1 && typeof input.name === 'string'
}

const isSettingsInput = (value: unknown): value is AppSettingsDto => {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false
  const settings = value as Record<string, unknown>
  if (
    Object.keys(settings).length !== 2 ||
    typeof settings.defaultProjectDirectory !== 'string' ||
    !settings.ide ||
    typeof settings.ide !== 'object' ||
    Object.getPrototypeOf(settings.ide) !== Object.prototype
  ) return false
  const ide = settings.ide as Record<string, unknown>
  return (
    Object.keys(ide).length === 2 &&
    (ide.type === 'vscode' || ide.type === 'custom') &&
    typeof ide.customExecutablePath === 'string'
  )
}

const toFailure = (error: unknown): { ok: false; error: CatalogError } => {
  if (error instanceof CatalogOperationError) return { ok: false, error: error.toCatalogError() }
  console.error('Unexpected catalog operation failure', error)
  return {
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: '操作失败，请稍后重试。' }
  }
}

export const registerIpcHandlers = (window: BrowserWindow, catalog: ProjectCatalog): (() => void) => {
  const trusted = (event: IpcMainInvokeEvent) =>
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame

  ipcMain.handle(IPC_CHANNELS.selectProjectDirectory, async (event) => {
    if (!trusted(event)) return null
    const selection = await dialog.showOpenDialog(window, {
      title: '选择现有项目目录',
      properties: ['openDirectory', 'dontAddToRecent']
    })
    return selection.canceled ? null : (selection.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC_CHANNELS.selectDefaultProjectDirectory, async (event) => {
    if (!trusted(event)) return null
    const selection = await dialog.showOpenDialog(window, {
      title: '选择默认项目位置',
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    })
    return selection.canceled ? null : (selection.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC_CHANNELS.selectIdeExecutable, async (event) => {
    if (!trusted(event)) return null
    const selection = await dialog.showOpenDialog(window, {
      title: '选择 IDE 程序',
      properties: ['openFile', 'dontAddToRecent']
    })
    return selection.canceled ? null : (selection.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC_CHANNELS.getCatalog, async (event): Promise<CatalogResult> => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无效的应用调用。' } }
    }
    try {
      return { ok: true, data: await catalog.getCatalog() }
    } catch (error) {
      return toFailure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.importExistingProject, async (event, input: unknown): Promise<CatalogResult> => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无效的应用调用。' } }
    }
    if (!isImportInput(input)) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: '项目表单格式无效。' }
      }
    }
    try {
      return { ok: true, data: await catalog.importExistingProject(input) }
    } catch (error) {
      return toFailure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.createCategory, async (event, input: unknown): Promise<CatalogResult> => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无效的应用调用。' } }
    }
    if (!isCreateCategoryInput(input)) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '分类格式无效。' } }
    }
    try {
      return { ok: true, data: await catalog.createCategory(input) }
    } catch (error) {
      return toFailure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.createEmptyProject, async (event, input: unknown): Promise<CatalogResult> => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无效的应用调用。' } }
    }
    if (!isCreateEmptyProjectInput(input)) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: '创建项目表单格式无效。' }
      }
    }
    try {
      return { ok: true, data: await catalog.createEmptyProject(input) }
    } catch (error) {
      return toFailure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.previewImportMigration, async (event, path: unknown): Promise<MigrationPlanResult> => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无效的应用调用。' } }
    }
    if (typeof path !== 'string') {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '项目路径格式无效。' } }
    }
    try {
      return { ok: true, data: await catalog.previewImportMigration(path) }
    } catch (error) {
      return toFailure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.getMigrationPlan, async (event): Promise<MigrationPlanResult> => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无效的应用调用。' } }
    }
    try {
      return { ok: true, data: await catalog.getMigrationPlan() }
    } catch (error) {
      return toFailure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.executeMigrations, async (event, input: unknown): Promise<MigrationBatchResult> => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无效的应用调用。' } }
    }
    if (!isExecuteMigrationsInput(input)) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '迁移确认格式无效。' } }
    }
    try {
      return { ok: true, data: await catalog.migrateProjects(input) }
    } catch (error) {
      return toFailure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.retryMigrationCleanup, async (event, operationId: unknown): Promise<MigrationPlanResult> => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无效的应用调用。' } }
    }
    if (typeof operationId !== 'string' || !operationId || operationId.length > 200) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '迁移操作 ID 无效。' } }
    }
    try {
      return { ok: true, data: await catalog.retryMigrationCleanup(operationId) }
    } catch (error) {
      return toFailure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.updateSettings, async (event, input: unknown): Promise<CatalogResult> => {
    if (!trusted(event)) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无效的应用调用。' } }
    }
    if (!isSettingsInput(input)) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '设置格式无效。' } }
    }
    try {
      return { ok: true, data: await catalog.updateSettings(input) }
    } catch (error) {
      return toFailure(error)
    }
  })

  return () => {
    Object.values(IPC_CHANNELS).forEach((channel) => ipcMain.removeHandler(channel))
  }
}
