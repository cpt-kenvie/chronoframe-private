import { z } from 'zod'
import { sql } from 'drizzle-orm'

export default eventHandler(async (event) => {
  await requireUserSession(event)

  const { albumId } = await getValidatedRouterParams(
    event,
    z.object({
      albumId: z
        .string()
        .regex(/^\d+$/)
        .transform((val) => parseInt(val, 10)),
    }).parse,
  )

  const body = await readValidatedBody(
    event,
    z.object({
      photoIds: z.array(z.string()).min(1),
    }).parse,
  )

  const db = useDB()
  const photoIds = [...new Set(body.photoIds)]

  // 检查相册是否存在
  const album = await db
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

  // 检查所有照片是否存在
  const photos = await db
    .select()
    .from(tables.photos)
    .where(inArray(tables.photos.id, photoIds))
    .all()

  if (photos.length !== photoIds.length) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Some photos not found',
    })
  }

  // 使用事务添加照片到相册
  const result = db.transaction((tx) => {
    // 获取当前最大的 position 值
    const maxPosition = tx
      .select({ maxPos: sql<number>`MAX(${tables.albumPhotos.position})` })
      .from(tables.albumPhotos)
      .where(eq(tables.albumPhotos.albumId, albumId))
      .get()

    let position = maxPosition?.maxPos || 1000000
    let addedCount = 0

    // 添加照片到相册
    for (const photoId of photoIds) {
      position += 10
      const insertResult = tx
        .insert(tables.albumPhotos)
        .values({
          albumId,
          photoId,
          position,
          addedAt: new Date(),
        })
        .onConflictDoNothing()
        .run()
      addedCount += insertResult.changes
    }

    // 更新相册的 updatedAt
    tx.update(tables.albums)
      .set({ updatedAt: new Date() })
      .where(eq(tables.albums.id, albumId))
      .run()

    return { success: true, addedCount }
  })

  return result
})
