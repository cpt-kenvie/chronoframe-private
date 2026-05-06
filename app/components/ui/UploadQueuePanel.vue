<script lang="ts" setup>
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
  uploadingFiles: Map<string, UploadFile>
  collapsed?: boolean
}>()

const emit = defineEmits<{
  removeFile: [fileId: string]
  clearCompleted: []
  clearAll: []
  toggle: []
  goToQueue: []
}>()

const isCollapsed = ref(props.collapsed ?? true)
const isQueuePanelDismissed = ref(false)

const stats = computed(() => {
  const files = Array.from(props.uploadingFiles.values())
  const result: Record<UploadStatus, number> & {
    total: number
    active: number
    pending: number
    processed: number
    removable: number
  } = {
    total: files.length,
    waiting: 0,
    preparing: 0,
    uploading: 0,
    processing: 0,
    completed: 0,
    error: 0,
    skipped: 0,
    blocked: 0,
    active: 0,
    pending: 0,
    processed: 0,
    removable: 0,
  }

  for (const file of files) {
    result[file.status] += 1

    if (file.status === 'uploading' || file.status === 'processing') {
      result.active += 1
    } else if (file.status === 'waiting' || file.status === 'preparing') {
      result.pending += 1
    } else {
      result.processed += 1
    }

    if (
      file.status === 'completed' ||
      file.status === 'error' ||
      file.status === 'skipped' ||
      file.status === 'blocked'
    ) {
      result.removable += 1
    }
  }

  return result
})

const overallProgress = computed(() => {
  const files = Array.from(props.uploadingFiles.values())
  if (files.length === 0) return 0

  let totalProgress = 0
  files.forEach((file) => {
    if (
      file.status === 'completed' ||
      file.status === 'error' ||
      file.status === 'skipped' ||
      file.status === 'blocked'
    ) {
      totalProgress += 100
    } else if (file.status === 'uploading' && file.progress !== undefined) {
      totalProgress += file.progress * 0.7
    } else if (file.status === 'processing') {
      totalProgress += 70
    }
  })

  return Math.round(totalProgress / files.length)
})

const processedProgress = computed(() => {
  if (stats.value.total === 0) return 0
  return Math.round((stats.value.processed / stats.value.total) * 100)
})

const showCloseButton = computed(() => {
  return isCollapsed.value || stats.value.processed === stats.value.total
})

const statusColor = computed(() => {
  if (stats.value.error > 0 || stats.value.blocked > 0) return 'error'
  if (stats.value.active > 0) return 'primary'
  if (stats.value.skipped > 0 && stats.value.active === 0) return 'warning'
  if (stats.value.completed > 0 && stats.value.active === 0) return 'success'
  return 'neutral'
})

const toggleCollapsed = () => {
  isCollapsed.value = !isCollapsed.value
  emit('toggle')
}

const clearCompletedFiles = () => {
  emit('clearCompleted')
}

const clearAllFiles = () => {
  emit('clearAll')
}

const closeQueuePanel = () => {
  if (stats.value.processed === stats.value.total) {
    emit('clearAll')
  } else {
    isQueuePanelDismissed.value = true
  }
}

