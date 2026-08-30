export const IPC_CHANNELS = {
  selectProjectDirectory: 'dialog:select-project-directory',
  selectDefaultProjectDirectory: 'dialog:select-default-project-directory',
  selectIdeExecutable: 'dialog:select-ide-executable',
  getCatalog: 'catalog:get',
  createCategory: 'catalog:create-category',
  importExistingProject: 'catalog:import-existing',
  createEmptyProject: 'catalog:create-empty',
  previewImportMigration: 'migration:preview-import',
  getMigrationPlan: 'migration:plan',
  executeMigrations: 'migration:execute',
  retryMigrationCleanup: 'migration:retry-cleanup',
  updateSettings: 'settings:update'
} as const

export interface AppSettingsDto {
  defaultProjectDirectory: string
  ide: {
    type: 'vscode' | 'custom'
    customExecutablePath: string
  }
}

export interface ProjectDto {
  id: string
  name: string
  description: string
  categoryId: string
  path: string
  source: 'existing' | 'created'
  createdAt: string
  updatedAt: string
  lastOpenedAt: null
}

export interface CategoryDto {
  id: string
  name: string
  createdAt: string
}

export interface CatalogSnapshotDto {
  projects: ProjectDto[]
  categories: CategoryDto[]
  settings: AppSettingsDto
}

export interface ImportExistingProjectInput {
  name: string
  description: string
  categoryName: string
  path: string
  expectedTargetPath: string
  migrationConfirmed: boolean
}

export interface CreateEmptyProjectInput {
  name: string
  description: string
  categoryName: string
}

export interface CreateCategoryInput {
  name: string
}

export type MigrationPlanStatus = 'ready' | 'already-managed' | 'conflict' | 'invalid'

export interface ProjectMigrationPlanItem {
  projectId: string
  projectName: string
  sourcePath: string
  targetPath: string
  status: MigrationPlanStatus
  message?: string
}

export interface MigrationCleanupItem {
  operationId: string
  projectId: string
  sourcePath: string
  targetPath: string
}

export interface MigrationPlanDto {
  items: ProjectMigrationPlanItem[]
  cleanupPending: MigrationCleanupItem[]
}

export interface ConfirmedMigrationItem {
  projectId: string
  sourcePath: string
  targetPath: string
}

export interface ExecuteMigrationsInput {
  items: ConfirmedMigrationItem[]
}

export interface MigrationItemResult {
  projectId: string
  status: 'completed' | 'failed' | 'cleanup-pending' | 'skipped'
  message: string
  targetPath?: string
  operationId?: string
}

export interface MigrationBatchDto {
  snapshot: CatalogSnapshotDto
  items: MigrationItemResult[]
}

export type CatalogErrorCode =
  | 'INVALID_INPUT'
  | 'DIRECTORY_NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'DUPLICATE_PATH'
  | 'DEFAULT_DIRECTORY_REQUIRED'
  | 'TARGET_ALREADY_EXISTS'
  | 'DIRECTORY_CREATE_FAILED'
  | 'DIRECTORY_ROLLBACK_FAILED'
  | 'MIGRATION_PLAN_CHANGED'
  | 'MIGRATION_CONFLICT'
  | 'MIGRATION_COPY_FAILED'
  | 'MIGRATION_VERIFY_FAILED'
  | 'MIGRATION_RECOVERY_REQUIRED'
  | 'MIGRATION_CLEANUP_PENDING'
  | 'STORAGE_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export interface CatalogError {
  code: CatalogErrorCode
  message: string
  field?: 'name' | 'description' | 'categoryName' | 'path'
  existingProjectId?: string
  targetPath?: string
}

export type CatalogResult =
  | { ok: true; data: CatalogSnapshotDto }
  | { ok: false; error: CatalogError }

export type MigrationPlanResult =
  | { ok: true; data: MigrationPlanDto }
  | { ok: false; error: CatalogError }

export type MigrationBatchResult =
  | { ok: true; data: MigrationBatchDto }
  | { ok: false; error: CatalogError }

export interface ProjectManagerApi {
  selectProjectDirectory(): Promise<string | null>
  selectDefaultProjectDirectory(): Promise<string | null>
  selectIdeExecutable(): Promise<string | null>
  getCatalog(): Promise<CatalogResult>
  createCategory(input: CreateCategoryInput): Promise<CatalogResult>
  previewImportMigration(path: string): Promise<MigrationPlanResult>
  getMigrationPlan(): Promise<MigrationPlanResult>
  executeMigrations(input: ExecuteMigrationsInput): Promise<MigrationBatchResult>
  retryMigrationCleanup(operationId: string): Promise<MigrationPlanResult>
  importExistingProject(input: ImportExistingProjectInput): Promise<CatalogResult>
  createEmptyProject(input: CreateEmptyProjectInput): Promise<CatalogResult>
  updateSettings(input: AppSettingsDto): Promise<CatalogResult>
}
