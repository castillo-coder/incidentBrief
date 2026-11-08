import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import { createDatabase } from './db/client.js';
import { authRepository } from './repositories/auth-repository.js';
import { incidentRepository } from './repositories/incident-repository.js';
import { AuthService } from './services/auth-service.js';
import { IncidentService } from './services/incident-service.js';
import { SummaryService } from './services/summary-service.js';
import { OpenAISummaryProvider } from './providers/openai-provider.js';
import { createApp } from './http/app.js';
import type { SummaryProvider } from './domain/ports.js';

export async function application(config: Config, provider?: SummaryProvider) {
  const { db, pool } = createDatabase(config.databaseUrl);
  const incidents = incidentRepository(db);
  const app = await createApp({
    auth: new AuthService(authRepository(db)),
    incidents: new IncidentService(incidents),
    summaries: new SummaryService(
      incidents,
      provider ?? new OpenAISummaryProvider(config.openaiKey, config.openaiModel),
    ),
    origin: config.origin,
    production: config.production,
    staticRoot: fileURLToPath(new URL('../../web/dist', import.meta.url)),
  });
  app.addHook('onClose', async () => {
    await pool.end();
  });
  return { app, db, pool };
}
