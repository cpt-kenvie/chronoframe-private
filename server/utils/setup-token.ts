import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { H3Event, SessionConfig } from 'h3'
import type { User, UserSession } from '#auth-utils'
import { settingsManager } from '~~/server/services/settings/settingsManager'

// 安装令牌使用 32 字节随机数，保证首次部署凭据具备足够强度。
const SETUP_TOKEN_BYTES = 32
// 安装令牌固定保存在数据目录，便于容器部署持久化和首次启动时读取。
const SETUP_TOKEN_FILE_PATH = join(process.cwd(), 'data', '.setup_token')
// 令牌采用十六进制编码，读取时拒绝格式异常或被手动破坏的文件。
const SETUP_TOKEN_PATTERN = /^[a-f0-9]{64}$/

const getErrorCode = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null
  }

  const code = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : null
}

const hashSetupToken = (token: string): Buffer => {
  return createHash('sha256').update(token, 'utf8').digest()
}

const readSetupToken = async (): Promise<string | null> => {
  try {
    const token = (await readFile(SETUP_TOKEN_FILE_PATH, 'utf8')).trim()
    return SETUP_TOKEN_PATTERN.test(token) ? token : null
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return null
    throw error
  }
}

const tokensMatch = (actual: string, expected: string): boolean => {
  return timingSafeEqual(hashSetupToken(actual), hashSetupToken(expected))
}

const tokenHashMatches = (actualHash: string, expectedToken: string): boolean => {
  if (!SETUP_TOKEN_PATTERN.test(actualHash)) return false

  return timingSafeEqual(
    Buffer.from(actualHash, 'hex'),
    hashSetupToken(expectedToken),
  )
}

const assertSetupPending = async (): Promise<void> => {
  const firstLaunch = await settingsManager.get<boolean>(
    'system',
    'firstLaunch',
    true,
  )

  if (firstLaunch !== true) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
    })
  }
}

export const getSetupSessionConfig = (): Partial<SessionConfig> => {
  const runtimeConfig = useRuntimeConfig()
  const allowInsecureCookie = String(runtimeConfig.allowInsecureCookie) === 'true'

  return {
    cookie: {
      secure: process.env.NODE_ENV === 'production' && !allowInsecureCookie,
    },
  }
}

export const ensureSetupToken = async (): Promise<string> => {
  const existingToken = await readSetupToken()
  if (existingToken) return existingToken

  await mkdir(join(process.cwd(), 'data'), { recursive: true })
  const token = randomBytes(SETUP_TOKEN_BYTES).toString('hex')

  try {
    await writeFile(SETUP_TOKEN_FILE_PATH, `${token}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if (getErrorCode(error) !== 'EEXIST') throw error

    const concurrentlyCreatedToken = await readSetupToken()
    if (concurrentlyCreatedToken) return concurrentlyCreatedToken

    await writeFile(SETUP_TOKEN_FILE_PATH, `${token}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
  }

  return token
}

export const removeSetupToken = async (): Promise<void> => {
  try {
    await unlink(SETUP_TOKEN_FILE_PATH)
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') throw error
  }
}

export const authorizeSetupSession = async (
  event: H3Event,
  token: string,
): Promise<void> => {
  await assertSetupPending()

  const expectedToken = await readSetupToken()
  if (!expectedToken) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Setup token is unavailable',
    })
  }

  if (!tokensMatch(token.trim(), expectedToken)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid setup token',
    })
  }

  await replaceUserSession(
    event,
    {
      secure: {
        setupTokenHash: hashSetupToken(expectedToken).toString('hex'),
      },
    },
    getSetupSessionConfig(),
  )
}

export const requireSetupSession = async (
  event: H3Event,
): Promise<UserSession> => {
  await assertSetupPending()

  const session = await getUserSession(event)
  const sessionTokenHash = session.secure?.setupTokenHash
  const expectedToken = await readSetupToken()

  if (
    typeof sessionTokenHash !== 'string' ||
    !expectedToken ||
    !tokenHashMatches(sessionTokenHash, expectedToken)
  ) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Setup authorization required',
    })
  }

  return session
}

export const finishSetup = async (
  event: H3Event,
  user: User,
): Promise<void> => {
  await settingsManager.set('system', 'firstLaunch', false, undefined, true)

  try {
    await removeSetupToken()
  } catch (error) {
    console.error('安装完成后删除一次性令牌失败：', error)
  }

  await replaceUserSession(
    event,
    { user },
    getSetupSessionConfig(),
  )
}
