import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type {
  AppSettingsDto,
  CreateCategoryInput,
  CreateEmptyProjectInput,
  ExecuteMigrationsInput,
  ImportExistingProjectInput,
  MigrationBatchDto,
  MigrationItemResult,
  MigrationPlanDto,
  ProjectMigrationPlanItem
} from '../shared/contracts'
import { toSnapshot, type CatalogDataV1 } from './catalog-types'
import {
  systemEmptyProjectDirectoryManager,
  type EmptyProjectDirectoryManager
} from './empty-project-directory'
import { CatalogOperationError } from './errors'
import type { ProjectMigrationManager } from './project-migration'

export interface CatalogStore {
  load(): Promise<CatalogDataV1>
  save(snapshot: CatalogDataV1): Promise<void>
}

export interface DirectoryInspector {
  canonicalize(path: string): Promise<string>
  isDirectory(path: string): Promise<boolean>
}

const systemDirectoryInspector: DirectoryInspector = {
  canonicalize: (path) => realpath(path),
  async isDirectory(path) {
    return (await stat(path)).isDirectory()
  }
}

interface ProjectCatalogOptions {
  directoryInspector?: DirectoryInspector
  createId?: () => string
  now?: () => Date
  platform?: NodeJS.Platform
  emptyProjectDirectoryManager?: EmptyProjectDirectoryManager
  migrationManager?: ProjectMigrationManager
}

const disabledMigrationManager: ProjectMigrationManager = {
  async planMigration(project) {
    return {
      projectId: project.id,
      projectName: project.name,
      sourcePath: project.path,
      targetPath: project.path,
      status: 'already-managed'
    }
  },
  async prepareMigration() { throw new Error('Migration manager is not configured') },
  async commitMigration() { return 'completed' },
  async rollbackMigration() { return undefined },
  async recoverPendingMigrations() { return [] },
  async getCleanupPending() { return [] },
  async retryCleanup() { return undefined }
}

export class ProjectCatalog {
  private data: CatalogDataV1 | undefined
  private readonly directoryInspector: DirectoryInspector
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly platform: NodeJS.Platform
  private readonly emptyProjectDirectoryManager: EmptyProjectDirectoryManager
  private readonly migrationManager: ProjectMigrationManager
  private migrationsRecovered = false

  constructor(
    private readonly store: CatalogStore,
    options: ProjectCatalogOptions = {}
  ) {
    this.directoryInspector = options.directoryInspector ?? systemDirectoryInspector
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.platform = options.platform ?? process.platform
    this.emptyProjectDirectoryManager =
      options.emptyProjectDirectoryManager ?? systemEmptyProjectDirectoryManager
    this.migrationManager = options.migrationManager ?? disabledMigrationManager
  }

  async getCatalog() {
    return toSnapshot(await this.ensureLoaded())
  }

  async createCategory(input: CreateCategoryInput) {
    const name = this.validateText(input.name, 'categoryName', 30, true)
    const current = await this.ensureLoaded()
    const categoryKey = name.toLocaleLowerCase()
    const existing = current.categories.find(
      (category) => category.name.trim().toLocaleLowerCase() === categoryKey
    )
    if (existing) return toSnapshot(current)

    const next = structuredClone(current)
    next.categories.push({ id: this.createId(), name, createdAt: this.now().toISOString() })
    await this.store.save(next)
    this.data = next
    return toSnapshot(next)
  }

