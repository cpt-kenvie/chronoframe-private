import type { AsyncDataRequestStatus } from '#app'
import type { Photo } from '~~/server/utils/db'
import type { DisplayPhoto } from '~/libs/panorama/photo-variants'
import {
  findDisplayPhotoById,
  mergePanoramaPhotoVariants,
} from '~/libs/panorama/photo-variants'

// 照片目录每次加载数量，需与服务端默认分页大小保持一致。
const PHOTO_PAGE_SIZE = 60

interface PhotoPageResponse {
  items: Photo[]
  total: number | null
  nextCursor: string | null
}

interface PhotosContext {
  photos: ComputedRef<DisplayPhoto[]>
  status: Ref<AsyncDataRequestStatus>
  refresh: () => Promise<void>
  ensureLoaded: () => Promise<void>
  loadMore: () => Promise<void>
  loadPhotoDetails: (id: string) => Promise<Photo>
  getPhotoById: (id: string) => DisplayPhoto | undefined
  filterPhotos: (predicate: (photo: DisplayPhoto) => boolean) => DisplayPhoto[]
  totalCount: Readonly<Ref<number>>
  loadedCount: ComputedRef<number>
  hasMore: ComputedRef<boolean>
}

const PhotosContextKey = Symbol('PhotosContext') as InjectionKey<PhotosContext>

const sortPhotos = (photos: Photo[]): Photo[] => {
  return photos.toSorted((a, b) => {
    if (a.dateTaken && b.dateTaken) {
      const dateComparison = b.dateTaken.localeCompare(a.dateTaken)
      if (dateComparison !== 0) return dateComparison
    } else if (a.dateTaken) {
      return -1
    } else if (b.dateTaken) {
      return 1
    }

    return b.id.localeCompare(a.id)
  })
}

export function providePhotos(): PhotosContext {
  const { loggedIn } = useUserSession()
  const rawPhotos = useState<Photo[]>('photos:items', () => [])
  const nextCursor = useState<string | null>('photos:next-cursor', () => null)
  const totalCount = useState<number>('photos:total-count', () => 0)
  const initialized = useState<boolean>('photos:initialized', () => false)
  const accessScope = useState<'public' | 'authenticated' | null>(
    'photos:access-scope',
    () => null,
  )
  const detailedPhotoIds = useState<string[]>(
    'photos:detailed-photo-ids',
    () => [],
  )
  const status = ref<AsyncDataRequestStatus>(
    initialized.value ? 'success' : 'idle',
  )
  const detailRequests = new Map<string, Promise<Photo>>()
  let pageRequest: Promise<void> | null = null

  const photos = computed(() => mergePanoramaPhotoVariants(rawPhotos.value))
  const loadedCount = computed(() => rawPhotos.value.length)
  const hasMore = computed(() => nextCursor.value !== null)

  const fetchPage = async (reset: boolean): Promise<void> => {
    if (pageRequest) {
      await pageRequest
      if (reset) return fetchPage(true)
      return
    }

    pageRequest = (async () => {
      status.value = 'pending'
      try {
        const response = await $fetch<PhotoPageResponse>('/api/photos', {
          query: {
            limit: PHOTO_PAGE_SIZE,
            ...(!reset && nextCursor.value
              ? { cursor: nextCursor.value }
              : {}),
          },
        })

        if (reset) {
          rawPhotos.value = response.items
          detailedPhotoIds.value = []
        } else {
          const photosById = new Map(
            rawPhotos.value.map((photo) => [photo.id, photo]),
          )
          for (const photo of response.items) {
            photosById.set(photo.id, photo)
          }
          rawPhotos.value = Array.from(photosById.values())
        }

        if (response.total !== null) totalCount.value = response.total
        nextCursor.value = response.nextCursor
        accessScope.value = loggedIn.value ? 'authenticated' : 'public'
        initialized.value = true
        status.value = 'success'
      } catch (error) {
        status.value = 'error'
        throw error
      }
    })().finally(() => {
      pageRequest = null
    })

    await pageRequest
  }

  const refresh = () => fetchPage(true)

  const ensureLoaded = async () => {
    const currentScope = loggedIn.value ? 'authenticated' : 'public'
    if (initialized.value && accessScope.value === currentScope) return
    await refresh()
  }

  const loadMore = async () => {
    if (!initialized.value) {
      await ensureLoaded()
      return
    }
    if (!nextCursor.value) return
    await fetchPage(false)
  }

  const loadPhotoDetails = async (id: string): Promise<Photo> => {
    const existing = rawPhotos.value.find((photo) => photo.id === id)
    if (existing && detailedPhotoIds.value.includes(id)) return existing

    const pendingRequest = detailRequests.get(id)
    if (pendingRequest) return pendingRequest

    const request = $fetch<Photo>(`/api/photos/${encodeURIComponent(id)}`)
      .then((photo) => {
        const photoIndex = rawPhotos.value.findIndex((item) => item.id === id)
        if (photoIndex === -1) {
          rawPhotos.value = sortPhotos([...rawPhotos.value, photo])
        } else {
          rawPhotos.value = rawPhotos.value.with(photoIndex, photo)
        }
        if (!detailedPhotoIds.value.includes(id)) {
          detailedPhotoIds.value = [...detailedPhotoIds.value, id]
        }
        return photo
      })
      .finally(() => {
        detailRequests.delete(id)
      })

    detailRequests.set(id, request)
    return request
  }

  const context: PhotosContext = {
    photos,
    status,
    refresh,
    ensureLoaded,
    loadMore,
    loadPhotoDetails,
    getPhotoById: (id: string) => findDisplayPhotoById(photos.value, id),
    filterPhotos: (predicate: (photo: DisplayPhoto) => boolean) => {
      return photos.value.filter(predicate)
    },
    totalCount: readonly(totalCount),
    loadedCount,
    hasMore,
  }

  provide(PhotosContextKey, context)
  return context
}

export function usePhotos(): PhotosContext {
  const context = inject(PhotosContextKey)

  if (!context) {
    throw new Error('usePhotos must be used within a photos provider')
  }

  return context
}
