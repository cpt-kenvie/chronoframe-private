import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const sitePage = await readFile('app/pages/onboarding/site.vue', 'utf8')
const schemaApi = await readFile('server/api/wizard/schema.get.ts', 'utf8')
const submitApi = await readFile('server/api/wizard/submit.post.ts', 'utf8')
const siteApi = await readFile('server/api/wizard/site.post.ts', 'utf8')

test('wizard schema exposes appearance theme as a select field', () => {
  assert.match(schemaApi, /query\.namespace === 'app' && setting\.key === 'appearance\.theme'/)
  assert.match(schemaApi, /type: 'select'/)
})

test('onboarding site page renders appearance theme as a select field', () => {
  assert.match(sitePage, /field\.ui\.type === 'select'/)
  assert.match(sitePage, /<USelectMenu/)
  assert.match(sitePage, /value-key="value"/)
})

test('wizard submit api accepts and stores appearance theme', () => {
  assert.match(submitApi, /'appearance\.theme': z\.enum\(\['light', 'dark', 'system'\]\)/)
  assert.match(submitApi, /settingsManager\.set\('app', 'appearance\.theme', body\.site\['appearance\.theme'\]\)/)
})

test('wizard site api accepts and stores appearance theme', () => {
  assert.match(siteApi, /'appearance\.theme': z\.enum\(\['light', 'dark', 'system'\]\)/)
  assert.match(siteApi, /settingsManager\.set\('app', 'appearance\.theme', body\['appearance\.theme'\]\)/)
})
