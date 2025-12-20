<script setup lang="ts">
import type { LoadingIndicatorRef } from './LoadingIndicator.vue'
import { PanoramaWebGLRenderer } from '~/libs/panorama/viewer-webgl'
import { clamp, degToRad } from '~/libs/panorama/math'

interface Props {
  src: string
  thumbnailSrc?: string
  thumbhash?: string | null
  alt?: string
  isCurrentImage?: boolean
  loadingIndicatorRef: LoadingIndicatorRef | null
}

const props = withDefaults(defineProps<Props>(), {
  thumbnailSrc: '',
  thumbhash: null,
  alt: '',
  isCurrentImage: true,
})

const containerRef = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()

const isReady = ref(false)
const hasError = ref(false)
const errorMessage = ref<string>()

const yaw = ref(Math.PI)
const pitch = ref(0)
const fovY = ref(degToRad(70))

let renderer: PanoramaWebGLRenderer | null = null
let rafId: number | null = null
let resizeObserver: ResizeObserver | null = null
let draggingPointerId: number | null = null
let lastPointer: { x: number; y: number } | null = null

const scheduleRender = () => {
  if (!renderer) return
  if (rafId != null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    renderer?.render({
      yaw: yaw.value,
      pitch: pitch.value,
      fovY: fovY.value,
      toneMapping: 'linear',
      exposure: 0,
      gamma: 2.2,
    })
  })
}

const setDefaultView = () => {
  yaw.value = Math.PI
  pitch.value = 0
  fovY.value = degToRad(70)
}

const setError = (message: string) => {
  hasError.value = true
  errorMessage.value = message
  props.loadingIndicatorRef?.updateLoadingState({
    isVisible: true,
    isError: true,
    errorMessage: message,
  })
}

const clearError = () => {
  hasError.value = false
  errorMessage.value = undefined
}

const cleanup = () => {
  draggingPointerId = null
  lastPointer = null
  renderer?.dispose()
  renderer = null
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  isReady.value = false
  clearError()
}

const initRenderer = () => {
  const canvas = canvasRef.value
  if (!canvas) throw new Error('Canvas not ready')
  renderer = new PanoramaWebGLRenderer(canvas)

  const container = containerRef.value
  if (container) {
    resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      renderer?.resize(rect.width, rect.height, window.devicePixelRatio || 1)
      scheduleRender()
    })
    resizeObserver.observe(container)
  }
}

const decodeImageToRGBA = async (src: string, maxTextureSize: number) => {
  const response = await fetch(src)
  if (!response.ok) {
    throw new Error(`Failed to load panorama (${response.status})`)
  }
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob)

  const srcW = bitmap.width
  const srcH = bitmap.height
  const scale = Math.min(1, maxTextureSize / Math.max(srcW, srcH))
  const w = Math.max(1, Math.floor(srcW * scale))
  const h = Math.max(1, Math.floor(srcH * scale))

  const scratch = document.createElement('canvas')
  scratch.width = w
  scratch.height = h
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D not available')
  ctx.drawImage(bitmap, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h)
  bitmap.close()
  return { width: w, height: h, rgba: imageData.data }
}

const loadPanorama = async () => {
  cleanup()
  if (!props.isCurrentImage) return
  setDefaultView()

  try {
    initRenderer()
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
    return
  }

  props.loadingIndicatorRef?.updateLoadingState({
    isVisible: true,
    isWebGLLoading: true,
    webglMessage: 'Downloading',
    webglQuality: 'high',
    progress: 0,
  })

  const maxTextureSize = renderer?.getMaxTextureSize() || 4096

  try {
    props.loadingIndicatorRef?.updateLoadingState({
      isVisible: true,
      isWebGLLoading: true,
      webglMessage: 'Decoding',
      webglQuality: 'high',
      progress: 0,
    })

    const { width, height, rgba } = await decodeImageToRGBA(props.src, maxTextureSize)
    renderer?.setTextureRGBA8(width, height, rgba)
    isReady.value = true
    scheduleRender()
    props.loadingIndicatorRef?.updateLoadingState({ isVisible: false })
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
}

const onPointerDown = (event: PointerEvent) => {
  if (!containerRef.value) return
  if (draggingPointerId !== null) return
  draggingPointerId = event.pointerId
  lastPointer = { x: event.clientX, y: event.clientY }
  containerRef.value.setPointerCapture(event.pointerId)
}

const onPointerMove = (event: PointerEvent) => {
  if (draggingPointerId !== event.pointerId) return
  if (!lastPointer) return

  const dx = event.clientX - lastPointer.x
  const dy = event.clientY - lastPointer.y
  lastPointer = { x: event.clientX, y: event.clientY }

  const sensitivity = 0.0025
  yaw.value += dx * sensitivity
  pitch.value = clamp(pitch.value + dy * sensitivity, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01)
  scheduleRender()
}

const onPointerUp = (event: PointerEvent) => {
  if (draggingPointerId !== event.pointerId) return
  draggingPointerId = null
  lastPointer = null
  containerRef.value?.releasePointerCapture(event.pointerId)
}

const onWheel = (event: WheelEvent) => {
  event.preventDefault()
  const delta = event.deltaY
  const next = fovY.value + delta * 0.002
  fovY.value = clamp(next, degToRad(35), degToRad(110))
  scheduleRender()
}

watch(
  () => props.src,
  () => {
    loadPanorama()
  },
)

onMounted(() => {
  loadPanorama()
})

onUnmounted(() => {
  cleanup()
})
</script>

<template>
  <div
    ref="containerRef"
    class="relative w-full h-full overflow-hidden touch-none"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="onWheel"
  >
    <ThumbImage
      v-if="!isReady && !hasError"
      :src="thumbnailSrc || src"
      :thumbhash="thumbhash || ''"
      :alt="alt"
      class="absolute inset-0 w-full h-full object-contain opacity-60 pointer-events-none"
      thumbhash-class="opacity-60"
      image-contain
    />

    <canvas
      ref="canvasRef"
      class="absolute inset-0 w-full h-full"
    />

    <div
      v-if="hasError"
      class="absolute inset-0 flex items-center justify-center p-6"
    >
      <div class="max-w-md text-center">
        <p class="text-sm text-white/90">
          {{ errorMessage || 'Panorama load failed' }}
        </p>
      </div>
    </div>
  </div>
</template>

