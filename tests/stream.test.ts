import { describe, expect, it } from 'vitest';
import { readSummaryStream } from '@incidentbrief/contracts/stream';
import type { SummaryEvent } from '@incidentbrief/contracts';

const encoder = new TextEncoder();
const frame = (event: SummaryEvent, ending = '\n') =>
  `event: ${event.type}${ending}data: ${JSON.stringify(event)}${ending}${ending}`;
function source(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
async function collect(chunks: Uint8Array[]) {
  const events: SummaryEvent[] = [];
  for await (const event of readSummaryStream(source(chunks))) events.push(event);
  return events;
}
describe('incremental summary stream', () => {
  it.each(['\n', '\r\n', '\r'])(
    'handles every byte boundary with %j endings and split UTF-8',
    async (ending) => {
      const events: SummaryEvent[] = [
        { type: 'delta', text: 'Café 🔎\nNext line' },
        { type: 'done' },
      ];
      const bytes = encoder.encode(events.map((event) => frame(event, ending)).join(''));
      expect(await collect([...bytes].map((byte) => Uint8Array.of(byte)))).toEqual(events);
    },
  );
  it('handles comments, unknown fields, empty frames and multiline data', async () => {
    const text =
      ': keepalive\n\nid: unused\n\nevent: delta\ndata: {"type":"delta",\ndata: "text":"hello"}\n\n' +
      frame({ type: 'done' });
    expect(await collect([encoder.encode(text)])).toEqual([
      { type: 'delta', text: 'hello' },
      { type: 'done' },
    ]);
  });
  it('treats errors as terminal and cancels remaining input', async () => {
    let cancelled = false;
    const event: SummaryEvent = {
      type: 'error',
      code: 'generation_failed',
      error: 'Try again.',
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame(event)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const events = [];
    for await (const value of readSummaryStream(stream)) events.push(value);
    expect(events).toEqual([event]);
    expect(cancelled).toBe(true);
  });
  it.each([
    '',
    frame({ type: 'delta', text: 'Partial' }),
    'data: {"type":"done"}',
    'data: broken\n\n',
    'event: done\ndata: {"type":"delta","text":"bad"}\n\n',
    'data: {"type":"done","extra":true}\n\n',
    `data: ${'a'.repeat(65537)}\n\n`,
  ])('rejects incomplete, invalid or oversized streams (%#)', async (text) => {
    await expect(collect([encoder.encode(text)])).rejects.toThrow();
  });
  it('rejects malformed UTF-8 instead of corrupting the output', async () => {
    await expect(collect([Uint8Array.of(0xc3, 0x28)])).rejects.toThrow();
  });
  it('cancels a pending read when the caller aborts and releases the lock', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const abort = new AbortController();
    const next = readSummaryStream(stream, abort.signal).next();
    abort.abort();
    await expect(next).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });
});
