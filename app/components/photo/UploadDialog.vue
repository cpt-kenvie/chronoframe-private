<script lang="ts" setup>
import type { Photo, PipelineQueueItem } from '~~/server/utils/db'

interface UploadingFile {
  file: File
  fileName: string
  fileId: string
  status:
    | 'waiting'
    | 'preparing'
    | 'uploading'
    | 'processing'
    | 'completed'
    | 'error'
    | 'skipped'
    | 'blocked'
  stage?: PipelineQueueItem['statusStage'] | null
  progress?: number
  error?: string
  taskId?: number
  signedUrlResponse?: { signedUrl: string; fileKey: string; expiresIn: number }
  uploadProgress?: {
    loaded: number
    total: number
    percentage: number
    speed?: number
    timeRemaining?: number
    speedText?: string
    timeRemainingText?: string
  }
  canAbort?: boolean
  abortUpload?: () => void
}

interface DuplicateCheckResult {
  fileName: string
  exists: boolean
  photoId?: string
}

interface Album {
  id: number
  title: string
  photoIds: string[]
}

const props = defineProps<{
  open: boolean
  targetAlbumId?: number | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'upload-complete': [photoIds: string[]]
}>()

const MAX_FILE_SIZE = 256 // in MB

const dayjs = useDayjs()
const toast = useToast()
const { refresh: refreshPhotos } = usePhotos()

const selectedFiles = ref<File[]>([])
const uploadingFiles = ref<Map<string, UploadingFile>>(new Map())
const checkingDuplicates = ref(false)
const duplicateCheckResults = ref<Map<string, DuplicateCheckResult>>(new Map())
const selectedAlbumId = ref<number | null>(null)
const completedPhotoIds = ref<string[]>([])
const isUploading = ref(false)

// 获取所有相册
const { data: albums, status: albumsStatus } = await useFetch<Album[]>('/api/albums')

const albumOptions = computed(() => {
  if (!albums.value) return []
  return [
    { label: '不添加到相册', value: null },
    ...albums.value.map((album) => ({
      label: `${album.title} (${album.photoIds.length} 张照片)`,
      value: album.id,
    })),
  ]
})

// 监听 targetAlbumId 和 open 变化，确保每次打开时都正确设置目标相册
watch(
  () => [props.targetAlbumId, props.open] as const,
  ([newTargetAlbumId, newOpen]) => {
    if (newOpen) {
      selectedAlbumId.value = newTargetAlbumId || null
    }
  },
  { immediate: true },
)

const hasSelectedFiles = computed(() => selectedFiles.value.length > 0)

const selectedFilesTotalSize = computed(() =>
  selectedFiles.value.reduce((total, file) => total + (file?.size || 0), 0),
)

const selectedFilesTotalSizeLabel = computed(() =>
  selectedFilesTotalSize.value > 0
    ? formatBytes(selectedFilesTotalSize.value)
    : '0 B',
)

const selectedFilesSummary = computed(() => {
  if (!selectedFiles.value.length) {
    return '未选择文件'
  }

  return `已准备 ${selectedFiles.value.length} 个文件 (${selectedFilesTotalSizeLabel.value})`
})

const newFilesCount = computed(() => {
  if (duplicateCheckResults.value.size === 0) {
    return selectedFiles.value.length
  }
  return selectedFiles.value.filter(
    (file) => !duplicateCheckResults.value.get(file.name)?.exists,
  ).length
})

const existingFilesCount = computed(() => {
  return selectedFiles.value.filter(
    (file) => duplicateCheckResults.value.get(file.name)?.exists,
  ).length
})

