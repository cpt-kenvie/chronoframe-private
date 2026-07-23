import { settingsManager } from '~~/server/services/settings/settingsManager'
import {
  ensureSetupToken,
  removeSetupToken,
} from '~~/server/utils/setup-token'

export default defineNitroPlugin(async () => {
  const firstLaunch = await settingsManager.get<boolean>(
    'system',
    'firstLaunch',
    true,
  )

  if (firstLaunch !== true) {
    await removeSetupToken()
    return
  }

  const token = await ensureSetupToken()

  // 容器日志属于部署管理员可见范围，首次安装完成后令牌文件会立即删除。
  console.warn('============================================================')
  console.warn(`[ChronoFrame] 一次性安装令牌：${token}`)
  console.warn('[ChronoFrame] 也可从 data/.setup_token 读取该令牌。')
  console.warn('============================================================')
})

