import { loadConfig } from './config.js';
import { application } from './composition.js';

const config = loadConfig();
const { app } = await application(config);
await app.listen({ port: config.port, host: config.host });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
