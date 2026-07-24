import { Readable } from 'node:stream'
import type { Logger } from '../../../utils/logger'
import type {
  StorageByteRange,
  StorageObject,
  StorageProvider,
  StorageReadResult,
} from '../interfaces'

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null

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
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: token,
    }
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

  private async getDownloadResponse(
    key: string,
    range?: StorageByteRange,
  ): Promise<Response | null> {
    const headers = range
      ? { Range: `bytes=${range.start}-${range.end}` }
      : undefined
    const downloadPath = this.config.downloadEndpoint

    if (!downloadPath) {
      const info = await this.getFileMeta(key)
      if (!info?.rawUrl) return null
      return await fetch(info.rawUrl, { headers })
    }

    const rootedKey = this.withRoot(key)
    const urlPath = `${downloadPath}?${encodeURIComponent(this.pathField)}=${encodeURIComponent(rootedKey)}`
    return await this.request(urlPath, { method: 'GET', headers })
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
      throw new Error(`OpenList upload failed: ${resp.status}`)
    }

    this.logger?.success(`Uploaded object: ${absoluteKey}`)
    this.logger?.debug?.('OpenList upload details', {
      originalKey: key,
      rootedKey,
      absoluteKey,
      rootPath: this.normalizedRoot(),
    })

    const meta = await this.getFileMeta(rootedKey)
    return (
      meta || {
        key: rootedKey,
        size: fileBuffer.length,
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
      throw new Error(`OpenList delete failed: ${resp.status}`)
    }
    this.logger?.success(`Deleted object: ${key}`)
  }

  async get(key: string): Promise<Buffer | null> {
    const result = await this.getStream(key)
    if (!result) return null

    const chunks: Buffer[] = []
    for await (const chunk of result.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  async getStream(
    key: string,
    range?: StorageByteRange,
  ): Promise<StorageReadResult | null> {
    const response = await this.getDownloadResponse(key, range)
    if (!response?.ok || !response.body) return null

    if (range && response.status !== 206) {
      await response.body.cancel()
      throw new Error('OpenList download endpoint does not support byte ranges')
    }

    const contentLengthHeader = response.headers.get('content-length')
    const contentLength = contentLengthHeader
      ? Number.parseInt(contentLengthHeader, 10)
      : range
        ? range.end - range.start + 1
        : 0
    const totalSizeMatch = /\/(\d+)$/.exec(
      response.headers.get('content-range') ?? '',
    )
    const size = totalSizeMatch?.[1]
      ? Number.parseInt(totalSizeMatch[1], 10)
      : contentLength

    return {
      stream: Readable.from(response.body as AsyncIterable<Uint8Array>),
      size,
      contentLength,
    }
  }

  getPublicUrl(key: string): string {
    const rootedKey = this.withRoot(key)
    const { cdnUrl, baseUrl } = this.config
    const base = cdnUrl || (baseUrl ? `${baseUrl.replace(/\/$/, '')}/d` : '')
    if (!base) {
      return ''
    }
    return `${base.replace(/\/$/, '')}/${rootedKey}`
  }

  async getFileMeta(key: string): Promise<StorageObject | null> {
    const metaPath = this.config.metaEndpoint || this.config.downloadEndpoint || '/api/fs/get'
    const rootedKey = this.withRoot(key)
    const urlPath = metaPath
    const payload: Record<string, unknown> = {
      [this.pathField]: this.toAbsolutePath(rootedKey),
      password: '',
      page: 1,
      per_page: 0,
      refresh: false,
    }
    const resp = await this.request(urlPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      this.logger?.error('OpenList get file meta failed', { status: resp.status, body: text })
      return null
    }

    const data = toRecord(await resp.json().catch(() => null))
    if (!data) return { key }
    const node = toRecord(data.data) ?? {}
    const size = node.size
    const modified = node.modified ?? node.lastModified
    const etag = node.etag
    const rawUrl = node.raw_url
    const result: StorageObject = {
      key: rootedKey,
      size: typeof size === 'number' ? size : undefined,
      lastModified:
        typeof modified === 'string' || typeof modified === 'number'
          ? new Date(modified)
          : undefined,
      etag: typeof etag === 'string' ? etag : undefined,
      rawUrl: typeof rawUrl === 'string' ? rawUrl : undefined,
    }
    return result
  }

  async listAll(): Promise<StorageObject[]> {
    // Listing API not provided explicitly; return empty array by default.
    // You can configure custom list endpoint and parsing later.
    const listPath = this.config.listEndpoint
    if (!listPath) return []
    
    const payload: Record<string, any> = {
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
    const data = (await resp.json().catch(() => null)) as any
    const items: any[] = data?.data || data || []
    return items
      .map((item) => {
        const rawKey = item?.path || item?.key || item?.name
        if (!rawKey) return null
        const rootedKey = this.withRoot(rawKey)
        const size = item?.size
        const lastModified = item?.modified || item?.lastModified || item?.mtime
        const etag = item?.etag
        return {
          key: rootedKey,
          size: typeof size === 'number' ? size : undefined,
          lastModified: lastModified ? new Date(lastModified) : undefined,
          etag: typeof etag === 'string' ? etag : undefined,
        } as StorageObject
      })
      .filter(Boolean) as StorageObject[]
  }

  async listImages(): Promise<StorageObject[]> {
    const all = await this.listAll()
    return all.filter((obj) => /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(obj.key))
  }
}
