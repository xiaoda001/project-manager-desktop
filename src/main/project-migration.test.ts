import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectDto } from '../shared/contracts'
import { ProjectMigrationService } from './project-migration'

const directories: string[] = []

const createRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-manager-migration-'))
  directories.push(root)
  return root
}

const project = (path: string): ProjectDto => ({
  id: 'project-1',
  name: 'Dashboard',
  description: '',
  categoryId: 'category-1',
  path,
  source: 'existing',
  createdAt: '2026-08-30T10:00:00.000Z',
  updatedAt: '2026-08-30T10:00:00.000Z',
  lastOpenedAt: null
})

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ProjectMigrationService', () => {
  it('plans external projects, skips managed projects and reports conflicts', async () => {
    const root = await createRoot()
    const source = join(root, 'outside', 'dashboard')
    const destination = join(root, 'managed')
    const userData = join(root, 'data')
    await mkdir(source, { recursive: true })
    await mkdir(destination)
    const service = new ProjectMigrationService(userData, { trashItem: vi.fn(async () => undefined) })

    await expect(service.planMigration(project(source), destination)).resolves.toMatchObject({
      status: 'ready',
      targetPath: join(destination, 'dashboard')
    })
    await expect(service.planMigration(project(join(destination, 'inside')), destination)).resolves.toMatchObject({
      status: 'already-managed'
    })

    await mkdir(join(destination, 'dashboard'))
    await expect(service.planMigration(project(source), destination)).resolves.toMatchObject({
      status: 'conflict'
    })
  })

  it('renames a same-volume project and can roll it back before catalog commit', async () => {
    const root = await createRoot()
    const source = join(root, 'outside', 'dashboard')
    const destination = join(root, 'managed')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'index.txt'), 'content', 'utf8')
    await mkdir(destination)
    const service = new ProjectMigrationService(join(root, 'data'), {
      trashItem: vi.fn(async () => undefined),
      createId: () => 'operation-1'
    })
    const plan = await service.planMigration(project(source), destination)

    const prepared = await service.prepareMigration(plan)
    await expect(readFile(join(prepared.targetPath, 'index.txt'), 'utf8')).resolves.toBe('content')
    await service.rollbackMigration(prepared.operationId)

    await expect(readFile(join(source, 'index.txt'), 'utf8')).resolves.toBe('content')
    await expect(stat(prepared.targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('falls back to verified copy only on EXDEV and trashes the source after commit', async () => {
    const root = await createRoot()
    const source = join(root, 'outside', 'dashboard')
    const destination = join(root, 'managed')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'index.txt'), 'cross-volume content', 'utf8')
    await mkdir(destination)
    let renameCalls = 0
    const renamePath: typeof rename = async (from, to) => {
      renameCalls += 1
      if (renameCalls === 1) throw Object.assign(new Error('cross device'), { code: 'EXDEV' })
      return rename(from, to)
    }
    const trashItem = vi.fn(async (path: string) => rm(path, { recursive: true }))
    const service = new ProjectMigrationService(join(root, 'data'), {
      trashItem,
      renamePath,
      createId: () => 'operation-2'
    })
    const plan = await service.planMigration(project(source), destination)

    const prepared = await service.prepareMigration(plan)
    expect(await readFile(join(prepared.targetPath, 'index.txt'), 'utf8')).toBe('cross-volume content')
    await expect(service.commitMigration(prepared.operationId)).resolves.toBe('completed')

    expect(trashItem).toHaveBeenCalledWith(source)
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a cleanup journal when the source cannot be moved to trash and supports retry', async () => {
    const root = await createRoot()
    const source = join(root, 'outside', 'dashboard')
    const destination = join(root, 'managed')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'index.txt'), 'content', 'utf8')
    await mkdir(destination)
    let renameCalls = 0
    const renamePath: typeof rename = async (from, to) => {
      renameCalls += 1
      if (renameCalls === 1) throw Object.assign(new Error('cross device'), { code: 'EXDEV' })
      return rename(from, to)
    }
    let trashFails = true
    const service = new ProjectMigrationService(join(root, 'data'), {
      trashItem: async (path) => {
        if (trashFails) throw new Error('trash unavailable')
        await rm(path, { recursive: true })
      },
      renamePath,
      createId: () => 'operation-3'
    })
    const prepared = await service.prepareMigration(
      await service.planMigration(project(source), destination)
    )

    await expect(service.commitMigration(prepared.operationId)).resolves.toBe('cleanup-pending')
    await expect(service.getCleanupPending()).resolves.toHaveLength(1)
    trashFails = false
    await service.retryCleanup(prepared.operationId)
    await expect(service.getCleanupPending()).resolves.toEqual([])
  })

  it('recovers a destination-ready rename according to the catalog path', async () => {
    const root = await createRoot()
    const source = join(root, 'outside', 'dashboard')
    const destination = join(root, 'managed')
    await mkdir(source, { recursive: true })
    await mkdir(destination)
    const service = new ProjectMigrationService(join(root, 'data'), {
      trashItem: vi.fn(async () => undefined),
      createId: () => 'operation-4'
    })
    const prepared = await service.prepareMigration(
      await service.planMigration(project(source), destination)
    )

    await service.recoverPendingMigrations(new Map([['project-1', source]]))

    await expect(stat(source)).resolves.toMatchObject({})
    await expect(stat(prepared.targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
