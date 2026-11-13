import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { FieldCipher } from '../domain/ports.js';
import { StorageIntegrityError } from '../domain/errors.js';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'ib:v1';

export function decodeEncryptionKey(encoded: string | undefined): Buffer {
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new Error('ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded)
    throw new Error('ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.');
  return key;
}
function decodePart(encoded: string, bytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) throw new StorageIntegrityError();
  const value = Buffer.from(encoded, 'base64url');
  if (value.toString('base64url') !== encoded || (bytes !== undefined && value.length !== bytes))
    throw new StorageIntegrityError();
  return value;
}

export class AesGcmCipher implements FieldCipher {
  private readonly key: Buffer;
  constructor(encodedKey: string) {
    this.key = decodeEncryptionKey(encodedKey);
  }

  encrypt(text: string, context: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, nonce, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return [
      VERSION,
      nonce.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(envelope: string, context: string): string {
    try {
      const [prefix, version, nonce, tag, ciphertext, extra] = envelope.split(':');
      if (
        `${prefix}:${version}` !== VERSION ||
        nonce === undefined ||
        tag === undefined ||
        ciphertext === undefined ||
        extra !== undefined
      )
        throw new StorageIntegrityError();
      const decipher = createDecipheriv(ALGORITHM, this.key, decodePart(nonce, NONCE_BYTES), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(decodePart(tag, TAG_BYTES));
      // Never return unauthenticated output from update() before final() succeeds.
      return Buffer.concat([decipher.update(decodePart(ciphertext)), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new StorageIntegrityError();
    }
  }
}
