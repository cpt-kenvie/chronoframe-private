import type { AsyncDataRequestStatus } from '#app'
import type { Album, Photo } from '~~/server/utils/db'

const ALBUMS_DATA_KEY = 'albums' // Nuxt async data key shared by every album list consumer.

export interface AlbumListItem extends Album {
  photoIds: string[]
  previewPhotos: Photo[]
}

interface AlbumsContext {
  data: Ref<AlbumListItem[]>
  status: Ref<AsyncDataRequestStatus>
  refresh: () => Promise<void>
}

export function useAlbums(): AlbumsContext {
  const { data, status, refresh } = useFetch<AlbumListItem[]>('/api/albums', {
    key: ALBUMS_DATA_KEY,
    default: () => [],
  })

  return {
    data,
    status,
    refresh,
  }
}

export async function refreshAlbumsData(): Promise<void> {
  await refreshNuxtData(ALBUMS_DATA_KEY)
}
