import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyServerOptions } from 'fastify';
import type { Auth } from '@incidentbrief/contracts';
import { loadConfig } from '../apps/api/src/config.js';
import { createDatabase } from '../apps/api/src/db/client.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { users } from '../apps/api/src/db/schema.js';
import { authRepository } from '../apps/api/src/repositories/auth-repository.js';
import { incidentRepository } from '../apps/api/src/repositories/incident-repository.js';
import { AuthService, hashPassword } from '../apps/api/src/services/auth-service.js';
import { IncidentService } from '../apps/api/src/services/incident-service.js';
import { SummaryService } from '../apps/api/src/services/summary-service.js';
import type { SummaryProvider } from '../apps/api/src/domain/ports.js';
import { createApp } from '../apps/api/src/http/app.js';

export const password = randomBytes(20).toString('hex');
const passwordHash = hashPassword(password);
export const origin = 'http://localhost:5173';
export const input = {
  title: 'Checkout is slow',
  description: 'The request is waiting for a dependency.',
  severity: 'high' as const,
};

export class FakeProvider implements SummaryProvider {
  mode: 'ok' | 'fail' | 'unavailable' = 'ok';
  contexts: string[] = [];
  available() {
    return this.mode !== 'unavailable';
  }
  async *stream(context: string, signal: AbortSignal) {
    this.contexts.push(context);
    if (signal.aborted) throw signal.reason;
    yield 'Known facts\n';
    if (this.mode === 'fail') throw new Error('private-provider-error');
    yield 'A dependency is slow.\nOpen questions\nUnknown root cause.';
  }
}

export async function fixture(
  options: {
    provider?: SummaryProvider;
    production?: boolean;
    logger?: FastifyServerOptions['logger'];
  } = {},
) {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base)
    throw new Error('Set TEST_DATABASE_URL to an isolated PostgreSQL database ending in _test.');
  const url = new URL(base);
  if (!process.env.TEST_DATABASE_URL) url.pathname = '/incidentbrief_test';
  if (!url.pathname.endsWith('_test'))
    throw new Error('Refusing to reset a database not ending in _test.');
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: url.toString(),
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
  const { db, pool } = createDatabase(config.databaseUrl);
  await migrate(pool);
  await pool.query('TRUNCATE users CASCADE');
  const owner = {
    id: randomUUID(),
    email: 'owner@example.test',
    passwordHash: await passwordHash,
  };
  const other = {
    id: randomUUID(),
    email: 'other@example.test',
    passwordHash: await passwordHash,
  };
  await db.insert(users).values([owner, other]);
  const repository = incidentRepository(db);
  const auth = new AuthService(authRepository(db));
  const incidentService = new IncidentService(repository);
  const provider = options.provider ?? new FakeProvider();
  const summaryService = new SummaryService(repository, provider);
  const app = await createApp({
    auth,
    incidents: incidentService,
    summaries: summaryService,
    origin,
    production: options.production ?? false,
    logger: options.logger ?? false,
  });
  async function login(who = owner) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { email: who.email, password },
    });
    if (response.statusCode !== 200) throw new Error('Test login failed.');
    const cookie = response.cookies.find((item) => item.name === 'session');
    if (!cookie) throw new Error('Session cookie missing.');
    return {
      cookie: `session=${cookie.value}`,
      origin,
      'x-csrf-token': response.json<Auth>().csrf_token,
    };
  }
  return {
    app,
    db,
    pool,
    repository,
    owner,
    other,
    auth,
    incidentService,
    summaryService,
    provider,
    login,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
