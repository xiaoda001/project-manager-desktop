import type { CreateEmptyProjectInput, ExecuteMigrationsInput } from '../shared/contracts'

export const isCreateEmptyProjectInput = (value: unknown): value is CreateEmptyProjectInput => {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return false
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  return (
    keys.length === 3 &&
    keys.every((key) => ['name', 'description', 'categoryName'].includes(key)) &&
    typeof input.name === 'string' &&
    typeof input.description === 'string' &&
    typeof input.categoryName === 'string'
  )
}

export const isExecuteMigrationsInput = (value: unknown): value is ExecuteMigrationsInput => {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return false
  }
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 1 || !Array.isArray(input.items) || input.items.length > 1000) {
    return false
  }
  const ids = new Set<string>()
  return input.items.every((value) => {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
      return false
    }
    const item = value as Record<string, unknown>
    if (
      Object.keys(item).length !== 3 ||
      typeof item.projectId !== 'string' ||
      typeof item.sourcePath !== 'string' ||
      typeof item.targetPath !== 'string' ||
      item.projectId.length === 0 ||
      item.sourcePath.length > 4096 ||
      item.targetPath.length > 4096 ||
      item.sourcePath.includes('\0') ||
      item.targetPath.includes('\0') ||
      ids.has(item.projectId)
    ) return false
    ids.add(item.projectId)
    return true
  })
}
