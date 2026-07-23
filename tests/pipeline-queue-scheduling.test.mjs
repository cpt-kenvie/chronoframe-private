import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const queueManager = await readFile(
  'server/services/pipeline-queue/manager.ts',
  'utf8',
)
const geocoding = await readFile(
  'server/services/location/geocoding.ts',
  'utf8',
)

test('queue workers only claim pending tasks whose retry delay has elapsed', () => {
  assert.match(queueManager, /eq\(tables\.pipelineQueue\.status, 'pending'\)/)
  assert.match(
    queueManager,
    /lte\(tables\.pipelineQueue\.createdAt, new Date\(\)\)/,
  )
  assert.match(queueManager, /INITIAL_RETRY_DELAY_MS/)
  assert.match(queueManager, /MAX_RETRY_DELAY_MS/)
})

test('zero latitude and longitude remain valid throughout photo processing', () => {
  assert.match(
    queueManager,
    /latitude !== undefined[\s\S]*?longitude !== null[\s\S]*?extractLocationFromGPS\(latitude, longitude\)/,
  )
  assert.match(queueManager, /latitude: coordinates\?\.latitude \?\? null/)
  assert.match(queueManager, /longitude: coordinates\?\.longitude \?\? null/)
  assert.match(geocoding, /exifData\.GPSLatitude !== undefined/)
  assert.match(geocoding, /isFiniteCoordinate\(latitude\)/)
})
