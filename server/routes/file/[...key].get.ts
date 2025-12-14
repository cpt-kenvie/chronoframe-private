import path from 'node:path'
import { and, eq, or } from 'drizzle-orm'
import { useStorageProvider } from '~~/server/utils/useStorageProvider'

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

const toHeicCandidatesFromJpeg = (key: string): string[] => {
  const lower = key.toLowerCase()
  if (!lower.endsWith('.jpeg')) return []
  const base = key.slice(0, -'.jpeg'.length)
  return [`${base}.heic`, `${base}.heif`, `${base}.hif`]
}

export default eventHandler(async (event) => {
  const rawParam = getRouterParam(event, 'key')
  if (!rawParam) {
    throw createError({ statusCode: 400, statusMessage: 'Missing key' })
  }

  const key = normalizeKeyFromParam(rawParam)
  const { storageProvider } = useStorageProvider(event)

  const session = await getUserSession(event)

  if (!session.user) {
    const db = useDB()

    const heicCandidates = toHeicCandidatesFromJpeg(key)

    const photo = await db
      .select({ id: tables.photos.id })
      .from(tables.photos)
      .where(
        or(
          eq(tables.photos.storageKey, key),
          eq(tables.photos.thumbnailKey, key),
          eq(tables.photos.livePhotoVideoKey, key),
          ...(heicCandidates.length > 0
            ? heicCandidates.map((k) => eq(tables.photos.storageKey, k))
            : []),
        ),
      )
      .get()

    if (!photo) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    }

    const hiddenRelation = await db
      .select({ id: tables.albumPhotos.id })
      .from(tables.albumPhotos)
      .innerJoin(tables.albums, eq(tables.albumPhotos.albumId, tables.albums.id))
      .where(and(eq(tables.albumPhotos.photoId, photo.id), eq(tables.albums.isHidden, 1)))
      .get()

    if (hiddenRelation) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    }
  }

  const buffer = await storageProvider.get(key)
  if (!buffer) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  setHeader(event, 'Content-Type', guessContentTypeFromKey(key))

  // Public photos are already filtered by DB check; allow long caching for them.
  setHeader(
    event,
    'Cache-Control',
    session.user ? 'private, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable',
  )

  const range = getHeader(event, 'range')
  if (range) {
    const matches = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (matches) {
      const size = buffer.length
      const start = matches[1] ? Number.parseInt(matches[1], 10) : 0
      const end = matches[2] ? Number.parseInt(matches[2], 10) : size - 1
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && end < size) {
        event.node.res.statusCode = 206
        setHeader(event, 'Accept-Ranges', 'bytes')
        setHeader(event, 'Content-Range', `bytes ${start}-${end}/${size}`)
        setHeader(event, 'Content-Length', String(end - start + 1))
        return buffer.subarray(start, end + 1)
      }
    }
  }

  setHeader(event, 'Content-Length', String(buffer.length))
  return buffer
})
