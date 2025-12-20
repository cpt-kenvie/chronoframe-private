import crypto from 'node:crypto'
import { z } from 'zod'
import {
  settingKeys,
  settingNamespaces,
} from '~~/server/services/settings/contants'
import { settingsManager } from '~~/server/services/settings/settingsManager'

/**
 * PUT /api/system/settings/batch
 *
 * 批量更新设置
 * 避免逐个更新产生多个 HTTP 请求
 *
 * @body {updates} 要更新的设置数组
 * @returns {success, updated} 成功标志和更新数量
 *
 * @example
 * PUT /api/system/settings/batch
 * {
 *   updates: [
 *     { namespace: 'app', key: 'title', value: 'ChronoFrame' },
 *     { namespace: 'app', key: 'slogan', value: 'A photo gallery' },
 *   ]
 * }
 */
export default eventHandler(async (event) => {
  const session = await requireUserSession(event)
  if (!session || !session.user.isAdmin) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Admin privileges required',
    })
  }

  const body = await readValidatedBody(
    event,
    z
      .object({
        updates: z.array(
          z.object({
            namespace: z.enum([...settingNamespaces]),
            key: z.enum([...settingKeys]),
            value: z.any(),
          }),
        ),
      })
      .parse,
  )

  try {
    let successCount = 0
    const errors: Array<{ namespace: string; key: string; error: string }> = []

    const updates = [...body.updates]
    const encryptionEnabledUpdate = updates.find(
      (u) =>
        u.namespace === 'storage' &&
        u.key === 'encryption.enabled' &&
        Boolean(u.value) === true,
    )

    if (encryptionEnabledUpdate) {
      const keyUpdate = updates.find(
        (u) => u.namespace === 'storage' && u.key === 'encryption.key',
      )

      const providedKey =
        typeof keyUpdate?.value === 'string' ? keyUpdate.value.trim() : ''
      const existingKey = (await settingsManager.get<string>(
        'storage',
        'encryption.key',
      ))?.trim() || ''

      if (!providedKey && !existingKey) {
        const generated = crypto.randomBytes(32).toString('base64')
        if (keyUpdate) {
          keyUpdate.value = generated
        } else {
          updates.unshift({
            namespace: 'storage',
            key: 'encryption.key',
            value: generated,
          })
        }
      }

      updates.sort((a, b) => {
        const weight = (u: { namespace: string; key: string }) => {
          if (u.namespace !== 'storage') return 2
          if (u.key === 'encryption.key') return 0
          if (u.key === 'encryption.enabled') return 1
          return 2
        }
        return weight(a) - weight(b)
      })
    }

    // 逐个更新设置
    for (const update of updates) {
      try {
        await settingsManager.set(
          update.namespace,
          update.key,
          update.value,
          session.user.id,
        )
        successCount++
      } catch (err) {
        errors.push({
          namespace: update.namespace,
          key: update.key,
          error: (err as Error).message,
        })
      }
    }

    // 如果有错误，返回部分成功的响应
    if (errors.length > 0) {
      return {
        success: false,
        updated: successCount,
        errors,
      }
    }

    return {
      success: true,
      updated: successCount,
    }
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: (error as Error).message || 'Failed to update settings',
    })
  }
})
