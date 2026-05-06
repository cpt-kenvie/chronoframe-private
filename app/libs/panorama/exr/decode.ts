import { halfToFloat } from '../half-float'
import type { PanoramaMetadata } from '../types'
import { PanoramaDecoderError } from '../decode-error'

type EXRDecodeResult = PanoramaMetadata & {
  decodeWidth: number
  decodeHeight: number
  data: Float32Array
}

export type EXRCompression =
  | 'none'
  | 'rle'
  | 'zips'
  | 'zip'
  | 'piz'
  | 'pxr24'
  | 'b44'
  | 'b44a'
  | 'dwaa'
  | 'dwab'
  | `unknown-${number}`
type EXRPixelType = 0 | 1 | 2

type EXRChannel = {
  name: string
  pixelType: EXRPixelType
  xSampling: number
  ySampling: number
}

type EXRHeader = {
  width: number
  height: number
  dataMinX: number
  dataMinY: number
  channels: EXRChannel[]
  compression: EXRCompression
  offsetTablePos: number
}

type SelectedChannels = {
  r?: number
  g?: number
  b?: number
  y?: number
}

const EXR_COMPRESSION_BY_CODE: Readonly<Record<number, EXRCompression>> = {
  0: 'none',
  1: 'rle',
  2: 'zips',
  3: 'zip',
  4: 'piz',
  5: 'pxr24',
  6: 'b44',
  7: 'b44a',
  8: 'dwaa',
  9: 'dwab',
}

const NATIVE_EXR_COMPRESSIONS: ReadonlySet<string> = new Set([
  'none',
  'zips',
  'zip',
])

export const isNativeEXRCompression = (compression?: string): boolean => {
  return compression ? NATIVE_EXR_COMPRESSIONS.has(compression) : true
}

const readNullTerminatedString = (bytes: Uint8Array, offset: number) => {
  let end = offset
  while (end < bytes.length && bytes[end] !== 0) end++
  const value = new TextDecoder().decode(bytes.slice(offset, end))
  return { value, next: end + 1 }
}

const readInt32LE = (view: DataView, offset: number) => view.getInt32(offset, true)
const readUint32LE = (view: DataView, offset: number) => view.getUint32(offset, true)

const readUint64LE = (view: DataView, offset: number): number => {
  const lo = view.getUint32(offset, true)
  const hi = view.getUint32(offset + 4, true)
  return hi * 2 ** 32 + lo
}

const parseChannels = (value: Uint8Array) => {
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  let off = 0
  const channels: EXRChannel[] = []
  while (off < value.byteLength) {
    const { value: name, next } = readNullTerminatedString(value, off)
    off = next
    if (name === '') break
    if (off + 16 > value.byteLength) throw new Error('Invalid EXR channels')
    const pixelType = readInt32LE(view, off) as EXRPixelType
    off += 4
    off += 4
    const xSampling = readInt32LE(view, off)
    off += 4
    const ySampling = readInt32LE(view, off)
    off += 4
    channels.push({ name, pixelType, xSampling, ySampling })
  }
  if (channels.length === 0) throw new Error('EXR has no channels')
  return channels
}

const parseBox2i = (view: DataView, offset: number) => {
  const minX = readInt32LE(view, offset)
  const minY = readInt32LE(view, offset + 4)
  const maxX = readInt32LE(view, offset + 8)
  const maxY = readInt32LE(view, offset + 12)
  return { minX, minY, maxX, maxY }
}

