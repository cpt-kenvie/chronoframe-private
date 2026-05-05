import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const photosPage = await readFile('app/pages/dashboard/photos.vue', 'utf8')
const uploadDialog = await readFile('app/components/photo/UploadDialog.vue', 'utf8')
const uploadQueuePanel = await readFile('app/components/ui/UploadQueuePanel.vue', 'utf8')
const uploadQueueItem = await readFile('app/components/ui/UploadQueueItem.vue', 'utf8')
const uploadTaskClassifier = await readFile('app/libs/upload-task-classifier.ts', 'utf8')
const addTasksApi = await readFile('server/api/queue/add-tasks.post.ts', 'utf8')
const photoFilters = await readFile('app/composables/usePhotoFilters.ts', 'utf8')
const dashboardAlbums = await readFile('app/pages/dashboard/albums.vue', 'utf8')

test('dashboard photo batch upload waits for each queued upload promise', () => {
  assert.match(photosPage, /await uploadImage\(file, fileId, validFiles\)/)
})

test('upload queues throttle render updates and batch photo refreshes', () => {
  for (const source of [photosPage, uploadDialog]) {
    assert.match(source, /const UPLOAD_PROGRESS_RENDER_INTERVAL_MS = 200/)
    assert.match(source, /scheduleUploadQueueUpdate\(/)
    assert.match(source, /schedulePhotosRefresh\(/)
  }
})

test('mov uploads are classified from the selected batch before queueing', () => {
  assert.match(uploadTaskClassifier, /export const getUploadTaskType/)
  assert.match(uploadTaskClassifier, /hasSameBatchLivePhotoImage/)

  for (const source of [photosPage, uploadDialog]) {
    assert.match(source, /getUploadTaskType\(file, batchFiles\)/)
    assert.match(source, /await uploadImage\(file, fileId, validFiles\)/)
    assert.doesNotMatch(source, /else if \(isMovFile\)\s*{\s*[^}]*taskType = 'live-photo-video'/)
  }
})

test('upload queue panel shows batch progress summary', () => {
  assert.match(uploadQueuePanel, /processed: 0/)
  assert.match(uploadQueuePanel, /processedProgress/)
  assert.match(uploadQueuePanel, /已完成\s*\{\{ stats\.completed \}\}\s*\/\s*\{\{ stats\.total \}\}/)
  assert.match(uploadQueuePanel, /已处理\s*\{\{ stats\.processed \}\}\s*\/\s*\{\{ stats\.total \}\}/)
  assert.match(uploadQueuePanel, /:model-value="overallProgress"/)
})

test('upload dialog hands progress off to the floating queue', () => {
  assert.match(uploadDialog, /<UploadQueuePanel/)
  assert.match(uploadDialog, /emit\('update:open', false\)\s*\n\s*void runQueuedUploads\(\)/)
  assert.match(uploadQueuePanel, /<Teleport to="body">/)
  assert.match(uploadQueuePanel, /z-\[9999\]/)
  assert.match(uploadQueuePanel, /props\.collapsed \?\? true/)
  assert.doesNotMatch(uploadQueuePanel, /mode="popLayout"/)
  assert.doesNotMatch(uploadQueueItem, /particle/)
  assert.doesNotMatch(uploadQueueItem, /文件已成功上传并处理/)
})

test('dashboard upload drawer closes after handing off to floating queue', () => {
  assert.match(photosPage, /const runQueuedUploads = async \(\) =>/)
  assert.match(photosPage, /isUploadSlideoverOpen\.value = false\s*\n\s*void runQueuedUploads\(\)/)
})

test('upload dropzones keep their prompt visible after files are selected', () => {
  for (const source of [photosPage, uploadDialog]) {
    assert.match(source, /<UFileUpload[\s\S]*?layout="list"[\s\S]*?position="outside"/)
    assert.match(source, /base: '[^']*min-h-\[13rem\][^']*'/)
    assert.match(source, /files: 'hidden'/)
  }
})

test('batch upload queue preserves album targets for photos and videos', () => {
  assert.match(addTasksApi, /type: z\.literal\('photo'\),\s*storageKey: z\.string\(\)\.nonempty\(\),\s*albumId: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\),/)
  assert.match(addTasksApi, /type: z\.literal\('video'\),\s*storageKey: z\.string\(\)\.nonempty\(\),\s*albumId: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\),/)
})

test('album consumers use the shared refreshable album cache', () => {
  assert.match(uploadDialog, /useAlbums\(\)/)
  assert.match(photoFilters, /useAlbums\(\)/)
  assert.match(uploadDialog, /await refreshAlbums\(\)/)
  assert.doesNotMatch(uploadDialog, /useFetch<Album\[\]>\('\/api\/albums'\)/)
  assert.doesNotMatch(photoFilters, /useFetch<[\s\S]*?>\('\/api\/albums'\)/)
})

test('album uploads refresh album counts when membership changes', () => {
  assert.match(uploadDialog, /const notifyAlbumMembershipChanged = async/)
  assert.match(uploadDialog, /await refreshAlbumsData\(\)/)
  assert.match(uploadDialog, /await notifyAlbumMembershipChanged\(\[photoId\]\)/)
  assert.match(uploadDialog, /await notifyAlbumMembershipChanged\(skippedPhotoIds\)/)
})

test('dashboard album list stays loading until the first fetch completes', () => {
  assert.match(dashboardAlbums, /const isLoadingAlbums = ref\(true\)/)
})
