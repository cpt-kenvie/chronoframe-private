import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withPhotoUrls } from '~~/server/utils/photoResponse'
import { getPublicPhotoVisibilityCondition } from '~~/server/utils/photoVisibility'

export default eventHandler(async (event) => {
  const { photoId } = await getValidatedRouterParams(
    event,
    z.object({ photoId: z.string().min(1) }).parse,
  )
  const db = useDB()
  const session = await getUserSession(event)
  const visibilityCondition = session.user
    ? undefined
    : getPublicPhotoVisibilityCondition()

  const photo = db
    .select()
    .from(tables.photos)
    .where(and(eq(tables.photos.id, photoId), visibilityCondition))
    .get()

  if (!photo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Photo not found',
    })
  }

  return withPhotoUrls(photo)
})