const parseHeader = (buffer: ArrayBuffer): EXRHeader => {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  const magic = readUint32LE(view, 0)
  if (magic !== 20000630) throw new Error('Invalid EXR signature')

  let off = 8
  let dataWindow: { minX: number; minY: number; maxX: number; maxY: number } | null =
    null
  let channels: EXRChannel[] | null = null
  let compression: EXRCompression = 'none'
  let hasTiles = false

  while (off < bytes.length) {
    const { value: name, next } = readNullTerminatedString(bytes, off)
    off = next
    if (name === '') {
      break
    }
    const { value: type, next: next2 } = readNullTerminatedString(bytes, off)
    off = next2
    if (off + 4 > bytes.length) throw new Error('Invalid EXR header')
    const size = readUint32LE(view, off)
    off += 4
    const end = off + size
    if (end > bytes.length) throw new Error('Invalid EXR header attribute size')
    const value = bytes.slice(off, end)
    const valueView = new DataView(value.buffer, value.byteOffset, value.byteLength)
    if (name === 'dataWindow' && type === 'box2i' && size === 16) {
      dataWindow = parseBox2i(valueView, 0)
    } else if (name === 'channels' && type === 'chlist') {
      channels = parseChannels(value)
    } else if (name === 'compression' && type === 'compression' && size === 1) {
      const c = value[0]!
      compression = EXR_COMPRESSION_BY_CODE[c] ?? `unknown-${c}`
    } else if (name === 'tiles') {
      hasTiles = true
    }
    off = end
  }

  if (hasTiles) throw new Error('Tiled EXR is not supported')
  if (!dataWindow) throw new Error('EXR missing dataWindow')
  if (!channels) throw new Error('EXR missing channels')

  const width = dataWindow.maxX - dataWindow.minX + 1
  const height = dataWindow.maxY - dataWindow.minY + 1
  if (width <= 0 || height <= 0) throw new Error('Invalid EXR dataWindow')

  return {
    width,
    height,
    dataMinX: dataWindow.minX,
    dataMinY: dataWindow.minY,
    channels,
    compression,
    offsetTablePos: off,
  }
}

export const readEXRMetadata = (buffer: ArrayBuffer): PanoramaMetadata => {
  const header = parseHeader(buffer)
  return {
    format: 'exr',
    width: header.width,
    height: header.height,
    compression: header.compression,
  }
}

const splitChannelName = (name: string): { layer: string; component: string } => {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return { layer: '', component: name }
  return { layer: name.slice(0, dot), component: name.slice(dot + 1) }
}

const selectChannels = (channels: EXRChannel[]): SelectedChannels => {
  const layers = new Map<string, { order: number; map: Map<string, number> }>()
  let nextOrder = 0

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i]!
    const { layer, component } = splitChannelName(ch.name)
    const key = component.toUpperCase()
    let entry = layers.get(layer)
    if (!entry) {
      entry = { order: nextOrder++, map: new Map() }
      layers.set(layer, entry)
    }
    if (!entry.map.has(key)) {
      entry.map.set(key, i)
    }
  }

  const orderedLayers = Array.from(layers.entries()).sort((a, b) => a[1].order - b[1].order)
  const rgbLayer =
    orderedLayers.find(([layer, e]) => layer === '' && e.map.has('R') && e.map.has('G') && e.map.has('B')) ||
    orderedLayers.find(([, e]) => e.map.has('R') && e.map.has('G') && e.map.has('B'))

  if (rgbLayer) {
    const [, e] = rgbLayer
    return { r: e.map.get('R'), g: e.map.get('G'), b: e.map.get('B') }
  }

  const yLayer =
    orderedLayers.find(([layer, e]) => layer === '' && e.map.has('Y')) ||
    orderedLayers.find(([, e]) => e.map.has('Y'))

  if (yLayer) {
    const [, e] = yLayer
    return { y: e.map.get('Y') }
  }

  return { r: 0 }
}

const unshuffle = (input: Uint8Array): Uint8Array => {
  const out = new Uint8Array(input.length)
  const half = Math.floor((input.length + 1) / 2)
  let even = 0
  let odd = half
  for (let i = 0; i < input.length; i += 2) {
    out[i] = input[even]!
    even++
    if (i + 1 < input.length) {
      out[i + 1] = input[odd]!
      odd++
    }
  }
  return out
}

const reversePredictor = (data: Uint8Array) => {
  for (let i = 1; i < data.length; i++) {
    data[i] = (data[i]! + data[i - 1]! - 128) & 0xff
  }
}

