import path from 'path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { and, eq } from 'drizzle-orm'
import { getStorageManager } from '~~/server/plugins/3.storage'
import { toFileProxyUrl } from '~~/server/utils/publicFile'

// Live Photo 视频的体积上限，用于避免把普通长视频误判为配对视频。
const MAX_LIVE_PHOTO_VIDEO_SIZE_BYTES = 12 * 1024 * 1024
// 单个 Live Photo 转码的最长执行时间，防止异常媒体长期占用工作进程。
const LIVE_PHOTO_TRANSCODE_TIMEOUT_MS = 2 * 60 * 1000
// FFmpeg 错误输出上限，避免异常文件产生过量日志占用内存。
const FFMPEG_MAX_OUTPUT_BYTES = 1024 * 1024

const execFileAsync = promisify(execFile)

interface LivePhotoPlaybackVideo {
  videoKey: string
  videoSize: number
}

const transcodeJobs = new Map<
  string,
  Promise<LivePhotoPlaybackVideo | null>
>()

const transcodeLivePhotoVideo = async (
  videoKey: string,
): Promise<LivePhotoPlaybackVideo | null> => {
  const extension = path.extname(videoKey).toLowerCase()
  const storageProvider = getStorageManager().getProvider()

  if (extension === '.mp4') {
    const metadata = await storageProvider.getFileMeta(videoKey)
    return metadata?.size === undefined
      ? null
      : { videoKey, videoSize: metadata.size }
  }
  if (extension !== '.mov') return null

  const mp4Key = `${videoKey.slice(0, -extension.length)}.livephoto.mp4`
  const existingMp4 = await storageProvider.getFileMeta(mp4Key)
  if (existingMp4?.size !== undefined) {
    return { videoKey: mp4Key, videoSize: existingMp4.size }
  }

  const source = await storageProvider.getStream(videoKey)
  if (!source) return null

  const tempBaseName = `chronoframe-live-photo-${randomUUID()}`
  const inputPath = path.join(os.tmpdir(), `${tempBaseName}.mov`)
  const outputPath = path.join(os.tmpdir(), `${tempBaseName}.mp4`)

  try {
    await pipeline(source.stream, createWriteStream(inputPath))
    await execFileAsync(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      {
        timeout: LIVE_PHOTO_TRANSCODE_TIMEOUT_MS,
        maxBuffer: FFMPEG_MAX_OUTPUT_BYTES,
      },
    )

    const outputStat = await fs.stat(outputPath)
    if (storageProvider.createFromStream) {
      await storageProvider.createFromStream(
        mp4Key,
        createReadStream(outputPath),
        outputStat.size,
        'video/mp4',
      )
    } else {
      await storageProvider.create(
        mp4Key,
        await fs.readFile(outputPath),
        'video/mp4',
      )
    }

    logger.chrono.success(`LivePhoto 视频已转码为 MP4: ${mp4Key}`)
    return { videoKey: mp4Key, videoSize: outputStat.size }
  } catch (error) {
    logger.chrono.error(`LivePhoto 视频转码失败: ${videoKey}`, error)
    return null
  } finally {
    await Promise.all([
      fs.unlink(inputPath).catch(() => undefined),
      fs.unlink(outputPath).catch(() => undefined),
    ])
  }
}

/**
 * 为浏览器准备真正的 MP4 播放文件，并合并同一源文件的并发转码请求。
 */
export const ensureLivePhotoPlaybackVideo = async (
  videoKey: string,
): Promise<LivePhotoPlaybackVideo | null> => {
  const runningJob = transcodeJobs.get(videoKey)
  if (runningJob) return await runningJob

  const job = transcodeLivePhotoVideo(videoKey)
  transcodeJobs.set(videoKey, job)
  try {
    return await job
  } finally {
    if (transcodeJobs.get(videoKey) === job) {
      transcodeJobs.delete(videoKey)
    }
  }
}

/**
 * 仅对已入库的 Live Photo MOV 做按需转码，普通 MOV 文件保持原样。
 */
export const resolveLivePhotoPlaybackKey = async (
  videoKey: string,
): Promise<string> => {
  if (path.extname(videoKey).toLowerCase() !== '.mov') return videoKey

  const livePhoto = await useDB()
    .select({ id: tables.photos.id })
    .from(tables.photos)
    .where(
      and(
        eq(tables.photos.isLivePhoto, 1),
        eq(tables.photos.livePhotoVideoKey, videoKey),
      ),
    )
    .get()
  if (!livePhoto) return videoKey

  return (await ensureLivePhotoPlaybackVideo(videoKey))?.videoKey ?? videoKey
}

/**
 * 处理 LivePhoto MOV 文件，匹配相同文件名的照片并更新 LivePhoto 信息
 */
