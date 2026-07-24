import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  LocalStorageConfig,
  StorageByteRange,
  StorageObject,
  StorageProvider,
  StorageReadResult,
} from '../interfaces'

const ensureDir = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true })
}

const sanitizeKey = (key: string) => key.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '')

const combinePrefixAndKey = (prefix: string | undefined, key: string) => {
  const cleanPrefix = (prefix || '').replace(/\/+$/, '')
  const cleanKey = key.replace(/^\/+/, '')
  if (!cleanPrefix) return cleanKey
  return cleanKey.startsWith(cleanPrefix + '/')
    ? cleanKey
    : `${cleanPrefix}/${cleanKey}`
}

export class LocalStorageProvider implements StorageProvider {
  config: LocalStorageConfig
  private logger?: Logger['storage']

  constructor(config: LocalStorageConfig, logger?: Logger['storage']) {
    this.config = config
    this.logger = logger
  }

  private resolveAbsoluteKey(key: string): { absFile: string; relKey: string } {
    const relKey = sanitizeKey(combinePrefixAndKey(this.config.prefix, key))
    const absFile = path.resolve(this.config.basePath, relKey)
    return { absFile, relKey }
  }

  async create(key: string, fileBuffer: Buffer): Promise<StorageObject> {
    const { absFile, relKey } = this.resolveAbsoluteKey(key)
    await ensureDir(path.dirname(absFile))

    const tempFile = `${absFile}.tmp-${Date.now()}`
    let retries = 3

    while (retries > 0) {
      try {
        await fs.writeFile(tempFile, fileBuffer)

        try {
          await fs.rename(tempFile, absFile)
          break
        } catch (renameErr) {
          const error = renameErr as NodeJS.ErrnoException
          if (error.code === 'EPERM' && retries > 1) {
            await new Promise(resolve => setTimeout(resolve, 300))
            retries--
            continue
          }

          try {
            await fs.unlink(tempFile)
          } catch {
            // ignore cleanup errors
          }
          throw renameErr
        }
      } catch (err) {
        if (retries === 1) throw err
        retries--
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }

    await new Promise(resolve => setTimeout(resolve, 150))

    const stat = await fs.stat(absFile)
    this.logger?.success?.(`Saved file: ${absFile}`)
    return {
      key: relKey,
      size: stat.size,
      lastModified: stat.mtime,
    }
  }

  async createFromStream(
    key: string,
    stream: Readable,
  ): Promise<StorageObject> {
    const { absFile, relKey } = this.resolveAbsoluteKey(key)
    await ensureDir(path.dirname(absFile))

    const tempFile = `${absFile}.tmp-${Date.now()}`

    try {
      await pipeline(stream, createWriteStream(tempFile))

      let retries = 3
      while (retries > 0) {
        try {
          await fs.rename(tempFile, absFile)
          break
        } catch (renameErr) {
          const error = renameErr as NodeJS.ErrnoException
          if (error.code === 'EPERM' && retries > 1) {
            await new Promise((resolve) => setTimeout(resolve, 300))
            retries--
            continue
          }
          throw renameErr
        }
      }
    } catch (err) {
      try {
        await fs.unlink(tempFile)
      } catch {
        // ignore cleanup errors
      }
      throw err
    }

    await new Promise((resolve) => setTimeout(resolve, 150))

    const stat = await fs.stat(absFile)
    this.logger?.success?.(`Saved file: ${absFile}`)
    return {
      key: relKey,
      size: stat.size,
      lastModified: stat.mtime,
    }
  }

  async delete(key: string): Promise<void> {
    const { absFile } = this.resolveAbsoluteKey(key)
    try {
      await fs.unlink(absFile)
      this.logger?.success?.(`Deleted file: ${absFile}`)
    } catch (err) {
      // ignore if not exists
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  async get(key: string): Promise<Buffer | null> {
    const { absFile } = this.resolveAbsoluteKey(key)
    try {
      return await fs.readFile(absFile)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async getStream(
    key: string,
    range?: StorageByteRange,
  ): Promise<StorageReadResult | null> {
    const { absFile } = this.resolveAbsoluteKey(key)

    try {
      const stat = await fs.stat(absFile)
      if (!stat.isFile()) return null

      if (stat.size === 0) {
        return {
          stream: createReadStream(absFile),
          size: 0,
          contentLength: 0,
        }
      }

      const start = range?.start ?? 0
      const end = range?.end ?? stat.size - 1
      return {
        stream: createReadStream(absFile, { start, end }),
        size: stat.size,
        contentLength: end - start + 1,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  getPublicUrl(key: string): string {
    const relKey = sanitizeKey(combinePrefixAndKey(this.config.prefix, key))
    const base = (this.config.baseUrl || '/storage').replace(/\/+$/, '')
    return `${base}/${relKey}`
  }

  async listAll(): Promise<StorageObject[]> {
    const results: StorageObject[] = []
    const baseDir = this.config.prefix
      ? path.resolve(this.config.basePath, this.config.prefix)
      : this.config.basePath

    const walk = async (dir: string, relBase: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        const rel = sanitizeKey(path.join(relBase, entry.name))
        if (entry.isDirectory()) {
          await walk(abs, rel)
        } else if (entry.isFile()) {
          const stat = await fs.stat(abs)
          results.push({ key: rel, size: stat.size, lastModified: stat.mtime })
        }
      }
    }

    await ensureDir(baseDir)
    await walk(baseDir, this.config.prefix || '')
    return results
  }

  async listImages(): Promise<StorageObject[]> {
    const all = await this.listAll()
    return all.filter((o) => /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(o.key))
  }

  async getFileMeta(key: string): Promise<StorageObject | null> {
    const tryGetStat = async (filePath: string, retries = 3): Promise<any> => {
      for (let i = 0; i < retries; i++) {
        try {
          return await fs.stat(filePath)
        } catch (err) {
          const error = err as NodeJS.ErrnoException
          if (error.code === 'ENOENT') {
            return null
          }
          if (error.code === 'EPERM' && i < retries - 1) {
            // Windows 文件权限问题，等待后重试
            await new Promise(resolve => setTimeout(resolve, 200 * (i + 1)))
            continue
          }
          throw err
        }
      }
      return null
    }

    // First try with combined prefix
    const { absFile, relKey } = this.resolveAbsoluteKey(key)
    const stat1 = await tryGetStat(absFile)
    if (stat1 && stat1.isFile()) {
      return { key: relKey, size: stat1.size, lastModified: stat1.mtime }
    }

    // Fallback: try without adding prefix (in case key already contains it or was stored raw)
    const rawRel = sanitizeKey(key)
    const rawAbs = path.resolve(this.config.basePath, rawRel)
    const stat2 = await tryGetStat(rawAbs)
    if (stat2 && stat2.isFile()) {
      return { key: rawRel, size: stat2.size, lastModified: stat2.mtime }
    }

    return null
  }
}


