import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { migrate } from '../db/migrate.js';

const { pool } = createDatabase(loadConfig().databaseUrl);
try {
  await migrate(pool);
  console.log('Database migrations complete.');
} finally {
  await pool.end();
}
