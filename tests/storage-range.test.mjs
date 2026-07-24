import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { LocalStorageProvider } from '../server/services/storage/providers/local.ts'
import { OpenListStorageProvider } from '../server/services/storage/providers/openlist.ts'
import { S3StorageProvider } from '../server/services/storage/providers/s3.ts'

const readStream = async (stream) => {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

test('local storage streams only the requested byte range', async () => {
  const basePath = await mkdtemp(path.join(tmpdir(), 'chronoframe-range-'))
  const provider = new LocalStorageProvider({
    provider: 'local',
    basePath,
    baseUrl: '/storage',
  })

  try {
    const source = Buffer.from(Array.from({ length: 100 }, (_, index) => index))
    await provider.create('sample.bin', source)

    const result = await provider.getStream('sample.bin', {
      start: 25,
      end: 49,
    })

    assert.ok(result)
    assert.equal(result.size, source.length)
    assert.equal(result.contentLength, 25)
    assert.deepEqual(await readStream(result.stream), source.subarray(25, 50))
  } finally {
    await rm(basePath, { recursive: true, force: true })
  }
})

test('s3 storage uses head metadata and forwards the requested byte range', async () => {
  const commands = []
  const source = Buffer.from(Array.from({ length: 25 }, (_, index) => index + 25))
  const provider = new S3StorageProvider({
    provider: 's3',
    bucket: 'bucket',
    region: 'auto',
    endpoint: 'https://s3.example.com',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
  })
  provider.client = {
    async send(command) {
      commands.push(command)
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: 100, ETag: 'etag' }
      }
      return {
        Body: Readable.from([source]),
        ContentLength: source.length,
        ContentRange: 'bytes 25-49/100',
      }
    },
  }

  const metadata = await provider.getFileMeta('sample.bin')
  const result = await provider.getStream('sample.bin', {
    start: 25,
    end: 49,
  })

  assert.equal(commands[0].constructor.name, 'HeadObjectCommand')
  assert.equal(commands[1].input.Range, 'bytes=25-49')
  assert.equal(metadata?.size, 100)
  assert.ok(result)
  assert.equal(result.size, 100)
  assert.equal(result.contentLength, source.length)
  assert.deepEqual(await readStream(result.stream), source)
})

test('openlist storage forwards the requested byte range', async () => {
  const originalFetch = globalThis.fetch
  let request
  const source = Buffer.from(Array.from({ length: 25 }, (_, index) => index + 25))
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init }
    return new Response(source, {
      status: 206,
      headers: {
        'content-length': String(source.length),
        'content-range': 'bytes 25-49/100',
      },
    })
  }

  try {
    const provider = new OpenListStorageProvider({
      provider: 'openlist',
      baseUrl: 'https://openlist.example.com',
      rootPath: 'photos',
      token: 'token',
      downloadEndpoint: '/download',
      pathField: 'path',
    })
    const result = await provider.getStream('sample.bin', {
      start: 25,
      end: 49,
    })

    assert.equal(request?.init?.headers?.Range, 'bytes=25-49')
    assert.match(request?.url ?? '', /\/download\?path=photos%2Fsample\.bin$/)
    assert.ok(result)
    assert.equal(result.size, 100)
    assert.equal(result.contentLength, source.length)
    assert.deepEqual(await readStream(result.stream), source)
  } finally {
    globalThis.fetch = originalFetch
  }
})
