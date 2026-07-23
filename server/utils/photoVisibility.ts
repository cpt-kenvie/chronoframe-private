import { and, eq, notExists, sql } from 'drizzle-orm'

/**
 * 构建匿名访问时的照片可见性条件。
 * 只要照片属于任意隐藏相册，就不会出现在公开查询中。
 */
export const getPublicPhotoVisibilityCondition = () => {
  const db = useDB()

  return notExists(
    db
      .select({ value: sql<number>`1` })
      .from(tables.albumPhotos)
      .innerJoin(
        tables.albums,
        eq(tables.albumPhotos.albumId, tables.albums.id),
      )
      .where(
        and(
          eq(tables.albumPhotos.photoId, tables.photos.id),
          eq(tables.albums.isHidden, true),
        ),
      ),
  )
}
