export class StorageProviderError extends Error {
  provider: string
  statusCode: number
  body?: string

  constructor(params: {
    provider: string
    statusCode: number
    message: string
    body?: string
  }) {
    super(params.message)
    this.name = 'StorageProviderError'
    this.provider = params.provider
    this.statusCode = params.statusCode
    this.body = params.body
  }
}

export const isStorageProviderError = (
  error: unknown,
): error is StorageProviderError => {
  return error instanceof StorageProviderError
}
