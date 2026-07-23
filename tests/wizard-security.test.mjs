import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const setupTokenUtility = await readFile('server/utils/setup-token.ts', 'utf8')
const setupTokenPlugin = await readFile('server/plugins/3.setup-token.ts', 'utf8')
const accessApi = await readFile('server/api/wizard/access.post.ts', 'utf8')
const submitApi = await readFile('server/api/wizard/submit.post.ts', 'utf8')
const completeApi = await readFile('server/api/wizard/complete.post.ts', 'utf8')
const onboardingPage = await readFile('app/pages/onboarding/index.vue', 'utf8')
const onboardingMapPage = await readFile('app/pages/onboarding/map.vue', 'utf8')
const onboardingCompletePage = await readFile(
  'app/pages/onboarding/complete.vue',
  'utf8',
)

const protectedWizardApis = [
  'admin.post.ts',
  'complete.post.ts',
  'map.post.ts',
  'schema.get.ts',
  'site.post.ts',
  'storage.post.ts',
  'submit.post.ts',
]

test('wizard endpoints require the authorized one-time setup session', async () => {
  for (const fileName of protectedWizardApis) {
    const source = await readFile(`server/api/wizard/${fileName}`, 'utf8')
    assert.match(source, /requireSetupSession\(event\)/, fileName)
  }
})

test('setup token is generated in data and stored only as a secure session hash', () => {
  assert.match(setupTokenUtility, /data', '\.setup_token'/)
  assert.match(setupTokenUtility, /randomBytes\(SETUP_TOKEN_BYTES\)/)
  assert.match(setupTokenUtility, /timingSafeEqual/)
  assert.match(setupTokenUtility, /secure:\s*\{\s*setupTokenHash:/)
  assert.match(setupTokenPlugin, /ensureSetupToken\(\)/)
})

test('setup access exchanges the token for a setup session', () => {
  assert.match(accessApi, /authorizeSetupSession\(event, token\)/)
  assert.match(onboardingPage, /\/api\/wizard\/access/)
  assert.match(onboardingPage, /autocomplete="one-time-code"/)
})

test('wizard submit never overwrites an existing administrator password', () => {
  assert.doesNotMatch(submitApi, /update\(tables\.users\)/)
  assert.match(submitApi, /setupSession\.user\?\.id !== existingUser\.id/)
  assert.match(submitApi, /statusMessage: 'Administrator already exists'/)
})

test('setup completion consumes the token and requires the bound administrator', () => {
  assert.match(setupTokenUtility, /removeSetupToken\(\)/)
  assert.match(setupTokenUtility, /replaceUserSession/)
  assert.match(completeApi, /sessionUser\.isAdmin !== 1/)
  assert.match(completeApi, /finishSetup\(event, adminUser\)/)
})

test('onboarding pages never log submitted credentials or provider secrets', () => {
  assert.doesNotMatch(onboardingMapPage, /console\.log/)
  assert.doesNotMatch(onboardingCompletePage, /console\.log/)
})
