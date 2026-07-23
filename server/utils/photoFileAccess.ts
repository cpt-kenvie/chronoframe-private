import type { EventHandlerRequest, H3Event } from 'h3'
import { and, eq, or } from 'drizzle-orm'

const toHeicCandidatesFromJpeg = (key: string): string[] => {
  const lower = key.toLowerCase()
  if (!lower.endsWith('.jpeg')) return []

  const base = key.slice(0, -'.jpeg'.length)
  return [`${base}.heic`, `${base}.heif`, `${base}.hif`]
}

interface PhotoFileAccess {
  isAuthenticated: boolean
}

/**
 * 校验媒体文件是否允许当前请求访问。
 * 未登录用户只能访问已入库且不属于任何隐藏相册的媒体文件。
 */
export const requirePhotoFileAccess = async (
  event: H3Event<EventHandlerRequest>,
  key: string,
): Promise<PhotoFileAccess> => {
  const session = await getUserSession(event)
  if (session.user) {
    return { isAuthenticated: true }
  }

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
        ...heicCandidates.map(candidate => eq(tables.photos.storageKey, candidate)),
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
    .where(and(eq(tables.albumPhotos.photoId, photo.id), eq(tables.albums.isHidden, true)))
    .get()

  if (hiddenRelation) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  return { isAuthenticated: false }
}