  async importExistingProject(input: ImportExistingProjectInput) {
    const name = this.validateText(input.name, 'name', 80, true)
    const description = this.validateText(input.description, 'description', 200, false)
    const categoryName = this.validateText(input.categoryName, 'categoryName', 30, true)
    const selectedPath = this.validatePath(input.path)

    let canonicalPath: string
    try {
      canonicalPath = await this.directoryInspector.canonicalize(selectedPath)
    } catch {
      throw new CatalogOperationError('DIRECTORY_NOT_FOUND', '所选目录已不存在，请重新选择。', 'path')
    }

    try {
      if (!(await this.directoryInspector.isDirectory(canonicalPath))) {
        throw new CatalogOperationError('NOT_A_DIRECTORY', '所选路径不是目录。', 'path')
      }
    } catch (error) {
      if (error instanceof CatalogOperationError) throw error
      throw new CatalogOperationError('DIRECTORY_NOT_FOUND', '所选目录已不存在，请重新选择。', 'path')
    }

    const current = await this.ensureLoaded()
    const duplicate = current.projects.find(
      (project) => this.pathKey(project.path) === this.pathKey(canonicalPath)
    )
    if (duplicate) {
      throw new CatalogOperationError(
        'DUPLICATE_PATH',
        `“${duplicate.name}”已经使用该目录。`,
        'path',
        duplicate.id
      )
    }

    const next = structuredClone(current)
    const categoryKey = categoryName.toLocaleLowerCase()
    let category = next.categories.find(
      (candidate) => candidate.name.trim().toLocaleLowerCase() === categoryKey
    )
    const timestamp = this.now().toISOString()

    if (!category) {
      category = { id: this.createId(), name: categoryName, createdAt: timestamp }
      next.categories.push(category)
    }

    const projectId = this.createId()
    const defaultDirectory = await this.requireDefaultDirectory(current)
    const migrationPlan = await this.migrationManager.planMigration(
      { id: projectId, name, path: canonicalPath },
      defaultDirectory
    )
    if (
      !input.migrationConfirmed ||
      this.pathKey(input.expectedTargetPath) !== this.pathKey(migrationPlan.targetPath)
    ) {
      throw new CatalogOperationError(
        'MIGRATION_PLAN_CHANGED',
        '项目迁移目标已变化，请重新确认。',
        'path'
      )
    }
    if (migrationPlan.status === 'conflict' || migrationPlan.status === 'invalid') {
      throw new CatalogOperationError(
        'MIGRATION_CONFLICT',
        migrationPlan.message ?? '项目当前无法迁移。',
        'path'
      )
    }

    const prepared = migrationPlan.status === 'ready'
      ? await this.migrationManager.prepareMigration(migrationPlan)
      : null
    const finalPath = prepared?.targetPath ?? canonicalPath

    next.projects.push({
      id: projectId,
      name,
      description,
      categoryId: category.id,
      path: finalPath,
      source: 'existing',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: null
    })

    try {
      await this.store.save(next)
    } catch (error) {
      if (prepared) await this.migrationManager.rollbackMigration(prepared.operationId)
      throw error
    }
    this.data = next
    if (prepared) await this.migrationManager.commitMigration(prepared.operationId)
    return toSnapshot(next)
  }

  async previewImportMigration(path: string): Promise<MigrationPlanDto> {
    const selectedPath = this.validatePath(path)
    let canonicalPath: string
    try {
      canonicalPath = await this.directoryInspector.canonicalize(selectedPath)
      if (!(await this.directoryInspector.isDirectory(canonicalPath))) {
        throw new CatalogOperationError('NOT_A_DIRECTORY', '所选路径不是目录。', 'path')
      }
    } catch (error) {
      if (error instanceof CatalogOperationError) throw error
      throw new CatalogOperationError('DIRECTORY_NOT_FOUND', '所选目录已不存在，请重新选择。', 'path')
    }
    const current = await this.ensureLoaded()
    const defaultDirectory = await this.requireDefaultDirectory(current)
    const item = await this.migrationManager.planMigration(
      { id: '__import-preview__', name: canonicalPath, path: canonicalPath },
      defaultDirectory
    )
    return { items: [item], cleanupPending: await this.migrationManager.getCleanupPending() }
  }

  async getMigrationPlan(): Promise<MigrationPlanDto> {
    const current = await this.ensureLoaded()
    if (!current.settings.defaultProjectDirectory) {
      return { items: [], cleanupPending: await this.migrationManager.getCleanupPending() }
    }
    const defaultDirectory = await this.requireDefaultDirectory(current)
    const items = await Promise.all(
      current.projects.map((project) => this.migrationManager.planMigration(project, defaultDirectory))
    )
    return { items, cleanupPending: await this.migrationManager.getCleanupPending() }
  }

