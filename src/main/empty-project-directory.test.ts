import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEmptyDirectory,
  rollbackEmptyDirectory,
  validateProjectDirectoryName
} from './empty-project-directory'

const directories: string[] = []

const createBaseDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'project-manager-create-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('empty project directory', () => {
  it('creates a new empty directory below the configured base', async () => {
    const base = await createBaseDirectory()
    const target = await createEmptyDirectory(base, 'dashboard')

    expect(target).toBe(join(base, 'dashboard'))
    expect((await stat(target)).isDirectory()).toBe(true)
  })

  it.each(['../escape', 'bad/name', 'bad\\name', 'CON', 'nul.txt', 'trailing.']) (
    'rejects unsafe cross-platform directory name %s',
    (name) => expect(() => validateProjectDirectoryName(name)).toThrow('安全的跨平台目录名')
  )

  it('does not overwrite an existing target', async () => {
    const base = await createBaseDirectory()
    await createEmptyDirectory(base, 'dashboard')

    await expect(createEmptyDirectory(base, 'dashboard')).rejects.toMatchObject({
      code: 'TARGET_ALREADY_EXISTS'
    })
  })

  it('rolls back an empty directory but preserves a non-empty directory', async () => {
    const base = await createBaseDirectory()
    const emptyTarget = await createEmptyDirectory(base, 'empty')
    await rollbackEmptyDirectory(emptyTarget)
    await expect(stat(emptyTarget)).rejects.toMatchObject({ code: 'ENOENT' })

    const nonEmptyTarget = await createEmptyDirectory(base, 'non-empty')
    await writeFile(join(nonEmptyTarget, 'keep.txt'), 'user content', 'utf8')
    await expect(rollbackEmptyDirectory(nonEmptyTarget)).rejects.toMatchObject({
      code: 'DIRECTORY_ROLLBACK_FAILED'
    })
    await expect(readFile(join(nonEmptyTarget, 'keep.txt'), 'utf8')).resolves.toBe('user content')
  })
})
