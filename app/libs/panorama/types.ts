export type PanoramaFormat = 'hdr' | 'exr'

export type ToneMappingMode = 'reinhard' | 'aces' | 'linear'

export interface PanoramaMetadata {
  format: PanoramaFormat
  width: number
  height: number
  compression?: string
}

export type PanoramaDecodeTarget =
  | {
      kind: 'rgb16f'
    }
  | {
      kind: 'rgba8'
      exposure: number
      toneMapping: ToneMappingMode
      gamma: number
    }

export type PanoramaDecodeQuality = 'low' | 'medium' | 'high'

export interface PanoramaDecodeRequest {
  id: string
  format: PanoramaFormat
  buffer: ArrayBuffer
  quality: PanoramaDecodeQuality
  maxTextureSize: number
  target: PanoramaDecodeTarget
}

export interface PanoramaDecodeResultBase extends PanoramaMetadata {
  id: string
  decodeWidth: number
  decodeHeight: number
}

export type PanoramaDecodeResult =
  | (PanoramaDecodeResultBase & {
      kind: 'rgb16f'
      data: Uint16Array
    })
  | (PanoramaDecodeResultBase & {
      kind: 'rgba8'
      data: Uint8ClampedArray
    })

export type PanoramaDecodeErrorCode =
  | 'unsupported-exr-compression'
  | 'panorama-decode-failed'

export type PanoramaDecodeError = {
  id: string
  message: string
  code?: PanoramaDecodeErrorCode
  compression?: string
}

