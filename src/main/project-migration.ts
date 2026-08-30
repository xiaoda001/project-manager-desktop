import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  MigrationCleanupItem,
  ProjectDto,
  ProjectMigrationPlanItem
} from '../shared/contracts'
import { CatalogOperationError } from './errors'

type MigrationMode = 'rename' | 'copy'
type MigrationPhase = 'prepared' | 'destination-ready' | 'catalog-committed' | 'cleanup-pending'

interface MigrationJournalEntry {
  operationId: string
  projectId: string
  sourcePath: string
  stagingPath: string | null
  targetPath: string
  mode: MigrationMode
  phase: MigrationPhase
  startedAt: string
}

interface ManifestEntry {
  path: string
  type: 'directory' | 'file' | 'symlink'
  size?: number
  hash?: string
  target?: string
}

export interface PreparedMigration {
  operationId: string
  projectId: string
  targetPath: string
}

export interface ProjectMigrationManager {
  planMigration(project: Pick<ProjectDto, 'id' | 'name' | 'path'>, defaultDirectory: string): Promise<ProjectMigrationPlanItem>
  prepareMigration(item: ProjectMigrationPlanItem): Promise<PreparedMigration>
  commitMigration(operationId: string): Promise<'completed' | 'cleanup-pending'>
  rollbackMigration(operationId: string): Promise<void>
  recoverPendingMigrations(catalogPaths: Map<string, string>): Promise<MigrationCleanupItem[]>
  getCleanupPending(): Promise<MigrationCleanupItem[]>
  retryCleanup(operationId: string): Promise<void>
}

interface ProjectMigrationServiceOptions {
  trashItem(path: string): Promise<void>
  createId?: () => string
  now?: () => Date
  renamePath?: typeof rename
}

const errorCode = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

const isWithin = (parent: string, child: string): boolean => {
  const childRelative = relative(parent, child)
  return childRelative === '' || (!childRelative.startsWith('..') && !isAbsolute(childRelative))
}

const isJournalEntry = (value: unknown): value is MigrationJournalEntry => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<MigrationJournalEntry>
  if (
    typeof entry.operationId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,200}$/u.test(entry.operationId) ||
    typeof entry.projectId !== 'string' ||
    typeof entry.sourcePath !== 'string' ||
    typeof entry.targetPath !== 'string' ||
    !isAbsolute(entry.sourcePath) ||
    !isAbsolute(entry.targetPath) ||
    basename(entry.sourcePath) !== basename(entry.targetPath) ||
    (entry.mode !== 'rename' && entry.mode !== 'copy') ||
    !['prepared', 'destination-ready', 'catalog-committed', 'cleanup-pending'].includes(entry.phase ?? '') ||
    typeof entry.startedAt !== 'string'
  ) return false
  if (entry.mode === 'rename') return entry.stagingPath === null
  return (
    typeof entry.stagingPath === 'string' &&
    isAbsolute(entry.stagingPath) &&
    dirname(entry.stagingPath) === dirname(entry.targetPath) &&
    basename(entry.stagingPath) === `.project-manager-migration-${entry.operationId}.tmp`
  )
}

const hashFile = (path: string): Promise<string> => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  stream.on('error', reject)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('end', () => resolveHash(hash.digest('hex')))
})

const buildManifest = async (root: string): Promise<ManifestEntry[]> => {
  const result: ManifestEntry[] = []
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink()) {
        result.push({ path: relativePath, type: 'symlink', target: await readlink(absolutePath) })
      } else if (info.isDirectory()) {
        result.push({ path: relativePath, type: 'directory' })
        await visit(absolutePath, relativePath)
      } else if (info.isFile()) {
        result.push({
          path: relativePath,
          type: 'file',
          size: info.size,
          hash: await hashFile(absolutePath)
        })
      } else {
        throw new CatalogOperationError(
          'MIGRATION_VERIFY_FAILED',
          `项目包含不支持的文件节点：${relativePath}`,
          'path'
        )
      }
    }
  }
  await visit(root, '')
  return result
}

export class ProjectMigrationService implements ProjectMigrationManager {
  private readonly journalPath: string
  private readonly temporaryJournalPath: string
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly renamePath: typeof rename

  constructor(
    userDataDirectory: string,
    private readonly options: ProjectMigrationServiceOptions
  ) {
    this.journalPath = join(userDataDirectory, 'project-migrations.json')
    this.temporaryJournalPath = join(userDataDirectory, 'project-migrations.json.tmp')
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.renamePath = options.renamePath ?? rename
  }

