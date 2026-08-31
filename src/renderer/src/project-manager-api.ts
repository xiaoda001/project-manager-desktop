import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type {
  AppSettingsDto,
  CatalogResult,
  CreateCategoryInput,
  CreateEmptyProjectInput,
  ExecuteMigrationsInput,
  ImportExistingProjectInput,
  MigrationBatchResult,
  MigrationPlanResult,
  ProjectManagerApi,
  UpdateProjectInput
} from '../../shared/contracts'

const selectPath = async (title: string, directory: boolean): Promise<string | null> => {
  const selected = await open({ title, directory, multiple: false })
  return typeof selected === 'string' ? selected : null
}

const api: ProjectManagerApi = {
  selectProjectDirectory: () => selectPath('选择现有项目目录', true),
  selectDefaultProjectDirectory: () => selectPath('选择默认项目位置', true),
  selectIdeExecutable: () => selectPath('选择 IDE 程序', false),
  getCatalog: () => invoke<CatalogResult>('get_catalog'),
  createCategory: (input: CreateCategoryInput) => invoke<CatalogResult>('create_category', { input }),
  previewImportMigration: (path: string) =>
    invoke<MigrationPlanResult>('preview_import_migration', { path }),
  getMigrationPlan: () => invoke<MigrationPlanResult>('get_migration_plan'),
  executeMigrations: (input: ExecuteMigrationsInput) =>
    invoke<MigrationBatchResult>('execute_migrations', { input }),
  retryMigrationCleanup: (operationId: string) =>
    invoke<MigrationPlanResult>('retry_migration_cleanup', { operationId }),
  openProjectInIde: (projectId: string) =>
    invoke<CatalogResult>('open_project_in_ide', { projectId }),
  openProjectFolder: (projectId: string) =>
    invoke<CatalogResult>('open_project_folder', { projectId }),
  openProjectRepository: (projectId: string) =>
    invoke<CatalogResult>('open_project_repository', { projectId }),
  runProjectAction: (projectId: string, actionId: string) =>
    invoke<CatalogResult>('run_project_action', { projectId, actionId }),
  updateProject: (input: UpdateProjectInput) =>
    invoke<CatalogResult>('update_project', { input }),
  deleteProject: (projectId: string) =>
    invoke<CatalogResult>('delete_project', { projectId }),
  importExistingProject: (input: ImportExistingProjectInput) =>
    invoke<CatalogResult>('import_existing_project', { input }),
  createEmptyProject: (input: CreateEmptyProjectInput) =>
    invoke<CatalogResult>('create_empty_project', { input }),
  updateSettings: (input: AppSettingsDto) => invoke<CatalogResult>('update_settings', { input })
}

window.projectManager = api
