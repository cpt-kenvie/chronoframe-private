import { asc, desc, eq, inArray } from 'drizzle-orm'
import {
  photoListSelection,
  toPhotoListItem,
} from '~~/server/utils/photoResponse'

// 相册卡片最多返回三张预览照片，避免列表页依赖完整照片目录。
const ALBUM_PREVIEW_PHOTO_COUNT = 3

export default eventHandler(async (event) => {
  const db = useDB()
  const session = await getUserSession(event)
  const isLoggedIn = Boolean(session.user)

  const albums = db
    .select()
    .from(tables.albums)
    .where(isLoggedIn ? undefined : eq(tables.albums.isHidden, false))
    .orderBy(desc(tables.albums.createdAt))
    .all()

  if (albums.length === 0) return []

  const albumIds = albums.map((album) => album.id)
  const albumPhotoRows = db
    .select({
      albumId: tables.albumPhotos.albumId,
      photoId: tables.albumPhotos.photoId,
      position: tables.albumPhotos.position,
    })
    .from(tables.albumPhotos)
    .where(inArray(tables.albumPhotos.albumId, albumIds))
    .orderBy(asc(tables.albumPhotos.albumId), asc(tables.albumPhotos.position))
    .all()

  const hiddenPhotoIds = new Set<string>()
  if (!isLoggedIn) {
    const hiddenRows = db
      .select({ photoId: tables.albumPhotos.photoId })
      .from(tables.albumPhotos)
      .innerJoin(
        tables.albums,
        eq(tables.albumPhotos.albumId, tables.albums.id),
      )
      .where(eq(tables.albums.isHidden, true))
      .all()
    for (const row of hiddenRows) hiddenPhotoIds.add(row.photoId)
  }

  const photoIdsByAlbum = new Map<number, string[]>()
  for (const row of albumPhotoRows) {
    if (hiddenPhotoIds.has(row.photoId)) continue
    const photoIds = photoIdsByAlbum.get(row.albumId)
    if (photoIds) photoIds.push(row.photoId)
    else photoIdsByAlbum.set(row.albumId, [row.photoId])
  }

  const previewIdsByAlbum = new Map<number, string[]>()
  const allPreviewPhotoIds = new Set<string>()
  for (const album of albums) {
    const photoIds = photoIdsByAlbum.get(album.id) ?? []
    const previewIds: string[] = []
    if (album.coverPhotoId && !hiddenPhotoIds.has(album.coverPhotoId)) {
      previewIds.push(album.coverPhotoId)
    }
    for (const photoId of photoIds) {
      if (previewIds.length >= ALBUM_PREVIEW_PHOTO_COUNT) break
      if (!previewIds.includes(photoId)) previewIds.push(photoId)
    }
    previewIdsByAlbum.set(album.id, previewIds)
    for (const photoId of previewIds) allPreviewPhotoIds.add(photoId)
  }

  const previewPhotos =
    allPreviewPhotoIds.size > 0
      ? db
          .select(photoListSelection)
          .from(tables.photos)
          .where(inArray(tables.photos.id, Array.from(allPreviewPhotoIds)))
          .all()
          .map(toPhotoListItem)
      : []
  const previewPhotoById = new Map(
    previewPhotos.map((photo) => [photo.id, photo]),
  )

  return albums.map((album) => ({
    ...album,
    photoIds: photoIdsByAlbum.get(album.id) ?? [],
    previewPhotos: (previewIdsByAlbum.get(album.id) ?? [])
      .map((photoId) => previewPhotoById.get(photoId))
      .filter((photo) => photo !== undefined),
  }))
})