// 批量检查文件是否已存在
const checkDuplicateFiles = async (files: File[]) => {
  if (files.length === 0) return

  checkingDuplicates.value = true
  try {
    const fileNames = files.map((f) => f.name)
    const data = await $fetch('/api/photos/check-duplicate', {
      method: 'POST',
      body: { fileNames },
    })

    duplicateCheckResults.value.clear()

    if (data.success && Array.isArray(data.results)) {
      data.results.forEach((result: any) => {
        duplicateCheckResults.value.set(result.fileName, {
          fileName: result.fileName,
          exists: result.exists,
          photoId: result.photoId,
        })
      })
    }

    // 排序：新文件在前，已存在的在后
    selectedFiles.value.sort((a, b) => {
      const aExists = duplicateCheckResults.value.get(a.name)?.exists
      const bExists = duplicateCheckResults.value.get(b.name)?.exists
      return (aExists ? 1 : 0) - (bExists ? 1 : 0)
    })
  } catch (error) {
    console.error('检查重复文件失败:', error)
    toast.add({
      title: '检查失败',
      description: '无法检查文件是否已存在，将继续上传',
      color: 'warning',
    })
  } finally {
    checkingDuplicates.value = false
  }
}

// 监听文件选择变化，自动触发重复检查
watch(
  selectedFiles,
  async (newFiles, oldFiles) => {
    if (newFiles.length > 0) {
      const hasChanged =
        !oldFiles ||
        newFiles.length !== oldFiles.length ||
        newFiles.some((file, index) => file !== oldFiles[index])

      if (hasChanged) {
        await checkDuplicateFiles(newFiles)
      }
    } else {
      duplicateCheckResults.value.clear()
    }
  },
  { deep: true },
)

const clearSelectedFiles = () => {
  selectedFiles.value = []
  duplicateCheckResults.value.clear()
}

// 状态检查间隔 Map
const statusIntervals = ref<Map<number, NodeJS.Timeout>>(new Map())

// 启动任务状态检查
const startTaskStatusCheck = (taskId: number, fileId: string) => {
  const intervalId = setInterval(async () => {
    try {
      const response = await $fetch(`/api/queue/stats/${taskId}`)
      const uploadingFile = uploadingFiles.value.get(fileId)

      if (!uploadingFile) {
        clearInterval(intervalId)
        statusIntervals.value.delete(taskId)
        return
      }

      uploadingFile.stage =
        response.status === 'in-stages' ? response.statusStage : null
      uploadingFiles.value = new Map(uploadingFiles.value)

      if (response.status === 'completed') {
        uploadingFile.status = 'completed'
        uploadingFile.stage = null
        uploadingFiles.value = new Map(uploadingFiles.value)

        clearInterval(intervalId)
        statusIntervals.value.delete(taskId)

        // 记录完成的照片ID（从文件名推断）
        const photoId = response.result?.photoId
        if (photoId) {
          completedPhotoIds.value.push(photoId)
        }

        await refreshPhotos()
      } else if (response.status === 'failed') {
        uploadingFile.status = 'error'
        uploadingFile.error = `处理失败: ${response.errorMessage || '未知错误'}`
        uploadingFile.stage = null
        uploadingFiles.value = new Map(uploadingFiles.value)

        clearInterval(intervalId)
        statusIntervals.value.delete(taskId)
      }
    } catch (error) {
      console.error('检查任务状态失败:', error)

      clearInterval(intervalId)
      statusIntervals.value.delete(taskId)

      const uploadingFile = uploadingFiles.value.get(fileId)
      if (uploadingFile) {
        uploadingFile.status = 'error'
        uploadingFile.error = '任务状态检查失败'
        uploadingFiles.value = new Map(uploadingFiles.value)
      }
    }
  }, 1000)

  statusIntervals.value.set(taskId, intervalId)
}

