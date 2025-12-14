import { eq } from 'drizzle-orm'
import { useStorageProvider } from '~~/server/utils/useStorageProvider'
import { isStorageEncryptionEnabled, resolveOriginalKeyForPhoto, toFileProxyUrl } from '~~/server/utils/publicFile'

export default eventHandler(async (event) => {
  await requireUserSession(event)
  const { storageProvider } = useStorageProvider(event)
  const encryptionEnabled = await isStorageEncryptionEnabled()
  const toUrl = (key?: string | null) => {
    if (!key) return null
    return encryptionEnabled ? toFileProxyUrl(key) : storageProvider.getPublicUrl(key)
  }
  
  const photoId = getRouterParam(event, 'photoId')
  
  if (!photoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Photo ID is required',
    })
  }

  try {
    const db = useDB()
    
    // 查询照片信息
    const photos = await db
      .select()
      .from(tables.photos)
      .where(eq(tables.photos.id, photoId))
      .limit(1)
    
    if (photos.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Photo not found',
      })
    }
    
    const photo = photos[0]
    
    const originalKey = resolveOriginalKeyForPhoto(photo.storageKey) || photo.storageKey

    return {
      id: photo.id,
      title: photo.title,
      isLivePhoto: Boolean(photo.isLivePhoto),
      livePhotoVideoUrl: toUrl(photo.livePhotoVideoKey),
      originalUrl: toUrl(originalKey),
      thumbnailUrl: toUrl(photo.thumbnailKey),
    }
  } catch (error) {
    logger.chrono.error('Failed to get photo details:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to get photo details',
    })
  }
})