  async migrateProjects(input: ExecuteMigrationsInput): Promise<MigrationBatchDto> {
    if (!input || !Array.isArray(input.items)) {
      throw new CatalogOperationError('INVALID_INPUT', '迁移计划格式无效。')
    }
    const current = await this.ensureLoaded()
    const defaultDirectory = await this.requireDefaultDirectory(current)
    const results: MigrationItemResult[] = []

    for (const confirmed of input.items) {
      const active = await this.ensureLoaded()
      const project = active.projects.find((candidate) => candidate.id === confirmed.projectId)
      if (!project) {
        results.push({ projectId: confirmed.projectId, status: 'failed', message: '项目记录不存在。' })
        continue
      }
      try {
        const plan = await this.migrationManager.planMigration(project, defaultDirectory)
        if (
          this.pathKey(plan.sourcePath) !== this.pathKey(confirmed.sourcePath) ||
          this.pathKey(plan.targetPath) !== this.pathKey(confirmed.targetPath)
        ) {
          throw new CatalogOperationError('MIGRATION_PLAN_CHANGED', '迁移路径已变化，请重新确认。')
        }
        if (plan.status === 'already-managed') {
          results.push({ projectId: project.id, status: 'skipped', message: '项目已在默认存储位置。' })
          continue
        }
        if (plan.status !== 'ready') {
          throw new CatalogOperationError('MIGRATION_CONFLICT', plan.message ?? '项目当前无法迁移。')
        }

        const prepared = await this.migrationManager.prepareMigration(plan)
        const next = structuredClone(active)
        const nextProject = next.projects.find((candidate) => candidate.id === project.id)!
        nextProject.path = prepared.targetPath
        nextProject.updatedAt = this.now().toISOString()
        try {
          await this.store.save(next)
        } catch (error) {
          await this.migrationManager.rollbackMigration(prepared.operationId)
          throw error
        }
        this.data = next
        const commitStatus = await this.migrationManager.commitMigration(prepared.operationId)
        results.push({
          projectId: project.id,
          status: commitStatus,
          message: commitStatus === 'completed' ? '迁移完成。' : '新路径已生效，原目录仍待移入回收站。',
          targetPath: prepared.targetPath,
          ...(commitStatus === 'cleanup-pending' ? { operationId: prepared.operationId } : {})
        })
      } catch (error) {
        results.push({
          projectId: project.id,
          status: 'failed',
          message: error instanceof Error ? error.message : '迁移失败。'
        })
      }
    }

    return { snapshot: toSnapshot(await this.ensureLoaded()), items: results }
  }

  async retryMigrationCleanup(operationId: string): Promise<MigrationPlanDto> {
    await this.migrationManager.retryCleanup(operationId)
    return this.getMigrationPlan()
  }

  async updateSettings(input: AppSettingsDto) {
    if (!input || typeof input !== 'object' || !input.ide || typeof input.ide !== 'object') {
      throw new CatalogOperationError('INVALID_INPUT', '设置格式无效。')
    }
    if (input.ide.type !== 'vscode' && input.ide.type !== 'custom') {
      throw new CatalogOperationError('INVALID_INPUT', '请选择有效的 IDE。')
    }

    let defaultProjectDirectory = input.defaultProjectDirectory.trim()
    if (defaultProjectDirectory) {
      const selectedPath = this.validatePath(defaultProjectDirectory)
      try {
        defaultProjectDirectory = await this.directoryInspector.canonicalize(selectedPath)
        if (!(await this.directoryInspector.isDirectory(defaultProjectDirectory))) {
          throw new CatalogOperationError('NOT_A_DIRECTORY', '默认项目位置必须是目录。', 'path')
        }
      } catch (error) {
        if (error instanceof CatalogOperationError) throw error
        throw new CatalogOperationError('DIRECTORY_NOT_FOUND', '默认项目位置已不存在。', 'path')
      }
    }

    const customExecutablePath = input.ide.customExecutablePath.trim()
    if (
      input.ide.type === 'custom' &&
      (!customExecutablePath ||
        customExecutablePath.length > 4096 ||
        customExecutablePath.includes('\0') ||
        !isAbsolute(customExecutablePath))
    ) {
      throw new CatalogOperationError('INVALID_INPUT', '请选择自定义 IDE 程序。', 'path')
    }

    const current = await this.ensureLoaded()
    const next = structuredClone(current)
    next.settings = {
      defaultProjectDirectory,
      ide: {
        type: input.ide.type,
        customExecutablePath
      }
    }
    await this.store.save(next)
    this.data = next
    return toSnapshot(next)
  }