  async planMigration(
    project: Pick<ProjectDto, 'id' | 'name' | 'path'>,
    defaultDirectory: string
  ): Promise<ProjectMigrationPlanItem> {
    const sourcePath = resolve(project.path)
    const normalizedDefault = resolve(defaultDirectory)
    const targetPath = join(normalizedDefault, basename(sourcePath))

    if (sourcePath === normalizedDefault || isWithin(sourcePath, normalizedDefault)) {
      return {
        projectId: project.id,
        projectName: project.name,
        sourcePath,
        targetPath,
        status: 'invalid',
        message: '项目目录不能是默认存储位置或其祖先目录。'
      }
    }
    if (isWithin(normalizedDefault, sourcePath)) {
      return {
        projectId: project.id,
        projectName: project.name,
        sourcePath,
        targetPath: sourcePath,
        status: 'already-managed'
      }
    }
    if (await pathExists(targetPath)) {
      return {
        projectId: project.id,
        projectName: project.name,
        sourcePath,
        targetPath,
        status: 'conflict',
        message: '目标路径已存在，不会覆盖或合并。'
      }
    }
    return {
      projectId: project.id,
      projectName: project.name,
      sourcePath,
      targetPath,
      status: 'ready'
    }
  }

  async prepareMigration(item: ProjectMigrationPlanItem): Promise<PreparedMigration> {
    if (item.status !== 'ready') {
      throw new CatalogOperationError('MIGRATION_CONFLICT', item.message ?? '项目当前不可迁移。', 'path')
    }
    if (await pathExists(item.targetPath)) {
      throw new CatalogOperationError('MIGRATION_CONFLICT', '目标路径已存在，不会覆盖。', 'path')
    }

    const operationId = this.createId()
    const stagingPath = join(dirname(item.targetPath), `.project-manager-migration-${operationId}.tmp`)
    const entry: MigrationJournalEntry = {
      operationId,
      projectId: item.projectId,
      sourcePath: item.sourcePath,
      stagingPath: null,
      targetPath: item.targetPath,
      mode: 'rename',
      phase: 'prepared',
      startedAt: this.now().toISOString()
    }
    await this.addEntry(entry)

    try {
      await this.renamePath(item.sourcePath, item.targetPath)
      await this.updateEntry(operationId, { phase: 'destination-ready' })
    } catch (error) {
      if (errorCode(error) !== 'EXDEV') {
        await this.removeEntry(operationId)
        throw new CatalogOperationError(
          'MIGRATION_COPY_FAILED',
          `无法移动项目目录：${item.sourcePath}`,
          'path'
        )
      }

      await this.updateEntry(operationId, { mode: 'copy', stagingPath })
      try {
        await cp(item.sourcePath, stagingPath, {
          recursive: true,
          dereference: false,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true
        })
        const [sourceManifest, stagingManifest] = await Promise.all([
          buildManifest(item.sourcePath),
          buildManifest(stagingPath)
        ])
        if (JSON.stringify(sourceManifest) !== JSON.stringify(stagingManifest)) {
          throw new CatalogOperationError(
            'MIGRATION_VERIFY_FAILED',
            '复制后的项目内容校验不一致，原目录已保留。',
            'path'
          )
        }
        await this.renamePath(stagingPath, item.targetPath)
        await this.updateEntry(operationId, { phase: 'destination-ready' })
      } catch (copyError) {
        try {
          if (await pathExists(stagingPath)) await this.options.trashItem(stagingPath)
          await this.removeEntry(operationId)
        } catch {
          throw new CatalogOperationError(
            'MIGRATION_RECOVERY_REQUIRED',
            `复制失败且暂存目录无法安全清理，请检查：${stagingPath}`,
            'path'
          )
        }
        if (copyError instanceof CatalogOperationError) throw copyError
        throw new CatalogOperationError(
          'MIGRATION_COPY_FAILED',
          '跨磁盘复制失败，原目录已保留。',
          'path'
        )
      }
    }

    return { operationId, projectId: item.projectId, targetPath: item.targetPath }
  }

  async commitMigration(operationId: string): Promise<'completed' | 'cleanup-pending'> {
    const entry = await this.requireEntry(operationId)
    await this.updateEntry(operationId, { phase: 'catalog-committed' })
    if (entry.mode === 'rename') {
      await this.removeEntry(operationId)
      return 'completed'
    }
    try {
      if (await pathExists(entry.sourcePath)) await this.options.trashItem(entry.sourcePath)
      await this.removeEntry(operationId)
      return 'completed'
    } catch {
      await this.updateEntry(operationId, { phase: 'cleanup-pending' })
      return 'cleanup-pending'
    }
  }

