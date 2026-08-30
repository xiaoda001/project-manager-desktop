import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { CatalogDataV1 } from './catalog-types'
import { LocalJsonStore } from './local-json-store'

const directories: string[] = []

const fixture = (name: string): CatalogDataV1 => ({
  schemaVersion: 1,
  settings: { defaultProjectDirectory: '', ide: { type: 'vscode', customExecutablePath: '' } },
  categories: [{ id: 'category-1', name: '前端', createdAt: '2026-08-29T10:00:00.000Z' }],
  projects: [{
    id: 'project-1',
    name,
    description: '测试项目',
    categoryId: 'category-1',
    path: `C:\\work\\${name}`,
    source: 'existing',
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    lastOpenedAt: null
  }]
})

const createDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'project-manager-store-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('LocalJsonStore', () => {
  it('returns an empty catalog on first launch and persists unicode data', async () => {
    const directory = await createDirectory()
    const store = new LocalJsonStore(directory)

    await expect(store.load()).resolves.toEqual({
      schemaVersion: 1,
      projects: [],
      categories: [],
      settings: { defaultProjectDirectory: '', ide: { type: 'vscode', customExecutablePath: '' } }
    })
    await store.save(fixture('控制台'))

    await expect(new LocalJsonStore(directory).load()).resolves.toEqual(fixture('控制台'))
    expect(await readFile(join(directory, 'project-manager.json'), 'utf8')).toContain('控制台')
  })

  it('recovers from a valid backup without overwriting corrupt primary data', async () => {
    const directory = await createDirectory()
    await writeFile(join(directory, 'project-manager.json'), '{broken', 'utf8')
    await writeFile(join(directory, 'project-manager.json.bak'), JSON.stringify(fixture('已恢复')), 'utf8')

    await expect(new LocalJsonStore(directory).load()).resolves.toEqual(fixture('已恢复'))
    await expect(readFile(join(directory, 'project-manager.json'), 'utf8')).resolves.toBe('{broken')
  })

  it('adds default settings when reading an older V1 catalog', async () => {
    const directory = await createDirectory()
    const legacy = fixture('legacy') as Partial<CatalogDataV1>
    delete legacy.settings
    await writeFile(join(directory, 'project-manager.json'), JSON.stringify(legacy), 'utf8')

    await expect(new LocalJsonStore(directory).load()).resolves.toMatchObject({
      settings: { defaultProjectDirectory: '', ide: { type: 'vscode', customExecutablePath: '' } }
    })
  })

  it('persists projects created by the application without a schema migration', async () => {
    const directory = await createDirectory()
    const created = fixture('new-project')
    created.projects[0]!.source = 'created'

    await new LocalJsonStore(directory).save(created)

    await expect(new LocalJsonStore(directory).load()).resolves.toEqual(created)
  })

  it('rejects dual corruption and preserves both files', async () => {
    const directory = await createDirectory()
    await writeFile(join(directory, 'project-manager.json'), '{broken-primary', 'utf8')
    await writeFile(join(directory, 'project-manager.json.bak'), '{broken-backup', 'utf8')

    await expect(new LocalJsonStore(directory).load()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    await expect(readFile(join(directory, 'project-manager.json'), 'utf8')).resolves.toBe('{broken-primary')
    await expect(readFile(join(directory, 'project-manager.json.bak'), 'utf8')).resolves.toBe('{broken-backup')
  })

  it('serializes concurrent saves in call order', async () => {
    const directory = await createDirectory()
    const store = new LocalJsonStore(directory)

    await Promise.all([store.save(fixture('first')), store.save(fixture('second'))])

    await expect(store.load()).resolves.toEqual(fixture('second'))
  })
})
