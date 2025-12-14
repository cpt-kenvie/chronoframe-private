import { desc, eq, inArray, notInArray } from 'drizzle-orm'
import { useStorageProvider } from '~~/server/utils/useStorageProvider'
import { isStorageEncryptionEnabled, resolveOriginalKeyForPhoto, toFileProxyUrl } from '~~/server/utils/publicFile'

export default eventHandler(async (event) => {
  const db = useDB()
  const session = await getUserSession(event)
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

  if (session.user) {
    return db
      .select()
      .from(tables.photos)
      .orderBy(desc(tables.photos.dateTaken))
      .all()
      .map(withUrls)
  }

  const hiddenAlbumIds = db
    .select({ id: tables.albums.id })
    .from(tables.albums)
    .where(eq(tables.albums.isHidden, 1))
    .all()
    .map((album) => album.id)

  if (hiddenAlbumIds.length === 0) {
    return db
      .select()
      .from(tables.photos)
      .orderBy(desc(tables.photos.dateTaken))
      .all()
      .map(withUrls)
  }

  const hiddenPhotoIds = db
    .select({ photoId: tables.albumPhotos.photoId })
    .from(tables.albumPhotos)
    .where(inArray(tables.albumPhotos.albumId, hiddenAlbumIds))
    .all()
    .map((row) => row.photoId)

  if (hiddenPhotoIds.length === 0) {
    return db
      .select()
      .from(tables.photos)
      .orderBy(desc(tables.photos.dateTaken))
      .all()
      .map(withUrls)
  }

  return db
    .select()
    .from(tables.photos)
    .where(notInArray(tables.photos.id, hiddenPhotoIds))
    .orderBy(desc(tables.photos.dateTaken))
    .all()
    .map(withUrls)
})
