import type { StorageObject, StorageProvider, UploadOptions } from './interfaces'
import { settingsManager } from '~~/server/services/settings/settingsManager'
import { decryptBuffer, deriveAes256Key, encryptBuffer, isEncryptedPayload } from './encryption'

const getEncryptionSettings = async (): Promise<{
  encryptOnWrite: boolean
  key: Buffer | null
}> => {
  const encryptOnWrite = Boolean(
    await settingsManager.get<boolean>('storage', 'encryption.enabled'),
  )
  const rawKey = await settingsManager.get<string>('storage', 'encryption.key')

  if (!rawKey) {
    return { encryptOnWrite, key: null }
  }

  return { encryptOnWrite, key: deriveAes256Key(rawKey) }
}

export class EncryptedStorageProvider implements StorageProvider {
  config?: StorageProvider['config']
  getSignedUrl?: (
    key: string,
    expiresIn?: number,
    options?: UploadOptions,
  ) => Promise<string>

  constructor(private inner: StorageProvider) {
    this.config = inner.config
    this.getSignedUrl = inner.getSignedUrl?.bind(inner)
  }

  async create(
    key: string,
    fileBuffer: Buffer,
    contentType?: string,
  ): Promise<StorageObject> {
    const { encryptOnWrite, key: encryptionKey } = await getEncryptionSettings()
    if (!encryptOnWrite) {
      return await this.inner.create(key, fileBuffer, contentType)
    }
    if (!encryptionKey) {
      throw new Error('Storage encryption is enabled but encryption key is not set')
    }

    const payload = isEncryptedPayload(fileBuffer)
      ? fileBuffer
      : encryptBuffer(fileBuffer, encryptionKey)

    return await this.inner.create(key, payload, 'application/octet-stream')
  }

  async delete(key: string): Promise<void> {
    return await this.inner.delete(key)
  }

  async get(key: string): Promise<Buffer | null> {
    const payload = await this.inner.get(key)
    if (!payload) return null
    if (!isEncryptedPayload(payload)) return payload

    const { key: encryptionKey } = await getEncryptionSettings()
    if (!encryptionKey) {
      throw new Error('Encrypted object found but encryption key is not set')
    }
    return decryptBuffer(payload, encryptionKey)
  }

  getPublicUrl(key: string): string {
    return this.inner.getPublicUrl(key)
  }

  async getFileMeta(key: string): Promise<StorageObject | null> {
    return await this.inner.getFileMeta(key)
  }

  async listAll(): Promise<StorageObject[]> {
    return await this.inner.listAll()
  }

  async listImages(): Promise<StorageObject[]> {
    return await this.inner.listImages()
  }
}
