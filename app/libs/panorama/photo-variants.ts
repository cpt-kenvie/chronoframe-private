import type { Photo } from '~~/server/utils/db'
import { getPanoramaFormatFromStorageKey } from './format'

export type DisplayPhoto = Photo & {
  panoramaVariants?: Photo[]
}

const stripStorageKeyExt = (storageKey: string): string => {
  const idx = storageKey.lastIndexOf('.')
  if (idx === -1) return storageKey
  return storageKey.slice(0, idx)
}

export const mergePanoramaPhotoVariants = (photos: Photo[]): DisplayPhoto[] => {
  const merged: DisplayPhoto[] = []
  const groupIndexByKey = new Map<string, number>()
  const groupPhotosByKey = new Map<string, Photo[]>()

  for (const photo of photos) {
    const storageKey = photo.storageKey
    const panoramaFormat = getPanoramaFormatFromStorageKey(storageKey)
    if (!storageKey || !panoramaFormat) {
      merged.push(photo)
      continue
    }

    const key = stripStorageKeyExt(storageKey)
    const existingIndex = groupIndexByKey.get(key)
    if (existingIndex === undefined) {
      groupIndexByKey.set(key, merged.length)
      groupPhotosByKey.set(key, [photo])
      merged.push(photo)
      continue
    }

    groupPhotosByKey.get(key)?.push(photo)
  }

  for (const [key, groupPhotos] of groupPhotosByKey) {
    if (groupPhotos.length < 2) continue
    const index = groupIndexByKey.get(key)
    if (index === undefined) continue
    const primaryPhoto = groupPhotos[0]
    if (!primaryPhoto) continue
    merged[index] = {
      ...primaryPhoto,
      panoramaVariants: groupPhotos.slice(1),
    }
  }

  return merged
}

export const photoMatchesId = (photo: DisplayPhoto, id: string): boolean => {
  if (photo.id === id) return true
  return photo.panoramaVariants?.some((p) => p.id === id) ?? false
}

export const findDisplayPhotoById = (
  photos: DisplayPhoto[],
  id: string,
): DisplayPhoto | undefined => {
  return photos.find((photo) => photoMatchesId(photo, id))
}

export const findDisplayPhotoIndexById = (
  photos: DisplayPhoto[],
  id: string,
): number => {
  return photos.findIndex((photo) => photoMatchesId(photo, id))
}