const uploadImage = async (file: File, existingFileId?: string) => {
  const fileName = file.name
  const fileId = existingFileId || `${Date.now()}-${fileName}`

  const uploadManager = useUpload({
    timeout: 10 * 60 * 1000,
  })

  let uploadingFile = uploadingFiles.value.get(fileId)
  if (!uploadingFile) {
    uploadingFile = {
      file,
      fileName,
      fileId,
      status: 'preparing',
      canAbort: false,
      abortUpload: () => uploadManager.abortUpload(),
    }
    uploadingFiles.value.set(fileId, uploadingFile)
  } else {
    uploadingFile.status = 'preparing'
    uploadingFile.canAbort = false
    uploadingFile.abortUpload = () => uploadManager.abortUpload()
    uploadingFiles.value = new Map(uploadingFiles.value)
  }

  try {
    uploadingFile.status = 'preparing'
    const signedUrlResponse = await $fetch('/api/photos', {
      method: 'POST',
      body: {
        fileName: file.name,
        contentType: file.type,
      },
    })

    uploadingFile.signedUrlResponse = signedUrlResponse

    if (signedUrlResponse.skipped) {
      uploadingFile.status = 'skipped'
      uploadingFile.progress = 100
      uploadingFile.canAbort = false
      uploadingFiles.value = new Map(uploadingFiles.value)
      return
    }

    uploadingFile.status = 'uploading'
    uploadingFile.canAbort = true
    uploadingFile.progress = 0
    uploadingFiles.value = new Map(uploadingFiles.value)

    await uploadManager.uploadFile(file, signedUrlResponse.signedUrl, {
      onProgress: (progress: UploadProgress) => {
        uploadingFile.progress = progress.percentage
        uploadingFile.uploadProgress = {
          loaded: progress.loaded,
          total: progress.total,
          percentage: progress.percentage,
          speed: progress.speed,
          timeRemaining: progress.timeRemaining,
          speedText: progress.speed ? `${formatBytes(progress.speed)}/s` : '',
          timeRemainingText: progress.timeRemaining
            ? dayjs.duration(progress.timeRemaining, 'seconds').humanize()
            : '',
        }
        uploadingFiles.value = new Map(uploadingFiles.value)
      },
      onStatusChange: (status: string) => {
        uploadingFile.canAbort = status === 'uploading'
        uploadingFiles.value = new Map(uploadingFiles.value)
      },
      onSuccess: async (_xhr: XMLHttpRequest) => {
        uploadingFile.status = 'processing'
        uploadingFile.progress = 100
        uploadingFile.canAbort = false
        uploadingFile.stage = null
        uploadingFiles.value = new Map(uploadingFiles.value)

        try {
          // MOV 格式可能是 LivePhoto，其他视频格式直接识别为视频
          const isMovFile = file.type === 'video/quicktime' || file.name.toLowerCase().endsWith('.mov')

          const otherVideoTypes = [
            'video/mp4',
            'video/x-msvideo',
            'video/x-matroska',
            'video/webm',
            'video/x-flv',
            'video/x-ms-wmv',
            'video/3gpp',
            'video/mpeg',
          ]
          const otherVideoExtensions = ['.mp4', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.mpeg', '.mpg']

          const isOtherVideoFile = otherVideoTypes.includes(file.type) ||
            otherVideoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))

          let taskType = 'photo'
          if (isOtherVideoFile) {
            // 非 MOV 格式的视频直接识别为视频
            taskType = 'video'
          } else if (isMovFile) {
            // MOV 格式识别为 LivePhoto 候选
            taskType = 'live-photo-video'
          }

          const resp = await $fetch('/api/queue/add-task', {
            method: 'POST',
            body: {
              payload: {
                type: taskType,
                storageKey: signedUrlResponse.fileKey,
                albumId: selectedAlbumId.value || undefined,
              },
              priority: taskType === 'video' ? 0 : (taskType === 'live-photo-video' ? 0 : 1),
              maxAttempts: 3,
            },
          })

          if (resp.success) {
            uploadingFile.taskId = resp.taskId
            uploadingFile.status = 'processing'
            uploadingFiles.value = new Map(uploadingFiles.value)

            startTaskStatusCheck(resp.taskId, fileId)
          } else {
            uploadingFile.status = 'error'
            uploadingFile.error = '任务提交失败'
            uploadingFiles.value = new Map(uploadingFiles.value)
          }
        } catch (processError: any) {
          uploadingFile.status = 'error'
          uploadingFile.error = `任务提交失败: ${processError.message}`
          uploadingFile.canAbort = false
          uploadingFiles.value = new Map(uploadingFiles.value)
        }
      },
      onError: (error: string) => {
        uploadingFile.status = 'error'
        uploadingFile.error = error
        uploadingFile.canAbort = false
        uploadingFiles.value = new Map(uploadingFiles.value)
      },
    })
  } catch (error: any) {
    uploadingFile.status = 'error'
    uploadingFile.canAbort = false

    if (error.statusCode === 409 && error.data?.duplicate) {
      uploadingFile.status = 'blocked'
      uploadingFile.error = error.data.title || '文件已存在'
    } else {
      uploadingFile.error = error.message || '上传失败'
    }

    uploadingFiles.value = new Map(uploadingFiles.value)
  }
}

