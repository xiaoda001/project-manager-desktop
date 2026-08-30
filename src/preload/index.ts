import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectManagerApi } from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'

const api: ProjectManagerApi = {
  selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory),
  selectDefaultProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectDefaultProjectDirectory),
  selectIdeExecutable: () => ipcRenderer.invoke(IPC_CHANNELS.selectIdeExecutable),
  getCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.getCatalog),
  createCategory: (input) => ipcRenderer.invoke(IPC_CHANNELS.createCategory, input),
  previewImportMigration: (path) => ipcRenderer.invoke(IPC_CHANNELS.previewImportMigration, path),
  getMigrationPlan: () => ipcRenderer.invoke(IPC_CHANNELS.getMigrationPlan),
  executeMigrations: (input) => ipcRenderer.invoke(IPC_CHANNELS.executeMigrations, input),
  retryMigrationCleanup: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.retryMigrationCleanup, operationId),
  importExistingProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.importExistingProject, input),
  createEmptyProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.createEmptyProject, input),
  updateSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, input)
}

contextBridge.exposeInMainWorld('projectManager', api)
