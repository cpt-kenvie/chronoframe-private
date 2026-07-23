import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const queuePage = await readFile('app/pages/dashboard/queue.vue', 'utf8')
const queueListApi = await readFile('server/api/queue/task/list.get.ts', 'utf8')
const queueDeleteApi = await readFile(
  'server/api/queue/task/[taskId].delete.ts',
  'utf8',
)
const addTaskApi = await readFile('server/api/queue/add-task.post.ts', 'utf8')
const albumsPage = await readFile('app/pages/dashboard/albums.vue', 'utf8')
const createAlbumApi = await readFile('server/api/albums/index.post.ts', 'utf8')
const updateAlbumApi = await readFile(
  'server/api/albums/[albumId]/index.put.ts',
  'utf8',
)

const localePaths = [
  'i18n/locales/zh-Hans.json',
  'i18n/locales/zh-Hant-TW.json',
  'i18n/locales/zh-Hant-HK.json',
  'i18n/locales/en.json',
  'i18n/locales/ja.json',
]

test('queue page deletes tasks through the existing task resource contract', () => {
  assert.match(queuePage, /`\/api\/queue\/task\/\$\{taskId\}`/)
  assert.doesNotMatch(queuePage, /\/api\/queue\/failed/)
  assert.match(queuePage, /row\.original\.status !== 'in-stages'/)
  assert.doesNotMatch(queuePage, /row\.original\.status !== 'in-stage'/)
  assert.match(queueDeleteApi, /task\.status === 'in-stages'/)
  assert.match(queueDeleteApi, /tx\.delete\(tables\.pipelineQueue\)/)
})

test('queue filters and single-task API accept every supported task type', () => {
  for (const taskType of ['video', 'file-encryption']) {
    assert.match(queuePage, new RegExp(`value: '${taskType}'`))
    assert.match(queueListApi, new RegExp(`'${taskType}'`))
    assert.match(addTaskApi, new RegExp(`z\\.literal\\('${taskType}'\\)`))
  }
})

test('every locale translates queue task types and processing stages', async () => {
  const requiredTypes = ['video', 'file-encryption']
  const requiredStages = [
    'motion-photo',
    'video-metadata',
    'video-thumbnail',
    'encrypting',
  ]

  for (const localePath of localePaths) {
    const locale = JSON.parse(await readFile(localePath, 'utf8'))
    for (const type of requiredTypes) {
      assert.equal(typeof locale.dashboard.queue.types[type], 'string')
    }
    for (const stage of requiredStages) {
      assert.equal(typeof locale.dashboard.queue.stages[stage], 'string')
    }
  }
})

test('album create and update contracts preserve explicit null values', () => {
  for (const api of [createAlbumApi, updateAlbumApi]) {
    assert.match(api, /description: z\.string\(\)\.max\(1000\)\.nullable\(\)\.optional\(\)/)
    assert.match(api, /coverPhotoId: z\.string\(\)\.min\(1\)\.nullable\(\)\.optional\(\)/)
  }

  assert.match(albumsPage, /description: event\.data\.description \|\| null/)
  assert.match(albumsPage, /coverPhotoId: coverPhotoId\.value \|\| null/)
  assert.match(updateAlbumApi, /updateData\.description = body\.description/)
  assert.match(updateAlbumApi, /updateData\.coverPhotoId = body\.coverPhotoId/)
})

test('clearing selected album photos also clears the cover selection', () => {
  assert.match(
    albumsPage,
    /const clearSelectedPhotos = \(\) => \{\s*selectedPhotoIds\.value = \[\]\s*coverPhotoId\.value = ''\s*\}/,
  )
  assert.match(albumsPage, /@click="clearSelectedPhotos"/)
})
