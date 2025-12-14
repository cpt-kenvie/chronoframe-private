import { asc, getTableColumns } from 'drizzle-orm'
import z from 'zod'
import { useStorageProvider } from '~~/server/utils/useStorageProvider'
import { isStorageEncryptionEnabled, resolveOriginalKeyForPhoto, toFileProxyUrl } from '~~/server/utils/publicFile'

export default eventHandler(async (event) => {
  const { storageProvider } = useStorageProvider(event)
  const encryptionEnabled = await isStorageEncryptionEnabled()
  const toUrl = (key?: string | null) => {
    if (!key) return null
    return encryptionEnabled ? toFileProxyUrl(key) : storageProvider.getPublicUrl(key)
  }
  const withUrls = (photo: any) => {
    const originalKey = resolveOriginalKeyForPhoto(photo.storageKey) || photo.storageKey
    return {
      ...photo,
      originalUrl: toUrl(originalKey),
      thumbnailUrl: toUrl(photo.thumbnailKey),
      livePhotoVideoUrl: toUrl(photo.livePhotoVideoKey),
    }
  }

  const { albumId } = await getValidatedRouterParams(
    event,
    z.object({
      albumId: z
        .string()
        .regex(/^\d+$/)
        .transform((val) => parseInt(val, 10)),
    }).parse,
  )

  const db = useDB()

  const album = db
    .select()
    .from(tables.albums)
    .where(eq(tables.albums.id, albumId))
    .get()

  if (!album) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Album not found',
    })
  }

  const session = await getUserSession(event)
  const isLoggedIn = !!session.user

  if (album.isHidden && !isLoggedIn) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied',
    })
  }

  // 如果用户未登录，获取所有隐藏相册中的照片ID，用于过滤
  let hiddenPhotoIds: string[] = []
  if (!isLoggedIn) {
    const hiddenAlbumIds = db
      .select({ id: tables.albums.id })
      .from(tables.albums)
      .where(eq(tables.albums.isHidden, 1))
      .all()
      .map((album) => album.id)

    if (hiddenAlbumIds.length > 0) {
      hiddenPhotoIds = db
        .select({ photoId: tables.albumPhotos.photoId })
        .from(tables.albumPhotos)
        .where(inArray(tables.albumPhotos.albumId, hiddenAlbumIds))
        .all()
        .map((row) => row.photoId)
    }
  }

  // 获取相册中的照片
  const photos = await db
    // all fields from tables.photos
    .select({
      ...getTableColumns(tables.photos),
    })
    .from(tables.photos)
    .innerJoin(
      tables.albumPhotos,
      eq(tables.photos.id, tables.albumPhotos.photoId),
    )
    .where(eq(tables.albumPhotos.albumId, albumId))
    .orderBy(asc(tables.albumPhotos.position))
    .all()

  // 如果用户未登录，过滤掉在隐藏相册中的照片
  const filteredPhotos = !isLoggedIn
    ? photos.filter((photo) => !hiddenPhotoIds.includes(photo.id))
    : photos

  // 验证相册数据完整性
  if (!filteredPhotos || !Array.isArray(filteredPhotos)) {
    // 空相册也是合法的，只需要返回空数组
    return {
      ...album,
      photos: [],
    }
  }

  return {
    ...album,
    photos: filteredPhotos.map(withUrls),
  }
})
