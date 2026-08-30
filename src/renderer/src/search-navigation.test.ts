import { describe, expect, it } from 'vitest'
import type { CategoryDto, ProjectDto } from '../../shared/contracts'
import {
  defaultProjectQuery,
  matchProject,
  scopeTitle,
  sortProjects,
  visibleProjects
} from './search-navigation'

const projects: ProjectDto[] = [
  {
    id: 'project-1',
    name: 'Alpha Tool',
    description: 'React desktop utility',
    categoryId: 'tools',
    path: 'C:\\Work\\alpha',
    source: 'existing',
    createdAt: '2026-08-28T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    lastOpenedAt: null
  },
  {
    id: 'project-2',
    name: 'Beta API',
    description: 'Backend service',
    categoryId: 'services',
    path: 'D:\\Code\\beta',
    source: 'existing',
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-30T10:00:00.000Z',
    lastOpenedAt: null
  }
]

const categories: CategoryDto[] = [
  { id: 'tools', name: '工具', createdAt: '2026-08-28T10:00:00.000Z' },
  { id: 'services', name: '服务', createdAt: '2026-08-29T10:00:00.000Z' }
]

describe('search navigation', () => {
  it.each([
    ['name', 'alpha', projects[0]],
    ['description', 'DESKTOP', projects[0]],
    ['path', 'code\\beta', projects[1]]
  ])('matches a project by %s', (_field, searchText, project) => {
    expect(matchProject(project!, searchText)).toBe(true)
  })

  it('does not filter an empty search and ignores surrounding whitespace', () => {
    expect(matchProject(projects[0]!, '   ')).toBe(true)
    expect(matchProject(projects[0]!, '  REACT ')).toBe(true)
  })

  it('returns a sorted copy without mutating the input', () => {
    expect(sortProjects(projects, 'updatedAtDesc').map(({ id }) => id)).toEqual(['project-2', 'project-1'])
    expect(sortProjects(projects, 'nameAsc').map(({ id }) => id)).toEqual(['project-1', 'project-2'])
    expect(projects.map(({ id }) => id)).toEqual(['project-1', 'project-2'])
  })

  it('filters by scope and search before sorting', () => {
    expect(visibleProjects(projects, {
      ...defaultProjectQuery,
      scope: { kind: 'category', categoryId: 'services' },
      searchText: 'backend'
    })).toEqual([projects[1]])
    expect(visibleProjects(projects, { ...defaultProjectQuery, searchText: 'missing' })).toEqual([])
  })

  it('resolves the current scope title', () => {
    expect(scopeTitle({ kind: 'all' }, categories)).toBe('全部项目')
    expect(scopeTitle({ kind: 'category', categoryId: 'tools' }, categories)).toBe('工具')
  })
})
