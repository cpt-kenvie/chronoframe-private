import type { StorageConfig } from '.'
import type { Readable } from 'node:stream'

export interface StorageObject {
  key: string
  size?: number
  etag?: string
  lastModified?: Date
  rawUrl?: string
}

export interface StorageByteRange {
  start: number
  end: number
}

export interface StorageReadResult {
  stream: Readable
  size: number
  contentLength: number
}

export interface UploadOptions {
  contentType?: string
  metadata?: Record<string, string>
  encryption?: boolean
  ttl?: number
}

export interface StorageProvider {
  config?: StorageConfig
  create(
    key: string,
    fileBuffer: Buffer,
    contentType?: string,
    skipEncryption?: boolean,
  ): Promise<StorageObject>
  createFromStream?(
    key: string,
    stream: Readable,
    contentLength: number | null,
    contentType?: string,
    skipEncryption?: boolean,
  ): Promise<StorageObject>
  delete(key: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  getStream(
    key: string,
    range?: StorageByteRange,
  ): Promise<StorageReadResult | null>
  getPublicUrl(key: string): string
  getSignedUrl?(
    key: string,
    expiresIn?: number,
    options?: UploadOptions,
  ): Promise<string>
  getFileMeta(key: string): Promise<StorageObject | null>
  listAll(): Promise<StorageObject[]>
  listImages(): Promise<StorageObject[]>
  encryptFile?(key: string): Promise<void>
}
