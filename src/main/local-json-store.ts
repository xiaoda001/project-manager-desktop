import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defaultSettings, emptyCatalog, type CatalogDataV1 } from './catalog-types'
import { CatalogOperationError } from './errors'

const isString = (value: unknown): value is string => typeof value === 'string'

export const validateStoredData = (value: unknown): value is CatalogDataV1 => {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<CatalogDataV1>
  if (data.schemaVersion !== 1 || !Array.isArray(data.projects) || !Array.isArray(data.categories)) {
    return false
  }

  const validCategories = data.categories.every(
    (category) =>
      category &&
      typeof category === 'object' &&
      isString(category.id) &&
      isString(category.name) &&
      isString(category.createdAt)
  )

  const validProjects = data.projects.every(
    (project) =>
      project &&
      typeof project === 'object' &&
      isString(project.id) &&
      isString(project.name) &&
      isString(project.description) &&
      isString(project.categoryId) &&
      isString(project.path) &&
      (project.source === 'existing' || project.source === 'created') &&
      isString(project.createdAt) &&
      isString(project.updatedAt) &&
      project.lastOpenedAt === null
  )

  const validSettings =
    data.settings === undefined ||
    (data.settings !== null &&
      typeof data.settings === 'object' &&
      isString(data.settings.defaultProjectDirectory) &&
      data.settings.ide !== null &&
      typeof data.settings.ide === 'object' &&
      (data.settings.ide.type === 'vscode' || data.settings.ide.type === 'custom') &&
      isString(data.settings.ide.customExecutablePath))

  return validCategories && validProjects && validSettings
}

const parseCatalog = (raw: string): CatalogDataV1 => {
  const parsed: unknown = JSON.parse(raw)
  if (!validateStoredData(parsed)) throw new Error('Unsupported or invalid catalog schema')
  return {
    ...parsed,
    settings: parsed.settings ?? defaultSettings()
  }
}

export class LocalJsonStore {
  private readonly dataPath: string
  private readonly backupPath: string
  private readonly temporaryPath: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(userDataDirectory: string) {
    this.dataPath = join(userDataDirectory, 'project-manager.json')
    this.backupPath = join(userDataDirectory, 'project-manager.json.bak')
    this.temporaryPath = join(userDataDirectory, 'project-manager.json.tmp')
  }

  async load(): Promise<CatalogDataV1> {
    try {
      return await this.readCatalog(this.dataPath)
    } catch (primaryError) {
      try {
        return await this.readCatalog(this.backupPath)
      } catch (backupError) {
        if (this.isMissing(primaryError) && this.isMissing(backupError)) return emptyCatalog()
        throw new CatalogOperationError(
          'STORAGE_UNAVAILABLE',
          '项目数据无法读取，原文件已保留。'
        )
      }
    }
  }

  save(snapshot: CatalogDataV1): Promise<void> {
    const stableSnapshot = structuredClone(snapshot)
    const operation = this.writeQueue.then(() => this.writeSnapshot(stableSnapshot))
    this.writeQueue = operation.catch(() => undefined)
    return operation
  }

  private async readCatalog(path: string): Promise<CatalogDataV1> {
    return parseCatalog(await readFile(path, 'utf8'))
  }

  private async writeSnapshot(snapshot: CatalogDataV1): Promise<void> {
    if (!validateStoredData(snapshot)) {
      throw new CatalogOperationError('STORAGE_UNAVAILABLE', '拒绝保存无效的项目数据。')
    }

    try {
      await mkdir(dirname(this.dataPath), { recursive: true })
      await writeFile(this.temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

      try {
        await copyFile(this.dataPath, this.backupPath)
      } catch (error) {
        if (!this.isMissing(error)) throw error
      }

      try {
        await rename(this.temporaryPath, this.dataPath)
      } catch (error) {
        if (!this.isReplaceConflict(error)) throw error
        await rm(this.dataPath, { force: true })
        await rename(this.temporaryPath, this.dataPath)
      }
    } catch (error) {
      await rm(this.temporaryPath, { force: true }).catch(() => undefined)
      if (error instanceof CatalogOperationError) throw error
      throw new CatalogOperationError('STORAGE_UNAVAILABLE', '项目数据无法保存，请稍后重试。')
    }
  }

  private isMissing(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
  }

  private isReplaceConflict(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'EEXIST' || error.code === 'EPERM')
    )
  }
}