export const processLivePhotoVideo = async (
  videoKey: string,
  _videoSize: number
): Promise<boolean> => {
  const db = useDB()
  
  try {
    // 从视频文件名提取基础名称（去除扩展名）
    const videoBaseName = path.basename(videoKey, path.extname(videoKey))
    const videoDir = path.dirname(videoKey)
    
    logger.chrono.info(`Processing LivePhoto video: ${videoKey}, looking for photo with base name: ${videoBaseName}`)
    
    // 查找可能匹配的照片文件名模式
    // LivePhoto 通常会有相同的基础文件名，但照片可能是 .HEIC/.JPG 等格式
    const possiblePhotoKeys = [
      path.join(videoDir, `${videoBaseName}.HEIC`).replace(/\\/g, '/'),
      path.join(videoDir, `${videoBaseName}.heic`).replace(/\\/g, '/'),
      path.join(videoDir, `${videoBaseName}.JPG`).replace(/\\/g, '/'),
      path.join(videoDir, `${videoBaseName}.jpg`).replace(/\\/g, '/'),
      path.join(videoDir, `${videoBaseName}.JPEG`).replace(/\\/g, '/'),
      path.join(videoDir, `${videoBaseName}.jpeg`).replace(/\\/g, '/'),
    ]
    
    // 在数据库中查找匹配的照片
    let matchedPhoto = null
    for (const photoKey of possiblePhotoKeys) {
      const photos = await db
        .select()
        .from(tables.photos)
        .where(eq(tables.photos.storageKey, photoKey))
        .limit(1)
      
      if (photos.length > 0) {
        matchedPhoto = photos[0]
        logger.chrono.info(`Found matching photo: ${photoKey}`)
        break
      }
    }
    
    if (!matchedPhoto) {
      logger.chrono.warn(`No matching photo found for LivePhoto video: ${videoKey}`)
      return false
    }
    
    const playbackVideo = await ensureLivePhotoPlaybackVideo(videoKey)
    if (!playbackVideo) return false

    // 媒体 URL 统一通过权限代理生成，避免隐藏相册文件泄漏。
    const videoUrl = toFileProxyUrl(playbackVideo.videoKey)
    
    // 更新照片记录，设置 LivePhoto 信息
    await db
      .update(tables.photos)
      .set({
        isLivePhoto: 1,
        livePhotoVideoUrl: videoUrl,
        livePhotoVideoKey: playbackVideo.videoKey,
      })
      .where(eq(tables.photos.id, matchedPhoto.id))
    
    logger.chrono.success(`Successfully processed LivePhoto: ${matchedPhoto.id}, video: ${playbackVideo.videoKey}`)
    return true
    
  } catch (error) {
    logger.chrono.error(`Failed to process LivePhoto video ${videoKey}:`, error)
    return false
  }
}

/**
 * 检查存储桶中是否有与照片对应的 LivePhoto 视频文件
 */
export const findLivePhotoVideoForImage = async (
  imageKey: string
): Promise<{ videoKey: string; videoSize: number } | null> => {
  const storageProvider = getStorageManager().getProvider()
  
  try {
    // 从图片文件名提取基础名称（去除扩展名）
    const imageBaseName = path.basename(imageKey, path.extname(imageKey))
    const imageDir = path.dirname(imageKey)
    
    logger.chrono.info(`Checking for LivePhoto video for image: ${imageKey}, base name: ${imageBaseName}`)
    
    // 查找可能匹配的视频文件名模式
    const possibleVideoKeys = [
      path.join(imageDir, `${imageBaseName}.MP4`).replace(/\\/g, '/'),
      path.join(imageDir, `${imageBaseName}.mp4`).replace(/\\/g, '/'),
      path.join(imageDir, `${imageBaseName}.MOV`).replace(/\\/g, '/'),
      path.join(imageDir, `${imageBaseName}.mov`).replace(/\\/g, '/'),
    ]
    
    // 检查存储中是否存在对应的视频文件
    for (const videoKey of possibleVideoKeys) {
      try {
        const metadata = await storageProvider.getFileMeta(videoKey)
        if (metadata?.size !== undefined) {
          const videoSize = metadata.size

          // 检查是否符合 LivePhoto 视频的特征
          const fileName = path.basename(videoKey)
          if (isLivePhotoVideo(fileName, videoSize)) {
            const playbackVideo = await ensureLivePhotoPlaybackVideo(videoKey)
            if (!playbackVideo) continue
            logger.chrono.info(`Found matching LivePhoto video: ${playbackVideo.videoKey}`)
            return playbackVideo
          } else {
            logger.chrono.warn(`Video file found but doesn't match LivePhoto criteria: ${videoKey} (size: ${videoSize})`)
          }
        }
      } catch {
        // 文件不存在，继续检查下一个
        continue
      }
    }
    
    logger.chrono.info(`No matching LivePhoto video found for image: ${imageKey}`)
    return null
    
  } catch (error) {
    logger.chrono.error(`Failed to check for LivePhoto video for ${imageKey}:`, error)
    return null
  }
}

/**
 * 检查文件是否为 MOV 视频格式
 */
export const isVideoFile = (fileName: string): boolean => {
  const extName = path.extname(fileName).toLowerCase()
  return ['.mov', '.mp4'].includes(extName)
}

/**
 * 检查文件是否可能是 LivePhoto 的 MOV 文件
 * LivePhoto 的 MOV 文件通常很小（几MB以内）
 */
export const isLivePhotoVideo = (fileName: string, fileSize: number): boolean => {
  const extName = path.extname(fileName).toLowerCase()
  
  // 已完成转码的 MP4 仍属于 Live Photo 配对视频。
  if (extName !== '.mov' && extName !== '.mp4') {
    return false
  }
  
  return fileSize <= MAX_LIVE_PHOTO_VIDEO_SIZE_BYTES
}
