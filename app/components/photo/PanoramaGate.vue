<script setup lang="ts">
import type { LoadingIndicatorRef } from './LoadingIndicator.vue'
import PanoramaFullscreen from './PanoramaFullscreen.vue'
import type { Photo } from '~~/server/utils/db'
import { getPanoramaFormatFromStorageKey } from '~/libs/panorama/format'

const props = withDefaults(
  defineProps<{
    photo: Photo
    open: boolean
    isCurrentImage?: boolean
    loadingIndicatorRef: LoadingIndicatorRef | null
  }>(),
  {
    isCurrentImage: true,
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const panoramaFormat = computed(() => {
  return getPanoramaFormatFromStorageKey(props.photo.storageKey)
})

const isPanorama = computed(() => {
  return panoramaFormat.value !== null || props.photo.isPanorama360 === 1
})

const enter = () => {
  if (!isPanorama.value) return
  emit('update:open', true)
}

const exit = () => {
  emit('update:open', false)
}
</script>

<template>
  <div class="relative w-full h-full flex items-center justify-center">
    <div
      v-if="!open"
      class="relative w-full h-full flex items-center justify-center"
    >
      <ThumbImage
        :src="photo.thumbnailUrl || photo.originalUrl || ''"
        :thumbhash="photo.thumbnailHash || ''"
        :alt="photo.title || photo.id"
        class="absolute inset-0 w-full h-full object-contain"
        thumbhash-class="opacity-60"
        image-contain
      />

      <div class="absolute inset-0 flex items-center justify-center">
        <UButton
          size="lg"
          icon="tabler:sphere"
          class="shadow-2xl"
          :disabled="!isPanorama"
          @click="enter"
        >
          进入全景预览
        </UButton>
      </div>
    </div>

    <PanoramaFullscreen
      v-else-if="isPanorama"
      :photo="photo"
      :open="open"
      @close="exit"
    />
  </div>
</template>
