import { randomBytes } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../.env', import.meta.url));
try {
  await access(file);
  console.log('.env already exists; nothing changed.');
} catch {
  const password = randomBytes(24).toString('hex');
  const key = randomBytes(32).toString('base64');
  const database = `postgres://incidentbrief:${password}@127.0.0.1:55439/incidentbrief`;
  await writeFile(
    file,
    [
      'NODE_ENV=development',
      'HOST=0.0.0.0',
      'PORT=3100',
      'APP_ORIGIN=http://localhost:5173',
      `POSTGRES_PASSWORD=${password}`,
      `DATABASE_URL=${database}`,
      `TEST_DATABASE_URL=${database}_test`,
      `ENCRYPTION_KEY=${key}`,
      'OPENAI_API_KEY=',
      'OPENAI_MODEL=',
      '',
    ].join('\n'),
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Created .env with generated local database credentials and encryption key.');
  console.log('Add OPENAI_API_KEY and OPENAI_MODEL to enable AI summaries.');
}
