import type { Logger } from '../../../utils/logger'
import type { StorageProvider, StorageObject } from '../interfaces'
import type { OpenListStorageConfig } from '..'
import { Readable } from 'node:stream'
import { StorageProviderError } from '../errors'

/**
 * OpenListStorageProvider implements StorageProvider for OpenList API.
 * Since OpenList API endpoints may vary by deployment, we keep them configurable.
 */
export class OpenListStorageProvider implements StorageProvider {
  config: OpenListStorageConfig
  private logger?: Logger['storage']
  private token?: string

  constructor(config: OpenListStorageConfig, logger?: Logger['storage']) {
    this.config = config
    this.logger = logger
  }

  private get baseUrl() {
    return this.config.baseUrl.replace(/\/$/, '')
  }

  private get pathField(): string {
    return this.config.pathField || 'path'
  }

  private async ensureAuthToken(): Promise<string> {
    if (this.token) return this.token
    if (this.config.token) {
      this.token = this.config.token
      return this.token
    }
    
    throw new Error('OpenList auth requires a token. Please configure NUXT_PROVIDER_OPENLIST_TOKEN.')
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.ensureAuthToken()
    const url = `${this.baseUrl}${path}`
    const headers = new Headers(init.headers)
    headers.set('Authorization', token)
    return fetch(url, { ...init, headers })
  }

  private normalizedRoot(): string {
    return (this.config.rootPath || '').replace(/\/+$/g, '').replace(/^\/+/, '')
  }

  private withRoot(key: string): string {
    const root = this.normalizedRoot()
    const trimmedKey = key.replace(/^\/+/, '')
    if (!root) {
      return trimmedKey
    }
    if (trimmedKey === root || trimmedKey.startsWith(`${root}/`)) {
      return trimmedKey
    }
    return `${root}/${trimmedKey}`
  }

  private toAbsolutePath(key: string): string {
    if (!key || key === '/') {
      return '/'
    }
    return key.startsWith('/') ? key : `/${key}`
  }

  private encodeUrlPath(key: string): string {
    return key
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/')
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  private async waitForMeta(key: string): Promise<(StorageObject & { rawUrl?: string }) | null> {
    const delaysMs = [0, 100, 250, 500, 1000]
    let last: (StorageObject & { rawUrl?: string }) | null = null

    for (const delayMs of delaysMs) {
      if (delayMs > 0) await this.sleep(delayMs)
      const meta = await this.getFileMetaInternal(key, true)
      if (meta?.rawUrl || typeof meta?.size === 'number') return meta
      last = meta
    }

    return last
  }

  private async fetchAsBuffer(url: string): Promise<Buffer | null> {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const arrayBuffer = await resp.arrayBuffer().catch(() => null)
    if (!arrayBuffer) return null
    return Buffer.from(arrayBuffer)
  }

  private async downloadWithBackoff(key: string): Promise<Buffer | null> {
    const delaysMs = [0, 100, 250, 500, 1000]
    const rootedKey = this.withRoot(key)

    for (let attempt = 0; attempt < delaysMs.length; attempt++) {
      const delayMs = delaysMs[attempt]
      if (delayMs > 0) await this.sleep(delayMs)

      const meta = await this.getFileMetaInternal(rootedKey, attempt > 0)
      const rawUrl = meta?.rawUrl
      if (rawUrl) {
        const buf = await this.fetchAsBuffer(rawUrl)
        if (buf) return buf
      }

      const publicUrl = this.getPublicUrl(rootedKey)
      if (publicUrl) {
        const buf = await this.fetchAsBuffer(publicUrl)
        if (buf) return buf
      }
    }

    return null
  }

  async create(key: string, fileBuffer: Buffer, contentType?: string): Promise<StorageObject> {
    const rootedKey = this.withRoot(key)
    const absoluteKey = this.toAbsolutePath(rootedKey)
    const uploadPath = this.config.uploadEndpoint || '/api/fs/put'

    const resp = await this.request(uploadPath, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': String(fileBuffer.length),
        'File-Path': encodeURIComponent(absoluteKey),
      },
      body: new Uint8Array(fileBuffer),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      this.logger?.error('OpenList upload failed', { status: resp.status, body: text })
      const statusLabel = resp.status === 413 ? 'Request Entity Too Large' : 'Request Failed'
      throw new StorageProviderError({
        provider: 'openlist',
        statusCode: resp.status,
        message: `OpenList upload failed: ${resp.status} ${statusLabel}`,
        body: text,
      })
    }

    this.logger?.success(`Uploaded object: ${absoluteKey}`)
    this.logger?.debug?.('OpenList upload details', {
      originalKey: key,
      rootedKey,
      absoluteKey,
      rootPath: this.normalizedRoot(),
    })

    const meta = await this.waitForMeta(rootedKey)
    return (
      meta || {
        key: rootedKey,
        size: fileBuffer.length,
        lastModified: new Date(),
      }
    )
  }

