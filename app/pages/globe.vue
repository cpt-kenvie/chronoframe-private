<script lang="ts" setup>
import { motion } from 'motion-v'
import { clusterMarkers, photosToMarkers } from '~/utils/clustering'
import { transformCoordinate } from '~/utils/coordinate-transform'

useHead({
  title: $t('title.globe'),
})

const route = useRoute()
const router = useRouter()

const { photos } = usePhotos()

const photosWithLocation = computed(() => {
  return photos.value.filter(
    (photo) =>
      photo.latitude !== null &&
      photo.longitude !== null &&
      photo.latitude !== undefined &&
      photo.longitude !== undefined,
  )
})

const currentClusterPointId = ref<string | null>(null)
const mapInstance = ref<any>(null)
const currentZoom = ref<number>(4)

const mapConfig = computed(() => {
  const config = getSetting('map')
  return typeof config === 'object' && config ? config : {}
})

const provider = computed(() => mapConfig.value.provider || 'maplibre')

// Convert photos to markers and apply clustering
const clusteredMarkers = computed(() => {
  const markers = photosToMarkers(photosWithLocation.value, provider.value)
  return clusterMarkers(markers, currentZoom.value)
})

// Separate clusters and single markers
const clusterGroups = computed(() => {
  return clusteredMarkers.value.filter(
    (point) => point.properties.cluster === true,
  )
})

const singleMarkers = computed(() => {
  return clusteredMarkers.value.filter(
    (point) => point.properties.cluster !== true,
  )
})

watch(currentClusterPointId, (newId) => {
  if (newId) {
    router.replace({ query: { ...route.query, photoId: newId } })
  } else {
    const { photoId, ...rest } = route.query
    router.replace({ query: { ...rest } })
  }
})

const mapViewState = computed(() => {
  if (photosWithLocation.value.length === 0) {
    const [lng, lat] = transformCoordinate(-122.4, 37.8, provider.value)
    return {
      longitude: lng,
      latitude: lat,
      zoom: 2,
    }
  }

  const latitudes = photosWithLocation.value.map((photo) => photo.latitude!)
  const longitudes = photosWithLocation.value.map((photo) => photo.longitude!)

  const minLat = Math.min(...latitudes)
  const maxLat = Math.max(...latitudes)
  const minLng = Math.min(...longitudes)
  const maxLng = Math.max(...longitudes)

  const centerLat = (minLat + maxLat) / 2
  const centerLng = (minLng + maxLng) / 2

  const latDiff = maxLat - minLat
  const lngDiff = maxLng - minLng
  const maxDiff = Math.max(latDiff, lngDiff)

  let zoom = 8
  if (maxDiff < 0.005) zoom = 16
  else if (maxDiff < 0.02) zoom = 14
  else if (maxDiff < 0.05) zoom = 12
  else if (maxDiff < 0.2) zoom = 10
  else if (maxDiff < 1) zoom = 8
  else if (maxDiff < 5) zoom = 6
  else if (maxDiff < 20) zoom = 5
  else if (maxDiff < 50) zoom = 4
  else zoom = 2

  const [lng, lat] = transformCoordinate(centerLng, centerLat, provider.value)

  return {
    longitude: lng,
    latitude: lat,
    zoom,
  }
})

const onMarkerPinClick = (clusterPoint: any) => {
  // If it's a cluster, zoom to the cluster area
  if (clusterPoint.properties.cluster === true) {
    const clusteredPhotos = clusterPoint.properties.clusteredPhotos || []
    if (clusteredPhotos.length > 0 && mapInstance.value) {
      // Calculate bounds for all photos in the cluster
      const lats = clusteredPhotos.map((p: any) => p.latitude)
      const lngs = clusteredPhotos.map((p: any) => p.longitude)

      const minLat = Math.min(...lats)
      const maxLat = Math.max(...lats)
      const minLng = Math.min(...lngs)
      const maxLng = Math.max(...lngs)

      // Add some padding
      const padding = 0.001

      if (provider.value === 'amap') {
        // AMap API
        const bounds = new window.AMap.Bounds(
          [minLng - padding, minLat - padding],
          [maxLng + padding, maxLat + padding],
        )
        mapInstance.value.setBounds(bounds, true, [50, 50, 50, 50], 1000)
      } else {
        // Mapbox/MapLibre API
        mapInstance.value.fitBounds(
          [
            [minLng - padding, minLat - padding],
            [maxLng + padding, maxLat + padding],
          ],
          {
            padding: 50,
            duration: 1000,
          },
        )
      }
    }
    return
  }

  // Handle single photo selection
  if (clusterPoint.properties.marker?.id === currentClusterPointId.value) {
    currentClusterPointId.value = null
    return
  }
  currentClusterPointId.value = clusterPoint.properties.marker?.id || null
}

const onMarkerPinClose = () => {
  currentClusterPointId.value = null
}

