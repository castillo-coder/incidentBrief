import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { deploy } from '../scripts/deploy.js';

const config = {
  apiKey: randomBytes(24).toString('hex'),
  serviceId: 'srv-synthetic',
  origin: 'https://example.test',
  sha: 'a'.repeat(40),
};
const json = (body: unknown) => new Response(JSON.stringify(body));
function network(
  options: {
    status?: string;
    sha?: string;
    hsts?: boolean;
    mixed?: boolean;
  } = {},
) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') return json({ id: 'dep-synthetic' });
    if (url.includes('api.render.com')) return json({ status: options.status ?? 'live' });
    if (url.endsWith('/healthz')) return json({ status: 'ok' });
    if (url.endsWith('/version')) return json({ version: options.sha ?? config.sha });
    return new Response(
      options.mixed
        ? '<script src="http://example.test/app.js"></script>'
        : '<div id="root"></div>',
      {
        headers:
          options.hsts === false
            ? {}
            : {
                'strict-transport-security': 'max-age=31536000; includeSubDomains',
              },
      },
    );
  });
  let time = 0;
  return {
    fetch,
    now: () => time,
    sleep: async () => {
      time += 300000;
    },
  };
}
describe('deployment verification', () => {
  it('does not retry an unsuccessful deployment request', async () => {
    const deps = network();
    deps.fetch.mockResolvedValue(new Response('private error details', { status: 503 }));
    await expect(deploy(config, deps)).rejects.toThrow('HTTP 503');
    expect(deps.fetch).toHaveBeenCalledOnce();
  });
  it('rejects an invalid response before polling or sending application requests', async () => {
    const deps = network();
    deps.fetch.mockResolvedValue(json({ id: 'untrusted/path' }));
    await expect(deploy(config, deps)).rejects.toThrow('invalid deployment ID');
    expect(deps.fetch).toHaveBeenCalledOnce();
  });
  it('pins the source once and verifies actual live status, health, HSTS and version', async () => {
    const deps = network();
    expect(await deploy(config, deps)).toEqual({
      id: 'dep-synthetic',
      sha: config.sha,
    });
    const [url, request] = deps.fetch.mock.calls[0]!;
    expect(url).toBe('https://api.render.com/v1/services/srv-synthetic/deploys');
    expect(JSON.parse(request!.body as string)).toEqual({
      commitId: config.sha,
    });
    expect(deps.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    for (const [input, init] of deps.fetch.mock.calls)
      if (!String(input).includes('api.render.com')) expect(init?.headers).toBeUndefined();
  });
  it.each(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled'])(
    'rejects terminal %s',
    async (status) => {
      await expect(deploy(config, network({ status }))).rejects.toThrow('deployment failed');
    },
  );
  it.each([{ sha: 'b'.repeat(40) }, { hsts: false }, { mixed: true }])(
    'does not accept a mismatched or insecure rollout (%#)',
    async (options) => {
      await expect(deploy(config, network(options))).rejects.toThrow('did not pass');
    },
  );
  it('times out on a permanently pending rollout', async () => {
    await expect(deploy(config, network({ status: 'build_in_progress' }))).rejects.toThrow(
      'timed out',
    );
  });
  it('does not send requests for missing credentials or a non-HTTPS origin', async () => {
    const deps = network();
    await expect(deploy({ ...config, apiKey: '' }, deps)).rejects.toThrow('configuration');
    await expect(deploy({ ...config, origin: 'http://example.test' }, deps)).rejects.toThrow(
      'HTTPS',
    );
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