  async createFromStream(
    key: string,
    stream: Readable,
    contentLength: number | null,
    contentType?: string,
  ): Promise<StorageObject> {
    const rootedKey = this.withRoot(key)
    const absoluteKey = this.toAbsolutePath(rootedKey)
    const uploadPath = this.config.uploadEndpoint || '/api/fs/put'

    const headers = new Headers()
    headers.set('Authorization', await this.ensureAuthToken())
    headers.set('Content-Type', contentType || 'application/octet-stream')
    headers.set('File-Path', encodeURIComponent(absoluteKey))
    if (contentLength !== null) {
      headers.set('Content-Length', String(contentLength))
    }

    const init: RequestInit & { duplex?: 'half' } = {
      method: 'PUT',
      headers,
      body: Readable.toWeb(stream),
      duplex: 'half',
    }

    const resp = await fetch(`${this.baseUrl}${uploadPath}`, init)

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      this.logger?.error('OpenList upload failed', { status: resp.status, body: text })
      const statusLabel = resp.status === 413 ? 'Request Entity Too Large' : 'Request Failed'
      throw new StorageProviderError({
        provider: 'openlist',
        statusCode: resp.status,
        message: `OpenList upload failed: ${resp.status} ${statusLabel}`,
        body: text,
      })
    }

    this.logger?.success(`Uploaded object: ${absoluteKey}`)
    this.logger?.debug?.('OpenList upload details', {
      originalKey: key,
      rootedKey,
      absoluteKey,
      rootPath: this.normalizedRoot(),
    })

