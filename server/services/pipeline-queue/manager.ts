import type { ConsolaInstance } from 'consola'
import path from 'path'
import { asc, desc, eq, sql } from 'drizzle-orm'
import type {
  NewPipelineQueueItem,
  PipelineQueueItem,
  Photo,
} from '~~/server/utils/db'
import { compressUint8Array } from '~~/shared/utils/u8array'
import {
  preprocessImageWithJpegUpload,
  processImageMetadataAndSharp,
} from '../image/processor'
import { generateThumbnailAndHash } from '../image/thumbnail'
import { extractExifData, extractPhotoInfo } from '../image/exif'
import { detectPanoramaExifPatch } from '../image/panorama'
import {
  extractLocationFromGPS,
  parseGPSCoordinates,
} from '../location/geocoding'
import { findLivePhotoVideoForImage, isLivePhotoVideo } from '../video/livephoto'
import { processMotionPhotoFromXmp } from '../video/motion-photo'
import { processVideoMetadata } from '../video/processor'
import { getStorageManager } from '~~/server/plugins/3.storage'
import { isStorageEncryptionEnabled, toFileProxyUrl } from '~~/server/utils/publicFile'

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

const getErrnoCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return
  if (!('code' in error)) return
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

const isWindowsFileAccessErrorCode = (code: string | undefined): boolean => {
  if (process.platform !== 'win32') return false
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

export class QueueManager {
  private static instances: Map<string, QueueManager> = new Map()
  private workerId: string
  private logger: ConsolaInstance
  private isProcessing: boolean = false
  private processingInterval: NodeJS.Timeout | null = null
  private processedCount: number = 0
  private errorCount: number = 0
  private startTime: Date

  static getInstance(
    workerId: string = 'default',
    logger?: ConsolaInstance,
  ): QueueManager {
    if (!QueueManager.instances.has(workerId)) {
      QueueManager.instances.set(workerId, new QueueManager(workerId, logger))
    }
    return QueueManager.instances.get(workerId)!
  }

  static getAllInstances(): QueueManager[] {
    return Array.from(QueueManager.instances.values())
  }

  private constructor(workerId: string, _logger?: ConsolaInstance) {
    this.workerId = workerId
    this.logger = _logger
      ? _logger.withTag(`${workerId}`)
      : logger.dynamic(`queue-${workerId}`)
    this.startTime = new Date()
  }

  getWorkerId(): string {
    return this.workerId
  }

  getStats() {
    const uptime = Date.now() - this.startTime.getTime()
    return {
      workerId: this.workerId,
      isProcessing: this.isProcessing,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      uptime: Math.floor(uptime / 1000), // seconds
      successRate:
        this.processedCount > 0
          ? (this.processedCount / (this.processedCount + this.errorCount)) *
            100
          : 0,
    }
  }

  /**
   * 插入新任务到队列
   * @param payload 任务负荷
   * @param options 可选的任务设置
   * @returns 新创建任务的 ID
   */
  async addTask(
    payload: any,
    options?: Partial<NewPipelineQueueItem>,
  ): Promise<number> {
    const db = useDB()
    const result = db
      .insert(tables.pipelineQueue)
      .values({
        payload,
        ...options,
      })
      .returning({ id: tables.pipelineQueue.id })
      .get()
    return result.id
  }

  /**
   * 获取任务状态
   * @param taskId 任务ID
   * @returns 任务状态信息
   */
  async getTaskStatus(taskId: number) {
    const db = useDB()
    const task = await db
      .select()
      .from(tables.pipelineQueue)
      .where(eq(tables.pipelineQueue.id, taskId))
      .get()
    return task
  }

  /**
   * 获取并锁定下一个待处理任务
   * @returns 下一个待处理任务
   */
  async getNextTask(): Promise<PipelineQueueItem | null> {
    const db = useDB()

    // 使用同步事务防止竞态条件
    const task = db.transaction((tx) => {
      const highestPriorityPendingTask = tx
        .select()
        .from(tables.pipelineQueue)
        .where(eq(tables.pipelineQueue.status, 'pending'))
        // 优先处理高优先级和较早创建的任务
        .orderBy(
          desc(tables.pipelineQueue.priority),
          asc(tables.pipelineQueue.createdAt),
        )
        .limit(1)
        .get()

      if (!highestPriorityPendingTask) return null

      const task = highestPriorityPendingTask
      tx.update(tables.pipelineQueue)
        .set({ status: 'in-stages' })
        .where(eq(tables.pipelineQueue.id, task.id))
        .run()

      return { ...task, status: 'in-stages' as const }
    })

    return task
  }

  /**
   * 更新任务阶段
   * @param taskId 任务ID
   * @param stage 新的任务阶段
   */
  async updateTaskStage(
    taskId: number,
    stage: PipelineQueueItem['statusStage'],
  ): Promise<void> {
    const db = useDB()
    await db
      .update(tables.pipelineQueue)
      .set({ statusStage: stage })
      .where(eq(tables.pipelineQueue.id, taskId))
  }

  /**
   * 标记任务为已完成
   * @param taskId 任务ID
   */
  async markTaskCompleted(taskId: number): Promise<void> {
    const db = useDB()
    await db
      .update(tables.pipelineQueue)
      .set({
        status: 'completed',
        completedAt: sql`(unixepoch())`,
      })
      .where(eq(tables.pipelineQueue.id, taskId))
  }

  /**
   * 标记任务为失败
   * @param taskId 任务ID
   * @param errorMessage 错误信息
   * @param isRetryable 是否可重试
   */
  async markTaskFailed(
    taskId: number,
    errorMessage: string | undefined,
    isRetryable: boolean = true,
    errorCode?: string,
  ): Promise<void> {
    const db = useDB()
    const task = await db
      .select()
      .from(tables.pipelineQueue)
      .where(eq(tables.pipelineQueue.id, taskId))
      .get()

    if (!task) return

    const newAttempts = task.attempts + 1
    const targetMaxAttempts = isRetryable && isWindowsFileAccessErrorCode(errorCode)
      ? Math.max(task.maxAttempts, 20)
      : task.maxAttempts
    const shouldRetry = isRetryable && newAttempts < targetMaxAttempts

    const retryDelay = shouldRetry
      ? Math.min(
          1000 * Math.pow(2, newAttempts - 1),
          isWindowsFileAccessErrorCode(errorCode) ? 60000 : 30000,
        )
      : 0

    await db
      .update(tables.pipelineQueue)
      .set({
        status: shouldRetry ? 'pending' : 'failed',
        attempts: newAttempts,
        maxAttempts: targetMaxAttempts,
        errorMessage: errorMessage || 'Unknown error',
        ...(shouldRetry && retryDelay > 0
          ? {
              createdAt: new Date(Date.now() + retryDelay),
            }
          : {}),
      })
      .where(eq(tables.pipelineQueue.id, taskId))

    if (shouldRetry) {
      this.logger.warn(
        `任务 ${taskId} 失败（第 ${newAttempts} 次尝试，共 ${targetMaxAttempts} 次），将在 ${retryDelay} 毫秒后重试：${errorMessage}`,
      )
    } else {
      this.logger.error(
        `任务 ${taskId} 永久失败${!isRetryable ? '（不可重试错误）' : ` 经过 ${newAttempts} 次尝试后`}：${errorMessage}`,
      )
    }
  }

  /** 任务处理器 */
  private processors = (() => {
    const processVideoFromStorageKey = async (params: {
      taskId: number
      storageKey: string
      albumId?: number
    }): Promise<Photo> => {
      const { taskId, storageKey, albumId } = params
      const storageProvider = getStorageManager().getProvider()
      const encryptionEnabled = await isStorageEncryptionEnabled()
      const toUrl = (key?: string | null) => {
        if (!key) return null
        return encryptionEnabled
          ? toFileProxyUrl(key)
          : storageProvider.getPublicUrl(key)
      }
      const photoId = generateSafePhotoId(storageKey)

      let storageObject = await storageProvider.getFileMeta(storageKey)
      let retries = 5

      while (!storageObject && retries > 0) {
        this.logger.info(
          `未在存储中找到视频文件，检查中（剩余重试次数：${retries}）：${storageKey}`,
        )
        const maybeBuffer = await storageProvider.get(storageKey)
        if (maybeBuffer) {
          storageObject = {
            key: storageKey,
            size: maybeBuffer.length,
            lastModified: new Date(),
          }
          break
        }

        if (retries > 1) {
          await new Promise(resolve => setTimeout(resolve, 500))
          retries--
          storageObject = await storageProvider.getFileMeta(storageKey)
        } else {
          break
        }
      }

      if (!storageObject) {
        this.logger.warn(`重试后未在存储中找到视频文件：${storageKey}`)
        throw new NonRetryableError(`未找到视频文件：${storageKey}`)
      }

      this.logger.success(`Video file found: ${storageKey}, size: ${storageObject.size}`)

      await this.updateTaskStage(taskId, 'video-metadata')
      this.logger.info(`[${taskId}:in-stage] 视频元数据提取`)
      const processedData = await processVideoMetadata(storageKey)
      if (!processedData) {
        throw new Error('视频元数据处理失败')
      }

      const { metadata, thumbnailBuffer } = processedData

      await this.updateTaskStage(taskId, 'video-thumbnail')
      this.logger.info(`[${taskId}:in-stage] 视频缩略图上传`)
      const thumbnailObject = await storageProvider.create(
        `thumbnails/${photoId}.webp`,
        thumbnailBuffer,
        'image/webp',
      )

      const result: Photo = {
        id: photoId,
        title: path.basename(storageKey, path.extname(storageKey)),
        description: null,
        dateTaken:
          storageObject.lastModified?.toISOString() || new Date().toISOString(),
        tags: null,
        width: metadata.width,
        height: metadata.height,
        aspectRatio: metadata.width / metadata.height,
        storageKey: storageKey,
        thumbnailKey: thumbnailObject.key,
        fileSize: storageObject.size || null,
        lastModified:
          storageObject.lastModified?.toISOString() || new Date().toISOString(),
        originalUrl: toUrl(storageKey),
        thumbnailUrl: toUrl(thumbnailObject.key),
        thumbnailHash: null,
        exif: null,
        latitude: null,
        longitude: null,
        country: null,
        city: null,
        locationName: null,
        isLivePhoto: 0,
        livePhotoVideoUrl: null,
        livePhotoVideoKey: null,
        isPanorama360: 0,
        isVideo: 1,
        duration: metadata.duration,
        videoCodec: metadata.videoCodec,
        audioCodec: metadata.audioCodec || null,
        bitrate: metadata.bitrate,
        frameRate: metadata.frameRate,
      }

      const db = useDB()
      await db.insert(tables.photos).values(result).onConflictDoUpdate({
        target: tables.photos.id,
        set: result,
      })

      if (albumId) {
        try {
          const album = await db
            .select()
            .from(tables.albums)
            .where(eq(tables.albums.id, albumId))
            .get()

          if (album) {
            const existingRelation = await db
              .select()
              .from(tables.albumPhotos)
              .where(
                sql`${tables.albumPhotos.albumId} = ${albumId} AND ${tables.albumPhotos.photoId} = ${photoId}`,
              )
              .get()

            if (!existingRelation) {
              await db
                .insert(tables.albumPhotos)
                .values({
                  albumId,
                  photoId: photoId,
                })
                .run()

              this.logger.info(
                `[${this.workerId}] 视频 ${photoId} 已添加到相册 ${albumId}`,
              )
            }
          }
        } catch (error) {
          this.logger.error(
            `[${this.workerId}] 处理视频 ${photoId} 时添加到相册 ${albumId} 失败：`,
            error,
          )
        }
      }

      return result
    }

    return {
      photo: async (task: PipelineQueueItem) => {
        const { id: taskId, payload } = task
        if (payload.type !== 'photo') {
          throw new Error(
            `照片任务的无效负载类型：${payload.type}`,
          )
        }
        const { storageKey } = payload
        const storageProvider = getStorageManager().getProvider()
        const encryptionEnabled = await isStorageEncryptionEnabled()
        const toUrl = (key?: string | null) => {
          if (!key) return null
          return encryptionEnabled ? toFileProxyUrl(key) : storageProvider.getPublicUrl(key)
        }
        const photoId = generateSafePhotoId(storageKey)

        try {
          this.logger.info(`开始处理任务 ${taskId}: ${storageKey}`)

          let storageObject = await storageProvider.getFileMeta(storageKey)
          let retries = 5

          while (!storageObject && retries > 0) {
            this.logger.info(`未在存储中找到照片文件，重试中（剩余重试次数：${retries}）：${storageKey}`)
            const maybeBuffer = await storageProvider.get(storageKey)
            if (maybeBuffer) {
              storageObject = {
                key: storageKey,
                size: maybeBuffer.length,
                lastModified: new Date(),
              }
              break
            }

            if (retries > 1) {
              await new Promise(resolve => setTimeout(resolve, 500))
              retries--
              storageObject = await storageProvider.getFileMeta(storageKey)
            } else {
              break
            }
          }

          if (!storageObject) {
            this.logger.warn(`重试后未在存储中找到照片文件：${storageKey}`)
            throw new NonRetryableError(`未在存储中找到照片文件：${storageKey}`)
          }

          this.logger.success(`照片文件找到：${storageKey}，大小：${storageObject.size}`)

          // STEP 1: 预处理 - 转换 HEIC 到 JPEG 并上传
          await this.updateTaskStage(taskId, 'preprocessing')
          this.logger.info(`[${taskId}:in-stage] 图片预处理`)
          const imageBuffers = await preprocessImageWithJpegUpload(storageKey)
          if (!imageBuffers) {
            throw new Error('Preprocessing failed')
          }

          // STEP 2: 元数据处理 - 使用 Sharp 处理图片元数据
          await this.updateTaskStage(taskId, 'metadata')
          this.logger.info(`[${taskId}:in-stage] 元数据提取`)
          const processedData = await processImageMetadataAndSharp(
            imageBuffers.processed,
            storageKey,
          )
          if (!processedData) {
            throw new Error('Metadata processing failed')
          }

          const { imageBuffer, metadata } = processedData

          // STEP 3: 生成缩略图
          await this.updateTaskStage(taskId, 'thumbnail')
          this.logger.info(`[${taskId}:in-stage] 缩略图生成`)
          const { thumbnailBuffer, thumbnailHash } =
            await generateThumbnailAndHash(imageBuffer, this.logger)

          // 上传缩略图到存储服务
          const thumbnailObject = await new Promise<any>((resolve, reject) => {
            setImmediate(async () => {
              try {
                const result = await storageProvider.create(
                  `thumbnails/${photoId}.webp`,
                  thumbnailBuffer,
                  'image/webp',
                )
                resolve(result)
              } catch (error) {
                reject(error)
              }
            })
          })

          // STEP 4: 提取 EXIF 数据
          await this.updateTaskStage(taskId, 'exif')
          this.logger.info(`[${taskId}:in-stage] EXIF 数据提取`)
          const exifData = await extractExifData(
            imageBuffer,
            imageBuffers.raw,
            this.logger,
          )

          // 提取照片基本信息
          const panoramaExifPatch = await detectPanoramaExifPatch({
            rawImageBuffer: imageBuffers.raw,
            processedImageBuffer: imageBuffer,
            width: metadata.width,
            height: metadata.height,
          })

          const mergedExif =
            exifData || Object.keys(panoramaExifPatch).length > 0
              ? { ...(exifData ?? {}), ...panoramaExifPatch }
              : null

          const photoInfo = extractPhotoInfo(storageKey, mergedExif)

          // STEP 5: 地理位置反向解析
          // 这里逆编码失败不报错，宽容处理
          await this.updateTaskStage(taskId, 'reverse-geocoding')
          this.logger.info(`[${taskId}:in-stage] 地理位置反向解析`)

          let coordinates = null
          let locationInfo = null
          if (mergedExif) {
            const { latitude, longitude } = parseGPSCoordinates(mergedExif)
            coordinates = { latitude, longitude }
            if (latitude && longitude) {
              locationInfo = await extractLocationFromGPS(latitude, longitude)
            }
          }

          // STEP 6: Motion Photo (XMP) 支持
          await this.updateTaskStage(taskId, 'motion-photo')
          this.logger.info(`[${taskId}:in-stage] Motion Photo 检测`)
          const motionPhotoInfo = imageBuffers.raw
            ? await processMotionPhotoFromXmp({
                photoId,
                storageKey,
                rawImageBuffer: imageBuffers.raw,
                exifData: mergedExif,
                storageProvider,
                logger: this.logger,
              })
            : null

          if (!imageBuffers.raw) {
            this.logger.warn(
              `[${taskId}:in-stage] 检测 LivePhoto 视频跳过：${storageKey} 缺少原始缓冲区`,
            )
          }

          // STEP 7: LivePhoto 视频配对（独立 MOV 文件）
          await this.updateTaskStage(taskId, 'live-photo')
          this.logger.info(`[${taskId}:in-stage] LivePhoto 视频检测`)
          let livePhotoInfo = null
          if (!motionPhotoInfo?.isMotionPhoto) {
            const livePhotoVideo = await findLivePhotoVideoForImage(storageKey)
            if (livePhotoVideo) {
              livePhotoInfo = {
                isLivePhoto: 1,
                livePhotoVideoUrl: toUrl(livePhotoVideo.videoKey),
                livePhotoVideoKey: livePhotoVideo.videoKey,
              }
              this.logger.info(
                `[${taskId}:in-stage] 找到 LivePhoto 视频: ${livePhotoVideo.videoKey}`,
              )
            }
          } else {
            livePhotoInfo = {
              isLivePhoto: 1,
              livePhotoVideoUrl: motionPhotoInfo.livePhotoVideoUrl || null,
              livePhotoVideoKey: motionPhotoInfo.livePhotoVideoKey || null,
            }
          }

          // 构建最终的 Photo 对象
          const db = useDB()
          const existingPanorama = await db
            .select({ isPanorama360: tables.photos.isPanorama360 })
            .from(tables.photos)
            .where(eq(tables.photos.id, photoId))
            .get()

          const detectedPanorama360 = mergedExif?.PanoramaDetected ? 1 : 0
          const isPanorama360 =
            existingPanorama?.isPanorama360 === 1 ? 1 : detectedPanorama360

          const result: Photo = {
            id: photoId,
            title: photoInfo.title,
            description: photoInfo.description,
            dateTaken: photoInfo.dateTaken,
            tags: photoInfo.tags,
            width: metadata.width,
            height: metadata.height,
            aspectRatio: metadata.width / metadata.height,
            storageKey: storageKey,
            thumbnailKey: thumbnailObject.key,
            fileSize: storageObject.size || null,
            lastModified: storageObject.lastModified?.toISOString() ||
              new Date().toISOString(),
            originalUrl: imageBuffers.jpegKey
              ? toUrl(imageBuffers.jpegKey) // 使用 JPEG 版本作为 originalUrl
              : toUrl(storageKey),
            thumbnailUrl: toUrl(thumbnailObject.key),
            thumbnailHash: thumbnailHash
              ? compressUint8Array(thumbnailHash)
              : null,
            exif: mergedExif,
            // 地理位置信息
            latitude: coordinates?.latitude || null,
            longitude: coordinates?.longitude || null,
            country: locationInfo?.country || null,
            city: locationInfo?.city || null,
            locationName: locationInfo?.locationName || null,
            // LivePhoto 相关字段
            isLivePhoto: motionPhotoInfo?.isMotionPhoto || livePhotoInfo?.isLivePhoto
              ? 1
              : 0,
            livePhotoVideoUrl: motionPhotoInfo?.livePhotoVideoUrl ||
              livePhotoInfo?.livePhotoVideoUrl ||
              null,
            livePhotoVideoKey: motionPhotoInfo?.livePhotoVideoKey ||
              livePhotoInfo?.livePhotoVideoKey ||
              null,
            isPanorama360,
            duration: null,
            isVideo: 0,
            videoCodec: null,
            audioCodec: null,
            bitrate: null,
            frameRate: null
          }
          await db.insert(tables.photos).values(result).onConflictDoUpdate({
            target: tables.photos.id,
            set: result,
          })

          // 如果 payload 中指定了 albumId，将照片添加到相册
          if (payload.albumId) {
            try {
              // 检查相册是否存在
              const album = await db
                .select()
                .from(tables.albums)
                .where(eq(tables.albums.id, payload.albumId))
                .get()

              if (album) {
                // 检查照片是否已经在相册中
                const existingRelation = await db
                  .select()
                  .from(tables.albumPhotos)
                  .where(
                    sql`${tables.albumPhotos.albumId} = ${payload.albumId} AND ${tables.albumPhotos.photoId} = ${photoId}`,
                  )
                  .get()

                if (!existingRelation) {
                  // 插入到关系表
                  await db
                    .insert(tables.albumPhotos)
                    .values({
                      albumId: payload.albumId,
                      photoId: photoId,
                    })
                    .run()

                  this.logger.info(
                    `添加照片 ${photoId} 到相册 ${payload.albumId} 成功`,
                  )
                } else {
                  this.logger.debug(
                    `照片 ${photoId} 已存在于相册 ${payload.albumId} 中`,
                  )
                }
              } else {
                this.logger.warn(
                  `相册 ${payload.albumId} 未找到，跳过相册关联`,
                )
              }
            } catch (error) {
              this.logger.error(
                `添加照片 ${photoId} 到相册 ${payload.albumId} 失败：`,
                error,
              )
            }
          }

          this.logger.success(`任务 ${taskId} 处理成功`)
          return result
        } catch (error) {
          this.logger.error(`任务 ${taskId} 处理失败`, error)
          throw error
        }
      },
      reverseGeocoding: async (task: PipelineQueueItem) => {
        const db = useDB()
        const { id: taskId, payload } = task

        if (payload.type !== 'photo-reverse-geocoding') {
          throw new Error(
            `无效的负载类型 ${payload.type} 用于反向地理编码任务`,
          )
        }

        const { photoId } = payload

        try {
          await this.updateTaskStage(taskId, 'reverse-geocoding')
          this.logger.info(
            `[${taskId}:in-stage] 为照片 ${photoId} 进行反向地理编码`,
          )

          const photo = await db
            .select()
            .from(tables.photos)
            .where(eq(tables.photos.id, photoId))
            .get()

          if (!photo) {
            this.logger.warn(
              `[${taskId}:reverse-geocoding] 照片 ${photoId} 未找到`,
            )
            throw new Error(`照片 ${photoId} 未找到`)
          }

          let latitude = payload.latitude ?? photo.latitude ?? undefined
          let longitude = payload.longitude ?? photo.longitude ?? undefined

          if (
            (latitude === undefined || latitude === null) ||
            (longitude === undefined || longitude === null)
          ) {
            if (photo.exif) {
              const coords = parseGPSCoordinates(photo.exif)
              if (latitude === undefined || latitude === null) {
                latitude = coords.latitude
              }
              if (longitude === undefined || longitude === null) {
                longitude = coords.longitude
              }
            }
          }

          const hasLatitude = latitude !== undefined && latitude !== null
          const hasLongitude = longitude !== undefined && longitude !== null

          if (!hasLatitude || !hasLongitude) {
            this.logger.warn(
              `[${taskId}:reverse-geocoding] 照片 ${photoId} 缺少坐标`,
            )
            await db
              .update(tables.photos)
              .set({
                latitude: null,
                longitude: null,
                country: null,
                city: null,
                locationName: null,
              })
              .where(eq(tables.photos.id, photoId))
            throw new Error(`照片 ${photoId} 缺少坐标`)
          }

          const locationInfo = await extractLocationFromGPS(
            latitude!,
            longitude!,
          )

          if (!locationInfo) {
            throw new Error(`从 GPS 坐标 (${latitude}, ${longitude}) 提取位置信息失败，可能是网络问题？`)
          }

          await db
            .update(tables.photos)
            .set({
              latitude: latitude!,
              longitude: longitude!,
              country: locationInfo.country ?? null,
              city: locationInfo.city ?? null,
              locationName: locationInfo.locationName ?? null,
            })
            .where(eq(tables.photos.id, photoId))

          this.logger.success(
            `[${taskId}:reverse-geocoding] 已更新照片 ${photoId} 的位置`,
          )
        } catch (error) {
          this.logger.error(
            `[${taskId}:reverse-geocoding] 为照片 ${photoId} 更新位置失败`,
            error,
          )
          throw error
        }
      },
      livePhotoDetect: async (task: PipelineQueueItem) => {
        const db = useDB()
        const storageProvider = getStorageManager().getProvider()
        const encryptionEnabled = await isStorageEncryptionEnabled()
        const toUrl = (key?: string | null) => {
          if (!key) return null
          return encryptionEnabled ? toFileProxyUrl(key) : storageProvider.getPublicUrl(key)
        }

        const { id: taskId, payload } = task
        if (payload.type !== 'live-photo-video') {
          throw new Error(
            `live-photo照片任务的无效负载类型：${payload.type}`,
          )
        }
        const { storageKey: videoKey, albumId } = payload

        try {
          this.logger.info(
            `开始处理 LivePhoto 检测任务 ${taskId}: ${videoKey}`,
          )

          let storageObject = await storageProvider.getFileMeta(videoKey)
          if (!storageObject) {
            const maybeBuffer = await storageProvider.get(videoKey)
            if (maybeBuffer) {
              storageObject = {
                key: videoKey,
                size: maybeBuffer.length,
                lastModified: new Date(),
              }
            }
          }
          if (!storageObject) {
            this.logger.warn(`LivePhoto 视频 ${videoKey} 不存在`)
            throw new NonRetryableError(`LivePhoto 视频 ${videoKey} 不存在`)
          }

          const videoFileName = path.basename(videoKey)
          if (!isLivePhotoVideo(videoFileName, storageObject.size)) {
            this.logger.info(
              `MOV ${videoKey} 不符合 LivePhoto 条件，按普通视频处理`,
            )
            await processVideoFromStorageKey({ taskId, storageKey: videoKey, albumId })
            return
          }

          // 寻找是否有同名的照片文件
          const videoDir = path.dirname(videoKey)
          const videoBaseName = path.basename(videoKey, path.extname(videoKey))

          const possiblePhotoKeys = [
            path.join(videoDir, `${videoBaseName}.HEIC`).replace(/\\/g, '/'),
            path.join(videoDir, `${videoBaseName}.heic`).replace(/\\/g, '/'),
            path.join(videoDir, `${videoBaseName}.JPG`).replace(/\\/g, '/'),
            path.join(videoDir, `${videoBaseName}.jpg`).replace(/\\/g, '/'),
            path.join(videoDir, `${videoBaseName}.JPEG`).replace(/\\/g, '/'),
            path.join(videoDir, `${videoBaseName}.jpeg`).replace(/\\/g, '/'),
          ]

          const findMatchedPhoto = async (): Promise<Photo | null> => {
            for (const photoKey of possiblePhotoKeys) {
              const photos = await db
                .select()
                .from(tables.photos)
                .where(eq(tables.photos.storageKey, photoKey))
                .limit(1)

              if (photos.length > 0) {
                this.logger.info(`LivePhoto 视频 ${videoKey} 匹配照片 ${photoKey}`)
                return photos[0]
              }
            }

            return null
          }

          let matchedPhoto = await findMatchedPhoto()

          if (!matchedPhoto) {
            let hasMatchingPhotoFile = false
            for (const photoKey of possiblePhotoKeys) {
              const meta = await storageProvider.getFileMeta(photoKey)
              if (meta) {
                hasMatchingPhotoFile = true
                break
              }
            }

            if (hasMatchingPhotoFile) {
              const waitStartTime = Date.now()
              const maxWaitMs = 60_000
              while (!matchedPhoto && Date.now() - waitStartTime < maxWaitMs) {
                await new Promise(resolve => setTimeout(resolve, 1000))
                matchedPhoto = await findMatchedPhoto()
              }
            }
          }

          if (!matchedPhoto) {
            this.logger.info(`LivePhoto 视频 ${videoKey} 没有匹配的照片，按普通视频处理`)
            await processVideoFromStorageKey({ taskId, storageKey: videoKey, albumId })
            return
          }

          const livePhotoVideoUrl = toUrl(videoKey)
          await db
            .update(tables.photos)
            .set({
              isLivePhoto: 1,
              livePhotoVideoUrl,
              livePhotoVideoKey: videoKey,
            })
            .where(eq(tables.photos.id, matchedPhoto.id))

          this.logger.success(
            `LivePhoto 检测任务 ${taskId} 成功，更新照片 ${matchedPhoto.id}`,
          )
        } catch (error) {
          this.logger.error(
            `LivePhoto 检测任务 ${taskId} 处理失败`,
            error,
          )
          throw error
        }
      },
      fileEncryption: async (task: PipelineQueueItem) => {
        const { id: taskId, payload } = task
        if (payload.type !== 'file-encryption') {
          throw new Error(
            `无效的任务有效载荷类型：${payload.type}，文件加密任务需要 'file-encryption' 类型`
          )
        }
        const { storageKey } = payload
        const storageProvider = getStorageManager().getProvider()

        try {
          this.logger.info(`开始加密文件任务 ${taskId}：${storageKey}`)

          await this.updateTaskStage(taskId, 'encrypting')
          this.logger.info(`[${taskId}:in-stage] encrypting file`)

          if (!storageProvider.encryptFile) {
            this.logger.warn(`存储提供程序不支持加密`)
            return
          }

          await storageProvider.encryptFile(storageKey)

          this.logger.success(`文件加密任务 ${taskId} 成功: ${storageKey}`)
        } catch (error) {
          this.logger.error(`文件加密任务 ${taskId} 失败`, error)
          throw error
        }
      },
      video: async (task: PipelineQueueItem) => {
        const { id: taskId, payload } = task
        if (payload.type !== 'video') {
          throw new Error(
            `无效的任务有效载荷类型：${payload.type}，视频任务需要 'video' 类型`
          )
        }
        const { storageKey } = payload
        const storageProvider = getStorageManager().getProvider()
        const encryptionEnabled = await isStorageEncryptionEnabled()
        const toUrl = (key?: string | null) => {
          if (!key) return null
          return encryptionEnabled ? toFileProxyUrl(key) : storageProvider.getPublicUrl(key)
        }
        const photoId = generateSafePhotoId(storageKey)

        try {
          this.logger.info(`开始处理视频任务 ${taskId}: ${storageKey}`)

          let storageObject = await storageProvider.getFileMeta(storageKey)
          let retries = 5

          while (!storageObject && retries > 0) {
            this.logger.info(`未在存储中找到视频文件，检查中（剩余重试次数：${retries}）：${storageKey}`)
            const maybeBuffer = await storageProvider.get(storageKey)
            if (maybeBuffer) {
              storageObject = {
                key: storageKey,
                size: maybeBuffer.length,
                lastModified: new Date(),
              }
              break
            }

            if (retries > 1) {
              await new Promise(resolve => setTimeout(resolve, 500))
              retries--
              storageObject = await storageProvider.getFileMeta(storageKey)
            } else {
              break
            }
          }

          if (!storageObject) {
            this.logger.warn(`重试后未在存储中找到视频文件：${storageKey}`)
            throw new NonRetryableError(`未找到视频文件：${storageKey}`)
          }

          this.logger.success(`Video file found: ${storageKey}, size: ${storageObject.size}`)

          await this.updateTaskStage(taskId, 'video-metadata')
          this.logger.info(`[${taskId}:in-stage] 视频元数据提取`)
          const processedData = await processVideoMetadata(storageKey)
          if (!processedData) {
            throw new Error('视频元数据处理失败')
          }

          const { metadata, thumbnailBuffer } = processedData

          await this.updateTaskStage(taskId, 'video-thumbnail')
          this.logger.info(`[${taskId}:in-stage] 视频缩略图上传`)
          const thumbnailObject = await storageProvider.create(
            `thumbnails/${photoId}.webp`,
            thumbnailBuffer,
            'image/webp',
          )

          const result: Photo = {
            id: photoId,
            title: path.basename(storageKey, path.extname(storageKey)),
            description: null,
            dateTaken: storageObject.lastModified?.toISOString() || new Date().toISOString(),
            tags: null,
            width: metadata.width,
            height: metadata.height,
            aspectRatio: metadata.width / metadata.height,
            storageKey: storageKey,
            thumbnailKey: thumbnailObject.key,
            fileSize: storageObject.size || null,
            lastModified: storageObject.lastModified?.toISOString() || new Date().toISOString(),
            originalUrl: toUrl(storageKey),
            thumbnailUrl: toUrl(thumbnailObject.key),
            thumbnailHash: null,
            exif: null,
            latitude: null,
            longitude: null,
            country: null,
            city: null,
            locationName: null,
            isLivePhoto: 0,
            livePhotoVideoUrl: null,
            livePhotoVideoKey: null,
            isPanorama360: 0,
            isVideo: 1,
            duration: metadata.duration,
            videoCodec: metadata.videoCodec,
            audioCodec: metadata.audioCodec || null,
            bitrate: metadata.bitrate,
            frameRate: metadata.frameRate,
          }

          const db = useDB()
          await db.insert(tables.photos).values(result).onConflictDoUpdate({
            target: tables.photos.id,
            set: result,
          })

          if (payload.albumId) {
            try {
              const album = await db
                .select()
                .from(tables.albums)
                .where(eq(tables.albums.id, payload.albumId))
                .get()

              if (album) {
                const existingRelation = await db
                  .select()
                  .from(tables.albumPhotos)
                  .where(
                    sql`${tables.albumPhotos.albumId} = ${payload.albumId} AND ${tables.albumPhotos.photoId} = ${photoId}`,
                  )
                  .get()

                if (!existingRelation) {
                  await db
                    .insert(tables.albumPhotos)
                    .values({
                      albumId: payload.albumId,
                      photoId: photoId,
                    })
                    .run()

                  this.logger.info(
                    `[${this.workerId}] 视频 ${photoId} 已添加到相册 ${payload.albumId}`,
                  )
                }
              }
            } catch (error) {
              this.logger.error(
                `[${this.workerId}] 处理视频 ${photoId} 时添加到相册 ${payload.albumId} 失败：`,
                error,
              )
            }
          }

          this.logger.success(`[${this.workerId}] 任务 ${taskId} 处理成功`)
          return result
        } catch (error) {
          this.logger.error(`[${this.workerId}] 任务 ${taskId} 处理失败`, error)
          throw error
        }
      },
    }
  })()

  /**
   * 处理下一个待处理任务
   */
  private async processNextTask(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug('任务正在处理中，跳过此轮询')
      return
    }

    this.isProcessing = true

    try {
      const task = await this.getNextTask()
      if (!task) {
        this.logger.debug('当前没有待处理任务')
        return
      }

      try {
        const { type } = task.payload

        switch (type) {
          case 'live-photo-video':
            await this.processors.livePhotoDetect(task)
            break
          case 'photo':
            await this.processors.photo(task)
            break
          case 'video':
            await this.processors.video(task)
            break
          case 'photo-reverse-geocoding':
            await this.processors.reverseGeocoding(task)
            break
          case 'file-encryption':
            await this.processors.fileEncryption(task)
            break
          default:
            throw new Error(`Unknown task type: ${type}`)
        }

        await this.markTaskCompleted(task.id)
        this.processedCount++
        this.logger.success(
          `[${this.workerId}] 任务 ${task.id} 处理成功（总计：${this.processedCount}）`,
        )

        // const result = await this.processTask(task)
        // if (result) {
        //   await this.markTaskCompleted(task.id)
        //   this.processedCount++
        //   this.logger.success(
        //     `[${this.workerId}] Task ${task.id} processed successfully (Total: ${this.processedCount})`,
        //   )
        // } else {
        //   await this.markTaskFailed(task.id, 'Processing result is empty')
        //   this.errorCount++
        // }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        const errorCode = getErrnoCode(error)
        const isRetryable = !(error instanceof NonRetryableError)
        await this.markTaskFailed(task.id, errorMessage, isRetryable, errorCode)
        this.errorCount++
        this.logger.error(
          `[${this.workerId}] 任务 ${task.id} 处理失败（错误：${this.errorCount}）：`,
          errorMessage,
        )
      }
    } catch (error) {
      this.logger.error('获取下一个任务时发生错误：', error)
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * 开始处理队列
   * @param intervalMs 轮询间隔
   */
  startProcessing(intervalMs: number = 3000): void {
    if (this.processingInterval) return

    this.processingInterval = setInterval(() => {
      this.processNextTask().catch((error) => {
        this.logger.error('处理队列时发生错误：', error)
      })
    }, intervalMs)

    this.logger.success(
      `队列处理已启动，间隔为：${intervalMs}毫秒`,
    )

    this.processNextTask().catch((error) => {
      this.logger.error('处理队列时发生错误：', error)
    })
  }

  /**
   * 停止处理队列
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval)
      this.processingInterval = null
      this.logger.warn('Queue processing stopped')
    }
  }

  /**
   * 获取队列统计信息
   * @returns 队列统计信息
   */
  async getQueueStats() {
    const db = useDB()
    const stats = await db
      .select({
        status: tables.pipelineQueue.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(tables.pipelineQueue)
      .groupBy(tables.pipelineQueue.status)

    return stats.reduce(
      (acc, stat) => {
        acc[stat.status] = stat.count
        return acc
      },
      {} as Record<string, number>,
    )
  }
}
