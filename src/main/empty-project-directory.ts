import { mkdir, rmdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { CatalogOperationError } from './errors'

const invalidDirectoryCharacters = /[<>:"/\\|?*\u0000-\u001f]/u
const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu

const errorCode = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined

export const validateProjectDirectoryName = (value: string): string => {
  const name = value.trim()
  if (
    name.length === 0 ||
    name.length > 80 ||
    name === '.' ||
    name === '..' ||
    name.endsWith('.') ||
    name.endsWith(' ') ||
    invalidDirectoryCharacters.test(name) ||
    windowsReservedName.test(name)
  ) {
    throw new CatalogOperationError(
      'INVALID_INPUT',
      '项目名称不能用作安全的跨平台目录名。',
      'name'
    )
  }
  return name
}

export const createEmptyDirectory = async (basePath: string, directoryName: string): Promise<string> => {
  const name = validateProjectDirectoryName(directoryName)
  const normalizedBase = resolve(basePath)
  const targetPath = join(normalizedBase, name)

  if (resolve(dirname(targetPath)) !== normalizedBase) {
    throw new CatalogOperationError('INVALID_INPUT', '项目目录超出默认存储位置。', 'name')
  }

  try {
    await mkdir(targetPath)
    return targetPath
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw new CatalogOperationError(
        'TARGET_ALREADY_EXISTS',
        `目标目录已存在，请更换项目名称：${targetPath}`,
        'name',
        undefined,
        targetPath
      )
    }
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') {
      throw new CatalogOperationError(
        'DIRECTORY_NOT_FOUND',
        '默认项目位置已不存在，请重新设置。',
        'path'
      )
    }
    throw new CatalogOperationError(
      'DIRECTORY_CREATE_FAILED',
      `无法创建项目目录：${targetPath}`,
      'path',
      undefined,
      targetPath
    )
  }
}

export const rollbackEmptyDirectory = async (targetPath: string): Promise<void> => {
  try {
    await rmdir(targetPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw new CatalogOperationError(
      'DIRECTORY_ROLLBACK_FAILED',
      `项目数据保存失败，目录未被删除，请检查：${targetPath}`,
      'path',
      undefined,
      targetPath
    )
  }
}

export interface EmptyProjectDirectoryManager {
  createEmptyDirectory(basePath: string, directoryName: string): Promise<string>
  rollbackEmptyDirectory(targetPath: string): Promise<void>
}

export const systemEmptyProjectDirectoryManager: EmptyProjectDirectoryManager = {
  createEmptyDirectory,
  rollbackEmptyDirectory
}
