import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const drizzleConfig = await readFile('drizzle.config.ts', 'utf8')
const runtimeDatabase = await readFile('server/utils/db.ts', 'utf8')
const migrationScript = await readFile('scripts/migrate.mjs', 'utf8')

test('drizzle config creates sqlite parent directory before migrations run', () => {
  assert.match(drizzleConfig, /mkdirSync\(dbDir, \{ recursive: true \}\)/)
  assert.match(drizzleConfig, /url: DATABASE_URL/)
})

test('drizzle config still defaults to the local data sqlite database', () => {
  assert.match(
    drizzleConfig,
    /const DATABASE_URL = process\.env\.DATABASE_URL \?\? 'file:\.\/data\/app\.sqlite3'/,
  )
})

test('runtime and migration connections use the same DATABASE_URL contract', () => {
  assert.match(
    runtimeDatabase,
    /const DATABASE_URL = process\.env\.DATABASE_URL \?\? 'file:\.\/data\/app\.sqlite3'/,
  )
  assert.match(runtimeDatabase, /DATABASE_URL\.replace\(\/\^file:\//)
  assert.match(
    migrationScript,
    /process\.env\.DATABASE_URL \?\? DEFAULT_DATABASE_URL/,
  )
  assert.match(migrationScript, /databaseUrl\.replace\(\/\^file:\//)
})
