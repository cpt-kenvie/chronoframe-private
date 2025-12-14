import crypto from 'node:crypto'

const MAGIC = Buffer.from('CFENC1', 'utf8')
const IV_LENGTH = 12
const TAG_LENGTH = 16

export const isEncryptedPayload = (payload: Buffer): boolean => {
  if (payload.length < MAGIC.length + IV_LENGTH + TAG_LENGTH) return false
  return payload.subarray(0, MAGIC.length).equals(MAGIC)
}

export const deriveAes256Key = (rawKey: string): Buffer => {
  const trimmed = rawKey.trim()
  if (!trimmed) {
    throw new Error('Encryption key is empty')
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex')
  }

  const maybeBase64 = Buffer.from(trimmed, 'base64')
  if (maybeBase64.length === 32) {
    return maybeBase64
  }

  // Fallback: derive from passphrase (stable but weaker than random 32B key)
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest()
}

export const encryptBuffer = (
  plaintext: Buffer,
  key: Buffer,
  aad?: Buffer,
): Buffer => {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  if (aad && aad.length > 0) {
    cipher.setAAD(aad)
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, iv, ciphertext, tag])
}

export const decryptBuffer = (
  encryptedPayload: Buffer,
  key: Buffer,
  aad?: Buffer,
): Buffer => {
  if (!isEncryptedPayload(encryptedPayload)) {
    throw new Error('Payload is not encrypted (missing magic header)')
  }

  const ivStart = MAGIC.length
  const ivEnd = ivStart + IV_LENGTH
  const tagStart = encryptedPayload.length - TAG_LENGTH

  if (tagStart <= ivEnd) {
    throw new Error('Encrypted payload is too short')
  }

  const iv = encryptedPayload.subarray(ivStart, ivEnd)
  const ciphertext = encryptedPayload.subarray(ivEnd, tagStart)
  const tag = encryptedPayload.subarray(tagStart)

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  if (aad && aad.length > 0) {
    decipher.setAAD(aad)
  }
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

