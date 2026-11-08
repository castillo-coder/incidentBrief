import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { AesGcmCipher } from '../security/aes-gcm-cipher.js';

const config = loadConfig();
const cipher = new AesGcmCipher(config.encryptionKey);
const { pool } = createDatabase(config.databaseUrl);
try {
  await migrate(pool, cipher);
  console.log('Database migrations complete.');
} catch {
  console.error(
    'Database migration failed. Failed migration changes were rolled back; check configuration and database access.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
