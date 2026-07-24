import { defineConfig } from 'drizzle-kit'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// 默认数据库地址必须与应用运行时和迁移脚本保持一致。
const DATABASE_URL = process.env.DATABASE_URL ?? 'file:./data/app.sqlite3'
const dbFilePath = DATABASE_URL.replace(/^file:/, '')
const dbDir = dirname(dbFilePath)

mkdirSync(dbDir, { recursive: true })

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dbCredentials: {
    url: DATABASE_URL,
  },
})
