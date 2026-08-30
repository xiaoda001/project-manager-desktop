import type { ProjectManagerApi } from '../../shared/contracts'

declare global {
  interface Window {
    projectManager: ProjectManagerApi
  }
}

export {}
