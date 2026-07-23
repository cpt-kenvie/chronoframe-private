<script lang="ts" setup>
import type { Photo } from '~~/server/utils/db'
import type { DisplayPhoto } from '~/libs/panorama/photo-variants'
import {
  findDisplayPhotoById,
  findDisplayPhotoIndexById,
  mergePanoramaPhotoVariants,
} from '~/libs/panorama/photo-variants'

definePageMeta({
  layout: 'masonry',
  // 固定 key 防止路径参数变化时创建新的实例
  key: 'photo-viewer-route',
})

const route = useRoute()
const router = useRouter()

const { switchToIndex, closeViewer, openViewer } = useViewerState()
const { isViewerOpen, albumContext } = storeToRefs(useViewerState())

const { photos, loadPhotoDetails } = usePhotos()

// 从 URL 参数获取相册 ID
const albumIdFromQuery = computed(() => route.query.album as string | undefined)

// 如果 URL 中有相册 ID，加载相册数据
const { data: albumData } = await useAsyncData(
  'photo-viewer-album-context',
  async () => {
    if (!albumIdFromQuery.value) return null
    return $fetch(`/api/albums/${albumIdFromQuery.value}`)
  },
  {
    watch: [albumIdFromQuery],
  },
)

const displayPhotos = computed(() => {
  // 优先使用 store 中的相册上下文
  if (albumContext.value?.photos) {
    return albumContext.value.photos
  }
  // 其次使用从 API 加载的相册照片
  if (albumData.value?.photos) {
    return mergePanoramaPhotoVariants(albumData.value.photos as Photo[])
  }
  // 最后使用全局照片列表
  return photos.value
})

const slug = computed(() => (route.params.slug as string[]) || [])
const photoId = computed(() => slug.value[0] || null)
const currentPhoto = computed(() => {
  if (!photoId.value) return undefined
  return findDisplayPhotoById(displayPhotos.value, photoId.value)
})

const returnRouteFromQuery = computed(() => {
  const from = route.query.from
  if (typeof from !== 'string') return null
  if (!from.startsWith('/')) return null
  return from
})

defineOgImageComponent('Photo', {
  headline: currentPhoto.value ? 'PHOTO' : 'ChronoFrame',
  title: currentPhoto.value?.title || getSetting('app:title'),
  description: currentPhoto.value
    ? currentPhoto.value.description
    : getSetting('app:title'),
  thumbnailJpegUrl:
    currentPhoto.value && currentPhoto.value.thumbnailKey
      ? `/thumb/${encodeURIComponent(currentPhoto.value.thumbnailUrl || '')}`
      : undefined,
  photo: currentPhoto.value || undefined,
})

// 处理标签查询参数
const { clearAllFilters, toggleFilter } = usePhotoFilters()

// 监听路由查询参数中的标签
watch(
  () => route.query.tag,
  (tagParam) => {
    if (tagParam && typeof tagParam === 'string' && !photoId.value) {
      clearAllFilters()
      toggleFilter('tags', tagParam)

      router.replace('/')
    }
  },
  { immediate: true },
)

// 避免循环依赖问题
let isProcessing = false

watch(
  [photoId, albumIdFromQuery, () => albumData.value?.photos, () => photos.value],
  async ([currentPhotoId, currentAlbumId, currentAlbumPhotos, allPhotos]) => {
    if (isProcessing) {
      return
    }

    if (currentPhotoId) {
      if (!currentAlbumId) {
        try {
          await loadPhotoDetails(currentPhotoId)
          // 详情请求返回前路由可能已切换，避免打开过期照片。
          if (
            photoId.value !== currentPhotoId ||
            albumIdFromQuery.value !== currentAlbumId
          ) {
            return
          }
          allPhotos = photos.value
        } catch {
          return
        }
      }

      // 确定使用哪个照片列表
      let photosToUse: DisplayPhoto[]
      if (currentAlbumId && currentAlbumPhotos) {
        photosToUse = mergePanoramaPhotoVariants(currentAlbumPhotos as Photo[])
      } else if (albumContext.value?.photos) {
        photosToUse = albumContext.value.photos
      } else {
        photosToUse = allPhotos
      }

      if (photosToUse.length > 0) {
        const foundIndex = findDisplayPhotoIndexById(photosToUse, currentPhotoId)
        if (foundIndex !== -1) {
          useHead({
            title: photosToUse[foundIndex]?.title || $t('title.fallback.photo'),
          })

          if (!isViewerOpen.value) {
            isProcessing = true

            // 如果 URL 中有相册 ID，说明是从相册页面跳转过来的
            if (currentAlbumId && currentAlbumPhotos) {
              // 从相册跳转过来，设置相册上下文和返回路由
              const albumRoute = `/albums/${currentAlbumId}`
              openViewer(foundIndex, albumRoute, {
                albumId: currentAlbumId,
                photos: photosToUse,
              })
            } else {
              // 直接访问照片详情页，不设置相册上下文
              openViewer(foundIndex, returnRouteFromQuery.value)
            }

            nextTick(() => {
              isProcessing = false
            })
          } else {
            switchToIndex(foundIndex)
          }
        }
      }
    } else {
      closeViewer()
      useHead({
        title: '',
      })
    }
  },
  { immediate: true },
)
</script>

<template>
  <div />
</template>

<style scoped></style>
