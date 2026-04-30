import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const drizzleConfig = await readFile('drizzle.config.ts', 'utf8')

test('drizzle config creates sqlite parent directory before migrations run', () => {
  assert.match(drizzleConfig, /mkdirSync\(dbDir, \{ recursive: true \}\)/)
  assert.match(drizzleConfig, /url: dbUrl/)
})

test('drizzle config still defaults to the local data sqlite database', () => {
  assert.match(drizzleConfig, /const dbUrl = process\.env\.DATABASE_URL \?\? 'file:\.\/data\/app\.sqlite3'/)
})
