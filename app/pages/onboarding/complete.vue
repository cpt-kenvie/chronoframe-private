<script setup lang="ts">
import { useWizardStore } from '~/stores/wizard'

definePageMeta({
  layout: 'onboarding',
})

const loading = ref(false)
const store = useWizardStore()
const toast = useToast()
const router = useRouter()

// 检查必需数据是否存在
const isDataComplete = computed(() => {
  const admin = unref(store.admin)
  const site = unref(store.site)
  const storage = unref(store.storage)
  const map = unref(store.map)

  return !!(
    admin?.email && 
    admin?.password && 
    site?.title && 
    storage?.name && 
    storage?.provider &&
    map?.provider
  )
})

// 页面加载时检查数据
onMounted(() => {
  if (!isDataComplete.value) {
    console.warn('向导数据不完整，重定向到第一步')
    toast.add({
      title: '数据不完整',
      description: '请从头开始完成向导设置',
      color: 'warning',
    })
    router.push('/onboarding')
  }
})

async function onComplete() {
  // 再次检查数据完整性
  if (!isDataComplete.value) {
    toast.add({
      title: '数据不完整',
      description: '请确保完成所有必需步骤',
      color: 'error',
    })
    router.push('/onboarding')
    return
  }

  loading.value = true
  try {
    // 1. Prepare Admin Data
    const adminData = { ...unref(store.admin) }

    // 2. Prepare Site Data
    const siteData = { ...unref(store.site) }

    // 3. Prepare Storage Data
    const storageState = { ...unref(store.storage) }
    const storageProvider = storageState.provider
    const storageConfig: Record<string, any> = { provider: storageProvider }

    // Extract provider specific keys
    Object.keys(storageState).forEach((key) => {
      if (key.startsWith(storageProvider + '.')) {
        const configKey = key.split('.')[1]!
        storageConfig[configKey] = storageState[key]
      }
    })

    const storageData = {
      name: storageState.name,
      config: storageConfig,
    }

    // 4. Prepare Map Data
    const mapState = { ...unref(store.map) }
    const mapProvider = mapState.provider

    const mapData: Record<string, any> = {
      provider: mapProvider,
    }

    if (mapProvider === 'amap') {
      mapData.token = mapState['amap.key']
      mapData.securityCode = mapState['amap.securityCode']
    } else {
      const mapTokenKey = `${mapProvider}.token`
      const mapStyleKey = `${mapProvider}.style`
      mapData.token = mapState[mapTokenKey]
      mapData.style = mapState[mapStyleKey]
    }

    // 5. Prepare Location Data
    const locationState = { ...unref(store.location) }
    const locationProvider = locationState.provider
    
    const locationData: Record<string, any> | undefined = locationProvider ? {
      provider: locationProvider,
    } : undefined

    if (locationData) {
      if (locationProvider === 'mapbox') {
        locationData.token = locationState['mapbox.token']
      } else if (locationProvider === 'nominatim') {
        locationData.baseUrl = locationState['nominatim.baseUrl']
      } else if (locationProvider === 'amap') {
        locationData.token = locationState['amap.key']
      }
    }

    // 6. Submit All
    const submitData = {
      admin: adminData,
      site: siteData,
      storage: storageData,
      map: mapData,
      location: locationData,
    }

    await $fetch('/api/wizard/submit', {
      method: 'POST',
      body: submitData,
    })

    // Clear store
    store.clear()

    toast.add({
      title: '设置完成',
      description: '正在跳转到仪表盘...',
      color: 'success',
    })

    // Force reload to apply settings
    setTimeout(() => {
      window.location.href = '/dashboard'
    }, 500)
  } catch (error: any) {
    console.error('提交向导失败:', error)
    
    let errorMessage = '提交失败，请重试'
    
    // 解析 Zod 验证错误
    if (error.data?.data) {
      const errors = error.data.data
      if (Array.isArray(errors) && errors.length > 0) {
        const missingFields = errors.map(e => e.path?.join('.') || '未知字段').join(', ')
        errorMessage = `以下字段缺失或无效: ${missingFields}`
      }
    } else if (error.data?.message) {
      errorMessage = error.data.message
    }
    
    toast.add({
      title: '设置失败',
      description: errorMessage,
      color: 'error',
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <WizardStep
    title="即将完成！"
    description="您的 ChronoFrame 画廊已准备好使用。"
  >
    <div
      class="flex flex-col items-center justify-center py-12 space-y-8 text-center"
    >
      <div class="relative">
        <div
          class="absolute inset-0 bg-green-500/20 blur-3xl rounded-full"
        ></div>
        <div
          class="relative size-28 bg-linear-to-br from-green-400/20 to-green-600/20 rounded-full flex items-center justify-center border border-green-500/30 shadow-2xl shadow-green-500/20"
        >
          <UIcon
            name="tabler:check"
            class="size-18 text-green-400"
          />
        </div>
      </div>

      <div class="max-w-md text-neutral-300 text-lg">
        <p>
          您已完成了所有基本配置。现在可以使用管理员账户登录并开始上传照片。
        </p>
      </div>

      <WizardButton
        size="xl"
        color="primary"
        :loading="loading"
        class="px-6 py-3 text-base font-bold shadow-xl shadow-primary-500/20 hover:shadow-primary-500/40 transition-all duration-300"
        @click="onComplete"
      >
        前往仪表盘
      </WizardButton>
    </div>
  </WizardStep>
</template>
