import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export interface Deployment {
  apiKey: string;
  serviceId: string;
  origin: string;
  sha: string;
}
interface Dependencies {
  fetch: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
}
const failed = new Set([
  'build_failed',
  'update_failed',
  'pre_deploy_failed',
  'canceled',
  'deactivated',
]);
const pending = new Set([
  'created',
  'queued',
  'pending',
  'build_in_progress',
  'pre_deploy_in_progress',
  'update_in_progress',
]);

/** A queued deploy is not success: verify live status, HTTPS headers and source SHA. */
export async function deploy(config: Deployment, overrides: Partial<Dependencies> = {}) {
  if (
    !config.apiKey ||
    !/^srv-[a-z0-9]+$/.test(config.serviceId) ||
    !/^[a-f0-9]{40}$/.test(config.sha)
  )
    throw new Error('Deployment configuration is incomplete.');
  const origin = new URL(config.origin);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== config.origin ||
    origin.username ||
    origin.password
  )
    throw new Error('Deployment requires an HTTPS origin.');
  const client: Dependencies = {
    fetch,
    sleep: async (ms) => {
      await delay(ms);
    },
    now: Date.now,
    ...overrides,
  };
  const deadline = client.now() + 600000;
  async function api(path: string, init: RequestInit = {}) {
    const response = await client.fetch(
      `https://api.render.com/v1/services/${config.serviceId}/deploys${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw new Error(`Deployment API returned HTTP ${response.status}.`);
    return (await response.json()) as { id?: string; status?: string };
  }
  // Send once; retrying an ambiguous POST could create multiple deployments.
  const started = await api('', {
    method: 'POST',
    body: JSON.stringify({ commitId: config.sha }),
  });
  if (!started.id || !/^dep-[a-z0-9]+$/.test(started.id))
    throw new Error('Deployment API returned an invalid deployment ID.');
  while (client.now() < deadline) {
    const status = await api(`/${started.id}`);
    if (status.status === 'live') break;
    if (failed.has(status.status ?? '')) throw new Error('The requested deployment failed.');
    if (!pending.has(status.status ?? ''))
      throw new Error('Deployment API returned an unknown status.');
    await client.sleep(5000);
  }
  if (client.now() >= deadline) throw new Error('Deployment timed out before becoming live.');
  while (client.now() < deadline) {
    try {
      const options = {
        signal: AbortSignal.timeout(10000),
        cache: 'no-store' as const,
      };
      const [health, version, page] = await Promise.all([
        client.fetch(`${config.origin}/healthz`, options),
        client.fetch(`${config.origin}/version`, options),
        client.fetch(config.origin, options),
      ]);
      const healthBody = (await health.json()) as { status?: string };
      const versionBody = (await version.json()) as { version?: string };
      const html = await page.text();
      const hsts = /max-age=(\d+)/i.exec(page.headers.get('strict-transport-security') ?? '');
      if (
        health.ok &&
        version.ok &&
        page.ok &&
        healthBody.status === 'ok' &&
        versionBody.version === config.sha &&
        Number(hsts?.[1] ?? 0) >= 31536000 &&
        !/\b(?:src|href)\s*=\s*["']http:\/\//i.test(html)
      )
        return { id: started.id, sha: config.sha };
    } catch {
      /* A rollout may briefly return old or unavailable responses. */
    }
    await client.sleep(5000);
  }
  throw new Error('Live deployment did not pass health, HTTPS and source verification.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await deploy({
      apiKey: process.env.RENDER_API_KEY ?? '',
      serviceId: process.env.RENDER_SERVICE_ID ?? '',
      origin: process.env.APP_URL ?? '',
      sha: process.env.SOURCE_SHA ?? process.env.GITHUB_SHA ?? '',
    });
    console.log(`Verified live deployment ${result.id} for source ${result.sha}.`);
  } catch (error) {
    console.error(
      error instanceof Error && error.message.startsWith('Deployment')
        ? error.message
        : 'Deployment verification failed. Credentials and response details withheld.',
    );
    process.exitCode = 1;
  }
}
