import type { AppSettingsDto, CategoryDto, ProjectDto } from '../shared/contracts'

export const defaultSettings = (): AppSettingsDto => ({
  defaultProjectDirectory: '',
  ide: { type: 'vscode', customExecutablePath: '' }
})

export interface CatalogDataV1 {
  schemaVersion: 1
  projects: ProjectDto[]
  categories: CategoryDto[]
  settings: AppSettingsDto
}

export const emptyCatalog = (): CatalogDataV1 => ({
  schemaVersion: 1,
  projects: [],
  categories: [],
  settings: defaultSettings()
})

export const toSnapshot = (data: CatalogDataV1) => ({
  projects: structuredClone(data.projects),
  categories: structuredClone(data.categories),
  settings: structuredClone(data.settings)
})
