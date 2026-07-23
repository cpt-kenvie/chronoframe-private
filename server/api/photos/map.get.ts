import { and, isNotNull, sql } from 'drizzle-orm'
import type { NeededExif } from '~~/shared/types/photo'
import type { PhotoMarker } from '~~/shared/types/map'
import { toFileProxyUrl } from '~~/server/utils/publicFile'
import { getPublicPhotoVisibilityCondition } from '~~/server/utils/photoVisibility'

const mapPhotoSelection = {
  id: tables.photos.id,
  latitude: tables.photos.latitude,
  longitude: tables.photos.longitude,
  title: tables.photos.title,
  thumbnailKey: tables.photos.thumbnailKey,
  thumbnailHash: tables.photos.thumbnailHash,
  dateTaken: tables.photos.dateTaken,
  city: tables.photos.city,
  exifMake: sql<string | null>`json_extract(${tables.photos.exif}, '$.Make')`,
  exifModel: sql<string | null>`json_extract(${tables.photos.exif}, '$.Model')`,
  exifDateTimeOriginal: sql<string | null>`json_extract(${tables.photos.exif}, '$.DateTimeOriginal')`,
  exifGPSLatitude: sql<string | number | null>`json_extract(${tables.photos.exif}, '$.GPSLatitude')`,
  exifGPSLongitude: sql<string | number | null>`json_extract(${tables.photos.exif}, '$.GPSLongitude')`,
  exifGPSLatitudeRef: sql<string | null>`json_extract(${tables.photos.exif}, '$.GPSLatitudeRef')`,
  exifGPSLongitudeRef: sql<string | null>`json_extract(${tables.photos.exif}, '$.GPSLongitudeRef')`,
  exifGPSAltitude: sql<string | number | null>`json_extract(${tables.photos.exif}, '$.GPSAltitude')`,
  exifGPSAltitudeRef: sql<string | null>`json_extract(${tables.photos.exif}, '$.GPSAltitudeRef')`,
}

export default eventHandler(async (event) => {
  const db = useDB()
  const session = await getUserSession(event)
  const visibilityCondition = session.user
    ? undefined
    : getPublicPhotoVisibilityCondition()

  const rows = db
    .select(mapPhotoSelection)
    .from(tables.photos)
    .where(
      and(
        isNotNull(tables.photos.latitude),
        isNotNull(tables.photos.longitude),
        visibilityCondition,
      ),
    )
    .all()

  return rows.map((row): PhotoMarker => {
    const exif: NeededExif = {
      Make: row.exifMake ?? undefined,
      Model: row.exifModel ?? undefined,
      DateTimeOriginal: row.exifDateTimeOriginal ?? undefined,
      GPSLatitude: row.exifGPSLatitude ?? undefined,
      GPSLongitude: row.exifGPSLongitude ?? undefined,
      GPSLatitudeRef: row.exifGPSLatitudeRef ?? undefined,
      GPSLongitudeRef: row.exifGPSLongitudeRef ?? undefined,
      GPSAltitude:
        row.exifGPSAltitude === null
          ? undefined
          : Number(row.exifGPSAltitude),
      GPSAltitudeRef: row.exifGPSAltitudeRef ?? undefined,
    }

    return {
      id: row.id,
      latitude: row.latitude!,
      longitude: row.longitude!,
      title: row.title ?? undefined,
      thumbnailUrl: row.thumbnailKey
        ? toFileProxyUrl(row.thumbnailKey)
        : undefined,
      thumbnailHash: row.thumbnailHash ?? undefined,
      dateTaken: row.dateTaken ?? undefined,
      city: row.city ?? undefined,
      exif: Object.values(exif).some((value) => value !== undefined)
        ? exif
        : undefined,
    }
  })
})
