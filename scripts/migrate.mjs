#!/usr/bin/env node
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 默认数据库地址必须与应用运行时和 Drizzle 配置保持一致。
const DEFAULT_DATABASE_URL = 'file:./data/app.sqlite3'

const resolveDatabaseFilePath = (databaseUrl) =>
  databaseUrl.replace(/^file:/, '')

console.log('Running database migrations...')

try {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
  const dbPath = resolveDatabaseFilePath(databaseUrl)
  mkdirSync(dirname(dbPath), { recursive: true })

  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite)

  await migrate(db, {
    migrationsFolder: join(__dirname, '../server/database/migrations'),
  })

  console.log('Database migrations completed successfully!')
  sqlite.close()
} catch (error) {
  console.error('Migration failed:', error)
  process.exit(1)
}
