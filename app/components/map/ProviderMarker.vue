<script lang="ts" setup>
import type { AMapMap } from '~~/shared/types/map'

withDefaults(
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

const mapConfig = computed(() => {
  const config = getSetting('map')
  return typeof config === 'object' && config ? config : {}
})

const provider = computed(() => mapConfig.value.provider || 'maplibre')
</script>

<template>
  <MapboxDefaultMarker
    v-if="provider === 'mapbox'"
    :marker-id
    :lnglat
  >
    <template #marker>
      <slot name="marker" />
    </template>
  </MapboxDefaultMarker>
  <MapAMapMarker
    v-else-if="provider === 'amap'"
    :marker-id
    :lnglat
    :map
  >
    <template #marker>
      <slot name="marker" />
    </template>
  </MapAMapMarker>
  <MglMarker
    v-else
    :coordinates="lnglat"
  >
    <template #marker>
      <slot name="marker" />
    </template>
  </MglMarker>
</template>

<style scoped></style>