watch(
  () => props.uploadingFiles.size,
  (size, previousSize) => {
    if (size === 0 || size > previousSize) {
      isQueuePanelDismissed.value = false
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="uploadingFiles.size > 0 && !isQueuePanelDismissed"
      class="fixed bottom-20 inset-x-2 sm:inset-x-auto sm:right-6 sm:bottom-6 z-[11000] min-w-0 sm:w-md max-w-[calc(100vw-1rem)] upload-queue-panel pointer-events-auto"
    >
      <div
        class="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden"
      >
        <div
          class="p-4 border-b border-neutral-200 dark:border-neutral-700 cursor-pointer hover:bg-neutral-50/80 dark:hover:bg-neutral-800/50 transition-colors duration-150"
          @click="toggleCollapsed"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <Icon
                :name="
                  {
                    primary: 'tabler:upload',
                    success: 'tabler:circle-check',
                    error: 'tabler:alert-circle',
                    warning: 'tabler:alert-triangle',
                    neutral: 'tabler:info-circle',
                  }[statusColor]
                "
                class="size-5 flex-shrink-0"
                :class="{
                  'text-blue-600 dark:text-blue-400': statusColor === 'primary',
                  'text-green-600 dark:text-green-400':
                    statusColor === 'success',
                  'text-red-600 dark:text-red-400': statusColor === 'error',
                  'text-yellow-600 dark:text-yellow-400':
                    statusColor === 'warning',
                  'text-neutral-600 dark:text-neutral-400':
                    statusColor === 'neutral',
                }"
              />

              <div class="min-w-0">
                <h3
                  class="font-semibold text-sm text-neutral-900 dark:text-neutral-100"
                >
                  文件上传队列
                </h3>

                <div
                  class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300"
                >
                  <span class="font-medium">
                    已完成 {{ stats.completed }} / {{ stats.total }}
                  </span>
                  <span>
                    已处理 {{ stats.processed }} / {{ stats.total }}
                  </span>
                </div>

                <div
                  class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 mt-1"
                >
                  <span
                    v-if="stats.waiting > 0"
                    class="text-neutral-600 dark:text-neutral-400"
                  >
                    {{ stats.waiting }} 等待
                  </span>
                  <span
                    v-if="stats.active > 0"
                    class="text-blue-600 dark:text-blue-400"
                  >
                    {{ stats.active }} 进行中
                  </span>
                  <span
                    v-if="stats.completed > 0"
                    class="text-green-600 dark:text-green-400"
                  >
                    {{ stats.completed }} 完成
                  </span>
                  <span
                    v-if="stats.error > 0"
                    class="text-red-600 dark:text-red-400"
                  >
                    {{ stats.error }} 失败
                  </span>
                  <span
                    v-if="stats.skipped > 0"
                    class="text-yellow-600 dark:text-yellow-400"
                  >
                    {{ stats.skipped }} 跳过
                  </span>
                  <span
                    v-if="stats.blocked > 0"
                    class="text-red-600 dark:text-red-400"
                  >
                    {{ stats.blocked }} 被阻止
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <div
                class="text-xs text-neutral-500 dark:text-neutral-400 font-mono"
              >
                {{ overallProgress }}%
              </div>

              <UButton
                v-if="showCloseButton"
                size="xs"
                variant="ghost"
                color="neutral"
                icon="tabler:x"
                aria-label="关闭文件上传队列"
                @click.stop="closeQueuePanel"
              />

              <div
                class="transition-transform duration-150"
                :class="{ 'rotate-180': !isCollapsed }"
              >
                <Icon
                  name="tabler:chevron-down"
                  class="size-5 text-neutral-500 dark:text-neutral-400 block"
                />
              </div>
            </div>
          </div>

          <div class="mt-3">
            <UProgress
              :model-value="overallProgress"
              :color="statusColor"
            />
            <div
              class="mt-1 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400"
            >
              <span>上传总进度 {{ overallProgress }}%</span>
              <span>完成队列 {{ processedProgress }}%</span>
            </div>
          </div>
        </div>

        <div
          v-if="!isCollapsed"
          class="max-h-[calc(100vh-18rem)] sm:max-h-[min(70vh,calc(100vh-12rem))] overflow-y-auto filelist-container"
        >
          <div class="p-2 space-y-2">
            <UploadQueueItem
              v-for="[fileId, uploadingFile] in uploadingFiles"
              :key="fileId"
              :uploading-file="uploadingFile"
              :file-id="fileId"
              @remove-file="emit('removeFile', $event)"
            />
          </div>
        </div>

        <div
          v-if="!isCollapsed && stats.removable > 0"
          class="p-3 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ stats.completed }} 完成, {{ stats.error }} 失败
            </div>

            <div class="flex items-center gap-0.5">
              <UButton
                v-if="stats.completed > 0"
                size="xs"
                variant="ghost"
                color="neutral"
                @click="clearCompletedFiles"
              >
                清除已完成
              </UButton>

              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="tabler:trash"
                @click="clearAllFiles"
              >
                清除全部
              </UButton>

              <UButton
                size="xs"
                variant="ghost"
                color="info"
                icon="tabler:list-check"
                @click="emit('goToQueue')"
              >
                队列管理
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.upload-queue-panel {
  contain: layout paint style;
}

.filelist-container::-webkit-scrollbar {
  width: 4px;
}

.filelist-container::-webkit-scrollbar-track {
  background: transparent;
}

.filelist-container::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 2px;
}

.dark .filelist-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}
</style>
