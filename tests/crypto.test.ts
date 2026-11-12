import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmCipher, decodeEncryptionKey } from '../apps/api/src/security/aes-gcm-cipher.js';
import { incidentContext, noteContext } from '../apps/api/src/security/field-context.js';
import { StorageIntegrityError } from '../apps/api/src/domain/errors.js';

const key = () => randomBytes(32).toString('base64');
describe('authenticated field encryption', () => {
  it('uses the same binding for uppercase and lowercase UUID spellings', () => {
    const owner = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const id = '12345678-abcd-4abc-8def-abcdefabcdef';
    expect(incidentContext(owner.toUpperCase(), id.toUpperCase())).toBe(incidentContext(owner, id));
    expect(noteContext(owner.toUpperCase(), id.toUpperCase(), id.toUpperCase())).toBe(
      noteContext(owner, id, id),
    );
  });
  it.each(['', 'Investigation notes', 'Café 🔎\nUnbekannte Ursache.', 'x'.repeat(48000)])(
    'round-trips UTF-8 safely (%#)',
    (text) => {
      const cipher = new AesGcmCipher(key());
      const context = incidentContext(randomUUID(), randomUUID());
      expect(cipher.decrypt(cipher.encrypt(text, context), context)).toBe(text);
    },
  );
  it('uses a distinct 96-bit nonce and 128-bit tag for repeated encryption', () => {
    const cipher = new AesGcmCipher(key());
    const first = cipher.encrypt('Same facts', 'record');
    const second = cipher.encrypt('Same facts', 'record');
    expect(first).not.toBe(second);
    expect(Buffer.from(first.split(':')[2]!, 'base64url')).toHaveLength(12);
    expect(Buffer.from(first.split(':')[3]!, 'base64url')).toHaveLength(16);
    expect(first.split(':')[2]).not.toBe(second.split(':')[2]);
  });
  it('rejects altered ciphertext, tag or nonce without returning any plaintext', () => {
    const cipher = new AesGcmCipher(key());
    const original = cipher.encrypt('Sensitive investigation details', 'record');
    for (const index of [2, 3, 4]) {
      const parts = original.split(':');
      const bytes = Buffer.from(parts[index]!, 'base64url');
      bytes[0] = bytes[0]! ^ 1;
      parts[index] = bytes.toString('base64url');
      expect(() => cipher.decrypt(parts.join(':'), 'record')).toThrow(StorageIntegrityError);
    }
  });
  it('rejects the wrong key and every changed record/field/owner/parent binding', () => {
    const cipher = new AesGcmCipher(key());
    const owner = randomUUID(),
      id = randomUUID(),
      note = randomUUID();
    const context = noteContext(owner, id, note);
    const encrypted = cipher.encrypt('Private note', context);
    for (const changed of [
      noteContext(randomUUID(), id, note),
      noteContext(owner, randomUUID(), note),
      noteContext(owner, id, randomUUID()),
      incidentContext(owner, id),
    ])
      expect(() => cipher.decrypt(encrypted, changed)).toThrow(StorageIntegrityError);
    expect(() => new AesGcmCipher(key()).decrypt(encrypted, context)).toThrow(
      StorageIntegrityError,
    );
  });
  it.each([
    'plain text',
    'ib:v2:nonce:tag:payload',
    'ib:v1:a:b:c',
    'ib:v1:!:!:!',
    'ib:v1::::extra',
  ])('fails closed on malformed or legacy input (%#)', (value) => {
    expect(() => new AesGcmCipher(key()).decrypt(value, 'record')).toThrow(
      'Encrypted data could not be read.',
    );
  });
  it('rejects noncanonical base64 envelopes and truncated tags', () => {
    const cipher = new AesGcmCipher(key());
    const parts = cipher.encrypt('A', 'record').split(':');
    parts[3] = Buffer.alloc(15).toString('base64url');
    expect(() => cipher.decrypt(parts.join(':'), 'record')).toThrow(StorageIntegrityError);
    parts[3] = Buffer.alloc(16).toString('base64url');
    parts[4] = 'AB'; // Decodes like AA, but has nonzero unused bits.
    expect(() => cipher.decrypt(parts.join(':'), 'record')).toThrow(StorageIntegrityError);
  });
  it('requires an exact, canonical 256-bit key and never echoes invalid material', () => {
    for (const encoded of [
      undefined,
      '',
      'private-invalid-key',
      randomBytes(31).toString('base64'),
      Buffer.alloc(32).toString('base64').slice(0, -2) + 'B=',
    ]) {
      expect(() => decodeEncryptionKey(encoded)).toThrow('ENCRYPTION_KEY');
      if (encoded) {
        try {
          decodeEncryptionKey(encoded);
        } catch (error) {
          expect((error as Error).message).not.toContain(encoded);
        }
      }
    }
    expect(decodeEncryptionKey(key())).toHaveLength(32);
  });
});
