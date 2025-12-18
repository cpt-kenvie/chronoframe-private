export default defineEventHandler((event) => {
  if (!event.path.startsWith('/_i18n/')) return
  if (event.context.nuxtI18n) return

  const messages: Record<string, Record<string, unknown>> = {}
  const slp: Record<string, unknown> = {}
  const trackMap: Record<string, Set<string>> = {}
  const trackKey = (key: string, locale: string) => {
    trackMap[locale] ??= new Set()
    trackMap[locale].add(key)
  }

  event.context.nuxtI18n = { messages, slp, trackMap, trackKey }
})
