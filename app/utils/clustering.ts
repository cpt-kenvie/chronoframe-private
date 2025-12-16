import type { PhotoMarker, ClusterPoint } from '~~/shared/types/map'
import { transformCoordinate } from './coordinate-transform'

export function clusterMarkers(
  markers: PhotoMarker[],
  zoom: number,
): ClusterPoint[] {
  if (markers.length === 0) return []

  const baseThreshold = Math.max(0.001, 0.01 / Math.pow(2, zoom - 10))
  const loadFactor = Math.max(1, Math.sqrt(markers.length / 1200))
  const threshold = baseThreshold * Math.min(8, loadFactor)
  const cellSize = threshold

  type WorkingCluster = {
    markers: PhotoMarker[]
    centerLng: number
    centerLat: number
  }

  const workingClusters: WorkingCluster[] = []
  const grid = new Map<string, WorkingCluster[]>()
  const neighborOffsets = [-1, 0, 1]

  const getCellKey = (lng: number, lat: number) => {
    const x = Math.floor(lng / cellSize)
    const y = Math.floor(lat / cellSize)
    return `${x}:${y}`
  }

  for (const marker of markers) {
    const x = Math.floor(marker.longitude / cellSize)
    const y = Math.floor(marker.latitude / cellSize)

    let target: WorkingCluster | undefined
    let bestDistance = Number.POSITIVE_INFINITY

    for (const dx of neighborOffsets) {
      for (const dy of neighborOffsets) {
        const bucket = grid.get(`${x + dx}:${y + dy}`)
        if (!bucket) continue

        for (const cluster of bucket) {
          const distance = Math.hypot(
            marker.longitude - cluster.centerLng,
            marker.latitude - cluster.centerLat,
          )
          if (distance < threshold && distance < bestDistance) {
            bestDistance = distance
            target = cluster
          }
        }
      }
    }

    if (!target) {
      target = {
        markers: [marker],
        centerLng: marker.longitude,
        centerLat: marker.latitude,
      }
      workingClusters.push(target)
      const key = getCellKey(marker.longitude, marker.latitude)
      const bucket = grid.get(key)
      if (bucket) bucket.push(target)
      else grid.set(key, [target])
      continue
    }

    target.markers.push(marker)
    const count = target.markers.length
    target.centerLng += (marker.longitude - target.centerLng) / count
    target.centerLat += (marker.latitude - target.centerLat) / count
  }

  const clusters: ClusterPoint[] = []
  for (const c of workingClusters) {
    if (c.markers.length === 1) {
      const marker = c.markers[0]
      clusters.push({
        type: 'Feature',
        properties: { marker },
        geometry: {
          type: 'Point',
          coordinates: [marker.longitude, marker.latitude],
        },
      })
      continue
    }

    clusters.push({
      type: 'Feature',
      properties: {
        cluster: true,
        point_count: c.markers.length,
        point_count_abbreviated: c.markers.length.toString(),
        marker: c.markers[0],
        clusteredPhotos: c.markers,
      },
      geometry: {
        type: 'Point',
        coordinates: [c.centerLng, c.centerLat],
      },
    })
  }

  return clusters
}

export function photosToMarkers(photos: Photo[], provider = 'maplibre'): PhotoMarker[] {
  return photos
    .filter(
      (photo) =>
        photo.latitude !== null &&
        photo.longitude !== null &&
        photo.latitude !== undefined &&
        photo.longitude !== undefined,
    )
    .map((photo) => {
      const [lng, lat] = transformCoordinate(
        photo.longitude!,
        photo.latitude!,
        provider,
      )
      return {
        id: photo.id,
        latitude: lat,
        longitude: lng,
        title: photo.title || undefined,
        thumbnailUrl: photo.thumbnailUrl || undefined,
        thumbnailHash: photo.thumbnailHash || undefined,
        dateTaken: photo.dateTaken || undefined,
        city: photo.city || undefined,
        exif: photo.exif || undefined,
      }
    })
}
