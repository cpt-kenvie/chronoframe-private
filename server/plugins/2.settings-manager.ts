import { DEFAULT_SETTINGS } from '../services/settings/contants'
import { settingsManager } from '../services/settings/settingsManager'
import type { SettingValue } from '~~/shared/types/settings'

type AppSettingMigration = {
  key: 'title' | 'slogan' | 'author' | 'avatarUrl'
  value: SettingValue
}

type MapSettingMigration = {
  key:
    | 'provider'
    | 'mapbox.token'
    | 'mapbox.style'
    | 'maplibre.token'
    | 'maplibre.style'
    | 'amap.key'
    | 'amap.securityCode'
  value: SettingValue
}

type LocationSettingMigration = {
  key: 'provider' | 'amap.key'
  value: SettingValue
}

export default defineNitroPlugin(async (_nitroApp) => {
  const _settingsManager = settingsManager
  
  // Mark initialization phase to prevent storage provider switch triggers
  // until storage manager is properly initialized in plugin 2_storage.ts
  _settingsManager.setInitializingFlag(true)
  
  try {
    // Initialize default settings first
    await _settingsManager.init(DEFAULT_SETTINGS)
    
    // Migrate existing configurations from runtimeConfig
    // Note: Storage manager will be initialized in the next plugin (2_storage.ts)
    await migrateRuntimeConfigToSettings()
    await repairMapProviderFromStoredCredentials()
  } finally {
    _settingsManager.setInitializingFlag(false)
  }
})

async function repairMapProviderFromStoredCredentials() {
  const provider = await settingsManager.get<string>('map', 'provider')
  const amapKey = await settingsManager.get<string>('map', 'amap.key')
  const maplibreToken = await settingsManager.get<string>('map', 'maplibre.token')
  const maplibreStyle = await settingsManager.get<string>('map', 'maplibre.style')

  if (provider === 'maplibre' && amapKey && !maplibreToken && !maplibreStyle) {
    await settingsManager.set('map', 'provider', 'amap', undefined, true)
  }
}

/**
 * Migrate existing configurations from runtimeConfig to the settings system
 */
