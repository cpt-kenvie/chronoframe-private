import path from 'node:path'
import { requirePhotoFileAccess } from '~~/server/utils/photoFileAccess'
import { parseByteRange } from '~~/server/utils/httpRange'
import { useStorageProvider } from '~~/server/utils/useStorageProvider'
import { resolveLivePhotoPlaybackKey } from '~~/server/services/video/livephoto'

const guessContentTypeFromKey = (key: string): string => {
  const ext = path.extname(key).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    case '.tif':
    case '.tiff':
      return 'image/tiff'
    case '.heic':
    case '.heif':
    case '.hif':
      return 'image/heic'
    case '.mp4':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.json':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}

const normalizeKeyFromParam = (p: string): string => {
  const decoded = decodeURIComponent(p)
  const key = decoded.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '')
  if (!key || key.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid key' })
  }
  return key
}

export default eventHandler(async (event) => {
  const rawParam = getRouterParam(event, 'key')
  if (!rawParam) {
    throw createError({ statusCode: 400, statusMessage: 'Missing key' })
  }

  const key = normalizeKeyFromParam(rawParam)
  const { storageProvider } = useStorageProvider(event)
  const { isAuthenticated } = await requirePhotoFileAccess(event, key)
  const playbackKey = await resolveLivePhotoPlaybackKey(key)

  const metadata = await storageProvider.getFileMeta(playbackKey)
  if (!metadata) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  const size = metadata.size
  if (size === undefined || !Number.isSafeInteger(size) || size < 0) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Storage provider did not return a valid file size',
    })
  }

  setHeader(event, 'Content-Type', guessContentTypeFromKey(playbackKey))
  setHeader(event, 'Accept-Ranges', 'bytes')

  // 相册可见性可能变化，公开响应必须在每次使用前重新校验。
  setHeader(
    event,
    'Cache-Control',
    isAuthenticated ? 'private, no-store' : 'public, max-age=0, must-revalidate',
  )

  const range = getHeader(event, 'range')
  if (range) {
    const parsedRange = parseByteRange(range, size)
    if (!parsedRange) {
      event.node.res.statusCode = 416
      setHeader(event, 'Content-Range', `bytes */${size}`)
      setHeader(event, 'Content-Length', 0)
      event.node.res.end()
      return
    }

    const result = await storageProvider.getStream(playbackKey, parsedRange)
    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    }

    event.node.res.statusCode = 206
    setHeader(
      event,
      'Content-Range',
      `bytes ${parsedRange.start}-${parsedRange.end}/${size}`,
    )
    setHeader(event, 'Content-Length', result.contentLength)
    return sendStream(event, result.stream)
  }

  const result = await storageProvider.getStream(playbackKey)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  setHeader(event, 'Content-Length', size)
  return sendStream(event, result.stream)
})
