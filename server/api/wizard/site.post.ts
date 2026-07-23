import { z } from 'zod'
import { settingsManager } from '~~/server/services/settings/settingsManager'
import { requireSetupSession } from '~~/server/utils/setup-token'

export default eventHandler(async (event) => {
  await requireSetupSession(event)

  const body = await readValidatedBody(
    event,
    z.object({
      title: z.string().min(1),
      slogan: z.string().optional(),
      avatarUrl: z.string().optional(),
      author: z.string().optional(),
      'appearance.theme': z.enum(['light', 'dark', 'system']).default('system'),
    }).parse,
  )

  await settingsManager.set('app', 'title', body.title)
  if (body.slogan) await settingsManager.set('app', 'slogan', body.slogan)
  if (body.avatarUrl) await settingsManager.set('app', 'avatarUrl', body.avatarUrl)
  if (body.author) await settingsManager.set('app', 'author', body.author)
  await settingsManager.set('app', 'appearance.theme', body['appearance.theme'])

  return { success: true }
})
