import { z } from 'zod'
import {
  getSetupSessionConfig,
  requireSetupSession,
} from '~~/server/utils/setup-token'

export default eventHandler(async (event) => {
  const setupSession = await requireSetupSession(event)
  const db = useDB()
  const { email, password, username } = await readValidatedBody(
    event,
    z.object({
      email: z.email(),
      password: z.string().min(6),
      username: z.string().min(2).default('admin'),
    }).parse,
  )

  const existingUser = db.select().from(tables.users).limit(1).get()
  if (existingUser) {
    // 仅允许创建过该管理员的同一安装会话继续，不通过向导覆盖已有凭据。
    if (
      setupSession.user?.id === existingUser.id &&
      existingUser.email === email &&
      existingUser.isAdmin === 1
    ) {
      return { success: true, resumed: true }
    }

    throw createError({
      statusCode: 409,
      statusMessage: 'Administrator already exists',
    })
  }

  const user = db
    .insert(tables.users)
    .values({
      email,
      username,
      password: await hashPassword(password),
      isAdmin: 1,
      createdAt: new Date(),
    })
    .returning()
    .get()

  // 保留安装授权，同时绑定刚创建的管理员，支持安装中断后安全续作。
  await setUserSession(event, { user }, getSetupSessionConfig())

  return { success: true }
})
