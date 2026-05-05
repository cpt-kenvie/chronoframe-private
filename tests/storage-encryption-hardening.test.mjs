import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const batchApi = await readFile('server/api/system/settings/batch.put.ts', 'utf8')
const fieldsApi = await readFile('server/api/system/settings/fields.get.ts', 'utf8')
const imageRoute = await readFile('server/routes/image/[...key].get.ts', 'utf8')
const settingsManager = await readFile('server/services/settings/settingsManager.ts', 'utf8')
const storagePage = await readFile('app/pages/dashboard/settings/storage.vue', 'utf8')

test('secret settings are redacted before being returned to settings forms', () => {
  assert.match(settingsManager, /redactSecretValue/)
  assert.match(fieldsApi, /redactSecretValue/)
  assert.doesNotMatch(fieldsApi, /\.\.\.setting,\s*ui:/)
})

test('blank secret updates preserve existing encryption key', () => {
  assert.match(batchApi, /preserveBlankSecretUpdates/)
  assert.match(batchApi, /setting\?\.isSecret/)
  assert.match(batchApi, /continue/)
})

test('enabling storage encryption queues existing files for encryption', () => {
  assert.match(batchApi, /enqueueExistingStorageEncryption/)
  assert.match(batchApi, /storageProvider\.listAll\(\)/)
  assert.match(batchApi, /type: 'file-encryption'/)
})

test('legacy image route uses the same visibility checks as file proxy', () => {
  assert.match(imageRoute, /normalizeKeyFromParam/)
  assert.match(imageRoute, /toFileProxyUrl/)
  assert.match(imageRoute, /sendRedirect/)
  assert.doesNotMatch(imageRoute, /storageProvider\.get\(key\)/)
})

test('storage encryption form does not submit redacted secret placeholders', () => {
  assert.match(storagePage, /buildStorageEncryptionPayload/)
  assert.doesNotMatch(storagePage, /'encryption\.key': storageState\['encryption\.key'\]/)
})
