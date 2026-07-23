import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const nuxtConfig = await readFile('nuxt.config.ts', 'utf8')
const envExample = await readFile('.env.example', 'utf8')
const sessionPlugin = await readFile('server/plugins/0.session-password.ts', 'utf8')
const settingsPlugin = await readFile('server/plugins/2.settings-manager.ts', 'utf8')
const wizardSchemaApi = await readFile('server/api/wizard/schema.get.ts', 'utf8')

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

test('runtime map provider default does not overwrite stored provider', () => {
  assert.match(settingsPlugin, /process\.env\.NUXT_PUBLIC_MAP_PROVIDER/)
  assert.doesNotMatch(settingsPlugin, /provider:\s*config\.public\.map\.provider/)
})

test('startup repairs default map provider when only amap is configured', () => {
  assert.match(settingsPlugin, /repairMapProviderFromStoredCredentials/)
  assert.match(settingsPlugin, /provider === 'maplibre'/)
  assert.match(settingsPlugin, /amapKey && !maplibreToken && !maplibreStyle/)
  assert.match(settingsPlugin, /settingsManager\.set\('map', 'provider', 'amap'/)
})

test('startup migrates amap credentials for wizard defaults', () => {
  assert.match(settingsPlugin, /config\.public\.map\.amap\?\.key/)
  assert.match(settingsPlugin, /config\.public\.map\.amap\?\.securityCode/)
  assert.match(settingsPlugin, /config\.location\.amap\?\.key/)
})

test('wizard admin email defaults to configured environment value', () => {
  assert.match(wizardSchemaApi, /process\.env\.CFRAME_ADMIN_EMAIL\?\.trim\(\)/)
  assert.match(wizardSchemaApi, /defaultValue: adminEmail/)
  assert.match(wizardSchemaApi, /value: adminEmail/)
})
