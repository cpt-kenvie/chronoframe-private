import sharp from 'sharp'
import type { NeededExif } from '~~/shared/types/photo'

const MAX_XMP_SCAN_BYTES = 512 * 1024

const toBoolean = (value: unknown): boolean | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'bigint') return value !== BigInt(0)
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false
    return null
  }
  return null
}

const toInt = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildNamePattern = (localName: string) => {
  const escaped = escapeRegExp(localName)
  return `(?:[\\w-]+:)?${escaped}`
}

const extractXmpSegment = (buffer: Buffer): string | null => {
  const scanSize = Math.min(buffer.length, MAX_XMP_SCAN_BYTES)
  if (scanSize <= 0) return null

  const header = buffer.toString('utf8', 0, scanSize)
  const startIndex = header.indexOf('<x:xmpmeta')
  if (startIndex === -1) return null

  const endIndex = header.indexOf('</x:xmpmeta>', startIndex)
  if (endIndex === -1) return null

  return header.slice(startIndex, endIndex + '</x:xmpmeta>'.length)
}

const extractXmpElementText = (xmp: string, localName: string): string | null => {
  const name = buildNamePattern(localName)
  const regex = new RegExp(`<${name}[^>]*>([^<]+)</${name}\\s*>`, 'i')
  const match = xmp.match(regex)
  return match?.[1]?.trim() || null
}

const extractXmpAttributeText = (xmp: string, localName: string): string | null => {
  const name = buildNamePattern(localName)
  const regex = new RegExp(`${name}="([^"]+)"`, 'i')
  const match = xmp.match(regex)
  return match?.[1]?.trim() || null
}

const extractXmpText = (xmp: string, localName: string): string | null => {
  return extractXmpElementText(xmp, localName) ?? extractXmpAttributeText(xmp, localName)
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

const scoreEquirectangularRatio = (width: number, height: number) => {
  if (width <= 0 || height <= 0) return 0
  const ratio = width / height
  const diff = Math.abs(ratio - 2)
  const maxDiff = 0.25
  return clamp01(1 - diff / maxDiff)
}

const computeSeamSimilarity = async (imageBuffer: Buffer) => {
  const { data, info } = await sharp(imageBuffer, { limitInputPixels: false })
    .resize({ width: 512, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const width = info.width
  const height = info.height
  const channels = info.channels
  if (width <= 1 || height <= 1 || channels < 3) return null

  const stripe = Math.max(1, Math.min(16, Math.floor(width / 16)))
  if (width <= stripe * 2) return null

  let sumAbs = 0
  let count = 0
  for (let y = 0; y < height; y++) {
    const rowBase = y * width * channels
    for (let x = 0; x < stripe; x++) {
      const left = rowBase + x * channels
      const right = rowBase + (width - stripe + x) * channels
      sumAbs += Math.abs(data[left]! - data[right]!)
      sumAbs += Math.abs(data[left + 1]! - data[right + 1]!)
      sumAbs += Math.abs(data[left + 2]! - data[right + 2]!)
      count += 3
    }
  }

  const mean = count > 0 ? sumAbs / (count * 255) : 1
  return clamp01(1 - mean)
}

export const detectPanoramaExifPatch = async (args: {
  rawImageBuffer: Buffer
  processedImageBuffer: Buffer
  width: number
  height: number
}): Promise<Partial<NeededExif>> => {
  const patch: Partial<NeededExif> = {}

  const xmp = extractXmpSegment(args.rawImageBuffer)
  if (xmp) {
    const projectionType = extractXmpText(xmp, 'ProjectionType')
    const useViewer = toBoolean(extractXmpText(xmp, 'UsePanoramaViewer'))
    const fullW = toInt(extractXmpText(xmp, 'FullPanoWidthPixels'))
    const fullH = toInt(extractXmpText(xmp, 'FullPanoHeightPixels'))
    const cropW = toInt(extractXmpText(xmp, 'CroppedAreaImageWidthPixels'))
    const cropH = toInt(extractXmpText(xmp, 'CroppedAreaImageHeightPixels'))
    const cropL = toInt(extractXmpText(xmp, 'CroppedAreaLeftPixels'))
    const cropT = toInt(extractXmpText(xmp, 'CroppedAreaTopPixels'))

    if (projectionType) patch.GPanoProjectionType = projectionType
    if (useViewer !== null) patch.GPanoUsePanoramaViewer = useViewer
    if (fullW !== null) patch.GPanoFullPanoWidthPixels = fullW
    if (fullH !== null) patch.GPanoFullPanoHeightPixels = fullH
    if (cropW !== null) patch.GPanoCroppedAreaImageWidthPixels = cropW
    if (cropH !== null) patch.GPanoCroppedAreaImageHeightPixels = cropH
    if (cropL !== null) patch.GPanoCroppedAreaLeftPixels = cropL
    if (cropT !== null) patch.GPanoCroppedAreaTopPixels = cropT
  }

  const ratioScore = scoreEquirectangularRatio(args.width, args.height)
  const projection = patch.GPanoProjectionType?.toLowerCase()
  const xmpStrong: boolean =
    patch.GPanoUsePanoramaViewer === true ||
    projection === 'equirectangular' ||
    (patch.GPanoFullPanoWidthPixels != null && patch.GPanoFullPanoHeightPixels != null)

  let seamSimilarity: number | null = null
  if (!xmpStrong && ratioScore >= 0.7 && Math.max(args.width, args.height) >= 1600) {
    try {
      seamSimilarity = await computeSeamSimilarity(args.processedImageBuffer)
    } catch {
      seamSimilarity = null
    }
  }

  if (seamSimilarity !== null) {
    patch.PanoramaSeamSimilarity = Number(seamSimilarity.toFixed(4))
  }

  const shouldPersist =
    xmpStrong ||
    patch.GPanoProjectionType != null ||
    patch.GPanoUsePanoramaViewer != null ||
    ratioScore >= 0.9 ||
    seamSimilarity !== null
  if (!shouldPersist) {
    return {}
  }

  const confidence = clamp01(
    (xmpStrong ? 0.85 : 0) +
      ratioScore * 0.35 +
      (seamSimilarity !== null ? seamSimilarity * 0.35 : 0),
  )

  const detected =
    xmpStrong ||
    (ratioScore >= 0.9 && seamSimilarity !== null && seamSimilarity >= 0.82)

  patch.PanoramaDetected = detected
  patch.PanoramaConfidence = Number(confidence.toFixed(4))
  patch.PanoramaDetectionMethod = xmpStrong
    ? 'xmp'
    : seamSimilarity !== null
      ? 'ratio+seam'
      : ratioScore >= 0.9
        ? 'ratio'
        : 'none'

  return patch
}
