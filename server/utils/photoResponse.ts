import { sql } from 'drizzle-orm'
import type { NeededExif } from '~~/shared/types/photo'
import type { Photo } from './db'
import { resolveOriginalKeyForPhoto, toFileProxyUrl } from './publicFile'

type DirectPhotoListColumn = Exclude<
  keyof Photo,
  | 'originalUrl'
  | 'thumbnailUrl'
  | 'livePhotoVideoUrl'
  | 'exif'
  | 'videoCodec'
  | 'audioCodec'
  | 'bitrate'
  | 'frameRate'
>

export type PhotoListRow = Pick<Photo, DirectPhotoListColumn> & {
  exifImageDescription: string | null
  exifMake: string | null
  exifModel: string | null
  exifLensMake: string | null
  exifLensModel: string | null
  exifRating: number | null
  exifColorSpace: string | null
  exifDateTimeOriginal: string | null
  exifExposureTime: string | number | null
  exifFNumber: number | null
  exifISO: number | null
  exifFocalLengthIn35mmFormat: string | number | null
  exifGPSLatitude: string | number | null
  exifGPSLongitude: string | number | null
  exifGPSLatitudeRef: string | null
  exifGPSLongitudeRef: string | null
  exifGPSAltitude: string | number | null
  exifGPSAltitudeRef: string | null
  exifPanoramaDetected: number | null
  exifGPanoUsePanoramaViewer: number | null
  exifGPanoProjectionType: string | null
  exifGPanoFullPanoWidthPixels: number | null
  exifGPanoFullPanoHeightPixels: number | null
}

/** 照片目录使用的轻量字段，避免随列表传输完整 EXIF。 */
export const photoListSelection = {
  id: tables.photos.id,
  title: tables.photos.title,
  description: tables.photos.description,
  width: tables.photos.width,
  height: tables.photos.height,
  aspectRatio: tables.photos.aspectRatio,
  dateTaken: tables.photos.dateTaken,
  storageKey: tables.photos.storageKey,
  thumbnailKey: tables.photos.thumbnailKey,
  fileSize: tables.photos.fileSize,
  lastModified: tables.photos.lastModified,
  thumbnailHash: tables.photos.thumbnailHash,
  tags: tables.photos.tags,
  latitude: tables.photos.latitude,
  longitude: tables.photos.longitude,
  country: tables.photos.country,
  city: tables.photos.city,
  locationName: tables.photos.locationName,
  isLivePhoto: tables.photos.isLivePhoto,
  livePhotoVideoKey: tables.photos.livePhotoVideoKey,
  isPanorama360: tables.photos.isPanorama360,
  isVideo: tables.photos.isVideo,
  duration: tables.photos.duration,
  exifImageDescription: sql<string | null>`json_extract(${tables.photos.exif}, '$.ImageDescription')`,
  exifMake: sql<string | null>`json_extract(${tables.photos.exif}, '$.Make')`,
  exifModel: sql<string | null>`json_extract(${tables.photos.exif}, '$.Model')`,
  exifLensMake: sql<string | null>`json_extract(${tables.photos.exif}, '$.LensMake')`,
  exifLensModel: sql<string | null>`json_extract(${tables.photos.exif}, '$.LensModel')`,
  exifRating: sql<number | null>`json_extract(${tables.photos.exif}, '$.Rating')`,
  exifColorSpace: sql<string | null>`json_extract(${tables.photos.exif}, '$.ColorSpace')`,
  exifDateTimeOriginal: sql<string | null>`json_extract(${tables.photos.exif}, '$.DateTimeOriginal')`,
  exifExposureTime: sql<string | number | null>`json_extract(${tables.photos.exif}, '$.ExposureTime')`,
  exifFNumber: sql<number | null>`json_extract(${tables.photos.exif}, '$.FNumber')`,
  exifISO: sql<number | null>`json_extract(${tables.photos.exif}, '$.ISO')`,
  exifFocalLengthIn35mmFormat: sql<string | number | null>`json_extract(${tables.photos.exif}, '$.FocalLengthIn35mmFormat')`,
  exifGPSLatitude: sql<string | number | null>`json_extract(${tables.photos.exif}, '$.GPSLatitude')`,
  exifGPSLongitude: sql<string | number | null>`json_extract(${tables.photos.exif}, '$.GPSLongitude')`,
  exifGPSLatitudeRef: sql<string | null>`json_extract(${tables.photos.exif}, '$.GPSLatitudeRef')`,
  exifGPSLongitudeRef: sql<string | null>`json_extract(${tables.photos.exif}, '$.GPSLongitudeRef')`,
  exifGPSAltitude: sql<string | number | null>`json_extract(${tables.photos.exif}, '$.GPSAltitude')`,
  exifGPSAltitudeRef: sql<string | null>`json_extract(${tables.photos.exif}, '$.GPSAltitudeRef')`,
  exifPanoramaDetected: sql<number | null>`json_extract(${tables.photos.exif}, '$.PanoramaDetected')`,
  exifGPanoUsePanoramaViewer: sql<number | null>`json_extract(${tables.photos.exif}, '$.GPanoUsePanoramaViewer')`,
  exifGPanoProjectionType: sql<string | null>`json_extract(${tables.photos.exif}, '$.GPanoProjectionType')`,
  exifGPanoFullPanoWidthPixels: sql<number | null>`json_extract(${tables.photos.exif}, '$.GPanoFullPanoWidthPixels')`,
  exifGPanoFullPanoHeightPixels: sql<number | null>`json_extract(${tables.photos.exif}, '$.GPanoFullPanoHeightPixels')`,
}

