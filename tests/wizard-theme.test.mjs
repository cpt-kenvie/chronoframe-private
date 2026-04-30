import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const sitePage = await readFile('app/pages/onboarding/site.vue', 'utf8')
const wizardSelect = await readFile('app/components/Wizard/Select.vue', 'utf8').catch(() => '')
const schemaApi = await readFile('server/api/wizard/schema.get.ts', 'utf8')
const submitApi = await readFile('server/api/wizard/submit.post.ts', 'utf8')
const siteApi = await readFile('server/api/wizard/site.post.ts', 'utf8')

test('wizard schema exposes appearance theme as a select field', () => {
  assert.match(schemaApi, /query\.namespace === 'app' && setting\.key === 'appearance\.theme'/)
  assert.match(schemaApi, /type: 'select'/)
})

test('onboarding site page renders appearance theme as a select field', () => {
  assert.match(sitePage, /field\.ui\.type === 'select'/)
  assert.match(sitePage, /<WizardSelect/)
})

test('wizard select matches onboarding input visual style', () => {
  assert.match(wizardSelect, /<USelectMenu/)
  assert.match(wizardSelect, /bg-white\/5 border border-white\/10 text-white/)
  assert.match(wizardSelect, /focus:ring-2 focus:ring-primary-500\/20 focus:border-primary-500/)
  assert.match(wizardSelect, /bg-neutral-950\/95/)
  assert.match(wizardSelect, /data-\[state=checked\]:text-neutral-950/)
  assert.match(wizardSelect, /data-\[state=checked\]:before:bg-white/)
  assert.match(wizardSelect, /value-key="value"/)
})

test('wizard submit api accepts and stores appearance theme', () => {
  assert.match(submitApi, /'appearance\.theme': z\.enum\(\['light', 'dark', 'system'\]\)/)
  assert.match(submitApi, /settingsManager\.set\('app', 'appearance\.theme', body\.site\['appearance\.theme'\]\)/)
})

test('wizard site api accepts and stores appearance theme', () => {
  assert.match(siteApi, /'appearance\.theme': z\.enum\(\['light', 'dark', 'system'\]\)/)
  assert.match(siteApi, /settingsManager\.set\('app', 'appearance\.theme', body\['appearance\.theme'\]\)/)
})
