import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseByteRange } from '../server/utils/httpRange.ts'

test('parses bounded, open-ended, and suffix byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=100-199', 1000), {
    start: 100,
    end: 199,
  })
  assert.deepEqual(parseByteRange('bytes=900-', 1000), {
    start: 900,
    end: 999,
  })
  assert.deepEqual(parseByteRange('bytes=-500', 1000), {
    start: 500,
    end: 999,
  })
  assert.deepEqual(parseByteRange('Bytes=0-99', 1000), {
    start: 0,
    end: 99,
  })
})

test('clamps ranges to the representation size', () => {
  assert.deepEqual(parseByteRange('bytes=900-1200', 1000), {
    start: 900,
    end: 999,
  })
  assert.deepEqual(parseByteRange('bytes=-1200', 1000), {
    start: 0,
    end: 999,
  })
})

test('rejects malformed and unsatisfiable byte ranges', () => {
  assert.equal(parseByteRange('bytes=-0', 1000), null)
  assert.equal(parseByteRange('bytes=1000-', 1000), null)
  assert.equal(parseByteRange('bytes=200-100', 1000), null)
  assert.equal(parseByteRange('bytes=0-1,4-5', 1000), null)
  assert.equal(parseByteRange('items=0-1', 1000), null)
  assert.equal(parseByteRange('bytes=0-1', 0), null)
})
