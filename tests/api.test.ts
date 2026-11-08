import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Incident, Note, Page, Auth, ApiError } from '@incidentbrief/contracts';
import { incidents, sessions } from '../apps/api/src/db/schema.js';
import { fixture, FakeProvider, input, origin, password, type Fixture } from './helpers.js';

let f: Fixture;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f?.close();
});

describe('authentication and CSRF', () => {
  it('sets production cookie/HSTS headers and omits sensitive data from logs and errors', async () => {
    await f.close();
    let logs = '';
    const stream = new Writable({
      write(chunk, _encoding, done) {
        logs += chunk.toString();
        done();
      },
    });
    f = await fixture({ production: true, logger: { level: 'info', stream } });
    const response = await f.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { email: f.owner.email, password },
    });
    const cookie = response.headers['set-cookie'];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    const headers = await f.login();
    const secret = `confidential-${randomUUID()}`;
    const created = await f.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers,
      payload: { ...input, description: secret },
    });
    const item = created.json<Incident>();
    vi.spyOn(f.incidentService, 'get').mockRejectedValueOnce(new Error(secret));
    const failed = await f.app.inject({
      url: `/api/incidents/${item.id}`,
      headers,
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain(secret);
    for (const value of [
      secret,
      password,
      headers.cookie.slice(8),
      headers['x-csrf-token'],
      f.owner.email,
    ])
      expect(logs).not.toContain(value);
    expect(logs).toContain('request completed');
    expect(logs).toContain('request failed');
  });
  it('creates an opaque session, returns public identity, and revokes it on logout', async () => {
    const headers = await f.login();
    const result = await f.app.inject({ url: '/api/auth/session', headers });
    expect(result.json<Auth>().user.id).toBe(f.owner.id);
    expect(result.json<Auth>().csrf_token).toBe(headers['x-csrf-token']);
    expect(result.body).not.toContain('password');
    expect(result.body).not.toContain(headers.cookie.slice(8));
    const stored = await f.db.select().from(sessions);
    expect(stored[0]!.tokenHash).not.toBe(headers.cookie.slice(8));
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/auth/logout', headers })).statusCode,
    ).toBe(204);
    expect((await f.app.inject({ url: '/api/auth/session', headers })).statusCode).toBe(401);
  });
  it('rejects incorrect or unknown credentials with the same public error', async () => {
    const request = (email: string) =>
      f.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin },
        payload: { email, password: 'incorrect' },
      });
    const a = await request(f.owner.email);
    const b = await request('missing@example.test');
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json<ApiError>().code).toBe('invalid_credentials');
    expect(b.json<ApiError>().error).toBe(a.json<ApiError>().error);
  });
  it('rejects wrong origins and missing/invalid CSRF tokens', async () => {
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: f.owner.email, password },
        })
      ).statusCode,
    ).toBe(403);
    const headers = await f.login();
    for (const bad of ['', 'wrong']) {
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/incidents',
        headers: { ...headers, 'x-csrf-token': bad },
        payload: input,
      });
      expect(response.statusCode).toBe(403);
    }
  });
  it('expires sessions and rejects malformed or missing session cookies', async () => {
    const headers = await f.login();
    await f.db.update(sessions).set({ expiresAt: new Date(0) });
    expect((await f.app.inject({ url: '/api/incidents', headers })).statusCode).toBe(401);
    expect(await f.db.select().from(sessions)).toHaveLength(0);
    expect((await f.app.inject({ url: '/api/incidents' })).statusCode).toBe(401);
    expect(
      (
        await f.app.inject({
          url: '/api/incidents',
          headers: { cookie: 'session=invalid' },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('rejects unknown fields, invalid enums, overlarge pages and empty patches', async () => {
    const headers = await f.login();
    for (const payload of [
      { ...input, owner_id: f.other.id },
      { ...input, severity: 'critical' },
      { ...input, title: '   ' },
    ]) {
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/incidents',
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect((await f.app.inject({ url: '/api/incidents?limit=51', headers })).statusCode).toBe(400);
    expect(
      (
        await f.app.inject({
          method: 'PATCH',
          url: `/api/incidents/${randomUUID()}`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect((await f.app.inject({ url: '/api/incidents/not-an-id', headers })).statusCode).toBe(400);
  });
  it('limits repeated login attempts', async () => {
    let status = 0;
    for (let i = 0; i < 11; i++) {
      status = (
        await f.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin },
          payload: { email: f.owner.email, password: 'wrong' },
        })
      ).statusCode;
    }
    expect(status).toBe(429);
  });
});

describe('incidents and notes', () => {
  it('creates, edits, filters and deletes an incident', async () => {
    const headers = await f.login();
    const created = await f.app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers,
      payload: { ...input, title: '  Checkout is slow  ' },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json<Incident>();
    expect(item.title).toBe(input.title);
    expect(
      (await f.app.inject({ url: `/api/incidents/${item.id}`, headers })).json<Incident>().id,
    ).toBe(item.id);
    expect(
      (
        await f.app.inject({
          method: 'PATCH',
          url: `/api/incidents/${item.id}`,
          headers,
          payload: { status: 'resolved' },
        })
      ).json<Incident>().status,
    ).toBe('resolved');
    expect(
      (await f.app.inject({ url: '/api/incidents?status=open', headers })).json<Page<Incident>>()
        .data,
    ).toHaveLength(0);
    expect(
      (await f.app.inject({ url: '/api/incidents?status=resolved', headers })).json<
        Page<Incident>
      >().data,
    ).toHaveLength(1);
    expect(
      (
        await f.app.inject({
          method: 'DELETE',
          url: `/api/incidents/${item.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(204);
    expect((await f.app.inject({ url: `/api/incidents/${item.id}`, headers })).statusCode).toBe(
      404,
    );
  });
  it('isolates all reads, writes, notes and summary endpoints by incident owner', async () => {
    const item = await f.incidentService.create(f.other.id, input);
    const note = await f.incidentService.addNote(
      f.other.id,
      item.id,
      'Private investigation note.',
    );
    const headers = await f.login();
    const requests = [
      { method: 'GET' as const, url: `/api/incidents/${item.id}` },
      {
        method: 'PATCH' as const,
        url: `/api/incidents/${item.id}`,
        payload: { title: 'Changed' },
      },
      { method: 'DELETE' as const, url: `/api/incidents/${item.id}` },
      { method: 'GET' as const, url: `/api/incidents/${item.id}/notes` },
      {
        method: 'POST' as const,
        url: `/api/incidents/${item.id}/notes`,
        payload: { body: 'No access' },
      },
      {
        method: 'DELETE' as const,
        url: `/api/incidents/${item.id}/notes/${note.id}`,
      },
      { method: 'POST' as const, url: `/api/incidents/${item.id}/summary` },
    ];
    for (const request of requests)
      expect((await f.app.inject({ ...request, headers })).statusCode).toBe(404);
    expect(
      (await f.app.inject({ url: '/api/incidents', headers })).json<Page<Incident>>().data,
    ).toHaveLength(0);
  });
  it('does not lose or duplicate records that share a timestamp', async () => {
    for (let i = 0; i < 5; i++)
      await f.incidentService.create(f.owner.id, {
        ...input,
        title: `Incident ${i}`,
      });
    await f.db.update(incidents).set({ createdAt: new Date('2026-01-01T00:00:00.000Z') });
    const headers = await f.login();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await f.app.inject({
        url: `/api/incidents?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      const page: Page<Incident> = response.json<Page<Incident>>();
      seen.push(...page.data.map((item) => item.id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    for (const bad of ['bad-cursor', Buffer.from('{}').toString('base64url')]) {
      expect(
        (await f.app.inject({ url: `/api/incidents?cursor=${bad}`, headers })).statusCode,
      ).toBe(400);
    }
  });
  it('supports note pagination and prevents deleting a note through another parent', async () => {
    const a = await f.incidentService.create(f.owner.id, input);
    const b = await f.incidentService.create(f.owner.id, input);
    const headers = await f.login();
    const response = await f.app.inject({
      method: 'POST',
      url: `/api/incidents/${a.id}/notes`,
      headers,
      payload: { body: 'First note' },
    });
    expect(response.statusCode).toBe(201);
    const first = response.json<Note>();
    await f.incidentService.addNote(f.owner.id, a.id, 'Second note');
    const page = (
      await f.app.inject({
        url: `/api/incidents/${a.id}/notes?limit=1`,
        headers,
      })
    ).json<Page<Note>>();
    expect(page.next_cursor).toBeTruthy();
    const second = (
      await f.app.inject({
        url: `/api/incidents/${a.id}/notes?limit=1&cursor=${page.next_cursor}`,
        headers,
      })
    ).json<Page<Note>>();
    expect(second.data).toHaveLength(1);
    expect(second.data[0]!.id).not.toBe(page.data[0]!.id);
    expect(
      (
        await f.app.inject({
          method: 'DELETE',
          url: `/api/incidents/${b.id}/notes/${first.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `/api/incidents/${a.id}/notes`,
          headers,
          payload: { body: '  ' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await f.app.inject({
          method: 'DELETE',
          url: `/api/incidents/${a.id}/notes/${first.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(204);
  });
  it('returns not found for missing updates and deletes without writing anything', async () => {
    const headers = await f.login();
    const id = randomUUID();
    expect(
      (
        await f.app.inject({
          method: 'PATCH',
          url: `/api/incidents/${id}`,
          headers,
          payload: { description: 'missing' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.app.inject({
          method: 'DELETE',
          url: `/api/incidents/${id}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    const item = await f.incidentService.create(f.owner.id, input);
    for (const patch of [{ title: ' ' }, { description: ' ' }])
      expect(
        (
          await f.app.inject({
            method: 'PATCH',
            url: `/api/incidents/${item.id}`,
            headers,
            payload: patch,
          })
        ).statusCode,
      ).toBe(400);
    expect((await f.db.select().from(incidents).where(eq(incidents.id, item.id)))[0]!.title).toBe(
      input.title,
    );
  });
});

describe('summary streaming', () => {
  it('streams typed deltas and a terminal done event using real HTTP/service/DB integration', async () => {
    const item = await f.incidentService.create(f.owner.id, input);
    await f.incidentService.addNote(f.owner.id, item.id, 'Investigating dependency latency.');
    const response = await f.app.inject({
      method: 'POST',
      url: `/api/incidents/${item.id}/summary`,
      headers: await f.login(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: delta');
    expect(response.body).toContain('event: done');
    expect((f.provider as FakeProvider).contexts[0]).toContain('Investigating dependency latency.');
  });
  it('returns 503 before starting a stream when AI is not configured', async () => {
    (f.provider as FakeProvider).mode = 'unavailable';
    const item = await f.incidentService.create(f.owner.id, input);
    const response = await f.app.inject({
      method: 'POST',
      url: `/api/incidents/${item.id}/summary`,
      headers: await f.login(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json<ApiError>().code).toBe('provider_unavailable');
  });
  it('emits a safe terminal error after provider failure and releases the active request', async () => {
    (f.provider as FakeProvider).mode = 'fail';
    const item = await f.incidentService.create(f.owner.id, input);
    const headers = await f.login();
    const response = await f.app.inject({
      method: 'POST',
      url: `/api/incidents/${item.id}/summary`,
      headers,
    });
    expect(response.body).toContain('event: error');
    expect(response.body).not.toContain('event: done');
    expect(response.body).not.toContain('private-provider-error');
    (f.provider as FakeProvider).mode = 'ok';
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `/api/incidents/${item.id}/summary`,
          headers,
        })
      ).body,
    ).toContain('event: done');
  });
  it('rejects oversized context and does not invoke the provider', async () => {
    const item = await f.incidentService.create(f.owner.id, {
      ...input,
      description: 'a'.repeat(12000),
    });
    await f.incidentService.addNote(f.owner.id, item.id, 'b'.repeat(8000));
    const response = await f.app.inject({
      method: 'POST',
      url: `/api/incidents/${item.id}/summary`,
      headers: await f.login(),
    });
    expect(response.statusCode).toBe(400);
    expect((f.provider as FakeProvider).contexts).toHaveLength(0);
  });
});
