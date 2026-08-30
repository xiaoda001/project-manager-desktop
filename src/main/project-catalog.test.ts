import { describe, expect, it, vi } from 'vitest'
import { emptyCatalog, type CatalogDataV1 } from './catalog-types'
import type { EmptyProjectDirectoryManager } from './empty-project-directory'
import type { ProjectMigrationManager } from './project-migration'
import type { CatalogStore, DirectoryInspector } from './project-catalog'
import { ProjectCatalog } from './project-catalog'

const createHarness = (
  initial: CatalogDataV1 = emptyCatalog(),
  migrationManager?: ProjectMigrationManager
) => {
  let data = structuredClone(initial)
  const store: CatalogStore = {
    load: vi.fn(async () => structuredClone(data)),
    save: vi.fn(async (snapshot) => { data = structuredClone(snapshot) })
  }
  const directoryInspector: DirectoryInspector = {
    canonicalize: vi.fn(async (path) => path.replace('alias', 'real')),
    isDirectory: vi.fn(async () => true)
  }
  const ids = ['category-id', 'project-id', 'next-id']
  const emptyProjectDirectoryManager: EmptyProjectDirectoryManager = {
    createEmptyDirectory: vi.fn(async (basePath, name) => `${basePath}\\${name}`),
    rollbackEmptyDirectory: vi.fn(async () => undefined)
  }
  const catalog = new ProjectCatalog(store, {
    directoryInspector,
    createId: () => ids.shift()!,
    now: () => new Date('2026-08-29T10:00:00.000Z'),
    platform: 'win32',
    emptyProjectDirectoryManager,
    migrationManager
  })
  return { catalog, store, directoryInspector, emptyProjectDirectoryManager }
}

const migrationManager = (targetPath: string): ProjectMigrationManager => ({
  planMigration: vi.fn(async (project) => ({
    projectId: project.id,
    projectName: project.name,
    sourcePath: project.path,
    targetPath,
    status: 'ready' as const
  })),
  prepareMigration: vi.fn(async (item) => ({
    operationId: 'operation-1',
    projectId: item.projectId,
    targetPath: item.targetPath
  })),
  commitMigration: vi.fn(async () => 'completed' as const),
  rollbackMigration: vi.fn(async () => undefined),
  recoverPendingMigrations: vi.fn(async () => []),
  getCleanupPending: vi.fn(async () => []),
  retryCleanup: vi.fn(async () => undefined)
})

const input = {
  name: ' Dashboard ',
  description: ' Internal tools ',
  categoryName: ' Frontend ',
  path: 'C:\\work\\alias-dashboard',
  expectedTargetPath: 'C:\\work\\real-dashboard',
  migrationConfirmed: true
}

const catalogWithDefault = () => {
  const data = emptyCatalog()
  data.settings.defaultProjectDirectory = 'C:\\work'
  return data
}

