<script lang="ts" setup>
import type { AMapMap } from '~~/shared/types/map'

const props = withDefaults(
  defineProps<{
    markerId?: string
    lnglat?: [number, number]
    map?: AMapMap
  }>(),
  {
    markerId: undefined,
    lnglat: undefined,
    map: undefined,
  },
)

const markerContent = ref<HTMLDivElement>()
const markerInstance = ref<any>()

const injectedMap = inject<Ref<AMapMap | undefined>>('amap', ref(undefined))
const mapToUse = computed(() => props.map || injectedMap.value)

const createMarker = () => {
  if (!mapToUse.value || !props.lnglat || !markerContent.value) {
    return
  }

  if (markerInstance.value) {
    mapToUse.value.remove(markerInstance.value)
  }

  // Clone the content element to avoid display:none issues
  const content = markerContent.value.cloneNode(true) as HTMLElement
  content.style.display = 'block'

  markerInstance.value = new window.AMap.Marker({
    position: props.lnglat,
    content: content,
    offset: new window.AMap.Pixel(-20, -20),
  })

  mapToUse.value.add(markerInstance.value)
}

watch(
  () => [mapToUse.value, props.lnglat, markerContent.value],
  () => {
    nextTick(() => {
      createMarker()
    })
  },
  { immediate: true },
)

watch(
  () => props.lnglat,
  (newLnglat) => {
    if (markerInstance.value && newLnglat) {
      markerInstance.value.setPosition(newLnglat)
    }
  },
)

onBeforeUnmount(() => {
  if (markerInstance.value && mapToUse.value) {
    mapToUse.value.remove(markerInstance.value)
    markerInstance.value = null
  }
})
</script>

<template>
  <div
    ref="markerContent"
    style="display: none"
  >
    <slot name="marker" />
  </div>
</template>

<style scoped></style>
