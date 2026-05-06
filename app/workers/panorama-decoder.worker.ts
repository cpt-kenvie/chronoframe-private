import { decodeHDRToFloatRGB, readHDRMetadata } from '~/libs/panorama/hdr/decode'
import {
  decodeEXRToFloatRGB,
  isNativeEXRCompression,
  readEXRMetadata,
} from '~/libs/panorama/exr/decode'
import { decodeEXRWithParserFallback } from '~/libs/panorama/exr/parser-fallback'
import { PanoramaDecoderError } from '~/libs/panorama/decode-error'
import { floatToHalf } from '~/libs/panorama/half-float'
import { linearToSRGB8 } from '~/libs/panorama/tone-map'
import type {
  PanoramaDecodeError,
  PanoramaDecodeRequest,
  PanoramaDecodeResult,
  PanoramaDecodeTarget,
  PanoramaMetadata,
} from '~/libs/panorama/types'

const chooseDecodeMaxDim = (
  quality: PanoramaDecodeRequest['quality'],
  maxTextureSize: number,
) => {
  const base = quality === 'low' ? 1024 : quality === 'medium' ? 2048 : 4096
  return Math.max(256, Math.min(base, maxTextureSize))
}

const computeDecodeSize = (
  meta: PanoramaMetadata,
  quality: PanoramaDecodeRequest['quality'],
  maxTextureSize: number,
) => {
  const maxDim = chooseDecodeMaxDim(quality, maxTextureSize)
  const srcMax = Math.max(meta.width, meta.height)
  const scale = srcMax > maxDim ? maxDim / srcMax : 1
  const decodeWidth = Math.max(1, Math.round(meta.width * scale))
  const decodeHeight = Math.max(1, Math.round(meta.height * scale))
  return { decodeWidth, decodeHeight }
}

const packFloatRGBToHalf = (rgb: Float32Array) => {
  const out = new Uint16Array(rgb.length)
  for (let i = 0; i < rgb.length; i++) {
    out[i] = floatToHalf(rgb[i]!)
  }
  return out
}

const toneMapFloatRGBToRGBA8 = (
  rgb: Float32Array,
  target: Extract<PanoramaDecodeTarget, { kind: 'rgba8' }>,
) => {
  const out = new Uint8ClampedArray((rgb.length / 3) * 4)
  let j = 0
  for (let i = 0; i < rgb.length; i += 3) {
    out[j] = linearToSRGB8(rgb[i]!, target.exposure, target.toneMapping, target.gamma)
    out[j + 1] = linearToSRGB8(rgb[i + 1]!, target.exposure, target.toneMapping, target.gamma)
    out[j + 2] = linearToSRGB8(rgb[i + 2]!, target.exposure, target.toneMapping, target.gamma)
    out[j + 3] = 255
    j += 4
  }
  return out
}

const decodeToFloatRGB = async (
  req: PanoramaDecodeRequest,
  decodeWidth: number,
  decodeHeight: number,
) => {
  if (req.format === 'hdr') {
    return decodeHDRToFloatRGB(req.buffer, decodeWidth, decodeHeight)
  }
  const meta = readEXRMetadata(req.buffer)
  if (!isNativeEXRCompression(meta.compression)) {
    return await decodeEXRWithParserFallback(
      req.buffer,
      decodeWidth,
      decodeHeight,
      meta.compression,
    )
  }
  return await decodeEXRToFloatRGB(req.buffer, decodeWidth, decodeHeight)
}

const readMetadata = (format: PanoramaDecodeRequest['format'], buffer: ArrayBuffer) => {
  return format === 'hdr' ? readHDRMetadata(buffer) : readEXRMetadata(buffer)
}

self.onmessage = async (event: MessageEvent<PanoramaDecodeRequest>) => {
  const req = event.data
  try {
    const meta = readMetadata(req.format, req.buffer)
    const { decodeWidth, decodeHeight } = computeDecodeSize(
      meta,
      req.quality,
      req.maxTextureSize,
    )

    const decoded = await decodeToFloatRGB(req, decodeWidth, decodeHeight)
    const rgb = decoded.data

    const base = {
      id: req.id,
      format: req.format,
      width: meta.width,
      height: meta.height,
      decodeWidth,
      decodeHeight,
    } as const

    let result: PanoramaDecodeResult
    if (req.target.kind === 'rgb16f') {
      result = {
        ...base,
        kind: 'rgb16f',
        data: packFloatRGBToHalf(rgb),
      }
    } else {
      result = {
        ...base,
        kind: 'rgba8',
        data: toneMapFloatRGBToRGBA8(rgb, req.target),
      }
    }

    const transfer: Transferable[] = [result.data.buffer]
    self.postMessage(result, transfer)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error: PanoramaDecodeError = {
      id: req.id,
      message,
      code: err instanceof PanoramaDecoderError ? err.code : undefined,
      compression: err instanceof PanoramaDecoderError ? err.compression : undefined,
    }
    self.postMessage(error)
  }
}