const compactExif = (row: PhotoListRow): NeededExif | null => {
  const exif: NeededExif = {
    ImageDescription: row.exifImageDescription ?? undefined,
    Make: row.exifMake ?? undefined,
    Model: row.exifModel ?? undefined,
    LensMake: row.exifLensMake ?? undefined,
    LensModel: row.exifLensModel ?? undefined,
    Rating: row.exifRating ?? undefined,
    ColorSpace: row.exifColorSpace ?? undefined,
    DateTimeOriginal: row.exifDateTimeOriginal ?? undefined,
    ExposureTime: row.exifExposureTime ?? undefined,
    FNumber: row.exifFNumber ?? undefined,
    ISO: row.exifISO ?? undefined,
    FocalLengthIn35mmFormat:
      row.exifFocalLengthIn35mmFormat === null
        ? undefined
        : String(row.exifFocalLengthIn35mmFormat),
    GPSLatitude: row.exifGPSLatitude ?? undefined,
    GPSLongitude: row.exifGPSLongitude ?? undefined,
    GPSLatitudeRef: row.exifGPSLatitudeRef ?? undefined,
    GPSLongitudeRef: row.exifGPSLongitudeRef ?? undefined,
    GPSAltitude:
      row.exifGPSAltitude === null
        ? undefined
        : Number(row.exifGPSAltitude),
    GPSAltitudeRef: row.exifGPSAltitudeRef ?? undefined,
    PanoramaDetected:
      row.exifPanoramaDetected === null
        ? undefined
        : Boolean(row.exifPanoramaDetected),
    GPanoUsePanoramaViewer:
      row.exifGPanoUsePanoramaViewer === null
        ? undefined
        : Boolean(row.exifGPanoUsePanoramaViewer),
    GPanoProjectionType: row.exifGPanoProjectionType ?? undefined,
    GPanoFullPanoWidthPixels:
      row.exifGPanoFullPanoWidthPixels ?? undefined,
    GPanoFullPanoHeightPixels:
      row.exifGPanoFullPanoHeightPixels ?? undefined,
  }

  return Object.values(exif).some((value) => value !== undefined) ? exif : null
}

/** 将轻量查询结果转换成现有前端兼容的照片结构。 */
export const toPhotoListItem = (row: PhotoListRow): Photo => {
  const {
    exifImageDescription: _exifImageDescription,
    exifMake: _exifMake,
    exifModel: _exifModel,
    exifLensMake: _exifLensMake,
    exifLensModel: _exifLensModel,
    exifRating: _exifRating,
    exifColorSpace: _exifColorSpace,
    exifDateTimeOriginal: _exifDateTimeOriginal,
    exifExposureTime: _exifExposureTime,
    exifFNumber: _exifFNumber,
    exifISO: _exifISO,
    exifFocalLengthIn35mmFormat: _exifFocalLengthIn35mmFormat,
    exifGPSLatitude: _exifGPSLatitude,
    exifGPSLongitude: _exifGPSLongitude,
    exifGPSLatitudeRef: _exifGPSLatitudeRef,
    exifGPSLongitudeRef: _exifGPSLongitudeRef,
    exifGPSAltitude: _exifGPSAltitude,
    exifGPSAltitudeRef: _exifGPSAltitudeRef,
    exifPanoramaDetected: _exifPanoramaDetected,
    exifGPanoUsePanoramaViewer: _exifGPanoUsePanoramaViewer,
    exifGPanoProjectionType: _exifGPanoProjectionType,
    exifGPanoFullPanoWidthPixels: _exifGPanoFullPanoWidthPixels,
    exifGPanoFullPanoHeightPixels: _exifGPanoFullPanoHeightPixels,
    ...photo
  } = row
  const originalKey =
    resolveOriginalKeyForPhoto(photo.storageKey) || photo.storageKey

  return {
    ...photo,
    originalUrl: originalKey ? toFileProxyUrl(originalKey) : null,
    thumbnailUrl: photo.thumbnailKey
      ? toFileProxyUrl(photo.thumbnailKey)
      : null,
    livePhotoVideoUrl: photo.livePhotoVideoKey
      ? toFileProxyUrl(photo.livePhotoVideoKey)
      : null,
    exif: compactExif(row),
    videoCodec: null,
    audioCodec: null,
    bitrate: null,
    frameRate: null,
  }
}

/** 为完整照片详情补充当前存储代理 URL。 */
export const withPhotoUrls = (photo: Photo): Photo => {
  const originalKey =
    resolveOriginalKeyForPhoto(photo.storageKey) || photo.storageKey

  return {
    ...photo,
    originalUrl: originalKey ? toFileProxyUrl(originalKey) : null,
    thumbnailUrl: photo.thumbnailKey
      ? toFileProxyUrl(photo.thumbnailKey)
      : null,
    livePhotoVideoUrl: photo.livePhotoVideoKey
      ? toFileProxyUrl(photo.livePhotoVideoKey)
      : null,
  }
}
