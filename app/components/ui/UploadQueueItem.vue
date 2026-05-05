<script lang="ts" setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { getPanoramaFormatFromName } from '~/libs/panorama/format'

type UploadStatus =
  | 'waiting'
  | 'preparing'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'skipped'
  | 'blocked'

interface UploadFile {
  file: File
  fileName: string
  fileId: string
  status: UploadStatus
  stage?: string | null
  progress?: number
  error?: string
  taskId?: number
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

const props = defineProps<{
  uploadingFile: UploadFile
  fileId: string
}>()

const emit = defineEmits<{
  removeFile: [fileId: string]
}>()

const showProcessingWarning = ref(false)
const processingStartTime = ref<number | null>(null)
let processingTimer: ReturnType<typeof setTimeout> | null = null

const fileIcon = computed(() => {
  const file = props.uploadingFile.file
  const panorama = getPanoramaFormatFromName(file.name)
  if (panorama) {
    return 'tabler:sphere'
  }
  if (file.type.startsWith('image/')) {
    return 'tabler:photo'
  } else if (file.type.startsWith('video/')) {
    return 'tabler:video'
  }
  return 'tabler:file'
})

const statusColor = computed(() => {
  switch (props.uploadingFile.status) {
    case 'waiting':
      return 'neutral'
    case 'preparing':
    case 'uploading':
      return 'primary'
    case 'processing':
      return 'info'
    case 'completed':
      return 'success'
    case 'error':
    case 'blocked':
      return 'error'
    case 'skipped':
      return 'warning'
    default:
      return 'neutral'
  }
})

const getStageText = (stage: string) => {
  const stageMap: Record<string, string> = {
    preprocessing: '预处理中',
    metadata: '提取元数据',
    thumbnail: '生成缩略图',
    exif: '处理 EXIF',
    'reverse-geocoding': '地理解析',
    'live-photo': '检测 LivePhoto',
  }
  return stageMap[stage] || stage
}

const statusText = computed(() => {
  switch (props.uploadingFile.status) {
    case 'waiting':
      return '等待上传'
    case 'preparing':
      return '准备中'
    case 'uploading':
      return `上传中 ${props.uploadingFile.progress ?? 0}%`
    case 'processing':
      return props.uploadingFile.stage
        ? getStageText(props.uploadingFile.stage)
        : '等待处理'
    case 'completed':
      return '完成'
    case 'error':
      return '错误'
    case 'skipped':
      return '已跳过'
    case 'blocked':
      return '被阻止'
    default:
      return '未知'
  }
})

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

watch(
  () => props.uploadingFile.status,
  (newStatus, oldStatus) => {
    if (newStatus === 'processing' && oldStatus !== 'processing') {
      processingStartTime.value = Date.now()
      showProcessingWarning.value = false

      processingTimer = setTimeout(() => {
        if (props.uploadingFile.status === 'processing') {
          showProcessingWarning.value = true
        }
      }, 30000)
    } else if (oldStatus === 'processing' && newStatus !== 'processing') {
      if (processingTimer) {
        clearTimeout(processingTimer)
        processingTimer = null
      }
      showProcessingWarning.value = false
      processingStartTime.value = null
    }
  },
)

onUnmounted(() => {
  if (processingTimer) {
    clearTimeout(processingTimer)
  }
})
</script>

<template>
  <div
    class="bg-white dark:bg-neutral-800 rounded-lg p-3 shadow-sm border border-neutral-200 dark:border-neutral-700"
  >
    <div class="flex items-start justify-between">
      <div class="flex items-center gap-3 flex-1 min-w-0">
        <div class="relative flex-shrink-0">
          <div
            class="w-10 h-10 rounded-lg border flex items-center justify-center"
            :class="{
              'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800/50':
                statusColor === 'primary' || statusColor === 'info',
              'bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800/50':
                statusColor === 'success',
              'bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800/50':
                statusColor === 'error',
              'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800/50':
                statusColor === 'warning',
              'bg-neutral-100 dark:bg-neutral-900/30 border-neutral-200 dark:border-neutral-800/50':
                statusColor === 'neutral',
            }"
          >
            <Icon
              :name="fileIcon"
              class="w-5 h-5"
              :class="{
                'text-blue-600/80 dark:text-blue-400/80':
                  statusColor === 'primary' || statusColor === 'info',
                'text-green-600/80 dark:text-green-400/80':
                  statusColor === 'success',
                'text-red-600/80 dark:text-red-400/80': statusColor === 'error',
                'text-yellow-600/80 dark:text-yellow-400/80':
                  statusColor === 'warning',
                'text-neutral-600/80 dark:text-neutral-400/80':
                  statusColor === 'neutral',
              }"
            />
          </div>

          <div
            v-if="uploadingFile.status === 'completed'"
            class="absolute -top-2 -right-2 size-5 bg-green-900 rounded-full border-2 border-white dark:border-neutral-800 flex items-center justify-center"
          >
            <Icon
              name="tabler:check"
              class="size-3 text-white"
            />
          </div>

          <div
            v-if="uploadingFile.status === 'skipped'"
            class="absolute -top-2 -right-2 size-5 bg-yellow-600 rounded-full border-2 border-white dark:border-neutral-800 flex items-center justify-center"
          >
            <Icon
              name="tabler:arrow-big-right-lines"
              class="size-3 text-white"
            />
          </div>

          <div
            v-if="uploadingFile.status === 'blocked'"
            class="absolute -top-2 -right-2 size-5 bg-red-600 rounded-full border-2 border-white dark:border-neutral-800 flex items-center justify-center"
          >
            <Icon
              name="tabler:cancel"
              class="size-3 text-white"
            />
          </div>
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <p
              class="font-medium text-sm truncate text-neutral-900 dark:text-neutral-100"
            >
              {{ uploadingFile.fileName }}
            </p>
            <UBadge
              :color="statusColor"
              variant="soft"
              size="sm"
            >
              {{ statusText }}
            </UBadge>
          </div>

          <div
            class="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400"
          >
            <span>{{ formatBytes(uploadingFile.file.size) }}</span>
            <span
              v-if="
                uploadingFile.uploadProgress?.speedText &&
                uploadingFile.status === 'uploading'
              "
              class="hidden sm:inline"
            >
              · {{ uploadingFile.uploadProgress.speedText }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 ml-2">
        <UButton
          v-if="uploadingFile.status === 'uploading' && uploadingFile.canAbort"
          size="xs"
          color="error"
          variant="ghost"
          icon="tabler:x"
          @click="uploadingFile.abortUpload?.()"
        >
          中止
        </UButton>

        <UButton
          v-if="
            uploadingFile.status === 'completed' ||
            uploadingFile.status === 'error'
          "
          size="xs"
          color="neutral"
          variant="soft"
          icon="tabler:x"
          @click="emit('removeFile', fileId)"
        >
          清除
        </UButton>
      </div>
    </div>

    <div
      v-if="
        uploadingFile.status === 'uploading' ||
        uploadingFile.status === 'processing'
      "
      class="space-y-2 mt-3"
    >
      <div
        v-if="uploadingFile.status === 'uploading'"
        class="space-y-1"
      >
        <div class="flex justify-between items-center">
          <span class="text-xs text-neutral-600 dark:text-neutral-400">
            上传进度
          </span>
          <span class="text-xs font-mono text-neutral-600 dark:text-neutral-400">
            {{ uploadingFile.progress }}%
          </span>
        </div>

        <UProgress
          :model-value="uploadingFile.progress"
          :color="statusColor"
        />

        <div
          v-if="uploadingFile.uploadProgress?.timeRemainingText"
          class="text-xs text-neutral-500 dark:text-neutral-400"
        >
          剩余时间: {{ uploadingFile.uploadProgress.timeRemainingText }}
        </div>
      </div>

      <div
        v-if="uploadingFile.status === 'processing'"
        class="space-y-1"
      >
        <div class="flex justify-between items-center">
          <span class="text-xs text-neutral-600 dark:text-neutral-400">
            处理状态
          </span>
          <span class="text-xs text-info-600 dark:text-info-400">
            {{ getStageText(uploadingFile.stage || 'pending') }}
          </span>
        </div>

        <UProgress
          :model-value="null"
          animation="swing"
          color="info"
        />
      </div>
    </div>

    <div
      v-if="uploadingFile.status === 'error' && uploadingFile.error"
      class="mt-3"
    >
      <UAlert
        :description="uploadingFile.error"
        color="error"
        variant="soft"
        icon="tabler:alert-circle"
        :ui="{
          root: 'px-2.5 py-2',
        }"
      />
    </div>

    <div
      v-if="showProcessingWarning && uploadingFile.status === 'processing'"
      class="mt-3"
    >
      <UAlert
        description="大文件处理时间较长，为正常现象"
        color="info"
        variant="soft"
        icon="tabler:info-circle"
        :ui="{
          root: 'px-2.5 py-2',
        }"
      />
    </div>
  </div>
</template>