    const meta = await this.waitForMeta(rootedKey)
    return (
      meta || {
        key: rootedKey,
        lastModified: new Date(),
      }
    )
  }

  async delete(key: string): Promise<void> {
    const deletePath = this.config.deleteEndpoint || '/api/fs/remove'
    const urlPath = `${deletePath}`
    const rootedKey = this.withRoot(key)
    const normalized = rootedKey.replace(/^\/+/, '')
    const slashIdx = normalized.lastIndexOf('/')
    const dir = this.toAbsolutePath(slashIdx >= 0 ? normalized.slice(0, slashIdx) : this.normalizedRoot())
    const name = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized
    const body = { dir, names: [name] }

    const resp = await this.request(urlPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      this.logger?.error('OpenList delete failed', { status: resp.status, body: text })
      throw new StorageProviderError({
        provider: 'openlist',
        statusCode: resp.status,
        message: `OpenList delete failed: ${resp.status}`,
        body: text,
      })
    }
    this.logger?.success(`Deleted object: ${key}`)
  }

  async get(key: string): Promise<Buffer | null> {
    const downloadPath = this.config.downloadEndpoint
    if (!downloadPath) {
      return await this.downloadWithBackoff(key)
    }

    const rootedKey = this.withRoot(key)
    const urlPath = `${downloadPath}?${encodeURIComponent(this.pathField)}=${encodeURIComponent(rootedKey)}`
    const resp = await this.request(urlPath, { method: 'GET' })
    if (!resp.ok) return null
    const arrayBuffer = await resp.arrayBuffer().catch(() => null)
    if (!arrayBuffer) return null
    return Buffer.from(arrayBuffer)
  }

  getPublicUrl(key: string): string {
    const rootedKey = this.withRoot(key)
    const { cdnUrl, baseUrl } = this.config
    const base = cdnUrl || (baseUrl ? `${baseUrl.replace(/\/$/, '')}/d` : '')
    if (!base) {
      return ''
    }
    return `${base.replace(/\/$/, '')}/${this.encodeUrlPath(rootedKey)}`
  }

  async getFileMeta(key: string): Promise<StorageObject | null> {
    return await this.getFileMetaInternal(key, false)
  }

  private async getFileMetaInternal(
    key: string,
    refresh: boolean,
  ): Promise<(StorageObject & { rawUrl?: string }) | null> {
    const metaPath =
      this.config.metaEndpoint || this.config.downloadEndpoint || '/api/fs/get'
    const rootedKey = this.withRoot(key)
    const urlPath = metaPath
    const payload: Record<string, unknown> = {
      [this.pathField]: this.toAbsolutePath(rootedKey),
      password: '',
      page: 1,
      per_page: 0,
      refresh,
    }
    const resp = await this.request(urlPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      this.logger?.error('OpenList get file meta failed', { status: resp.status, body: text })
      return null
    }

    const json: unknown = await resp.json().catch(() => null)
    const isRecord = (val: unknown): val is Record<string, unknown> => {
      return typeof val === 'object' && val !== null
    }

    if (!isRecord(json)) return { key: rootedKey }
    const node = isRecord(json.data) ? json.data : json

    const size = typeof node.size === 'number' ? node.size : undefined
    const etag = typeof node.etag === 'string' ? node.etag : undefined
    const rawUrl = typeof node.raw_url === 'string' ? node.raw_url : undefined
    const modified =
      typeof node.modified === 'string'
        ? node.modified
        : typeof node.lastModified === 'string'
          ? node.lastModified
          : undefined

    const result: StorageObject & { rawUrl?: string } = {
      key: rootedKey,
      size,
      lastModified: modified ? new Date(modified) : undefined,
      etag,
      rawUrl,
    }
    return result
  }

  async listAll(): Promise<StorageObject[]> {
    const listPath = this.config.listEndpoint
    if (!listPath) return []
    
    const payload: Record<string, unknown> = {
      [this.pathField]: this.toAbsolutePath(this.normalizedRoot()),
      password: '',
      page: 1,
      per_page: 0,
      refresh: false,
    }
    const resp = await this.request(listPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) return []

    const json: unknown = await resp.json().catch(() => null)
    const isRecord = (val: unknown): val is Record<string, unknown> => {
      return typeof val === 'object' && val !== null
    }
    const node = isRecord(json) && isRecord(json.data) ? json.data : null
    const items = node && Array.isArray(node.content) ? node.content : []

    return items
      .map((item) => {
        if (!isRecord(item)) return null
        const rawKey = item.path
        const name = item.name
        if (typeof rawKey !== 'string' && typeof name !== 'string') return null

        const keyValue =
          typeof rawKey === 'string' ? rawKey : `${this.normalizedRoot()}/${name}`
        const rootedKey = this.withRoot(keyValue)
        const size = typeof item.size === 'number' ? item.size : undefined
        const etag = typeof item.etag === 'string' ? item.etag : undefined
        const modified =
          typeof item.modified === 'string'
            ? item.modified
            : typeof item.lastModified === 'string'
              ? item.lastModified
              : typeof item.mtime === 'string'
                ? item.mtime
                : undefined

        return {
          key: rootedKey,
          size,
          lastModified: modified ? new Date(modified) : undefined,
          etag,
        }
      })
      .filter(Boolean) as StorageObject[]
  }

  async listImages(): Promise<StorageObject[]> {
    const all = await this.listAll()
    return all.filter((obj) => /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(obj.key))
  }
}