const reversePredictorCopy = (data: Uint8Array) => {
  const out = new Uint8Array(data)
  reversePredictor(out)
  return out
}

const decompressDeflate = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not available')
  }
  const ds = new DecompressionStream('deflate')
  const stream = new Blob([data]).stream().pipeThrough(ds)
  const ab = await new Response(stream).arrayBuffer()
  return new Uint8Array(ab)
}

const decodePixel = (view: DataView, offset: number, type: EXRPixelType) => {
  if (type === 0) return view.getUint32(offset, true)
  if (type === 1) return halfToFloat(view.getUint16(offset, true))
  return view.getFloat32(offset, true)
}

const pixelByteSize = (type: EXRPixelType) => {
  if (type === 1) return 2
  return 4
}

export const decodeEXRToFloatRGB = async (
  buffer: ArrayBuffer,
  decodeWidth: number,
  decodeHeight: number,
): Promise<EXRDecodeResult> => {
  const header = parseHeader(buffer)
  if (!isNativeEXRCompression(header.compression)) {
    throw new PanoramaDecoderError(
      `Unsupported EXR compression: ${header.compression}`,
      {
        code: 'unsupported-exr-compression',
        compression: header.compression,
      },
    )
  }
  const view = new DataView(buffer)

  const width = header.width
  const height = header.height

  const blockLines = header.compression === 'zip' ? 16 : 1
  const blocks = Math.ceil(height / blockLines)

  const offsets: number[] = []
  let off = header.offsetTablePos
  for (let i = 0; i < blocks; i++) {
    offsets.push(readUint64LE(view, off))
    off += 8
  }

  const stepX = width / decodeWidth
  const stepY = height / decodeHeight
  const sourceYToTargets = new Map<number, number[]>()
  for (let y = 0; y < decodeHeight; y++) {
    const srcY = Math.min(height - 1, Math.floor(y * stepY))
    const list = sourceYToTargets.get(srcY)
    if (list) list.push(y)
    else sourceYToTargets.set(srcY, [y])
  }

  const out = new Float32Array(decodeWidth * decodeHeight * 3)

  const channelOrder = header.channels
  const selected = selectChannels(channelOrder)

  const bytesPerLine = channelOrder.reduce((sum, ch) => {
    return sum + width * pixelByteSize(ch.pixelType)
  }, 0)

  const channelBaseWithinLine: number[] = []
  {
    let base = 0
    for (const ch of channelOrder) {
      channelBaseWithinLine.push(base)
      base += width * pixelByteSize(ch.pixelType)
    }
  }

  const scoreUncompressed = (uncompressed: Uint8Array, linesInBlock: number) => {
    const chunkView = new DataView(
      uncompressed.buffer,
      uncompressed.byteOffset,
      uncompressed.byteLength,
    )

    const sampleXs = Math.min(width, 24)
    const step = Math.max(1, Math.floor(width / sampleXs))
    const lines = linesInBlock > 1 ? [0, Math.floor(linesInBlock / 2)] : [0]

    const readValueAt = (channelPos: number, x: number, lineIndex: number) => {
      const ch = channelOrder[channelPos]!
      const o =
        lineIndex * bytesPerLine +
        channelBaseWithinLine[channelPos]! +
        x * pixelByteSize(ch.pixelType)
      return decodePixel(chunkView, o, ch.pixelType)
    }

    const readRGB = (x: number, lineIndex: number) => {
      if (selected.r != null && selected.g != null && selected.b != null) {
        return [
          readValueAt(selected.r, x, lineIndex),
          readValueAt(selected.g, x, lineIndex),
          readValueAt(selected.b, x, lineIndex),
        ] as const
      }
      if (selected.y != null) {
        const yv = readValueAt(selected.y, x, lineIndex)
        return [yv, yv, yv] as const
      }
      const first = readValueAt(0, x, lineIndex)
      return [first, first, first] as const
    }

    let score = 0
    let total = 0
    for (const lineIndex of lines) {
      for (let x = 0; x < width; x += step) {
        const [r, g, b] = readRGB(x, lineIndex)
        total += 3
        if (Number.isFinite(r) && Math.abs(r) < 1e6) score++
        if (Number.isFinite(g) && Math.abs(g) < 1e6) score++
        if (Number.isFinite(b) && Math.abs(b) < 1e6) score++
      }
    }
    return total > 0 ? score / total : 0
  }

  let zipTransform: 'predictor-then-unshuffle' | 'unshuffle-then-predictor' | null = null

  const sampleLine = (
    chunkView: DataView,
    baseOffset: number,
    lineIndex: number,
    outYs: number[],
  ) => {
    const lineOffset = baseOffset + lineIndex * bytesPerLine
    const readValueAt = (channelPos: number, x: number) => {
      const ch = channelOrder[channelPos]!
      const o =
        lineOffset +
        channelBaseWithinLine[channelPos]! +
        x * pixelByteSize(ch.pixelType)
      return decodePixel(chunkView, o, ch.pixelType)
    }

    for (const outY of outYs) {
      const rowBase = outY * decodeWidth * 3
      for (let x = 0; x < decodeWidth; x++) {
        const srcX = Math.min(width - 1, Math.floor(x * stepX))
        let r = 0
        let g = 0
        let b = 0

        if (selected.r != null && selected.g != null && selected.b != null) {
          r = readValueAt(selected.r, srcX) as number
          g = readValueAt(selected.g, srcX) as number
          b = readValueAt(selected.b, srcX) as number
        } else if (selected.y != null) {
          const yv = readValueAt(selected.y, srcX) as number
          r = yv
          g = yv
          b = yv
        } else {
          const first = readValueAt(0, srcX) as number
          r = first
          g = first
          b = first
        }

        const o = rowBase + x * 3
        out[o] = r
        out[o + 1] = g
        out[o + 2] = b
      }
    }
  }

  for (let blockIndex = 0; blockIndex < blocks; blockIndex++) {
    const blockOffset = offsets[blockIndex]!
    if (blockOffset <= 0 || blockOffset >= buffer.byteLength) continue

    const y = readInt32LE(view, blockOffset)
    const size = readInt32LE(view, blockOffset + 4)
    const dataStart = blockOffset + 8
    const dataEnd = dataStart + size
    if (dataEnd > buffer.byteLength) throw new Error('Invalid EXR chunk size')

    const y0 = y - header.dataMinY
    const linesInBlock = Math.min(blockLines, height - y0)

    const compressed = new Uint8Array(buffer, dataStart, size)
    const expectedBytes = bytesPerLine * linesInBlock
    let uncompressed: Uint8Array

    if (header.compression === 'none') {
      if (compressed.byteLength !== expectedBytes) throw new Error('Invalid EXR chunk size')
      uncompressed = compressed
    } else {
      const inflated = await decompressDeflate(compressed)
      if (inflated.byteLength !== expectedBytes) throw new Error('Invalid EXR chunk size')

      if (!zipTransform) {
        const a = unshuffle(reversePredictorCopy(inflated))
        const b = unshuffle(inflated)
        reversePredictor(b)
        zipTransform =
          scoreUncompressed(a, linesInBlock) >= scoreUncompressed(b, linesInBlock)
            ? 'predictor-then-unshuffle'
            : 'unshuffle-then-predictor'
      }

      if (zipTransform === 'predictor-then-unshuffle') {
        uncompressed = unshuffle(reversePredictorCopy(inflated))
      } else {
        uncompressed = unshuffle(inflated)
        reversePredictor(uncompressed)
      }
    }

    const chunkView = new DataView(
      uncompressed.buffer,
      uncompressed.byteOffset,
      uncompressed.byteLength,
    )

    for (let line = 0; line < linesInBlock; line++) {
      const srcY = y0 + line
      const outYs = sourceYToTargets.get(srcY)
      if (!outYs) continue
      sampleLine(chunkView, 0, line, outYs)
    }
  }

  return {
    format: 'exr',
    width,
    height,
    decodeWidth,
    decodeHeight,
    data: out,
  }
}
