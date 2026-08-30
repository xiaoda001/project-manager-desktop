import type { CategoryDto, ProjectDto } from '../../shared/contracts'

export type Scope = { kind: 'all' } | { kind: 'category'; categoryId: string }
export type SortKey = 'updatedAtDesc' | 'nameAsc'
export type ViewMode = 'card' | 'list'

export interface ProjectQuery {
  scope: Scope
  searchText: string
  sort: SortKey
  view: ViewMode
}

export const defaultProjectQuery: ProjectQuery = {
  scope: { kind: 'all' },
  searchText: '',
  sort: 'updatedAtDesc',
  view: 'card'
}

export const matchProject = (project: ProjectDto, searchText: string): boolean => {
  const query = searchText.trim().toLocaleLowerCase()
  if (!query) return true

  return [project.name, project.description, project.path]
    .some((value) => value.toLocaleLowerCase().includes(query))
}

export const sortProjects = (projects: ProjectDto[], sort: SortKey): ProjectDto[] => {
  const result = [...projects]
  result.sort(sort === 'updatedAtDesc'
    ? (left, right) => right.updatedAt.localeCompare(left.updatedAt)
    : (left, right) => left.name.localeCompare(right.name))
  return result
}

export const visibleProjects = (projects: ProjectDto[], query: ProjectQuery): ProjectDto[] => {
  const categoryId = query.scope.kind === 'category' ? query.scope.categoryId : null
  const inScope = categoryId === null
    ? projects
    : projects.filter((project) => project.categoryId === categoryId)
  return sortProjects(inScope.filter((project) => matchProject(project, query.searchText)), query.sort)
}

export const scopeTitle = (scope: Scope, categories: CategoryDto[]): string => {
  if (scope.kind === 'all') return '全部项目'
  return categories.find((category) => category.id === scope.categoryId)?.name ?? '未知分类'
}
