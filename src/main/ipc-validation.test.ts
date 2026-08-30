import { describe, expect, it } from 'vitest'
import { isCreateEmptyProjectInput, isExecuteMigrationsInput } from './ipc-validation'

describe('S4 IPC validation', () => {
  it('accepts only the three string fields in the create command', () => {
    expect(isCreateEmptyProjectInput({
      name: 'dashboard',
      description: '',
      categoryName: 'Tools'
    })).toBe(true)
    expect(isCreateEmptyProjectInput({
      name: 'dashboard',
      description: '',
      categoryName: 'Tools',
      path: 'C:\\outside'
    })).toBe(false)
    expect(isCreateEmptyProjectInput({
      name: 'dashboard',
      description: 42,
      categoryName: 'Tools'
    })).toBe(false)
  })

  it('rejects objects with a custom prototype', () => {
    const value = Object.create({ path: 'C:\\outside' }) as Record<string, string>
    Object.assign(value, { name: 'dashboard', description: '', categoryName: 'Tools' })
    expect(isCreateEmptyProjectInput(value)).toBe(false)
  })
})

describe('S5 IPC validation', () => {
  it('accepts confirmed migration items and rejects duplicate IDs or extra fields', () => {
    expect(isExecuteMigrationsInput({
      items: [{ projectId: 'one', sourcePath: 'C:\\one', targetPath: 'D:\\one' }]
    })).toBe(true)
    expect(isExecuteMigrationsInput({
      items: [
        { projectId: 'one', sourcePath: 'C:\\one', targetPath: 'D:\\one' },
        { projectId: 'one', sourcePath: 'C:\\two', targetPath: 'D:\\two' }
      ]
    })).toBe(false)
    expect(isExecuteMigrationsInput({
      items: [{ projectId: 'one', sourcePath: 'C:\\one', targetPath: 'D:\\one', force: true }]
    })).toBe(false)
  })
})
