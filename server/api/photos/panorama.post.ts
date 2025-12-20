import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { generateSafePhotoId } from '~~/server/utils/file-utils'
import { useStorageProvider } from '~~/server/utils/useStorageProvider'
import { isStorageEncryptionEnabled, toFileProxyUrl } from '~~/server/utils/publicFile'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)

  const { storageKey, thumbnailKey, thumbnailHash, width, height, fileSize, lastModified, title, albumId } =
    await readValidatedBody(
      event,
      z
        .object({
          storageKey: z.string().min(1),
          thumbnailKey: z.string().min(1),
          thumbnailHash: z.string().min(1).optional(),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          fileSize: z.number().int().positive().optional(),
          lastModified: z.string().min(1).optional(),
          title: z.string().min(1).optional(),
          albumId: z.number().int().positive().optional(),
        })
        .parse,
    )

  const photoId = generateSafePhotoId(storageKey)
  const { storageProvider } = useStorageProvider(event)
  const encryptionEnabled = await isStorageEncryptionEnabled()
  const toUrl = (key?: string | null) => {
    if (!key) return null
    return encryptionEnabled ? toFileProxyUrl(key) : storageProvider.getPublicUrl(key)
  }

  const nowIso = new Date().toISOString()
  const tags: string[] = []
  const record = {
    id: photoId,
    title: title ?? photoId,
    description: null,
    width,
    height,
    aspectRatio: width / height,
    dateTaken: null,
    storageKey,
    thumbnailKey,
    fileSize: fileSize ?? null,
    lastModified: lastModified ?? nowIso,
    originalUrl: toUrl(storageKey),
    thumbnailUrl: toUrl(thumbnailKey),
    thumbnailHash: thumbnailHash ?? null,
    tags,
    exif: null,
    latitude: null,
    longitude: null,
    country: null,
    city: null,
    locationName: null,
    isLivePhoto: 0,
    livePhotoVideoUrl: null,
    livePhotoVideoKey: null,
    isPanorama360: 1,
    isVideo: 0,
    duration: null,
    videoCodec: null,
    audioCodec: null,
    bitrate: null,
    frameRate: null,
  } satisfies typeof tables.photos.$inferInsert

  const db = useDB()
  await db.insert(tables.photos).values(record).onConflictDoUpdate({
    target: tables.photos.id,
    set: record,
  })

  if (albumId) {
    const album = await db
      .select()
      .from(tables.albums)
      .where(eq(tables.albums.id, albumId))
      .get()

    if (album) {
      const existing = await db
        .select()
        .from(tables.albumPhotos)
        .where(sql`${tables.albumPhotos.albumId} = ${albumId} AND ${tables.albumPhotos.photoId} = ${photoId}`)
        .get()

      if (!existing) {
        await db
          .insert(tables.albumPhotos)
          .values({ albumId, photoId })
          .run()
      }
    }
  }

  return {
    success: true,
    photoId,
  }
})
