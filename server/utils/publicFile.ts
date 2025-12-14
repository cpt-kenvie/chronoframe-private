import { settingsManager } from '~~/server/services/settings/settingsManager'
import type { StorageProvider } from '~~/server/services/storage'

export const isStorageEncryptionEnabled = async (): Promise<boolean> => {
  return Boolean(
    await settingsManager.get<boolean>('storage', 'encryption.enabled'),
  )
}

export const toFileProxyUrl = (key: string): string => {
  const normalized = key.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '')
  const encoded = normalized
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `/file/${encoded}`
}

export const resolveDownloadUrl = async (
  storageProvider: StorageProvider,
  key?: string | null,
): Promise<string | null> => {
  if (!key) return null
  return (await isStorageEncryptionEnabled())
    ? toFileProxyUrl(key)
    : storageProvider.getPublicUrl(key)
}

export const resolveOriginalKeyForPhoto = (storageKey?: string | null): string | null => {
  if (!storageKey) return null
  const lower = storageKey.toLowerCase()
  const heicExt = ['.heic', '.heif', '.hif'].find((ext) => lower.endsWith(ext))
  if (!heicExt) return storageKey
  return storageKey.slice(0, storageKey.length - heicExt.length) + '.jpeg'
}