describe('ProjectCatalog', () => {
  it('creates a standalone category and persists it', async () => {
    const { catalog, store } = createHarness()

    const result = await catalog.createCategory({ name: ' 桌面工具 ' })

    expect(result.categories).toEqual([
      { id: 'category-id', name: '桌面工具', createdAt: '2026-08-29T10:00:00.000Z' }
    ])
    expect(store.save).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate a standalone category with different casing', async () => {
    const initial = emptyCatalog()
    initial.categories.push({ id: 'existing', name: 'Desktop', createdAt: '2026-01-01T00:00:00.000Z' })
    const { catalog, store } = createHarness(initial)

    const result = await catalog.createCategory({ name: 'desktop' })

    expect(result.categories).toHaveLength(1)
    expect(store.save).not.toHaveBeenCalled()
  })

  it('creates a category and project in one save', async () => {
    const { catalog, store } = createHarness(catalogWithDefault())

    const result = await catalog.importExistingProject(input)

    expect(result.categories).toEqual([
      { id: 'category-id', name: 'Frontend', createdAt: '2026-08-29T10:00:00.000Z' }
    ])
    expect(result.projects[0]).toMatchObject({
      id: 'project-id',
      name: 'Dashboard',
      description: 'Internal tools',
      categoryId: 'category-id',
      path: 'C:\\work\\real-dashboard'
    })
    expect(store.save).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing category case-insensitively', async () => {
    const initial = catalogWithDefault()
    initial.categories.push({ id: 'existing', name: 'Frontend', createdAt: '2026-01-01T00:00:00.000Z' })
    const { catalog } = createHarness(initial)

    const result = await catalog.importExistingProject({ ...input, categoryName: 'frontend' })

    expect(result.categories).toHaveLength(1)
    expect(result.projects[0]?.categoryId).toBe('existing')
  })

  it('rejects duplicate canonical paths on Windows', async () => {
    const initial = catalogWithDefault()
    initial.categories.push({ id: 'category', name: 'Frontend', createdAt: '2026-01-01T00:00:00.000Z' })
    initial.projects.push({
      id: 'existing-project',
      name: 'Existing',
      description: '',
      categoryId: 'category',
      path: 'c:\\WORK\\REAL-DASHBOARD',
      source: 'existing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: null
    })
    const { catalog, store } = createHarness(initial)

    await expect(catalog.importExistingProject(input)).rejects.toMatchObject({
      code: 'DUPLICATE_PATH',
      existingProjectId: 'existing-project'
    })
    expect(store.save).not.toHaveBeenCalled()
  })

  it('does not update its valid in-memory snapshot when saving fails', async () => {
    const initial = catalogWithDefault()
    const { catalog, store } = createHarness(initial)
    vi.mocked(store.save).mockRejectedValueOnce(new Error('disk full'))

    await expect(catalog.importExistingProject(input)).rejects.toThrow('disk full')
    await expect(catalog.getCatalog()).resolves.toEqual({
      projects: [],
      categories: [],
      settings: initial.settings
    })
  })

  it('normalizes and persists application settings', async () => {
    const { catalog, store, directoryInspector } = createHarness()
    vi.mocked(directoryInspector.canonicalize).mockResolvedValueOnce('C:\\workspace')

    const result = await catalog.updateSettings({
      defaultProjectDirectory: ' C:\\workspace ',
      ide: { type: 'custom', customExecutablePath: ' C:\\Tools\\IDE.exe ' }
    })

    expect(result.settings).toEqual({
      defaultProjectDirectory: 'C:\\workspace',
      ide: { type: 'custom', customExecutablePath: 'C:\\Tools\\IDE.exe' }
    })
    expect(store.save).toHaveBeenCalledTimes(1)
  })

  it('creates an empty project below the configured default directory in one save', async () => {
    const initial = emptyCatalog()
    initial.settings.defaultProjectDirectory = 'C:\\workspace'
    const { catalog, store, emptyProjectDirectoryManager } = createHarness(initial)

    const result = await catalog.createEmptyProject({
      name: ' Dashboard ',
      description: ' New project ',
      categoryName: ' Tools '
    })

    expect(emptyProjectDirectoryManager.createEmptyDirectory).toHaveBeenCalledWith(
      'C:\\workspace',
      'Dashboard'
    )
    expect(result.projects[0]).toMatchObject({
      id: 'project-id',
      name: 'Dashboard',
      description: 'New project',
      categoryId: 'category-id',
      path: 'C:\\workspace\\Dashboard',
      source: 'created'
    })
    expect(store.save).toHaveBeenCalledTimes(1)
  })

  it('requires a configured default directory before creating anything', async () => {
    const { catalog, store, emptyProjectDirectoryManager } = createHarness()

    await expect(catalog.createEmptyProject({
      name: 'Dashboard',
      description: '',
      categoryName: 'Tools'
    })).rejects.toMatchObject({ code: 'DEFAULT_DIRECTORY_REQUIRED' })
    expect(emptyProjectDirectoryManager.createEmptyDirectory).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('rolls back the new empty directory when metadata saving fails', async () => {
    const initial = emptyCatalog()
    initial.settings.defaultProjectDirectory = 'C:\\workspace'
    const { catalog, store, emptyProjectDirectoryManager } = createHarness(initial)
    vi.mocked(store.save).mockRejectedValueOnce(new Error('disk full'))

    await expect(catalog.createEmptyProject({
      name: 'Dashboard',
      description: '',
      categoryName: 'Tools'
    })).rejects.toThrow('disk full')
    expect(emptyProjectDirectoryManager.rollbackEmptyDirectory).toHaveBeenCalledWith(
      'C:\\workspace\\Dashboard'
    )
    await expect(catalog.getCatalog()).resolves.toEqual({
      projects: [],
      categories: [],
      settings: initial.settings
    })
  })

  it('surfaces a rollback warning instead of deleting a non-empty directory', async () => {
    const initial = emptyCatalog()
    initial.settings.defaultProjectDirectory = 'C:\\workspace'
    const { catalog, store, emptyProjectDirectoryManager } = createHarness(initial)
    vi.mocked(store.save).mockRejectedValueOnce(new Error('disk full'))
    vi.mocked(emptyProjectDirectoryManager.rollbackEmptyDirectory).mockRejectedValueOnce(
      Object.assign(new Error('directory preserved'), { code: 'DIRECTORY_ROLLBACK_FAILED' })
    )

    await expect(catalog.createEmptyProject({
      name: 'Dashboard',
      description: '',
      categoryName: 'Tools'
    })).rejects.toMatchObject({ code: 'DIRECTORY_ROLLBACK_FAILED' })
  })

  it('migrates a future import before saving its catalog record', async () => {
    const initial = catalogWithDefault()
    initial.settings.defaultProjectDirectory = 'C:\\managed'
    const manager = migrationManager('C:\\managed\\real-dashboard')
    const { catalog, store } = createHarness(initial, manager)

    const result = await catalog.importExistingProject({
      ...input,
      expectedTargetPath: 'C:\\managed\\real-dashboard'
    })

    expect(manager.prepareMigration).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenCalledTimes(1)
    expect(result.projects[0]?.path).toBe('C:\\managed\\real-dashboard')
    expect(manager.commitMigration).toHaveBeenCalledWith('operation-1')
  })

  it('commits each confirmed existing-project migration as a separate snapshot', async () => {
    const initial = emptyCatalog()
    initial.settings.defaultProjectDirectory = 'C:\\managed'
    initial.categories.push({ id: 'category-1', name: 'Tools', createdAt: '2026-01-01T00:00:00.000Z' })
    initial.projects.push({
      id: 'project-1',
      name: 'Dashboard',
      description: '',
      categoryId: 'category-1',
      path: 'C:\\outside\\dashboard',
      source: 'existing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: null
    })
    const manager = migrationManager('C:\\managed\\dashboard')
    const { catalog, store } = createHarness(initial, manager)

    const result = await catalog.migrateProjects({
      items: [{
        projectId: 'project-1',
        sourcePath: 'C:\\outside\\dashboard',
        targetPath: 'C:\\managed\\dashboard'
      }]
    })

    expect(result.snapshot.projects[0]?.path).toBe('C:\\managed\\dashboard')
    expect(result.items).toEqual([expect.objectContaining({ projectId: 'project-1', status: 'completed' })])
    expect(store.save).toHaveBeenCalledTimes(1)
  })

  it('rolls back a prepared migration when catalog saving fails', async () => {
    const initial = emptyCatalog()
    initial.settings.defaultProjectDirectory = 'C:\\managed'
    initial.categories.push({ id: 'category-1', name: 'Tools', createdAt: '2026-01-01T00:00:00.000Z' })
    initial.projects.push({
      id: 'project-1',
      name: 'Dashboard',
      description: '',
      categoryId: 'category-1',
      path: 'C:\\outside\\dashboard',
      source: 'existing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: null
    })
    const manager = migrationManager('C:\\managed\\dashboard')
    const { catalog, store } = createHarness(initial, manager)
    vi.mocked(store.save).mockRejectedValueOnce(new Error('disk full'))

    const result = await catalog.migrateProjects({
      items: [{
        projectId: 'project-1',
        sourcePath: 'C:\\outside\\dashboard',
        targetPath: 'C:\\managed\\dashboard'
      }]
    })

    expect(manager.rollbackMigration).toHaveBeenCalledWith('operation-1')
    expect(result.snapshot.projects[0]?.path).toBe('C:\\outside\\dashboard')
    expect(result.items[0]?.status).toBe('failed')
  })
})
