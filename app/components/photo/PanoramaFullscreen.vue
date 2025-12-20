<script setup lang="ts">
import type { LoadingIndicatorRef } from './LoadingIndicator.vue'
import PanoramaViewer from './PanoramaViewer.vue'
import PanoramaImageViewer from './PanoramaImageViewer.vue'
import { getPanoramaFormatFromStorageKey } from '~/libs/panorama/format'
import type { PanoramaFormat } from '~/libs/panorama/types'
import type { DisplayPhoto } from '~/libs/panorama/photo-variants'
import type { Photo } from '~~/server/utils/db'

const props = defineProps<{
  photo: DisplayPhoto
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const isLoading = ref(false)
const loadingBridge: LoadingIndicatorRef = {
  updateLoadingState: (state) => {
    if (state.isVisible === false) isLoading.value = false
    else if (state.isVisible === true) isLoading.value = true
    if (state.isError) isLoading.value = false
  },
  resetLoadingState: () => {
    isLoading.value = false
  },
}

const panoramaFormat = computed(() => {
  return getPanoramaFormatFromStorageKey(props.photo.storageKey)
})

const isPanorama360 = computed(() => {
  return props.photo.isPanorama360 === 1
})

const sourcesByFormat = computed(() => {
  const sources = new Map<PanoramaFormat, Photo>()
  const photos: Photo[] = [props.photo, ...(props.photo.panoramaVariants ?? [])]
  for (const photo of photos) {
    const format = getPanoramaFormatFromStorageKey(photo.storageKey)
    if (!format || sources.has(format)) continue
    sources.set(format, photo)
  }
  return sources
})

const availableFormats = computed(() => {
  const formats: PanoramaFormat[] = []
  if (sourcesByFormat.value.has('hdr')) formats.push('hdr')
  if (sourcesByFormat.value.has('exr')) formats.push('exr')
  return formats
})

const selectedFormat = ref<PanoramaFormat | null>(null)

watchEffect(() => {
  if (!panoramaFormat.value) return
  if (selectedFormat.value === null) {
    selectedFormat.value = panoramaFormat.value
    return
  }
  if (!sourcesByFormat.value.has(selectedFormat.value)) {
    selectedFormat.value = panoramaFormat.value
  }
})

const activeFormat = computed(() => {
  return selectedFormat.value ?? panoramaFormat.value
})

const activeFormatNonNull = computed<PanoramaFormat>(() => {
  return activeFormat.value ?? panoramaFormat.value!
})

const activePhoto = computed(() => {
  return sourcesByFormat.value.get(activeFormatNonNull.value) ?? props.photo
})

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (typeof window === 'undefined') return
    if (open) {
      window.addEventListener('keydown', onKeyDown)
      isLoading.value = true
    } else {
      window.removeEventListener('keydown', onKeyDown)
      isLoading.value = false
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && (panoramaFormat || isPanorama360)"
      class="fixed inset-0 z-[9999] bg-black"
    >
      <div class="relative w-full h-full">
        <PanoramaViewer
          v-if="panoramaFormat"
          :src="activePhoto.originalUrl || ''"
          :format="activeFormatNonNull"
          :thumbnail-src="activePhoto.thumbnailUrl || ''"
          :thumbhash="activePhoto.thumbnailHash"
          :alt="activePhoto.title || activePhoto.id"
          :is-current-image="true"
          :loading-indicator-ref="loadingBridge"
        />

        <PanoramaImageViewer
          v-else
          :src="props.photo.originalUrl || ''"
          :thumbnail-src="props.photo.thumbnailUrl || ''"
          :thumbhash="props.photo.thumbnailHash"
          :alt="props.photo.title || props.photo.id"
          :is-current-image="true"
          :loading-indicator-ref="loadingBridge"
        />

        <div
          v-if="isLoading"
          class="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <Icon
            name="tabler:loader-2"
            class="w-10 h-10 text-white animate-spin"
          />
        </div>

        <div class="absolute top-3 right-3 z-[10000]">
          <UButton
            variant="soft"
            color="neutral"
            icon="tabler:x"
            @click="emit('close')"
          />
        </div>

        <div
          v-if="availableFormats.length > 1"
          class="absolute bottom-3 right-3 z-[10000]"
        >
          <div class="bg-black/40 backdrop-blur-xl rounded-lg border border-white/10 p-1 flex items-center gap-1">
            <UButton
              v-for="format in availableFormats"
              :key="format"
              size="xs"
              color="neutral"
              :variant="activeFormatNonNull === format ? 'soft' : 'ghost'"
              @click.stop="selectedFormat = format"
            >
              {{ format.toUpperCase() }}
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
