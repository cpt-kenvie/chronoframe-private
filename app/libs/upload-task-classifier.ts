const LIVE_PHOTO_VIDEO_EXTENSIONS = new Set(['.mov']) // Separate Live Photo video candidates exported by iOS
const LIVE_PHOTO_IMAGE_EXTENSIONS = new Set(['.heic', '.heif', '.jpg', '.jpeg']) // Image formats that can pair with an iOS MOV
const VIDEO_MIME_TYPES = new Set([ // Non-MOV video MIME types that should become standalone videos
  'video/mp4',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/x-flv',
  'video/x-ms-wmv',
  'video/3gpp',
  'video/mpeg',
])
const VIDEO_EXTENSIONS = new Set([ // Non-MOV video extensions that should become standalone videos
  '.mp4',
  '.avi',
  '.mkv',
  '.webm',
  '.flv',
  '.wmv',
  '.m4v',
  '.3gp',
  '.mpeg',
  '.mpg',
])

export type UploadTaskType = 'photo' | 'video' | 'live-photo-video'

const getFileExtension = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

const getFileBaseName = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.')
  const baseName = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName
  return baseName.toLowerCase()
}

const isLivePhotoVideoCandidate = (file: File) =>
  file.type === 'video/quicktime' ||
  LIVE_PHOTO_VIDEO_EXTENSIONS.has(getFileExtension(file.name))

const isSameBatchLivePhotoImage = (file: File, videoBaseName: string) =>
  LIVE_PHOTO_IMAGE_EXTENSIONS.has(getFileExtension(file.name)) &&
  getFileBaseName(file.name) === videoBaseName

export const hasSameBatchLivePhotoImage = (
  file: File,
  batchFiles: File[],
) => {
  if (!isLivePhotoVideoCandidate(file)) {
    return false
  }

  const videoBaseName = getFileBaseName(file.name)
  return batchFiles.some((candidate) =>
    candidate !== file && isSameBatchLivePhotoImage(candidate, videoBaseName),
  )
}

export const getUploadTaskType = (
  file: File,
  batchFiles: File[],
): UploadTaskType => {
  if (VIDEO_MIME_TYPES.has(file.type) || VIDEO_EXTENSIONS.has(getFileExtension(file.name))) {
    return 'video'
  }

  if (isLivePhotoVideoCandidate(file)) {
    return hasSameBatchLivePhotoImage(file, batchFiles)
      ? 'live-photo-video'
      : 'video'
  }

  return 'photo'
}

export const getUploadQueueRank = (file: File, batchFiles: File[]) => {
  const taskType = getUploadTaskType(file, batchFiles)
  if (taskType === 'photo') return 0
  if (taskType === 'video') return 1
  return 2
}
