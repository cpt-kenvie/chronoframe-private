import type {
  PanoramaDecodeRequest,
  PanoramaDecodeResult,
  PanoramaDecodeError,
} from './types'
import { PanoramaDecoderError } from './decode-error'

export class PanoramaDecoderClient {
  private worker: Worker
  private pending = new Map<
    string,
    { resolve: (r: PanoramaDecodeResult) => void; reject: (e: Error) => void }
  >()

  constructor() {
    this.worker = new Worker(
      new URL('../../workers/panorama-decoder.worker.ts', import.meta.url),
      { type: 'module' },
    )

    this.worker.onmessage = (event: MessageEvent<PanoramaDecodeResult | PanoramaDecodeError>) => {
      const data = event.data
      const entry = this.pending.get(data.id)
      if (!entry) return
      this.pending.delete(data.id)
      if ('message' in data && !('kind' in data)) {
        const error = new PanoramaDecoderError(data.message, {
          code: data.code,
          compression: data.compression,
        })
        entry.reject(error)
        return
      }
      entry.resolve(data as PanoramaDecodeResult)
    }
  }

  decode(request: PanoramaDecodeRequest): Promise<PanoramaDecodeResult> {
    const existing = this.pending.get(request.id)
    if (existing) {
      existing.reject(new Error('Decode request replaced'))
      this.pending.delete(request.id)
    }

    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject })
      this.worker.postMessage(request, [request.buffer])
    })
  }

  terminate() {
    for (const entry of this.pending.values()) {
      entry.reject(new Error('Decoder terminated'))
    }
    this.pending.clear()
    this.worker.terminate()
  }
}
