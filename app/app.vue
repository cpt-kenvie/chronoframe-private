<script setup lang="ts">
import dayjsLocale_zhCN from 'dayjs/locale/zh-cn'
import dayjsLocale_zhTW from 'dayjs/locale/zh-tw'
import dayjsLocale_zhHK from 'dayjs/locale/zh-hk'

const router = useRouter()
const dayjs = useDayjs()
const colorMode = useColorMode()
const { locale } = useI18n({ useScope: 'global' })

// 初始化设置系统 - 一次性加载所有设置
const settingsStore = useSettingsStore()
await settingsStore.initSettings()

const appTitle = useSettingRef('app:title')

colorMode.preference = useSettingRef('app:appearance.theme').value as string

useHead({
  titleTemplate: (title) =>
    `${title ? title + ' | ' : ''}${appTitle.value || 'ChronoFrame'}`,
})

// 根组件只提供照片目录状态，具体页面按需触发分页加载。
const { photos } = providePhotos()

const { switchToIndex, closeViewer, clearReturnRoute } = useViewerState()
const { currentPhotoIndex, isViewerOpen, returnRoute, isDirectAccess, albumContext } =
  storeToRefs(useViewerState())

const displayPhotos = computed(() => {
  return albumContext.value?.photos || photos.value
})

const handleIndexChange = (newIndex: number) => {
  switchToIndex(newIndex)
  const photoId = displayPhotos.value[newIndex]?.id
  if (photoId) {
    // 如果有相册上下文，保持 URL 中的相册参数
    if (albumContext.value?.albumId) {
      router.replace({
        path: `/${photoId}`,
        query: { album: albumContext.value.albumId },
      })
    } else {
      router.replace(`/${photoId}`)
    }
  }
}

const handleClose = () => {
  closeViewer()

  // 如果是直接访问详情页面，关闭时返回首页
  if (isDirectAccess.value) {
    isDirectAccess.value = false
    router.replace('/')
  } else if (returnRoute.value) {
    // 如果有指定的返回路由，返回到该路由
    const destination = returnRoute.value
    clearReturnRoute()
    router.replace(destination)
  } else {
    // 否则使用历史记录或默认返回首页
    if (window.history.length > 1) {
      router.back()
    } else {
      router.replace('/')
    }
  }
}

watchEffect(() => {
  dayjs.locale('zh-Hans', dayjsLocale_zhCN)
  dayjs.locale('zh-Hant-TW', dayjsLocale_zhTW)
  dayjs.locale('zh-Hant-HK', dayjsLocale_zhHK)
  dayjs.locale(locale.value)
})

// 在全局级别提供筛选功能的状态管理
provide(
  'photosFiltering',
  reactive({
    activeFilters: {
      tags: [],
      cameras: [],
      lenses: [],
      cities: [],
      ratings: [],
    },
  }),
)
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <ClientOnly>
      <PhotoViewer
        :photos="displayPhotos"
        :current-index="currentPhotoIndex"
        :is-open="isViewerOpen"
        @close="handleClose"
        @index-change="handleIndexChange"
      />
    </ClientOnly>
  </UApp>
</template>

<style></style>
