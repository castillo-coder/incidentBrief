import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import type { FieldCipher } from '../domain/ports.js';
import { encryptFields } from './data-migrations/encrypt-fields.js';

const dataMigrations: Record<string, (client: PoolClient, cipher: FieldCipher) => Promise<void>> = {
  '002_encrypted_fields.sql': encryptFields,
};

export async function migrate(pool: Pool, cipher: FieldCipher): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(7118026)');
    locked = true;
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
    const directory = fileURLToPath(new URL('../../migrations/', import.meta.url));
    for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      const existing = await client.query('SELECT name FROM schema_migrations WHERE name = $1', [
        name,
      ]);
      if (existing.rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(`${directory}${name}`, 'utf8'));
        await dataMigrations[name]?.(client, cipher);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(7118026)');
    } finally {
      client.release();
    }
  }
}
