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
          const isMovFile =
            file.type === 'video/quicktime' ||
            file.type === 'video/mp4' ||
            file.name.toLowerCase().endsWith('.mov')

          const resp = await $fetch('/api/queue/add-task', {
            method: 'POST',
            body: {
              payload: {
                type: isMovFile ? 'live-photo-video' : 'photo',
                storageKey: signedUrlResponse.fileKey,
                albumId: selectedAlbumId.value || undefined,
              },
              priority: isMovFile ? 0 : 1,
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
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'video/quicktime',
  ]

  const isValidImageType = allowedTypes.includes(file.type)
  const isValidImageExtension = ['.heic', '.heif'].some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  )
  const isValidVideoExtension = file.name.toLowerCase().endsWith('.mov')

  if (!isValidImageType && !isValidImageExtension && !isValidVideoExtension) {
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
            label="选择照片"
            :description="`支持 JPEG、PNG、HEIC、LivePhoto，最大 ${MAX_FILE_SIZE}MB`"
            icon="tabler:cloud-upload"
            layout="grid"
            size="xl"
            accept="image/jpeg,image/png,image/heic,image/heif,video/quicktime,.mov"
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
              class="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm transition-all"
              :class="
                duplicateCheckResults.get(file.name)?.exists
                  ? 'border-neutral-200/80 bg-neutral-50/50 dark:border-neutral-800/80 dark:bg-neutral-900/30 opacity-60'
                  : 'border-neutral-200/80 bg-white/80 dark:border-neutral-800/80 dark:bg-neutral-900/70'
              "
            >
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <Icon
                  name="tabler:photo"
                  class="size-5 shrink-0"
                  :class="
                    duplicateCheckResults.get(file.name)?.exists
                      ? 'text-neutral-400 dark:text-neutral-500'
                      : 'text-primary-600 dark:text-primary-400'
                  "
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span
                      class="text-sm font-medium truncate"
                      :class="
                        duplicateCheckResults.get(file.name)?.exists
                          ? 'text-neutral-500 dark:text-neutral-400'
                          : 'text-neutral-700 dark:text-neutral-100'
                      "
                    >
                      {{ file.name }}
                    </span>
                    <UBadge
                      v-if="duplicateCheckResults.get(file.name)?.exists"
                      variant="soft"
                      color="neutral"
                      size="xs"
                    >
                      已存在
                    </UBadge>
                  </div>
                  <span class="text-xs text-neutral-500 dark:text-neutral-400">
                    {{ formatBytes(file.size) }}
                  </span>
                </div>
              </div>
              <UButton
                variant="ghost"
                color="neutral"
                size="xs"
                icon="tabler:x"
                @click="
                  () => {
                    selectedFiles.splice(index, 1)
                  }
                "
              />
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
