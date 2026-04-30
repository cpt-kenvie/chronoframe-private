import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const nuxtConfig = await readFile('nuxt.config.ts', 'utf8')
const envExample = await readFile('.env.example', 'utf8')
const sessionPlugin = await readFile('server/plugins/0.session-password.ts', 'utf8')

test('runtime defaults use local storage when no env overrides are provided', () => {
  assert.match(nuxtConfig, /STORAGE_PROVIDER: 'local'/)
  assert.match(nuxtConfig, /localPath: '\.\/data\/storage'/)
})

test('env example documents optional generated session password and local storage defaults', () => {
  assert.match(envExample, /NUXT_SESSION_PASSWORD=auto-generated-if-empty/)
  assert.match(envExample, /NUXT_STORAGE_PROVIDER=local/)
  assert.match(envExample, /NUXT_PROVIDER_LOCAL_PATH=\.\/data\/storage/)
})

test('session password fallback persists generated secrets outside root env file', () => {
  assert.match(sessionPlugin, /const passwordFile = join\(dataDir, '\.session_password'\)/)
  assert.doesNotMatch(sessionPlugin, /writeFile\([^)]*'\.env'/)
})
