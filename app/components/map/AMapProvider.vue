<script lang="ts" setup>
import { twMerge } from 'tailwind-merge'
import type { AMapMap } from '~~/shared/types/map'

const props = withDefaults(
  defineProps<{
    class?: string
    mapId?: string
    center?: [number, number]
    zoom?: number
    interactive?: boolean
  }>(),
  {
    class: undefined,
    mapId: 'amap-container',
    center: () => [116.397428, 39.90923],
    zoom: 10,
    interactive: true,
  },
)

const emit = defineEmits<{
  load: [map: AMapMap]
  zoom: []
}>()

const mapContainer = ref<HTMLDivElement>()
const mapInstance = ref<AMapMap>()
const isLoaded = ref(false)

provide('amap', mapInstance)

const mapConfig = computed(() => {
  const config = getSetting('map')
  return typeof config === 'object' && config ? config : {}
})

const amapKey = computed(() => mapConfig.value['amap.key'] || '')
const securityCode = computed(() => mapConfig.value['amap.securityCode'] || '')

const loadAMapScript = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      resolve()
      return
    }

    if (securityCode.value) {
      window._AMapSecurityConfig = {
        securityJsCode: securityCode.value,
      }
    }

    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${amapKey.value}`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load AMap script'))
    document.head.appendChild(script)
  })
}

const initMap = async () => {
  if (!mapContainer.value || !amapKey.value) return

  try {
    await loadAMapScript()

    mapInstance.value = new window.AMap.Map(mapContainer.value, {
      center: props.center,
      zoom: props.zoom,
      dragEnable: props.interactive,
      zoomEnable: props.interactive,
      doubleClickZoom: props.interactive,
      keyboardEnable: props.interactive,
      scrollWheel: props.interactive,
      touchZoom: props.interactive,
      viewMode: '2D',
    })

    mapInstance.value.on('complete', () => {
      isLoaded.value = true
      emit('load', mapInstance.value!)
    })

    mapInstance.value.on('zoomend', () => {
      emit('zoom')
    })
  } catch (error) {
    console.error('Failed to initialize AMap:', error)
  }
}

watch(
  () => props.center,
  (newCenter) => {
    if (mapInstance.value && newCenter) {
      mapInstance.value.setCenter(newCenter)
    }
  },
)

watch(
  () => props.zoom,
  (newZoom) => {
    if (mapInstance.value && newZoom) {
      mapInstance.value.setZoom(newZoom)
    }
  },
)

onMounted(() => {
  initMap()
})

onBeforeUnmount(() => {
  if (mapInstance.value) {
    mapInstance.value.destroy()
  }
})

defineExpose({
  map: mapInstance,
})
</script>

<template>
  <div :class="twMerge('w-full h-full', $props.class)">
    <div
      :id="mapId"
      ref="mapContainer"
      class="w-full h-full"
    />
    <div v-if="isLoaded">
      <slot :map="mapInstance" />
    </div>
  </div>
</template>

<style scoped></style>
