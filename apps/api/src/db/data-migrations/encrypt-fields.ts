import type { PoolClient, QueryResult } from 'pg';
import type { FieldCipher } from '../../domain/ports.js';
import { incidentContext, noteContext } from '../../security/field-context.js';

const BATCH_SIZE = 500;
type LegacyIncident = {
  id: string;
  owner_id: string;
  description_ciphertext: string;
};
type LegacyNote = {
  id: string;
  incident_id: string;
  owner_id: string;
  body_ciphertext: string;
};
export async function encryptFields(client: PoolClient, cipher: FieldCipher): Promise<void> {
  let cursor: string | null = null;
  while (true) {
    const result: QueryResult<LegacyIncident> = await client.query<LegacyIncident>(
      'SELECT id, owner_id, description_ciphertext FROM incidents WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2',
      [cursor, BATCH_SIZE],
    );
    if (!result.rows.length) break;
    for (const row of result.rows) {
      // Always encrypt: a legacy plaintext value may itself resemble an envelope.
      const encrypted = cipher.encrypt(
        row.description_ciphertext,
        incidentContext(row.owner_id, row.id),
      );
      await client.query('UPDATE incidents SET description_ciphertext = $1 WHERE id = $2', [
        encrypted,
        row.id,
      ]);
    }
    cursor = result.rows.at(-1)!.id;
  }
  cursor = null;
  while (true) {
    const result: QueryResult<LegacyNote> = await client.query<LegacyNote>(
      'SELECT n.id, n.incident_id, i.owner_id, n.body_ciphertext FROM notes n JOIN incidents i ON i.id = n.incident_id WHERE ($1::uuid IS NULL OR n.id > $1::uuid) ORDER BY n.id LIMIT $2',
      [cursor, BATCH_SIZE],
    );
    if (!result.rows.length) break;
    for (const row of result.rows) {
      const encrypted = cipher.encrypt(
        row.body_ciphertext,
        noteContext(row.owner_id, row.incident_id, row.id),
      );
      await client.query('UPDATE notes SET body_ciphertext = $1 WHERE id = $2', [
        encrypted,
        row.id,
      ]);
    }
    cursor = result.rows.at(-1)!.id;
  }
  await client.query('ALTER TABLE incidents VALIDATE CONSTRAINT incidents_description_envelope');
  await client.query('ALTER TABLE notes VALIDATE CONSTRAINT notes_body_envelope');
}