async function migrateRuntimeConfigToSettings() {
  const config = useRuntimeConfig()
  const _logger = logger.dynamic('settings-migration')
  
  try {
    // Migrate app settings
    if (config.public.app) {
      _logger.info('Migrating app settings')
      const appSettings: AppSettingMigration[] = [
        { key: 'title', value: config.public.app.title },
        { key: 'slogan', value: config.public.app.slogan },
        { key: 'author', value: config.public.app.author },
        { key: 'avatarUrl', value: config.public.app.avatarUrl },
      ]
      
      for (const { key, value } of appSettings) {
        if (value) {
          try {
            await settingsManager.set('app', key, value, undefined, true)
            _logger.debug(`Migrated app.${key}`)
          } catch (error) {
            _logger.warn(`Failed to migrate app.${key}:`, error)
          }
        }
      }
    }
    
    // Migrate map settings
    if (config.public.map) {
      _logger.info('Migrating map settings')
      const mapSettings: MapSettingMigration[] = [
        { key: 'mapbox.token', value: config.mapbox?.accessToken || '' },
        { key: 'mapbox.style', value: config.public.map.mapbox?.style || '' },
        { key: 'maplibre.token', value: config.public.map.maplibre?.token || '' },
        { key: 'maplibre.style', value: config.public.map.maplibre?.style || '' },
        { key: 'amap.key', value: config.public.map.amap?.key || '' },
        { key: 'amap.securityCode', value: config.public.map.amap?.securityCode || '' },
      ]

      if (process.env.NUXT_PUBLIC_MAP_PROVIDER) {
        mapSettings.unshift({
          key: 'provider',
          value: config.public.map.provider,
        })
      }

      for (const { key, value } of mapSettings) {
        if (value) {
          try {
            await settingsManager.set('map', key, value, undefined, true)
            _logger.debug(`Migrated map.${key}`)
          } catch (error) {
            _logger.warn(`Failed to migrate map.${key}:`, error)
          }
        }
      }
    }

    // Migrate location settings
    if (config.location) {
      _logger.info('Migrating location settings')
      const locationSettings: LocationSettingMigration[] = [
        { key: 'provider', value: config.location.provider || '' },
        { key: 'amap.key', value: config.location.amap?.key || '' },
      ]

      for (const { key, value } of locationSettings) {
        if (value) {
          try {
            await settingsManager.set('location', key, value, undefined, true)
            _logger.debug(`Migrated location.${key}`)
          } catch (error) {
            _logger.warn(`Failed to migrate location.${key}:`, error)
          }
        }
      }
    }
    
    // Migrate storage configuration and set as active provider
    if (config.STORAGE_PROVIDER || config.provider) {
      _logger.info('Migrating storage configuration')
      
      const storageProvider = config.STORAGE_PROVIDER || 's3'
      const providerConfig = config.provider?.[storageProvider as keyof typeof config.provider]
      
      if (providerConfig) {
        try {
          // Check if a provider of the same type already exists
          const existingProviders = await settingsManager.storage.getProviders()
          const sameTypeProviderExists = existingProviders.some(
            (provider) => provider.provider === storageProvider,
          )
          
          if (sameTypeProviderExists) {
            _logger.info(
              `Storage provider of type ${storageProvider} already exists, skipping creation`,
            )
          } else {
            // Create a storage provider from the current configuration
            const providerName = `Migrated ${storageProvider} Provider`
            
            const providerId = await settingsManager.storage.addProvider({
              name: providerName,
              provider: storageProvider as 's3' | 'local' | 'openlist',
              config: normalizeProviderConfig(storageProvider, providerConfig),
            })
            
            // Set this as the active provider
            await settingsManager.set('storage', 'provider', providerId, undefined, true)
            _logger.info(
              `Storage provider migrated and set as active. Provider ID: ${providerId}`,
            )
          }
        } catch (error) {
          _logger.error('Failed to migrate storage provider:', error)
        }
      }
    }
    
    _logger.info('Configuration migration completed')
  } catch (error) {
    _logger.error('Failed to migrate configurations:', error)
  }
}

/**
 * Normalize provider configuration based on provider type
 */
function normalizeProviderConfig(
  provider: string,
  config: any,
): any {
  switch (provider) {
    case 's3':
      return {
        provider: 's3',
        endpoint: config.endpoint || '',
        bucket: config.bucket || '',
        region: config.region || 'auto',
        accessKeyId: config.accessKeyId || '',
        secretAccessKey: config.secretAccessKey || '',
        prefix: config.prefix || '/photos',
        cdnUrl: config.cdnUrl || '',
        forcePathStyle: config.forcePathStyle ?? false,
      }
    
    case 'local':
      return {
        provider: 'local',
        basePath: config.localPath || './data/storage',
        baseUrl: config.baseUrl || '/storage',
        prefix: config.prefix || 'photos/',
      }
    
    case 'openlist': {
      // Support both old nested and new flat endpoint formats
      const oldEndpoints = config.endpoints || {}
      return {
        provider: 'openlist',
        baseUrl: config.baseUrl || '',
        rootPath: config.rootPath || '',
        token: config.token || '',
        uploadEndpoint: config.uploadEndpoint ?? oldEndpoints.upload ?? '/api/fs/put',
        downloadEndpoint: config.downloadEndpoint ?? oldEndpoints.download,
        listEndpoint: config.listEndpoint ?? oldEndpoints.list,
        deleteEndpoint: config.deleteEndpoint ?? oldEndpoints.delete ?? '/api/fs/remove',
        metaEndpoint: config.metaEndpoint ?? oldEndpoints.meta ?? '/api/fs/get',
        pathField: config.pathField ?? 'path',
        cdnUrl: config.cdnUrl || '',
      }
    }
    
    default:
      return config
  }
}
