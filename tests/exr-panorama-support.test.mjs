import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const exrDecoder = await readFile('app/libs/panorama/exr/decode.ts', 'utf8')
const panoramaFormat = await readFile('app/libs/panorama/format.ts', 'utf8')
const panoramaTypes = await readFile('app/libs/panorama/types.ts', 'utf8')
const decoderClient = await readFile('app/libs/panorama/decoder-client.ts', 'utf8')
const parserFallback = await readFile('app/libs/panorama/exr/parser-fallback.ts', 'utf8')
const worker = await readFile('app/workers/panorama-decoder.worker.ts', 'utf8')
const decodeErrorMessage = await readFile('app/composables/usePanoramaDecodeErrorMessage.ts', 'utf8')
const photosPage = await readFile('app/pages/dashboard/photos.vue', 'utf8')
const uploadDialog = await readFile('app/components/photo/UploadDialog.vue', 'utf8')
const enLocale = await readFile('i18n/locales/en.json', 'utf8')

test('EXR metadata accepts common compressed scanline encodings', () => {
  for (const compression of ['piz', 'pxr24', 'b44', 'b44a', 'dwaa', 'dwab']) {
    assert.match(exrDecoder, new RegExp(`'${compression}'`))
  }

  assert.match(exrDecoder, /compression:\s*header\.compression/)
  assert.doesNotMatch(exrDecoder, /else throw new Error\('Unsupported EXR compression'\)/)
})

test('EXR decoder has a parser fallback and stable decode error codes', () => {
  assert.match(worker, /decodeEXRWithParserFallback/)
  assert.match(worker, /meta\.compression/)
  assert.match(parserFallback, /compression\?:\s*string/)
  assert.match(decoderClient, /new PanoramaDecoderError/)
  assert.match(panoramaTypes, /code\?:\s*PanoramaDecodeErrorCode/)
  assert.match(panoramaTypes, /compression\?:\s*string/)
})

test('EXR decode errors are mapped to localized upload messages', () => {
  assert.match(decodeErrorMessage, /unsupportedExrCompression/)
  assert.match(decodeErrorMessage, /panoramaDecodeFailed/)
  assert.match(enLocale, /unsupportedExrCompression/)
  assert.match(enLocale, /panoramaDecodeFailed/)
})

test('panorama uploads create thumbnails before uploading the original file', () => {
  for (const source of [photosPage, uploadDialog]) {
    const thumbnailIndex = source.indexOf('panoramaThumbnail = await createPanoramaThumbnail')
    const uploadIndex = source.indexOf('await uploadManager.uploadFile(uploadFile')
    assert.notEqual(thumbnailIndex, -1)
    assert.notEqual(uploadIndex, -1)
    assert.ok(thumbnailIndex < uploadIndex)
  }
})

test('dashboard classifies panorama photos in the media type column', () => {
  assert.match(panoramaFormat, /export const isPanoramaPhoto/)
  assert.match(photosPage, /isPanoramaPhoto\(row\.original\)/)
  assert.match(photosPage, /dashboard\.photos\.table\.cells\.panoramaPhoto/)
  assert.match(enLocale, /"panoramaPhoto": "Panorama Photo"/)
})

test('parse-exr fallback rows are normalized to the native EXR orientation', () => {
  assert.match(
    parserFallback,
    /height\s*-\s*1\s*-\s*Math\.min\(height\s*-\s*1,\s*Math\.floor\(y\s*\*\s*stepY\)\)/,
  )
})
