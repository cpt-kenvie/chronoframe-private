const DEV_FETCH_ERROR_PREFIX = 'Fetch handler error:'
const DEV_FETCH_ABORT_HINT = '开发服务器请求已取消：浏览器刷新、跳转或关闭连接时可能出现，已忽略该次 Fetch handler 噪音。'
const DEV_FETCH_ABORT_MESSAGES = [
  'Cannot pipe to a closed or destroyed stream',
  'aborted',
] as const

interface ConsoleLike {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

let isInstalled = false

function getMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as { message: unknown }).message
    return typeof message === 'string' ? message : ''
  }

  return ''
}

export function isDevFetchAbortError(args: readonly unknown[]): boolean {
  if (args[0] !== DEV_FETCH_ERROR_PREFIX) {
    return false
  }

  const message = getMessage(args[1])
  return DEV_FETCH_ABORT_MESSAGES.some((item) => message.includes(item))
}

export function installDevFetchErrorHint(consoleLike: ConsoleLike = console): void {
  if (isInstalled) {
    return
  }

  const originalError = consoleLike.error.bind(consoleLike)

  consoleLike.error = (...args: unknown[]) => {
    if (isDevFetchAbortError(args)) {
      consoleLike.warn(DEV_FETCH_ABORT_HINT)
      return
    }

    originalError(...args)
  }

  isInstalled = true
}
