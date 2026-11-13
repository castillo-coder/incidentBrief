import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../apps/web/src/api.js';

const auth = {
  user: { id: randomUUID(), email: 'owner@example.test' },
  csrf_token: 'memory-only-csrf',
};
const incident = {
  id: randomUUID(),
  title: 'Facts',
  description: 'Investigation',
  severity: 'low',
  status: 'open',
  created_at: '2026-11-08T12:00:00.000Z',
  updated_at: '2026-11-08T12:00:00.000Z',
};
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
const error = (status: number) =>
  new Response(
    JSON.stringify({
      error: 'Please sign in.',
      code: 'unauthenticated',
      request_id: 'request-id',
    }),
    { status },
  );
afterEach(() => vi.unstubAllGlobals());

describe('typed API client', () => {
  it('keeps CSRF in memory, uses same-origin cookies, and validates public response contracts', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok(auth))
      .mockResolvedValueOnce(ok(incident))
      .mockResolvedValueOnce(ok({ data: [incident], next_cursor: null }));
    vi.stubGlobal('fetch', fetch);
    const client = new ApiClient();
    await client.login({ email: auth.user.email, password: 'test-input' });
    expect(
      await client.create({
        title: 'Facts',
        description: 'Investigation',
        severity: 'low',
      }),
    ).toEqual(incident);
    const [path, init] = fetch.mock.calls[1]!;
    expect(path).toBe('/api/incidents');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers.get('X-CSRF-Token')).toBe(auth.csrf_token);
    expect(init.headers.get('Content-Type')).toBe('application/json');
    expect((await client.list({ status: 'open', cursor: 'a+b/=', limit: 2 })).data).toHaveLength(1);
    expect(fetch.mock.calls[2]![0]).toContain('cursor=a%2Bb%2F%3D');
  });
  it.each([
    { ...incident, id: 'invalid' },
    { ...incident, updated_at: 'not-a-date' },
    { ...incident, password_hash: 'private' },
    null,
  ])('rejects a mismatched response (%#)', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(body)));
    await expect(new ApiClient().get(incident.id)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('does not expire the login form on invalid credentials, but expires a revoked session', async () => {
    const expired = vi.fn();
    const fetch = vi.fn().mockResolvedValueOnce(error(401)).mockResolvedValueOnce(error(401));
    vi.stubGlobal('fetch', fetch);
    const client = new ApiClient(expired);
    await expect(client.login({ email: auth.user.email, password: 'wrong' })).rejects.toMatchObject(
      { status: 401 },
    );
    expect(expired).not.toHaveBeenCalled();
    await expect(client.session()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('hides unexpected server content and never retries a mutation', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('private upstream output', { status: 502 }));
    vi.stubGlobal('fetch', fetch);
    await expect(new ApiClient().delete(incident.id)).rejects.toMatchObject({
      code: 'invalid_response',
      message: 'The server returned an unexpected response.',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('forwards cancellation to summary fetch and emits validated stream events', async () => {
    const stream =
      'event: delta\ndata: {"type":"delta","text":"Known facts"}\n\nevent: done\ndata: {"type":"done"}\n\n';
    const fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const events = [];
    for await (const event of new ApiClient().summary(incident.id, signal)) events.push(event);
    expect(events).toEqual([{ type: 'delta', text: 'Known facts' }, { type: 'done' }]);
    expect(fetch.mock.calls[0]![1].signal).toBe(signal);
  });
  it('rejects a successful response that is not an event stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ wrong: true })));
    const stream = new ApiClient().summary(incident.id, new AbortController().signal);
    await expect(stream.next()).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
