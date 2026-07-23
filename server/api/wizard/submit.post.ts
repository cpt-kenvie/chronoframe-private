import { z } from 'zod'
import { settingsManager } from '~~/server/services/settings/settingsManager'
import {
  finishSetup,
  getSetupSessionConfig,
  requireSetupSession,
} from '~~/server/utils/setup-token'
import { storageConfigSchema } from '~~/shared/types/storage'
import { useDB, tables } from '~~/server/utils/db'
import type { User } from '~~/server/utils/db'

export default eventHandler(async (event) => {
  const setupSession = await requireSetupSession(event)

  const body = await readValidatedBody(
    event,
    z.object({
      admin: z.object({
        email: z.string().email(),
        password: z.string().min(6),
        username: z.string().min(2).default('admin'),
      }),
      site: z.object({
        title: z.string().min(1),
        slogan: z.string().optional(),
        avatarUrl: z.string().optional(),
        author: z.string().optional(),
        'appearance.theme': z.enum(['light', 'dark', 'system']).default('system'),
      }),
      storage: z.object({
        name: z.string().min(1),
        config: storageConfigSchema,
      }),
      map: z.object({
        provider: z.enum(['mapbox', 'maplibre', 'amap']),
        token: z.string().min(1),
        style: z.string().optional(),
        securityCode: z.string().optional(),
      }),
      location: z.object({
        provider: z.enum(['mapbox', 'nominatim', 'amap']),
        token: z.string().optional(),
        baseUrl: z.string().optional(),
      }).optional(),
    }).parse,
  )

  const db = useDB()

  const existingUser = db.select().from(tables.users).limit(1).get()
  let adminUser: User

  if (existingUser) {
    // 安装重试只能由创建该管理员的原安装会话继续，绝不覆盖已有密码。
    if (
      setupSession.user?.id !== existingUser.id ||
      existingUser.email !== body.admin.email ||
      existingUser.isAdmin !== 1
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Administrator already exists',
      })
    }

    adminUser = existingUser
  } else {
    adminUser = db
      .insert(tables.users)
      .values({
        email: body.admin.email,
        username: body.admin.username,
        password: await hashPassword(body.admin.password),
        isAdmin: 1,
        createdAt: new Date(),
      })
      .returning()
      .get()

    // 立即绑定管理员身份，避免后续配置失败后只能通过匿名路径覆盖账号。
    await setUserSession(event, { user: adminUser }, getSetupSessionConfig())
  }

  // 2. Handle Site Settings
  await settingsManager.set('app', 'title', body.site.title)
  if (body.site.slogan) await settingsManager.set('app', 'slogan', body.site.slogan)
  if (body.site.avatarUrl) await settingsManager.set('app', 'avatarUrl', body.site.avatarUrl)
  if (body.site.author) await settingsManager.set('app', 'author', body.site.author)
  await settingsManager.set('app', 'appearance.theme', body.site['appearance.theme'])

  // 3. Handle Storage Settings
  // Check if provider already exists to avoid duplicates if re-running?
  // For now, just add it.
  const id = await settingsManager.storage.addProvider({
    name: body.storage.name,
    provider: body.storage.config.provider,
    config: body.storage.config,
  })
  await settingsManager.set('storage', 'provider', id)

  // 4. Handle Map Settings
  await settingsManager.set('map', 'provider', body.map.provider)
  if (body.map.provider === 'mapbox') {
    await settingsManager.set('map', 'mapbox.token', body.map.token)
    if (body.map.style) await settingsManager.set('map', 'mapbox.style', body.map.style)
  } else if (body.map.provider === 'maplibre') {
    await settingsManager.set('map', 'maplibre.token', body.map.token)
    if (body.map.style) await settingsManager.set('map', 'maplibre.style', body.map.style)
  } else if (body.map.provider === 'amap') {
    await settingsManager.set('map', 'amap.key', body.map.token)
    if (body.map.securityCode) await settingsManager.set('map', 'amap.securityCode', body.map.securityCode)
  }

  // 5. Handle Location Settings
  if (body.location) {
    await settingsManager.set('location', 'provider', body.location.provider)
    if (body.location.provider === 'mapbox' && body.location.token) {
      await settingsManager.set('location', 'mapbox.token', body.location.token)
    } else if (body.location.provider === 'nominatim' && body.location.baseUrl) {
      await settingsManager.set('location', 'nominatim.baseUrl', body.location.baseUrl)
    } else if (body.location.provider === 'amap' && body.location.token) {
      await settingsManager.set('location', 'amap.key', body.location.token)
    }
  }

  await finishSetup(event, adminUser)

  return { success: true }
})
