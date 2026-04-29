<script setup lang="ts">
import { z } from 'zod'
import type { FieldDescriptor } from '~~/shared/types/settings'

definePageMeta({
  layout: 'onboarding',
})

const router = useRouter()

const {
  fields,
  state,
  loading: fetchingSchema,
  isFieldVisible,
} = useWizardForm('app')

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  slogan: z.string().optional(),
  author: z.string().optional(),
  avatarUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
  'appearance.theme': z.enum(['light', 'dark', 'system']),
})

const getSelectItems = (field: FieldDescriptor) =>
  field.ui.options?.map((option) => ({
    ...option,
    label: $t(option.label),
  })) ?? []

function onSubmit() {
  router.push('/onboarding/storage')
}
</script>

<template>
  <WizardStep
    title="站点信息"
    description="配置站点基本信息"
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

    <UForm
      v-else
      id="site-form"
      :schema="schema"
      :state="state"
      class="space-y-4"
      @submit="onSubmit"
    >
      <template
        v-for="field in fields"
        :key="field.key"
      >
        <WizardFormField
          v-if="isFieldVisible(field)"
          :label="$t(field.label || '')"
          :name="field.key"
          :required="field.ui.required"
          :help="$t(field.ui.help || '')"
        >
          <USelectMenu
            v-if="field.ui.type === 'select'"
            v-model="state[field.key]"
            :items="getSelectItems(field)"
            label-key="label"
            value-key="value"
            class="w-full"
          />
          <WizardInput
            v-else
            v-model="state[field.key]"
            :type="field.ui.type === 'url' ? 'url' : 'text'"
            :placeholder="field.ui.placeholder"
          />
        </WizardFormField>
      </template>
    </UForm>

    <template #actions>
      <WizardButton
        type="submit"
        form="site-form"
        color="primary"
        size="lg"
        :disabled="fetchingSchema"
        trailing-icon="tabler:arrow-right"
      >
        下一步
      </WizardButton>
    </template>
  </WizardStep>
</template>
