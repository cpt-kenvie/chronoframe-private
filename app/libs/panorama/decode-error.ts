import type { PanoramaDecodeErrorCode } from './types'

export type PanoramaDecodeErrorDetails = {
  code?: PanoramaDecodeErrorCode
  compression?: string
}

export class PanoramaDecoderError extends Error {
  code?: PanoramaDecodeErrorCode
  compression?: string

  constructor(
    message: string,
    details: PanoramaDecodeErrorDetails = {},
  ) {
    super(message)
    this.name = 'PanoramaDecoderError'
    this.code = details.code
    this.compression = details.compression
  }
}

const isPanoramaDecodeErrorCode = (
  value: unknown,
): value is PanoramaDecodeErrorCode => {
  return value === 'unsupported-exr-compression' || value === 'panorama-decode-failed'
}

export const getPanoramaDecodeErrorDetails = (
  error: unknown,
): PanoramaDecodeErrorDetails => {
  if (!(error instanceof Error)) return {}
  const details: PanoramaDecodeErrorDetails = {}

  if ('code' in error && isPanoramaDecodeErrorCode(error.code)) {
    details.code = error.code
  }
  if ('compression' in error && typeof error.compression === 'string') {
    details.compression = error.compression
  }

  return details
}
