import { asc, getTableColumns } from 'drizzle-orm'
import z from 'zod'
import { withPhotoUrls } from '~~/server/utils/photoResponse'

export default eventHandler(async (event) => {
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
      .where(eq(tables.albums.isHidden, true))
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
  const hiddenPhotoIdSet = new Set(hiddenPhotoIds)
  const filteredPhotos = !isLoggedIn
    ? photos.filter((photo) => !hiddenPhotoIdSet.has(photo.id))
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
    photos: filteredPhotos.map(withPhotoUrls),
  }
})
