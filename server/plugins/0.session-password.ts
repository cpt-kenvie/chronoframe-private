import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export default defineNitroPlugin(async () => {
  const runtimeConfig = useRuntimeConfig()
  const envKey = `${runtimeConfig.nitro?.envPrefix || 'NUXT_'}SESSION_PASSWORD`

  const fromEnv = process.env[envKey]?.trim()
  if (fromEnv && fromEnv.length >= 32) {
    return
  }

  const dataDir = join(process.cwd(), 'data')
  const passwordFile = join(dataDir, '.session_password')

  await mkdir(dataDir, { recursive: true })

  const fromFile = existsSync(passwordFile)
    ? (await readFile(passwordFile, 'utf8')).trim()
    : ''

  if (fromFile.length >= 32) {
    process.env[envKey] = fromFile
    logger.chrono.warn(
      `${envKey} 未设置，已从 ${passwordFile} 读取（建议在生产环境显式配置）`,
    )
    return
  }

  const generated = randomBytes(32).toString('hex')
  await writeFile(passwordFile, `${generated}\n`, 'utf8')
  process.env[envKey] = generated
  logger.chrono.warn(
    `${envKey} 未设置，已自动生成并写入 ${passwordFile}（建议在生产环境显式配置）`,
  )
})


