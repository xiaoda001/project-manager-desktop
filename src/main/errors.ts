import type { CatalogError, CatalogErrorCode } from '../shared/contracts'

export class CatalogOperationError extends Error {
  constructor(
    public readonly code: CatalogErrorCode,
    message: string,
    public readonly field?: CatalogError['field'],
    public readonly existingProjectId?: string,
    public readonly targetPath?: string
  ) {
    super(message)
    this.name = 'CatalogOperationError'
  }

  toCatalogError(): CatalogError {
    return {
      code: this.code,
      message: this.message,
      ...(this.field ? { field: this.field } : {}),
      ...(this.existingProjectId ? { existingProjectId: this.existingProjectId } : {}),
      ...(this.targetPath ? { targetPath: this.targetPath } : {})
    }
  }
}
