import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAISummaryProvider,
  SUMMARY_PROMPT_V1,
} from '../apps/api/src/providers/openai-provider.js';

const { create, constructor } = vi.hoisted(() => ({
  create: vi.fn(),
  constructor: vi.fn(),
}));
vi.mock('openai', () => ({
  default: class {
    responses = { create };
    constructor(options: unknown) {
      constructor(options);
    }
  },
}));

type Event = { type: string; delta?: string };
function stream(events: Event[]) {
  create.mockImplementationOnce(async function* () {
    for (const event of events) yield event;
  });
}
async function collect(provider: OpenAISummaryProvider, signal = new AbortController().signal) {
  const values: string[] = [];
  for await (const value of provider.stream('Untrusted investigation records', signal))
    values.push(value);
  return values;
}

beforeEach(() => vi.clearAllMocks());
describe('OpenAI response adapter', () => {
  it('is unavailable without both credentials and a model', async () => {
    for (const provider of [
      new OpenAISummaryProvider('', 'test-model'),
      new OpenAISummaryProvider('test-key', ''),
    ]) {
      expect(provider.available()).toBe(false);
      await expect(collect(provider)).rejects.toMatchObject({
        code: 'provider_unavailable',
      });
    }
    expect(constructor).not.toHaveBeenCalled();
  });
  it('streams text only, requires completion, disables storage/retries and forwards cancellation', async () => {
    const provider = new OpenAISummaryProvider('test-key', 'test-model');
    const signal = new AbortController().signal;
    stream([
      { type: 'response.created' },
      { type: 'response.output_text.delta', delta: 'Known facts' },
      { type: 'response.output_text.delta', delta: '\nUnknown cause.' },
      { type: 'response.completed' },
    ]);
    expect(await collect(provider, signal)).toEqual(['Known facts', '\nUnknown cause.']);
    expect(constructor).toHaveBeenCalledWith({
      apiKey: 'test-key',
      maxRetries: 0,
      timeout: 30000,
    });
    expect(create).toHaveBeenCalledWith(
      {
        model: 'test-model',
        instructions: SUMMARY_PROMPT_V1,
        input: 'Untrusted investigation records',
        stream: true,
        store: false,
        max_output_tokens: 1500,
      },
      { signal },
    );
  });
  it.each(['error', 'response.failed', 'response.incomplete', 'response.refusal.delta'])(
    'rejects terminal %s events',
    async (type) => {
      stream([{ type }]);
      await expect(
        collect(new OpenAISummaryProvider('test-key', 'test-model')),
      ).rejects.toMatchObject({ code: 'generation_failed' });
    },
  );
  it.each([
    [{ type: 'response.output_text.delta', delta: 'Partial' }],
    [{ type: 'response.completed' }],
    [{ type: 'response.output_text.delta', delta: ' ' }, { type: 'response.completed' }],
  ])('rejects missing completion or empty output (%j)', async (...events) => {
    stream(events);
    await expect(
      collect(new OpenAISummaryProvider('test-key', 'test-model')),
    ).rejects.toMatchObject({ code: 'generation_failed' });
  });
});
