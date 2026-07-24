import { computed, readonly, ref } from 'vue'

// 浏览器读取视频元数据的最长等待时间，包含服务端首次转码所需时间。
const LIVE_PHOTO_PREPARE_TIMEOUT_MS = 2 * 60 * 1000
// 状态缓存只保存轻量 URL 和错误信息，限制条目数以避免长时间浏览持续增长。
const MAX_LIVE_PHOTO_STATE_ENTRIES = 200

interface LivePhotoProcessingState {
  isProcessing: boolean
  progress: number
  videoUrl: string | null
  error: string | null
  lastAccessed: number
}

interface LivePhotoCandidate {
  id: string
  livePhotoVideoUrl?: string | null
  isVisible?: boolean
}

interface PreparedLivePhotoCandidate extends LivePhotoCandidate {
  livePhotoVideoUrl: string
}

const processedLivePhotos = ref(
  new Map<string, LivePhotoProcessingState>(),
)
const pendingPreparations = new Map<string, Promise<string | null>>()

const trimStateCache = () => {
  const overflow = processedLivePhotos.value.size - MAX_LIVE_PHOTO_STATE_ENTRIES
  if (overflow <= 0) return

  const oldestPhotoIds = [...processedLivePhotos.value.entries()]
    .filter(([photoId]) => !pendingPreparations.has(photoId))
    .sort((left, right) => left[1].lastAccessed - right[1].lastAccessed)
    .slice(0, overflow)
    .map(([photoId]) => photoId)

  oldestPhotoIds.forEach((photoId) => {
    processedLivePhotos.value.delete(photoId)
  })
}

const validateVideoUrl = async (videoUrl: string): Promise<void> => {
  if (typeof document === 'undefined') {
    throw new Error('Live Photo video can only be prepared in the browser')
  }

  await new Promise<void>((resolve, reject) => {
    const video = document.createElement('video')
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Live Photo video preparation timed out'))
    }, LIVE_PHOTO_PREPARE_TIMEOUT_MS)

    const cleanup = () => {
      window.clearTimeout(timeout)
      video.onloadedmetadata = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
    }

    video.onloadedmetadata = () => {
      cleanup()
      resolve()
    }
    video.onerror = () => {
      cleanup()
      reject(new Error('Live Photo video format is not supported'))
    }
    video.preload = 'metadata'
    video.src = videoUrl
    video.load()
  })
}

export const useLivePhotoProcessor = () => {
  /**
   * 准备可直接播放的 URL。MOV 会由文件代理在服务端使用 FFmpeg 真正转码为 MP4。
   */
  const prepareLivePhotoVideo = async (
    videoUrl: string,
    photoId: string,
  ): Promise<string | null> => {
    const existing = processedLivePhotos.value.get(photoId)
    if (existing?.videoUrl === videoUrl && !existing.error) {
      existing.lastAccessed = Date.now()
      return videoUrl
    }

    const pending = pendingPreparations.get(photoId)
    if (pending) return await pending

    const state: LivePhotoProcessingState = {
      isProcessing: true,
      progress: 10,
      videoUrl: null,
      error: null,
      lastAccessed: Date.now(),
    }
    processedLivePhotos.value.set(photoId, state)

    const preparation = (async () => {
      try {
        await validateVideoUrl(videoUrl)
        processedLivePhotos.value.set(photoId, {
          isProcessing: false,
          progress: 100,
          videoUrl,
          error: null,
          lastAccessed: Date.now(),
        })
        return videoUrl
      } catch (error) {
        processedLivePhotos.value.set(photoId, {
          isProcessing: false,
          progress: 0,
          videoUrl: null,
          error: error instanceof Error ? error.message : String(error),
          lastAccessed: Date.now(),
        })
        return null
      } finally {
        pendingPreparations.delete(photoId)
        trimStateCache()
      }
    })()

    pendingPreparations.set(photoId, preparation)
    return await preparation
  }

  const getProcessingState = (photoId: string) =>
    computed(() => processedLivePhotos.value.get(photoId) ?? null)

  const processPhotoBatch = async (
    photos: PreparedLivePhotoCandidate[],
    maxConcurrent: number,
  ) => {
    for (let index = 0; index < photos.length; index += maxConcurrent) {
      const batch = photos.slice(index, index + maxConcurrent)
      await Promise.allSettled(
        batch.map((photo) =>
          prepareLivePhotoVideo(photo.livePhotoVideoUrl, photo.id),
        ),
      )
    }
  }

  const preloadLivePhotosInViewport = async (
    photos: LivePhotoCandidate[],
    options: { maxConcurrent?: number; prioritizeVisible?: boolean } = {},
  ) => {
    const { maxConcurrent = 2, prioritizeVisible = true } = options
    const candidates = photos.flatMap((photo): PreparedLivePhotoCandidate[] =>
      photo.livePhotoVideoUrl
        ? [{ ...photo, livePhotoVideoUrl: photo.livePhotoVideoUrl }]
        : [],
    )
    const sortedCandidates = prioritizeVisible
      ? [...candidates].sort(
          (left, right) => Number(Boolean(right.isVisible)) - Number(Boolean(left.isVisible)),
        )
      : candidates

    await processPhotoBatch(sortedCandidates, Math.max(1, maxConcurrent))
  }

  const batchProcessLivePhotos = async (photos: LivePhotoCandidate[]) => {
    await preloadLivePhotosInViewport(photos, { maxConcurrent: 3 })
  }

  const cleanupExpiredCache = () => {
    trimStateCache()
  }

  const getCacheStats = () => {
    const states = [...processedLivePhotos.value.values()]
    return {
      total: states.length,
      processed: states.filter((state) => Boolean(state.videoUrl)).length,
      processing: states.filter((state) => state.isProcessing).length,
      failed: states.filter((state) => Boolean(state.error)).length,
      totalSizeMB: 0,
    }
  }

  const clearProcessedCache = () => {
    processedLivePhotos.value.clear()
  }

  return {
    prepareLivePhotoVideo,
    getProcessingState,
    batchProcessLivePhotos,
    preloadLivePhotosInViewport,
    cleanupExpiredCache,
    getCacheStats,
    clearProcessedCache,
    processedLivePhotos: readonly(processedLivePhotos),
  }
}
