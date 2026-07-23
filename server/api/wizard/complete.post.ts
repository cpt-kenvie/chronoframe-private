import { finishSetup, requireSetupSession } from '~~/server/utils/setup-token'
import { eq, tables, useDB } from '~~/server/utils/db'

export default eventHandler(async (event) => {
  const setupSession = await requireSetupSession(event)
  const sessionUser = setupSession.user

  if (!sessionUser || sessionUser.isAdmin !== 1) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Administrator setup is incomplete',
    })
  }

  const adminUser = useDB()
    .select()
    .from(tables.users)
    .where(eq(tables.users.id, sessionUser.id))
    .get()

  if (!adminUser || adminUser.isAdmin !== 1) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Administrator setup is incomplete',
    })
  }

  await finishSetup(event, adminUser)

  return { success: true }
})
