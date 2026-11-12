import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Incident, Note, Page } from '@incidentbrief/contracts';
import { fixture, input, type Fixture, FakeProvider } from './helpers.js';
import { incidentRepository } from '../apps/api/src/repositories/incident-repository.js';
import { StorageMapper } from '../apps/api/src/repositories/storage-mapper.js';
import { AesGcmCipher } from '../apps/api/src/security/aes-gcm-cipher.js';
import { StorageIntegrityError } from '../apps/api/src/domain/errors.js';

let f: Fixture;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f?.close();
});
describe('encrypted persistence boundary', () => {
  it('preserves valid uppercase UUID writes and subsequent reads', async () => {
    const item = await f.incidentService.create(f.owner.id, input);
    const headers = await f.login();
    const path = `/api/incidents/${item.id.toUpperCase()}`;
    const update = await f.app.inject({
      method: 'PATCH',
      url: path,
      headers,
      payload: { description: 'Updated through an uppercase ID.' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json<Incident>().description).toBe('Updated through an uppercase ID.');
    const added = await f.app.inject({
      method: 'POST',
      url: `${path}/notes`,
      headers,
      payload: { body: 'Created through an uppercase parent ID.' },
    });
    expect(added.statusCode).toBe(201);
    const note = added.json<Note>();
    expect(note.body).toBe('Created through an uppercase parent ID.');
    expect((await f.noteService.list(f.owner.id, item.id, {})).data[0]!.body).toBe(note.body);
    expect(
      (
        await f.app.inject({
          method: 'DELETE',
          url: `${path}/notes/${note.id.toUpperCase()}`,
          headers,
        })
      ).statusCode,
    ).toBe(204);
  });
  it('stores only ciphertext while preserving plaintext contracts for CRUD, notes and AI context', async () => {
    const item = await f.incidentService.create(f.owner.id, input);
    const note = await f.noteService.add(f.owner.id, item.id, 'Confidential dependency finding.');
    const stored = await f.pool.query<{ description_ciphertext: string }>(
      'SELECT description_ciphertext FROM incidents WHERE id = $1',
      [item.id],
    );
    const storedNote = await f.pool.query<{ body_ciphertext: string }>(
      'SELECT body_ciphertext FROM notes WHERE id = $1',
      [note.id],
    );
    expect(stored.rows[0]!.description_ciphertext).toMatch(/^ib:v1:/);
    expect(stored.rows[0]!.description_ciphertext).not.toContain(input.description);
    expect(storedNote.rows[0]!.body_ciphertext).toMatch(/^ib:v1:/);
    expect(storedNote.rows[0]!.body_ciphertext).not.toContain(note.body);
    const headers = await f.login();
    expect(
      (await f.app.inject({ url: `/api/incidents/${item.id}`, headers })).json<Incident>()
        .description,
    ).toBe(input.description);
    expect(
      (await f.app.inject({ url: '/api/incidents', headers })).json<Page<Incident>>().data[0]!
        .description,
    ).toBe(input.description);
    expect(
      (await f.app.inject({ url: `/api/incidents/${item.id}/notes`, headers })).json<Page<Note>>()
        .data[0]!.body,
    ).toBe(note.body);
    const response = await f.app.inject({
      method: 'POST',
      url: `/api/incidents/${item.id}/summary`,
      headers,
    });
    expect(response.body).toContain('event: done');
    expect((f.provider as FakeProvider).contexts[0]).toContain(note.body);
    const columns = await f.pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('incidents', 'notes')",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('description');
    expect(columns.rows.map((row) => row.column_name)).not.toContain('body');
  });
  it('reencrypts changed content with a new nonce and leaves ciphertext alone for metadata-only updates', async () => {
    const item = await f.incidentService.create(f.owner.id, input);
    const read = async () =>
      (
        await f.pool.query<{ description_ciphertext: string }>(
          'SELECT description_ciphertext FROM incidents WHERE id = $1',
          [item.id],
        )
      ).rows[0]!.description_ciphertext;
    const before = await read();
    await f.incidentService.update(f.owner.id, item.id, { status: 'resolved' });
    expect(await read()).toBe(before);
    await f.incidentService.update(f.owner.id, item.id, {
      description: input.description,
    });
    expect(await read()).not.toBe(before);
    await f.incidentService.update(f.owner.id, item.id, {
      description: 'Updated private details.',
    });
    expect((await f.incidentService.get(f.owner.id, item.id)).description).toBe(
      'Updated private details.',
    );
  });
  it('rejects accidental plaintext writes at the database boundary', async () => {
    const item = await f.incidentService.create(f.owner.id, input);
    const note = await f.noteService.add(f.owner.id, item.id, 'Private note');
    await expect(
      f.pool.query('UPDATE incidents SET description_ciphertext = $1 WHERE id = $2', [
        'plaintext',
        item.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      f.pool.query('UPDATE notes SET body_ciphertext = $1 WHERE id = $2', ['plaintext', note.id]),
    ).rejects.toMatchObject({ code: '23514' });
    expect((await f.incidentService.get(f.owner.id, item.id)).description).toBe(input.description);
  });
  it('fails closed with the wrong key and on ciphertext copied to another field', async () => {
    const item = await f.incidentService.create(f.owner.id, input);
    const note = await f.noteService.add(f.owner.id, item.id, 'Private note');
    const wrong = incidentRepository(
      f.db,
      new StorageMapper(new AesGcmCipher(randomBytes(32).toString('base64'))),
    );
    await expect(wrong.get(f.owner.id, item.id)).rejects.toThrow(StorageIntegrityError);
    const row = (
      await f.pool.query<{ description_ciphertext: string }>(
        'SELECT description_ciphertext FROM incidents WHERE id = $1',
        [item.id],
      )
    ).rows[0]!;
    await f.pool.query('UPDATE notes SET body_ciphertext = $1 WHERE id = $2', [
      row.description_ciphertext,
      note.id,
    ]);
    await expect(f.noteService.list(f.owner.id, item.id, {})).rejects.toThrow(
      StorageIntegrityError,
    );
  });
  it('returns a sanitized error and logs no content, keys or ciphertext after record swapping', async () => {
    await f.close();
    let logs = '';
    const stream = new Writable({
      write(chunk, _encoding, done) {
        logs += chunk.toString();
        done();
      },
    });
    f = await fixture({ logger: { level: 'info', stream } });
    const first = await f.incidentService.create(f.owner.id, {
      ...input,
      description: 'Sensitive investigation A.',
    });
    const second = await f.incidentService.create(f.owner.id, {
      ...input,
      description: 'Sensitive investigation B.',
    });
    const envelope = (
      await f.pool.query<{ description_ciphertext: string }>(
        'SELECT description_ciphertext FROM incidents WHERE id = $1',
        [second.id],
      )
    ).rows[0]!.description_ciphertext;
    await f.pool.query('UPDATE incidents SET description_ciphertext = $1 WHERE id = $2', [
      envelope,
      first.id,
    ]);
    const result = await f.app.inject({
      url: `/api/incidents/${first.id}`,
      headers: await f.login(),
    });
    expect(result.statusCode).toBe(500);
    for (const sensitive of [
      first.description,
      second.description,
      envelope,
      f.encryptionKey,
      'StorageIntegrityError',
    ]) {
      expect(logs).not.toContain(sensitive);
      expect(result.body).not.toContain(sensitive);
    }
    expect(logs).toContain('request failed');
  });
});
