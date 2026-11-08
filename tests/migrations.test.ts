import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDatabaseUrl } from './helpers.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { AesGcmCipher } from '../apps/api/src/security/aes-gcm-cipher.js';
import { incidentContext, noteContext } from '../apps/api/src/security/field-context.js';

let admin: Pool;
let pool: Pool;
let created = false;
let cipher: AesGcmCipher;
let owner: string;
let incidentIds: string[];
let noteId: string;
const legacy = ['Private legacy description.', `ib:v1:${'A'.repeat(16)}:${'B'.repeat(22)}:CCCC`];
beforeEach(async () => {
  created = false;
  admin = new Pool({ connectionString: testDatabaseUrl() });
  // Fixed, dedicated test schema: never replace an existing schema silently.
  await admin.query('CREATE SCHEMA incidentbrief_migration_test');
  created = true;
  pool = new Pool({
    connectionString: testDatabaseUrl(),
    options: '-c search_path=incidentbrief_migration_test',
  });
  await pool.query(
    await readFile(new URL('../apps/api/migrations/001_initial.sql', import.meta.url), 'utf8'),
  );
  await pool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY)');
  await pool.query('INSERT INTO schema_migrations(name) VALUES ($1)', ['001_initial.sql']);
  cipher = new AesGcmCipher(randomBytes(32).toString('base64'));
  owner = randomUUID();
  incidentIds = [randomUUID(), randomUUID()];
  noteId = randomUUID();
  await pool.query('INSERT INTO users(id,email,password_hash) VALUES ($1,$2,$3)', [
    owner,
    'migration@example.test',
    'unused-test-hash',
  ]);
  for (let index = 0; index < incidentIds.length; index++)
    await pool.query(
      'INSERT INTO incidents(id,owner_id,title,description,severity) VALUES ($1,$2,$3,$4,$5)',
      [incidentIds[index], owner, 'Legacy incident', legacy[index], 'low'],
    );
  await pool.query('INSERT INTO notes(id,incident_id,body) VALUES ($1,$2,$3)', [
    noteId,
    incidentIds[0],
    'Private legacy note 🔎',
  ]);
});
afterEach(async () => {
  await pool?.end();
  if (created) await admin.query('DROP SCHEMA incidentbrief_migration_test CASCADE');
  await admin?.end();
});

describe('transactional encryption migration', () => {
  it('converts legacy text exactly once, including text resembling an envelope', async () => {
    await migrate(pool, cipher);
    const incidents = await pool.query<{
      id: string;
      description_ciphertext: string;
    }>('SELECT id, description_ciphertext FROM incidents');
    for (const row of incidents.rows)
      expect(cipher.decrypt(row.description_ciphertext, incidentContext(owner, row.id))).toBe(
        legacy[incidentIds.indexOf(row.id)],
      );
    const note = (
      await pool.query<{ body_ciphertext: string }>(
        'SELECT body_ciphertext FROM notes WHERE id = $1',
        [noteId],
      )
    ).rows[0]!;
    expect(cipher.decrypt(note.body_ciphertext, noteContext(owner, incidentIds[0]!, noteId))).toBe(
      'Private legacy note 🔎',
    );
    await migrate(pool, cipher);
    expect((await pool.query('SELECT id, description_ciphertext FROM incidents')).rows).toEqual(
      incidents.rows,
    );
    expect(
      (await pool.query('SELECT body_ciphertext FROM notes WHERE id = $1', [noteId])).rows[0],
    ).toEqual(note);
    expect((await pool.query('SELECT name FROM schema_migrations')).rowCount).toBe(2);
    const checks = await pool.query<{ convalidated: boolean }>(
      "SELECT convalidated FROM pg_constraint WHERE connamespace = 'incidentbrief_migration_test'::regnamespace AND conname IN ('incidents_description_envelope', 'notes_body_envelope')",
    );
    expect(checks.rows).toEqual([{ convalidated: true }, { convalidated: true }]);
  });
  it('rolls back renamed columns, partial conversions and migration history on failure, then recovers', async () => {
    const encrypt = cipher.encrypt.bind(cipher);
    const failure = vi
      .spyOn(cipher, 'encrypt')
      .mockImplementationOnce(encrypt)
      .mockImplementationOnce(() => {
        throw new Error('Simulated local encryption failure');
      });
    await expect(migrate(pool, cipher)).rejects.toThrow('Simulated local encryption failure');
    failure.mockRestore();
    const rows = await pool.query<{ id: string; description: string }>(
      'SELECT id, description FROM incidents',
    );
    for (const row of rows.rows) expect(row.description).toBe(legacy[incidentIds.indexOf(row.id)]);
    expect((await pool.query('SELECT body FROM notes WHERE id = $1', [noteId])).rows[0]!.body).toBe(
      'Private legacy note 🔎',
    );
    expect((await pool.query('SELECT name FROM schema_migrations')).rowCount).toBe(1);
    await migrate(pool, cipher);
    expect((await pool.query('SELECT name FROM schema_migrations')).rowCount).toBe(2);
  });
  it('converts both tables across the 500-row batch boundary without losing records', async () => {
    const ids: string[] = Array.from({ length: 501 }, () => randomUUID());
    const notes: string[] = Array.from({ length: 501 }, () => randomUUID());
    const descriptions = ids.map((_, index) => `Legacy batch description ${index}`);
    const bodies = notes.map((_, index) => `Legacy batch note ${index}`);
    await pool.query(
      'INSERT INTO incidents(id,owner_id,title,description,severity) SELECT * FROM unnest($1::uuid[],$2::uuid[],$3::text[],$4::text[],$5::text[])',
      [ids, ids.map(() => owner), ids.map(() => 'Batch'), descriptions, ids.map(() => 'low')],
    );
    await pool.query(
      'INSERT INTO notes(id,incident_id,body) SELECT * FROM unnest($1::uuid[],$2::uuid[],$3::text[])',
      [notes, ids, bodies],
    );
    await migrate(pool, cipher);
    const incidentRows = await pool.query<{
      id: string;
      description_ciphertext: string;
    }>('SELECT id, description_ciphertext FROM incidents');
    const noteRows = await pool.query<{
      id: string;
      incident_id: string;
      body_ciphertext: string;
    }>('SELECT id, incident_id, body_ciphertext FROM notes');
    expect(incidentRows.rowCount).toBe(503);
    expect(noteRows.rowCount).toBe(502);
    for (const row of incidentRows.rows) {
      const index = ids.indexOf(row.id);
      if (index >= 0)
        expect(cipher.decrypt(row.description_ciphertext, incidentContext(owner, row.id))).toBe(
          descriptions[index],
        );
    }
    for (const row of noteRows.rows) {
      const index = notes.indexOf(row.id);
      if (index >= 0)
        expect(
          cipher.decrypt(row.body_ciphertext, noteContext(owner, row.incident_id, row.id)),
        ).toBe(bodies[index]);
    }
  });
});
