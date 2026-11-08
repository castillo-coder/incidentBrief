import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, input, type Fixture } from './helpers.js';
import { hashPassword } from '../apps/api/src/services/auth-service.js';
import { decodeCursor } from '../apps/api/src/repositories/cursor.js';
import { loadConfig } from '../apps/api/src/config.js';
import { SummaryService } from '../apps/api/src/services/summary-service.js';
import type { SummaryProvider } from '../apps/api/src/domain/ports.js';

let f: Fixture;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f?.close();
});

describe('service boundaries', () => {
  it('releases reservations after preparation errors and interrupted generation', async () => {
    const item = await f.incidentService.create(f.owner.id, input);
    const failure = vi
      .spyOn(f.repository, 'summaryNotes')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(f.summaryService.prepare(f.owner.id, item.id)).rejects.toThrow(
      'storage unavailable',
    );
    failure.mockRestore();
    const prepared = await f.summaryService.prepare(f.owner.id, item.id);
    const abort = new AbortController();
    abort.abort();
    const events = [];
    for await (const event of prepared.events(abort.signal)) events.push(event);
    expect(events).toEqual([]);
    const retried = await f.summaryService.prepare(f.owner.id, item.id);
    retried.release();
    retried.release();
  });
  it('emits a timeout error and frees the summary slot', async () => {
    const item = await f.incidentService.create(f.owner.id, input);
    const provider: SummaryProvider = {
      available: () => true,
      async *stream(_context, signal) {
        await new Promise<void>((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
        });
        yield 'unreachable';
      },
    };
    const service = new SummaryService(f.repository, provider, 10);
    const prepared = await service.prepare(f.owner.id, item.id);
    const events = [];
    for await (const event of prepared.events(new AbortController().signal)) events.push(event);
    expect(events).toEqual([
      { type: 'error', code: 'generation_timeout', error: expect.any(String) },
    ]);
    const next = await service.prepare(f.owner.id, item.id);
    next.release();
  });
  it('reserves one summary slot even when two preparations overlap', async () => {
    const item = await f.incidentService.create(f.owner.id, input);
    vi.spyOn(f.repository, 'get').mockResolvedValue(item);
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    vi.spyOn(f.repository, 'summaryNotes').mockImplementation(async () => {
      await gate;
      return [];
    });
    const first = f.summaryService.prepare(f.owner.id, item.id);
    await Promise.resolve();
    const second = f.summaryService.prepare(f.owner.id, item.id);
    const results = Promise.allSettled([first, second]);
    await Promise.resolve();
    await Promise.resolve();
    unlock();
    const settled = await results;
    for (const result of settled) if (result.status === 'fulfilled') result.value.release();
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'conflict' },
    });
  });
  it('validates credentials and text before persistence', async () => {
    await expect(hashPassword('short')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(hashPassword('é'.repeat(40))).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(() => f.incidentService.create(f.owner.id, { ...input, description: ' ' })).toThrow();
    const item = await f.incidentService.create(f.owner.id, input);
    await expect(f.incidentService.update(f.owner.id, item.id, {})).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(decodeCursor()).toBeUndefined();
    expect(() =>
      decodeCursor(
        Buffer.from(JSON.stringify({ id: item.id, created_at: 'yesterday' })).toString('base64url'),
      ),
    ).toThrow();
    expect(() => decodeCursor('!invalid')).toThrow();
  });
  it('validates application configuration without exposing secrets', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL');
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/example',
        ENCRYPTION_KEY: 'bad',
      }),
    ).toThrow('ENCRYPTION_KEY');
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/example',
        ENCRYPTION_KEY: key,
        PORT: '0',
      }),
    ).toThrow('PORT');
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/example',
        ENCRYPTION_KEY: key,
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://example.test',
      }),
    ).toThrow('APP_ORIGIN');
  });
});
