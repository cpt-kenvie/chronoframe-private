import z from 'zod'

export default eventHandler(async (event) => {
  await requireUserSession(event)

  const body = await readValidatedBody(
    event,
    z.object({
      title: z.string().min(1).max(255),
      description: z.string().max(1000).nullable().optional(),
      isHidden: z.boolean().optional(),
      coverPhotoId: z.string().min(1).nullable().optional(),
      photoIds: z.array(z.string()).optional(),
    }).parse,
  )

  const db = useDB()

  const album = db.transaction((tx) => {
    const newAlbum = tx
      .insert(tables.albums)
      .values({
        title: body.title,
        description: body.description ?? null,
        isHidden: body.isHidden ?? false,
        coverPhotoId: body.coverPhotoId ?? null,
      })
      .returning()
      .get()

    const albumId = newAlbum.id
    const photoIds = new Set(body.photoIds || [])

    if (body.coverPhotoId) {
      photoIds.add(body.coverPhotoId)
    }

    if (photoIds.size > 0) {
      let pos = 1000000
      for (const photoId of photoIds) {
        tx.insert(tables.albumPhotos)
          .values({
            albumId,
            photoId,
            position: (pos += 10),
          })
          .onConflictDoNothing()
          .run()
      }
    }

    return newAlbum
  })

  return album
})