const validateFile = (file: File): { valid: boolean; error?: string } => {
  const allowedImageTypes = [
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff',
  ]

  const allowedVideoTypes = [
    'video/quicktime',
    'video/mp4',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm',
    'video/x-flv',
    'video/x-ms-wmv',
    'video/3gpp',
    'video/mpeg',
  ]

  const videoExtensions = ['.mov', '.mp4', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.mpeg', '.mpg']
  const imageExtensions = ['.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif']

  const isValidImageType = allowedImageTypes.includes(file.type)
  const isValidVideoType = allowedVideoTypes.includes(file.type)
  const isValidImageExtension = imageExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  )
  const isValidVideoExtension = videoExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  )

  if (!isValidImageType && !isValidVideoType && !isValidImageExtension && !isValidVideoExtension) {
    return {
      valid: false,
      error: `不支持的文件格式: ${file.type}`,
    }
  }

  const maxSize = MAX_FILE_SIZE * 1024 * 1024
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `文件过大: ${(file.size / 1024 / 1024).toFixed(2)}MB (最大 ${MAX_FILE_SIZE}MB)`,
    }
  }

  return { valid: true }
}

const getUploadingFile = (file: File): UploadingFile | undefined => {
  const fileId = `${Date.now()}-${file.name}`
  for (const [key, value] of uploadingFiles.value.entries()) {
    if (value.fileName === file.name) {
      return value
    }
  }
  return undefined
}

