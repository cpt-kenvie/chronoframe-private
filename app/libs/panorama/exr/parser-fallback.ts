import parseExr from 'parse-exr'
import { halfToFloat } from '../half-float'
import { PanoramaDecoderError } from '../decode-error'
import type { PanoramaMetadata } from '../types'

type EXRDecodeResult = PanoramaMetadata & {
  decodeWidth: number
  decodeHeight: number
  data: Float32Array
}

const PARSE_EXR_FLOAT_TYPE = 1015
const PARSE_EXR_RGBA_FORMAT = 1023
const PARSE_EXR_RED_FORMAT = 1028

const readSample = (data: Float32Array | Uint16Array, offset: number): number => {
  return data instanceof Float32Array ? data[offset]! : halfToFloat(data[offset]!)
}

export const decodeEXRWithParserFallback = async (
  buffer: ArrayBuffer,
  decodeWidth: number,
  decodeHeight: number,
  compression?: string,
): Promise<EXRDecodeResult> => {
  try {
    const parsed = parseExr(buffer, PARSE_EXR_FLOAT_TYPE)
    const width = parsed.width
    const height = parsed.height
    const data = parsed.data
    const out = new Float32Array(decodeWidth * decodeHeight * 3)
    const stepX = width / decodeWidth
    const stepY = height / decodeHeight
    const components = parsed.format === PARSE_EXR_RGBA_FORMAT ? 4 : 1

    if (parsed.format !== PARSE_EXR_RGBA_FORMAT && parsed.format !== PARSE_EXR_RED_FORMAT) {
      throw new Error('Unsupported parsed EXR channel layout')
    }

    for (let y = 0; y < decodeHeight; y++) {
      const srcY = height - 1 - Math.min(height - 1, Math.floor(y * stepY))
      for (let x = 0; x < decodeWidth; x++) {
        const srcX = Math.min(width - 1, Math.floor(x * stepX))
        const src = (srcY * width + srcX) * components
        const dst = (y * decodeWidth + x) * 3
        const r = readSample(data, src)
        const g = components === 4 ? readSample(data, src + 1) : r
        const b = components === 4 ? readSample(data, src + 2) : r
        out[dst] = r
        out[dst + 1] = g
        out[dst + 2] = b
      }
    }

    return {
      format: 'exr',
      width,
      height,
      compression,
      decodeWidth,
      decodeHeight,
      data: out,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new PanoramaDecoderError(`EXR decode failed: ${message}`, {
      code: 'panorama-decode-failed',
      compression,
    })
  }
}
