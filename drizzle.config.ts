import { defineConfig } from 'drizzle-kit'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const dbUrl = process.env.DATABASE_URL ?? 'file:./data/app.sqlite3'
const dbFilePath = dbUrl.replace(/^file:/, '')
const dbDir = dirname(dbFilePath)

mkdirSync(dbDir, { recursive: true })

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dbCredentials: {
    url: dbUrl,
  },
})
