import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const photosApi = await readFile('server/api/photos/index.get.ts', 'utf8')
const fileRoute = await readFile('server/routes/file/[...key].get.ts', 'utf8')
const storageRoute = await readFile('server/routes/storage/[...path].ts', 'utf8')
const accessGuard = await readFile('server/utils/photoFileAccess.ts', 'utf8')

test('photo list only returns URLs protected by the file proxy', () => {
  assert.match(photosApi, /toFileProxyUrl\(key\)/)
  assert.doesNotMatch(photosApi, /getPublicUrl/)
})

test('file and legacy local storage routes share hidden album access checks', () => {
  assert.match(fileRoute, /requirePhotoFileAccess\(event, key\)/)
  assert.match(storageRoute, /requirePhotoFileAccess\(event, relPath\)/)
  assert.match(accessGuard, /eq\(tables\.albums\.isHidden, true\)/)
  assert.match(accessGuard, /statusCode: 404/)
})

test('media routes do not cache visibility decisions as immutable responses', () => {
  for (const route of [fileRoute, storageRoute]) {
    assert.match(route, /public, max-age=0, must-revalidate/)
    assert.doesNotMatch(route, /max-age=31536000|immutable/)
  }
})
