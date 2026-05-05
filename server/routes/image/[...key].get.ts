import { toFileProxyUrl } from '~~/server/utils/publicFile'

const normalizeKeyFromParam = (p: string): string => {
  const decoded = decodeURIComponent(p)
  const key = decoded.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '')
  if (!key || key.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid key' })
  }
  return key
}

export default eventHandler(async (event) => {
  const rawParam = getRouterParam(event, 'key')
  if (!rawParam) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid key' })
  }

  const key = normalizeKeyFromParam(rawParam)
  return sendRedirect(event, toFileProxyUrl(key), 302)
})
