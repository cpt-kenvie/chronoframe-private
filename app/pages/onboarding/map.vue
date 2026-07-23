<script setup lang="ts">
import type { ProviderOption } from '~/components/Wizard/ProviderSelector.vue'
import { useWizardStore } from '~/stores/wizard'

definePageMeta({
  layout: 'onboarding',
})

const router = useRouter()
const store = useWizardStore()
const toast = useToast()

// 检查前面步骤的数据是否完整
onMounted(() => {
  const admin = unref(store.admin)
  const site = unref(store.site)
  const storage = unref(store.storage)

  if (!admin?.email || !admin?.password || !site?.title || !storage?.name || !storage?.provider) {
    console.warn('前置数据不完整，重定向到第一步')
    toast.add({
      title: '请先完成前面的步骤',
      description: '需要先配置管理员、站点信息和存储',
      color: 'warning',
    })
    router.push('/onboarding')
  }
})

// Map settings
const {
  fields: mapFields,
  state: mapState,
  loading: fetchingMapSchema,
  isFieldVisible: isMapFieldVisible,
} = useWizardForm('map')

// Location settings
const {
  fields: locationFields,
  state: locationState,
  loading: fetchingLocationSchema,
  isFieldVisible: isLocationFieldVisible,
} = useWizardForm('location')

const fetchingSchema = computed(() => fetchingMapSchema.value || fetchingLocationSchema.value)

// Note: Schema validation is handled by form fields
// These schemas are kept for potential future use
// const mapSchema = computed(() => { ... })
// const locationSchema = computed(() => { ... })

function onSubmit() {
  // Validation passed, data is already in the store via useWizardForm binding
  // Transformation of map config will happen in the final step
  router.push('/onboarding/complete')
}
</script>

<template>
  <WizardStep
    title="地图服务与位置服务"
    description="配置地图服务和位置服务，用于地球仪视图、照片详情中的小地图以及地理位置信息"
  >
    <div
      v-if="fetchingSchema"
      class="flex justify-center py-8"
    >
      <UIcon
        name="tabler:loader"
        class="animate-spin w-8 h-8 text-gray-400"
      />
    </div>

    <div
      v-else
      class="space-y-8"
    >
      <!-- 地图服务 -->
      <div class="space-y-4">
        <h3 class="text-lg font-semibold text-white">地图服务</h3>
        <p class="text-sm text-gray-400">为地球仪视图以及照片详情中的小地图配置地图服务</p>
        
        <!-- Map Provider Selector -->
        <template
          v-for="field in mapFields"
          :key="field.key"
        >
          <WizardProviderSelector
            v-if="field.key === 'provider' && field.ui.type === 'tabs'"
            v-model="mapState[field.key]"
            :options="(field.ui.options as ProviderOption[]) || []"
          />
        </template>

        <!-- Map Fields -->
        <div class="space-y-4">
          <template
            v-for="field in mapFields"
            :key="field.key"
          >
            <WizardFormField
              v-if="isMapFieldVisible(field) && field.key !== 'provider'"
              :label="$t(field.label || '')"
              :name="`map-${field.key}`"
              :required="field.ui.required"
              :help="$t(field.ui.help || '')"
            >
              <WizardInput
                v-if="field.ui.type === 'password'"
                v-model="mapState[field.key]"
                type="password"
                :placeholder="$t(field.ui.placeholder || '')"
              />
              <WizardInput
                v-else
                v-model="mapState[field.key]"
                type="text"
                :placeholder="$t(field.ui.placeholder || '')"
              />
            </WizardFormField>
          </template>
        </div>
      </div>

      <!-- 位置服务 -->
      <div class="space-y-4 pt-6 pb-16 border-t border-gray-700">
        <h3 class="text-lg font-semibold text-white">位置服务</h3>
        <p class="text-sm text-gray-400">配置反向地理编码服务，用于将坐标转换为地址信息</p>
        
        <!-- Location Provider Selector -->
        <template
          v-for="field in locationFields"
          :key="field.key"
        >
          <WizardProviderSelector
            v-if="field.key === 'provider' && field.ui.type === 'tabs'"
            v-model="locationState[field.key]"
            :options="(field.ui.options as ProviderOption[]) || []"
          />
        </template>

        <!-- Location Fields -->
        <div class="space-y-4">
          <template
            v-for="field in locationFields"
            :key="field.key"
          >
            <WizardFormField
              v-if="isLocationFieldVisible(field) && field.key !== 'provider'"
              :label="$t(field.label || '')"
              :name="`location-${field.key}`"
              :required="field.ui.required"
              :help="$t(field.ui.help || '')"
            >
              <WizardInput
                v-if="field.ui.type === 'password'"
                v-model="locationState[field.key]"
                type="password"
                :placeholder="$t(field.ui.placeholder || '')"
              />
              <WizardInput
                v-else-if="field.ui.type === 'url'"
                v-model="locationState[field.key]"
                type="url"
                :placeholder="$t(field.ui.placeholder || '')"
              />
              <WizardInput
                v-else
                v-model="locationState[field.key]"
                type="text"
                :placeholder="$t(field.ui.placeholder || '')"
              />
            </WizardFormField>
          </template>
        </div>
      </div>

      <UForm
        id="map-form"
        class="hidden"
        @submit="onSubmit"
      />
    </div>

    <template #actions>
      <WizardButton
        type="submit"
        form="map-form"
        color="primary"
        size="lg"
        :disabled="fetchingSchema"
        trailing-icon="tabler:arrow-right"
      >
        完成设置
      </WizardButton>
    </template>
  </WizardStep>
</template>
