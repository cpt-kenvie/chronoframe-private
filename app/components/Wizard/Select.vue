<script setup lang="ts">
import type { SettingValue } from '~~/shared/types/settings'

defineOptions({
  inheritAttrs: false,
})

interface WizardSelectItem {
  label: string
  value: SettingValue
  icon?: string
  description?: string
}

const props = defineProps<{
  modelValue?: SettingValue
  items: WizardSelectItem[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SettingValue]
}>()

const value = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})
</script>

<template>
  <USelectMenu
    v-bind="$attrs"
    v-model="value"
    :items="items"
    label-key="label"
    value-key="value"
    :search-input="false"
    selected-icon="tabler:check"
    trailing-icon="tabler:chevron-down"
    variant="none"
    class="w-full"
    :ui="{
      root: 'relative w-full',
      base: 'w-full bg-white/5 border border-white/10 text-white placeholder:text-neutral-500 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all duration-200 rounded-lg',
      value: 'truncate text-white',
      placeholder: 'truncate text-neutral-500',
      arrow: 'fill-neutral-400',
      content: 'bg-neutral-950/95 border border-white/10 text-white shadow-xl shadow-black/30 backdrop-blur-xl rounded-lg ring-0 overflow-hidden',
      viewport: 'p-1',
      item: 'text-neutral-200 rounded-md cursor-pointer data-highlighted:not-data-disabled:bg-white/10 data-highlighted:not-data-disabled:text-white data-[state=checked]:text-neutral-950 data-[state=checked]:before:bg-white data-[state=checked]:data-highlighted:text-neutral-950 data-[state=checked]:data-highlighted:before:bg-white',
      itemLeadingIcon: 'text-neutral-400 group-data-highlighted:not-group-data-disabled:text-primary-300',
      itemTrailingIcon: 'text-primary-300',
      itemDescription: 'text-neutral-500',
    }"
  >
    <template v-for="(_, name) in $slots" #[name]="slotData">
      <slot :name="name" v-bind="slotData" />
    </template>
  </USelectMenu>
</template>
