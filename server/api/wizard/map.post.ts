import { z } from 'zod'
import { settingsManager } from '~~/server/services/settings/settingsManager'

export default eventHandler(async (event) => {
  const body = await readValidatedBody(
    event,
    z.object({
      provider: z.enum(['mapbox', 'maplibre', 'amap']),
      token: z.string().min(1),
      style: z.string().optional(),
      securityCode: z.string().optional(),
    }).parse,
  )

  await settingsManager.set('map', 'provider', body.provider)

  if (body.provider === 'mapbox') {
    await settingsManager.set('map', 'mapbox.token', body.token)
    if (body.style) await settingsManager.set('map', 'mapbox.style', body.style)
  } else if (body.provider === 'maplibre') {
    await settingsManager.set('map', 'maplibre.token', body.token)
    if (body.style) await settingsManager.set('map', 'maplibre.style', body.style)
  } else if (body.provider === 'amap') {
    await settingsManager.set('map', 'amap.key', body.token)
    if (body.securityCode) await settingsManager.set('map', 'amap.securityCode', body.securityCode)
  }

  return { success: true }
})