const onMapLoaded = (map: any) => {
  mapInstance.value = map

  const { photoId } = route.query
  if (photoId && typeof photoId === 'string') {
    const photo = photosWithLocation.value.find((photo) => photo.id === photoId)
    if (photo && photo.latitude && photo.longitude) {
      const [lng, lat] = transformCoordinate(
        photo.longitude,
        photo.latitude,
        provider.value,
      )
      setTimeout(() => {
        if (provider.value === 'amap') {
          // AMap API
          mapInstance.value.setZoomAndCenter(17, [lng, lat], false, 2000)
        } else {
          // Mapbox/MapLibre API
          map.flyTo({
            center: [lng, lat],
            zoom: 17,
            essential: true,
            duration: 2000,
          })
        }
        setTimeout(() => {
          nextTick(() => {
            currentClusterPointId.value = photoId
          })
        }, 2000)
      }, 600)
    }
  }

  if (provider.value === 'amap') {
    currentZoom.value = map.getZoom()
  } else {
    currentZoom.value = map.getZoom()
  }
}

const onMapZoom = useThrottleFn(() => {
  if (!mapInstance.value) return
  currentZoom.value = mapInstance.value.getZoom()
}, 100)

// Map control functions
const zoomIn = () => {
  if (!mapInstance.value) return
  if (provider.value === 'amap') {
    mapInstance.value.zoomIn()
  } else {
    mapInstance.value.zoomIn({ duration: 300 })
  }
}

const zoomOut = () => {
  if (!mapInstance.value) return
  if (provider.value === 'amap') {
    mapInstance.value.zoomOut()
  } else {
    mapInstance.value.zoomOut({ duration: 300 })
  }
}

const resetMap = () => {
  if (!mapInstance.value) return
  // Clear current selection
  currentClusterPointId.value = null

  // Reset to initial view state
  if (provider.value === 'amap') {
    // AMap API
    mapInstance.value.setZoomAndCenter(
      mapViewState.value.zoom,
      [mapViewState.value.longitude, mapViewState.value.latitude],
      false,
      1000,
    )
  } else {
    // Mapbox/MapLibre API
    mapInstance.value.flyTo({
      center: [mapViewState.value.longitude, mapViewState.value.latitude],
      zoom: mapViewState.value.zoom,
      essential: true,
      duration: 1000,
    })
  }
}

const generateRandomKey = () => {
  return Math.random().toString(36).substring(2, 15)
}

onBeforeRouteLeave(() => {
  if (mapInstance.value) {
    if (provider.value === 'amap') {
      mapInstance.value.destroy()
    } else {
      mapInstance.value.remove()
    }
    mapInstance.value = null
  }
})
</script>

<template>
  <div class="w-full h-svh relative overflow-hidden">
    <GlassButton
      class="absolute top-4 left-4 z-10"
      icon="tabler:home"
      @click="$router.push('/')"
    />

    <div class="absolute bottom-4 left-4 z-10 flex flex-col">
      <!-- Zoom in -->
      <GlassButton
        class="rounded-b-none border-b-0"
        icon="tabler:plus"
        @click="zoomIn"
      />
      <!-- Zoom out -->
      <GlassButton
        class="rounded-none"
        icon="tabler:minus"
        @click="zoomOut"
      />
      <!-- Reset map -->
      <GlassButton
        class="rounded-t-none border-t-0"
        icon="tabler:scan-position"
        @click="resetMap"
      />
    </div>

    <motion.div
      :initial="{ opacity: 0, scale: 1.08 }"
      :animate="{ opacity: 1, scale: 1 }"
      :transition="{ duration: 0.6, delay: 0.1 }"
      class="w-full h-full"
    >
      <ClientOnly>
        <!-- mapbox://styles/hoshinosuzumi/cmev0eujf01dw01pje3g9cmlg -->
        <MapProvider
          class="w-full h-full"
          :map-id="generateRandomKey()"
          :zoom="mapViewState.zoom"
          :center="[mapViewState.longitude, mapViewState.latitude]"
          :attribution-control="false"
          :language="$i18n.locale"
          @load="onMapLoaded"
          @zoom="onMapZoom"
        >
          <!-- Cluster pins -->
          <template v-if="!!mapInstance">
            <MapClusterPin
              v-for="clusterPoint in clusterGroups"
              :key="`cluster-${clusterPoint.properties.marker?.id}`"
              :cluster-point="clusterPoint"
              :marker-id="generateRandomKey()"
              @click="onMarkerPinClick"
              @close="onMarkerPinClose"
            />
          </template>

          <!-- Single photo pins -->
          <template v-if="!!mapInstance">
            <MapPhotoPin
              v-for="clusterPoint in singleMarkers"
              :key="`single-${clusterPoint.properties.marker?.id}`"
              :cluster-point="clusterPoint"
              :is-selected="
                clusterPoint.properties.marker?.id === currentClusterPointId
              "
              :marker-id="generateRandomKey()"
              @click="onMarkerPinClick"
              @close="onMarkerPinClose"
            />
          </template>
        </MapProvider>

        <template #fallback>
          <div class="w-full h-full flex items-center justify-center">
            <Icon
              name="tabler:map-pin-off"
              class="size-10 text-gray-500 animate-pulse"
            />
          </div>
        </template>
      </ClientOnly>
    </motion.div>
  </div>
</template>

<style>
.mapboxgl-ctrl-logo {
  display: none !important;
}

.mapboxgl-ctrl-attrib {
  display: none !important;
}
</style>
