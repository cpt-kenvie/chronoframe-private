import { z } from 'zod'
import { authorizeSetupSession } from '~~/server/utils/setup-token'

export default eventHandler(async (event) => {
  const { token } = await readValidatedBody(
    event,
    z.object({
      token: z.string().trim().min(1).max(256),
    }).parse,
  )

  await authorizeSetupSession(event, token)

  return { success: true }
})

