import type { H3Event, EventHandlerRequest } from 'h3'
import type { StorageProvider } from '../services/storage'
import { getGlobalStorageManager } from '../services/storage'

export const useStorageProvider = (event: H3Event<EventHandlerRequest>) => {
  const storageManager = event.context?.storage || getGlobalStorageManager()
  if (!storageManager) {
    throw new Error('Storage manager not initialized')
  }
  const storageProvider = storageManager.getProvider() as StorageProvider
  if (!storageProvider) {
    throw new Error('Storage provider not found')
  }
  return { storageProvider }
}
