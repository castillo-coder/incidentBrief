import { Value } from '@sinclair/typebox/value';
import { SummaryEventSchema, type SummaryEvent } from './index.js';

const MAX_FRAME = 65536;
export class StreamProtocolError extends Error {
  constructor(message = 'The summary stream ended before completion. Please try again.') {
    super(message);
    this.name = 'StreamProtocolError';
  }
}

/** Decode SSE independently of network chunk and UTF-8 character boundaries. */
export async function* readSummaryStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SummaryEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '';
  let data: string[] = [];
  let eventName = '';
  let frameSize = 0;
  let afterCR = false;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  function finishLine(): SummaryEvent | undefined {
    const value = line;
    line = '';
    if (!value) {
      frameSize = 0;
      if (!data.length) {
        eventName = '';
        return;
      }
      let event: unknown;
      try {
        event = JSON.parse(data.join('\n'));
      } catch {
        throw new StreamProtocolError('The summary stream contained invalid data.');
      }
      data = [];
      if (!Value.Check(SummaryEventSchema, event) || (eventName && eventName !== event.type))
        throw new StreamProtocolError('The summary stream did not match the expected format.');
      eventName = '';
      return event;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    const text = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(text);
    else if (field === 'event') eventName = text;
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (const char of text) {
        if (afterCR && char === '\n') {
          afterCR = false;
          continue;
        }
        afterCR = char === '\r';
        if (char === '\r' || char === '\n') {
          const event = finishLine();
          if (event) {
            yield event;
            if (event.type !== 'delta') return;
          }
        } else {
          line += char;
          if (++frameSize > MAX_FRAME)
            throw new StreamProtocolError('A summary event was too large.');
        }
      }
      if (done) throw new StreamProtocolError();
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