const getFileIcon = (file: File): string => {
  const videoExtensions = ['.mov', '.mp4', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.mpeg', '.mpg']
  const isVideo = file.type.startsWith('video/') || videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
  return isVideo ? 'tabler:video' : 'tabler:photo'
}

const getFileIconClass = (file: File): string => {
  const uploadingFile = getUploadingFile(file)
  if (uploadingFile?.status === 'completed') {
    return 'text-green-600 dark:text-green-400'
  }
  if (uploadingFile?.status === 'error') {
    return 'text-red-600 dark:text-red-400'
  }
  if (uploadingFile?.status === 'uploading' || uploadingFile?.status === 'processing') {
    return 'text-primary-600 dark:text-primary-400'
  }
  if (duplicateCheckResults.value.get(file.name)?.exists) {
    return 'text-neutral-400 dark:text-neutral-500'
  }
  return 'text-primary-600 dark:text-primary-400'
}

const getFileNameClass = (file: File): string => {
  const uploadingFile = getUploadingFile(file)
  if (uploadingFile?.status === 'error') {
    return 'text-red-600 dark:text-red-400'
  }
  if (duplicateCheckResults.value.get(file.name)?.exists) {
    return 'text-neutral-500 dark:text-neutral-400'
  }
  return 'text-neutral-700 dark:text-neutral-100'
}

const getStatusColor = (status?: string): string => {
  switch (status) {
    case 'completed':
      return 'green'
    case 'error':
      return 'red'
    case 'uploading':
      return 'primary'
    case 'processing':
      return 'yellow'
    case 'preparing':
      return 'neutral'
    case 'skipped':
      return 'neutral'
    default:
      return 'neutral'
  }
}

const getStatusText = (status?: string): string => {
  switch (status) {
    case 'waiting':
      return '等待中'
    case 'preparing':
      return '准备中'
    case 'uploading':
      return '上传中'
    case 'processing':
      return '处理中'
    case 'completed':
      return '已完成'
    case 'error':
      return '失败'
    case 'skipped':
      return '已跳过'
    case 'blocked':
      return '已阻止'
    default:
      return ''
  }
}

const getStageText = (stage?: string | null): string => {
  switch (stage) {
    case 'exif':
      return '正在提取照片信息...'
    case 'thumbnail':
      return '正在生成缩略图...'
    case 'motion-photo':
      return '正在检测动态照片...'
    case 'reverse-geocoding':
      return '正在获取位置信息...'
    case 'live-photo':
      return '正在处理 Live Photo...'
    case 'video-metadata':
      return '正在提取视频信息...'
    case 'video-thumbnail':
      return '正在生成视频缩略图...'
    default:
      return '正在处理...'
  }
}

const handleUpload = async () => {
  const fileList = selectedFiles.value

  if (fileList.length === 0) {
    return
  }

  isUploading.value = true

  try {
    const errors: string[] = []
    const validFiles: File[] = []
    const fileIdMapping = new Map<File, string>()
    const skippedFiles: string[] = []
    const skippedPhotoIds: string[] = []

    for (const file of fileList) {
      const duplicateResult = duplicateCheckResults.value.get(file.name)
      if (duplicateResult?.exists) {
        skippedFiles.push(file.name)
        if (duplicateResult.photoId) {
          skippedPhotoIds.push(duplicateResult.photoId)
        }
        continue
      }

      const validation = validateFile(file)
      if (!validation.valid) {
        errors.push(`${file.name}: ${validation.error}`)
      } else {
        validFiles.push(file)
        const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.name}`
        fileIdMapping.set(file, fileId)
      }
    }

    if (skippedFiles.length > 0) {
      toast.add({
        title: '已跳过重复文件',
        description: `跳过了 ${skippedFiles.length} 个已存在的文件${selectedAlbumId.value ? '，但会添加到目标相册' : ''}`,
        color: 'info',
      })
    }

    if (validFiles.length === 0) {
      if (skippedFiles.length > 0 && selectedAlbumId.value && skippedPhotoIds.length > 0) {
        try {
          await $fetch(`/api/albums/${selectedAlbumId.value}/photos`, {
            method: 'POST',
            body: {
              photoIds: skippedPhotoIds,
            },
          })

          toast.add({
            title: '添加成功',
            description: `已将 ${skippedPhotoIds.length} 张已存在的照片添加到相册`,
            color: 'success',
          })

          emit('upload-complete', skippedPhotoIds)
        } catch (error) {
          console.error('添加照片到相册失败:', error)
          toast.add({
            title: '添加到相册失败',
            description: '无法将照片添加到相册',
            color: 'error',
          })
        }

        selectedFiles.value = []
        emit('update:open', false)
        return
      }

      if (skippedFiles.length > 0) {
        toast.add({
          title: '没有需要上传的文件',
          description: '所有文件都已存在',
          color: 'warning',
        })
      } else {
        toast.add({
          title: '上传失败',
          description: '所有文件验证失败',
          color: 'error',
        })
      }
      selectedFiles.value = []
      return
    }

    completedPhotoIds.value = [...skippedPhotoIds]

    for (const file of validFiles) {
      const fileId = fileIdMapping.get(file)!
      const uploadingFile: UploadingFile = {
        file,
        fileName: file.name,
        fileId,
        status: 'waiting',
        canAbort: false,
      }
      uploadingFiles.value.set(fileId, uploadingFile)
    }

    uploadingFiles.value = new Map(uploadingFiles.value)

    const CONCURRENT_LIMIT = 3
    const fileQueue = [...validFiles]
    const activeUploads = new Set<Promise<void>>()

    const startUpload = async (file: File): Promise<void> => {
      const fileId = fileIdMapping.get(file)!
      try {
        await uploadImage(file, fileId)
      } catch (error: any) {
        errors.push(`${file.name}: ${error.message || '上传失败'}`)
        console.error('上传错误:', error)
      }
    }

    const processQueue = async (): Promise<void> => {
      while (fileQueue.length > 0 || activeUploads.size > 0) {
        while (activeUploads.size < CONCURRENT_LIMIT && fileQueue.length > 0) {
          const file = fileQueue.shift()!
          const uploadPromise = startUpload(file)

          activeUploads.add(uploadPromise)

          uploadPromise.finally(() => {
            activeUploads.delete(uploadPromise)
          })
        }

        if (activeUploads.size > 0) {
          await Promise.race(activeUploads)
        }
      }
    }

    await processQueue()

    if (errors.length > 0) {
      console.error('批量上传错误详情:', errors)
    }

    // 如果选择了相册，显示提示信息
    if (selectedAlbumId.value) {
      const totalFiles = validFiles.length + skippedPhotoIds.length
      toast.add({
        title: '上传任务已提交',
        description: `${totalFiles} 个文件已提交处理，完成后将自动添加到相册`,
        color: 'success',
      })
    }

    // 如果有跳过的文件且选择了相册，立即添加到相册
    if (selectedAlbumId.value && skippedPhotoIds.length > 0) {
      try {
        await $fetch(`/api/albums/${selectedAlbumId.value}/photos`, {
          method: 'POST',
          body: {
            photoIds: skippedPhotoIds,
          },
        })
      } catch (error) {
        console.error('添加已存在照片到相册失败:', error)
      }
    }

    emit('upload-complete', completedPhotoIds.value)

    selectedFiles.value = []
    emit('update:open', false)
  } finally {
    isUploading.value = false
  }
}

const handleClose = () => {
  emit('update:open', false)
}

// 清理定时器
onUnmounted(() => {
  statusIntervals.value.forEach((intervalId) => {
    clearInterval(intervalId)
  })
  statusIntervals.value.clear()
})
</script>

<template>
  <USlideover
    :open="open"
    title="上传照片"
    description="选择照片并上传到照片库"
    :ui="{
      content: 'sm:max-w-xl',
      body: 'p-2',
      header: 'px-6 py-5 border-b border-neutral-200 dark:border-neutral-800',
      footer: 'px-6 py-5 border-t border-neutral-200 dark:border-neutral-800',
    }"
    @update:open="handleClose"
  >
    <template #body>
      <div class="space-y-4">
        <!-- 目标相册选择器 -->
        <div
          v-if="albumsStatus === 'success'"
          class="px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl border border-neutral-200 dark:border-neutral-800"
        >
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 block">
            目标相册（可选）
          </label>
          <USelectMenu
            v-model="selectedAlbumId"
            :items="albumOptions"
            value-key="value"
            label-key="label"
            placeholder="选择相册或不添加到相册"
            class="w-full"
          />
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
            上传完成后，照片将自动添加到选中的相册
          </p>
        </div>

        <!-- 文件拖拽上传区域 -->
        <div class="flex-shrink-0">
          <UFileUpload
            v-model="selectedFiles"
            label="选择照片或视频"
            :description="`支持图片（JPEG、PNG、HEIC、WebP、GIF、BMP）和视频（MP4、MOV、AVI、MKV、WebM等），最大 ${MAX_FILE_SIZE}MB`"
            icon="tabler:cloud-upload"
            layout="grid"
            size="xl"
            accept="image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif,image/bmp,image/tiff,video/quicktime,video/mp4,video/x-msvideo,video/x-matroska,video/webm,video/x-flv,video/x-ms-wmv,video/3gpp,video/mpeg,.mov,.mp4,.avi,.mkv,.webm,.flv,.wmv,.m4v,.3gp,.mpeg,.mpg,.heic,.heif"
            multiple
            highlight
            dropzone
            :ui="{
              root: 'w-full',
              base: 'group relative flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-neutral-200/80 bg-white/90 px-6 py-12 text-center shadow-sm transition-all duration-300 hover:border-primary-400/80 hover:bg-primary-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 dark:border-neutral-700/70 dark:bg-neutral-900/80',
              wrapper: 'flex flex-col items-center gap-2',
              label: 'text-base font-semibold text-neutral-800 dark:text-neutral-100',
              description: 'text-sm text-neutral-500 dark:text-neutral-400',
              files: 'hidden',
            }"
          />
        </div>

        <!-- 检查中的加载状态 -->
        <div
          v-if="checkingDuplicates"
          class="flex items-center justify-center gap-2 py-4 text-sm text-neutral-500 dark:text-neutral-400"
        >
          <Icon
            name="tabler:loader-2"
            class="size-4 animate-spin"
          />
          <span>正在检查文件是否已存在...</span>
        </div>

        <!-- 文件列表 -->
        <div
          v-if="selectedFiles.length > 0"
          class="space-y-2"
        >
          <div class="flex items-center justify-between px-2">
            <span class="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              已选择 {{ selectedFiles.length }} 个文件
            </span>
            <div
              v-if="duplicateCheckResults.size > 0"
              class="flex items-center gap-2"
            >
              <UBadge
                v-if="newFilesCount > 0"
                variant="soft"
                color="success"
                size="sm"
              >
                {{ newFilesCount }} 个新文件
              </UBadge>
              <UBadge
                v-if="existingFilesCount > 0"
                variant="soft"
                color="neutral"
                size="sm"
              >
                {{ existingFilesCount }} 个已存在
              </UBadge>
            </div>
          </div>

          <div class="space-y-2">
            <div
              v-for="(file, index) in selectedFiles"
              :key="`${file.name}-${index}`"
              class="rounded-2xl border px-4 py-3 text-left shadow-sm transition-all"
              :class="
                duplicateCheckResults.get(file.name)?.exists
                  ? 'border-neutral-200/80 bg-neutral-50/50 dark:border-neutral-800/80 dark:bg-neutral-900/30 opacity-60'
                  : 'border-neutral-200/80 bg-white/80 dark:border-neutral-800/80 dark:bg-neutral-900/70'
              "
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-start gap-3 min-w-0 flex-1">
                  <Icon
                    :name="getFileIcon(file)"
                    class="size-5 shrink-0 mt-0.5"
                    :class="getFileIconClass(file)"
                  />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div>
                      <div class="flex items-start gap-2 flex-wrap">
                        <span
                          class="text-sm font-medium break-all"
                          :class="getFileNameClass(file)"
                        >
                          {{ file.name }}
                        </span>
                        <div class="flex items-center gap-2 shrink-0">
                          <UBadge
                            v-if="duplicateCheckResults.get(file.name)?.exists"
                            variant="soft"
                            color="neutral"
                            size="xs"
                          >
                            已存在
                          </UBadge>
                          <UBadge
                            v-if="getUploadingFile(file)?.status"
                            variant="soft"
                            :color="getStatusColor(getUploadingFile(file)?.status)"
                            size="xs"
                          >
                            {{ getStatusText(getUploadingFile(file)?.status) }}
                          </UBadge>
                        </div>
                      </div>
                      <div class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                        <span>{{ formatBytes(file.size) }}</span>
                        <template v-if="getUploadingFile(file)?.uploadProgress">
                          <span class="text-neutral-300 dark:text-neutral-600">•</span>
                          <span class="text-primary-600 dark:text-primary-400 font-medium">
                            {{ getUploadingFile(file)?.uploadProgress?.speedText }}
                          </span>
                          <template v-if="getUploadingFile(file)?.uploadProgress?.timeRemainingText">
                            <span class="text-neutral-300 dark:text-neutral-600">•</span>
                            <span>剩余 {{ getUploadingFile(file)?.uploadProgress?.timeRemainingText }}</span>
                          </template>
                        </template>
                      </div>
                    </div>

                    <!-- 上传进度条 -->
                    <div
                      v-if="getUploadingFile(file) && ['uploading', 'processing'].includes(getUploadingFile(file)?.status || '')"
                      class="space-y-1"
                    >
                      <div class="flex items-center justify-between text-xs">
                        <span class="text-neutral-600 dark:text-neutral-400">
                          {{ getUploadingFile(file)?.status === 'uploading' ? '上传中' : '处理中' }}
                        </span>
                        <span class="font-medium text-neutral-700 dark:text-neutral-300">
                          {{ Math.round(getUploadingFile(file)?.progress || 0) }}%
                        </span>
                      </div>
                      <div class="w-full h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                        <div
                          class="h-full transition-all duration-300 rounded-full"
                          :class="
                            getUploadingFile(file)?.status === 'uploading'
                              ? 'bg-primary-500'
                              : 'bg-yellow-500 animate-pulse'
                          "
                          :style="{ width: `${getUploadingFile(file)?.progress || 0}%` }"
                        />
                      </div>
                      <div
                        v-if="getUploadingFile(file)?.stage"
                        class="text-xs text-neutral-500 dark:text-neutral-400"
                      >
                        {{ getStageText(getUploadingFile(file)?.stage) }}
                      </div>
                    </div>

                    <!-- 错误信息 -->
                    <div
                      v-if="getUploadingFile(file)?.status === 'error'"
                      class="text-xs text-red-600 dark:text-red-400"
                    >
                      {{ getUploadingFile(file)?.error }}
                    </div>
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="flex items-center gap-1">
                  <UButton
                    v-if="getUploadingFile(file)?.canAbort"
                    variant="ghost"
                    color="red"
                    size="xs"
                    icon="tabler:x"
                    @click="getUploadingFile(file)?.abortUpload?.()"
                  />
                  <UButton
                    v-else-if="!isUploading"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    icon="tabler:x"
                    @click="selectedFiles.splice(index, 1)"
                  />
                  <Icon
                    v-else-if="getUploadingFile(file)?.status === 'completed'"
                    name="tabler:check"
                    class="size-5 text-green-600 dark:text-green-400"
                  />
                  <Icon
                    v-else-if="getUploadingFile(file)?.status === 'error'"
                    name="tabler:alert-circle"
                    class="size-5 text-red-600 dark:text-red-400"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-col gap-1 text-sm text-neutral-500 dark:text-neutral-400">
          <span>{{
            hasSelectedFiles ? selectedFilesSummary : '未选择文件'
          }}</span>
        </div>
        <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <UButton
            variant="soft"
            color="neutral"
            class="w-full sm:w-auto"
            :disabled="!hasSelectedFiles"
            @click="clearSelectedFiles"
          >
            清空
          </UButton>
          <UButton
            color="primary"
            size="lg"
            class="w-full sm:w-auto"
            icon="tabler:upload"
            :disabled="!hasSelectedFiles || checkingDuplicates || isUploading"
            :loading="checkingDuplicates || isUploading"
            @click="handleUpload"
          >
            <template v-if="isUploading">
              上传中...
            </template>
            <template v-else-if="checkingDuplicates">
              检查中...
            </template>
            <template v-else-if="hasSelectedFiles && existingFilesCount > 0">
              上传 {{ newFilesCount }} 个文件（跳过 {{ existingFilesCount }} 个）
            </template>
            <template v-else-if="hasSelectedFiles">
              上传 {{ selectedFiles.length }} 个文件
            </template>
            <template v-else>
              上传
            </template>
          </UButton>
        </div>
      </div>
    </template>
  </USlideover>
</template>
