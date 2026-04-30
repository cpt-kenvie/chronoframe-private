import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const nuxtConfig = await readFile('nuxt.config.ts', 'utf8')
const helperPath = 'shared/utils/dev-fetch-error-hint.ts'

test('nuxt config installs dev fetch error hint in non-production mode', () => {
  assert.match(nuxtConfig, /installDevFetchErrorHint\(\)/)
  assert.match(nuxtConfig, /ENABLE_DEV_FETCH_ABORT_HINT/)
})

test('dev fetch error hint downgrades client disconnect fetch errors only', async () => {
  const helper = await readFile(helperPath, 'utf8')

  assert.match(helper, /Fetch handler error:/)
  assert.match(helper, /Cannot pipe to a closed or destroyed stream/)
  assert.match(helper, /aborted/)
  assert.match(helper, /consoleLike\.warn/)
  assert.match(helper, /originalError\(\.\.\.args\)/)
})
