import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'

export const useWizardStore = defineStore('wizard', () => {
  const admin = useLocalStorage<Record<string, any>>('wizard-admin', {})
  const site = useLocalStorage<Record<string, any>>('wizard-site', {})
  const storage = useLocalStorage<Record<string, any>>('wizard-storage', {})
  const map = useLocalStorage<Record<string, any>>('wizard-map', {})

  const updateAdmin = (data: Record<string, any>) => {
    admin.value = { ...admin.value, ...data }
  }

  const updateSite = (data: Record<string, any>) => {
    site.value = { ...site.value, ...data }
  }

  const updateStorage = (data: Record<string, any>) => {
    storage.value = { ...storage.value, ...data }
  }

  const updateMap = (data: Record<string, any>) => {
    map.value = { ...map.value, ...data }
  }

  const clear = () => {
    admin.value = {}
    site.value = {}
    storage.value = {}
    map.value = {}
  }

  return {
    admin,
    site,
    storage,
    map,
    updateAdmin,
    updateSite,
    updateStorage,
    updateMap,
    clear,
  }
})
