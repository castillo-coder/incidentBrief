import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

export interface Config {
  databaseUrl: string;
  encryptionKey: string;
  origin: string;
  production: boolean;
  host: string;
  port: number;
  openaiKey: string;
  openaiModel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  const encryptionKey = env.ENCRYPTION_KEY;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  if (
    !encryptionKey ||
    !/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey) ||
    Buffer.from(encryptionKey, 'base64').length !== 32
  ) {
    throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  const port = Number(env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid.');
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN ?? 'http://localhost:5173';
  const parsed = new URL(origin);
  if (origin !== parsed.origin || (production && parsed.protocol !== 'https:'))
    throw new Error('APP_ORIGIN must be an origin and use HTTPS in production.');
  return {
    databaseUrl,
    encryptionKey,
    origin,
    production,
    port,
    host: env.HOST ?? '0.0.0.0',
    openaiKey: env.OPENAI_API_KEY ?? '',
    openaiModel: env.OPENAI_MODEL ?? '',
  };
}