  async rollbackMigration(operationId: string): Promise<void> {
    const entry = await this.requireEntry(operationId)
    try {
      if (entry.mode === 'rename') {
        const sourceExists = await pathExists(entry.sourcePath)
        const targetExists = await pathExists(entry.targetPath)
        if (!sourceExists && targetExists) await this.renamePath(entry.targetPath, entry.sourcePath)
        else if (!sourceExists || targetExists) throw new Error('ambiguous rename state')
      } else {
        if (!(await pathExists(entry.sourcePath))) throw new Error('source missing')
        if (entry.stagingPath && await pathExists(entry.stagingPath)) {
          await this.options.trashItem(entry.stagingPath)
        }
        if (await pathExists(entry.targetPath)) {
          await this.options.trashItem(entry.targetPath)
        }
      }
      await this.removeEntry(operationId)
    } catch {
      throw new CatalogOperationError(
        'MIGRATION_RECOVERY_REQUIRED',
        `迁移状态无法自动恢复，请检查源和目标：${entry.sourcePath} → ${entry.targetPath}`,
        'path'
      )
    }
  }

  async recoverPendingMigrations(catalogPaths: Map<string, string>): Promise<MigrationCleanupItem[]> {
    const entries = await this.readEntries()
    for (const entry of entries) {
      const catalogPath = catalogPaths.get(entry.projectId)
      if (catalogPath && resolve(catalogPath) === resolve(entry.targetPath)) {
        await this.commitMigration(entry.operationId)
      } else {
        await this.rollbackMigration(entry.operationId)
      }
    }
    return this.getCleanupPending()
  }

  async getCleanupPending(): Promise<MigrationCleanupItem[]> {
    return (await this.readEntries())
      .filter((entry) => entry.phase === 'cleanup-pending')
      .map(({ operationId, projectId, sourcePath, targetPath }) => ({
        operationId,
        projectId,
        sourcePath,
        targetPath
      }))
  }

  async retryCleanup(operationId: string): Promise<void> {
    const entry = await this.requireEntry(operationId)
    if (entry.phase !== 'cleanup-pending' || entry.mode !== 'copy') {
      throw new CatalogOperationError('MIGRATION_PLAN_CHANGED', '该迁移不处于待清理状态。')
    }
    try {
      if (await pathExists(entry.sourcePath)) await this.options.trashItem(entry.sourcePath)
      await this.removeEntry(operationId)
    } catch {
      throw new CatalogOperationError(
        'MIGRATION_CLEANUP_PENDING',
        `原目录仍未移入回收站：${entry.sourcePath}`,
        'path'
      )
    }
  }

  private async readEntries(): Promise<MigrationJournalEntry[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.journalPath, 'utf8'))
      if (!Array.isArray(value) || !value.every(isJournalEntry)) throw new Error('invalid journal')
      return value
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw new CatalogOperationError(
        'MIGRATION_RECOVERY_REQUIRED',
        '迁移恢复日志无法读取，请先处理日志文件。'
      )
    }
  }

  private async writeEntries(entries: MigrationJournalEntry[]): Promise<void> {
    await mkdir(dirname(this.journalPath), { recursive: true })
    await writeFile(this.temporaryJournalPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
    await rename(this.temporaryJournalPath, this.journalPath)
  }

  private async addEntry(entry: MigrationJournalEntry): Promise<void> {
    const entries = await this.readEntries()
    entries.push(entry)
    await this.writeEntries(entries)
  }

  private async updateEntry(
    operationId: string,
    changes: Partial<MigrationJournalEntry>
  ): Promise<void> {
    const entries = await this.readEntries()
    const index = entries.findIndex((entry) => entry.operationId === operationId)
    if (index < 0) throw new CatalogOperationError('MIGRATION_RECOVERY_REQUIRED', '迁移日志项不存在。')
    entries[index] = { ...entries[index]!, ...changes }
    await this.writeEntries(entries)
  }

  private async removeEntry(operationId: string): Promise<void> {
    const entries = await this.readEntries()
    await this.writeEntries(entries.filter((entry) => entry.operationId !== operationId))
  }

  private async requireEntry(operationId: string): Promise<MigrationJournalEntry> {
    const entry = (await this.readEntries()).find((candidate) => candidate.operationId === operationId)
    if (!entry) throw new CatalogOperationError('MIGRATION_PLAN_CHANGED', '迁移操作不存在或已完成。')
    return entry
  }
}