  async createEmptyProject(input: CreateEmptyProjectInput) {
    const name = this.validateText(input.name, 'name', 80, true)
    const description = this.validateText(input.description, 'description', 200, false)
    const categoryName = this.validateText(input.categoryName, 'categoryName', 30, true)
    const current = await this.ensureLoaded()

    if (!current.settings.defaultProjectDirectory) {
      throw new CatalogOperationError(
        'DEFAULT_DIRECTORY_REQUIRED',
        '请先在设置中选择默认项目位置。',
        'path'
      )
    }

    let defaultDirectory: string
    try {
      defaultDirectory = await this.directoryInspector.canonicalize(
        current.settings.defaultProjectDirectory
      )
      if (!(await this.directoryInspector.isDirectory(defaultDirectory))) {
        throw new CatalogOperationError(
          'NOT_A_DIRECTORY',
          '默认项目位置必须是目录。',
          'path'
        )
      }
    } catch (error) {
      if (error instanceof CatalogOperationError) throw error
      throw new CatalogOperationError(
        'DIRECTORY_NOT_FOUND',
        '默认项目位置已不存在，请重新设置。',
        'path'
      )
    }

    const targetPath = await this.emptyProjectDirectoryManager.createEmptyDirectory(
      defaultDirectory,
      name
    )
    const duplicate = current.projects.find(
      (project) => this.pathKey(project.path) === this.pathKey(targetPath)
    )
    if (duplicate) {
      await this.emptyProjectDirectoryManager.rollbackEmptyDirectory(targetPath)
      throw new CatalogOperationError(
        'DUPLICATE_PATH',
        `“${duplicate.name}”已经使用该目录。`,
        'path',
        duplicate.id,
        targetPath
      )
    }

    const next = structuredClone(current)
    const categoryKey = categoryName.toLocaleLowerCase()
    let category = next.categories.find(
      (candidate) => candidate.name.trim().toLocaleLowerCase() === categoryKey
    )
    const timestamp = this.now().toISOString()

    if (!category) {
      category = { id: this.createId(), name: categoryName, createdAt: timestamp }
      next.categories.push(category)
    }

    next.projects.push({
      id: this.createId(),
      name,
      description,
      categoryId: category.id,
      path: targetPath,
      source: 'created',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: null
    })

    try {
      await this.store.save(next)
    } catch (error) {
      await this.emptyProjectDirectoryManager.rollbackEmptyDirectory(targetPath)
      throw error
    }
    this.data = next
    return toSnapshot(next)
  }

  private async ensureLoaded(): Promise<CatalogDataV1> {
    if (!this.data) this.data = await this.store.load()
    if (!this.migrationsRecovered) {
      await this.migrationManager.recoverPendingMigrations(
        new Map(this.data.projects.map((project) => [project.id, project.path]))
      )
      this.migrationsRecovered = true
    }
    return this.data
  }

  private async requireDefaultDirectory(current: CatalogDataV1): Promise<string> {
    if (!current.settings.defaultProjectDirectory) {
      throw new CatalogOperationError(
        'DEFAULT_DIRECTORY_REQUIRED',
        '请先在设置中选择默认项目位置。',
        'path'
      )
    }
    try {
      const directory = await this.directoryInspector.canonicalize(current.settings.defaultProjectDirectory)
      if (!(await this.directoryInspector.isDirectory(directory))) {
        throw new CatalogOperationError('NOT_A_DIRECTORY', '默认项目位置必须是目录。', 'path')
      }
      return directory
    } catch (error) {
      if (error instanceof CatalogOperationError) throw error
      throw new CatalogOperationError('DIRECTORY_NOT_FOUND', '默认项目位置已不存在，请重新设置。', 'path')
    }
  }

  private validateText(
    value: unknown,
    field: 'name' | 'description' | 'categoryName',
    maxLength: number,
    required: boolean
  ): string {
    if (typeof value !== 'string') {
      throw new CatalogOperationError('INVALID_INPUT', '输入格式无效。', field)
    }
    const normalized = value.trim()
    if ((required && normalized.length === 0) || normalized.length > maxLength) {
      throw new CatalogOperationError('INVALID_INPUT', '请输入有效内容。', field)
    }
    return normalized
  }

  private validatePath(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 4096 ||
      value.includes('\0') ||
      !isAbsolute(value)
    ) {
      throw new CatalogOperationError('INVALID_INPUT', '请选择有效的绝对目录路径。', 'path')
    }
    return value
  }

  private pathKey(path: string): string {
    return this.platform === 'win32' ? path.toLocaleLowerCase() : path
  }
}
