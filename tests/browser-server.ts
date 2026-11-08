import { fileURLToPath } from 'node:url';
import { fixture, FakeProvider } from './helpers.js';

class BrowserProvider extends FakeProvider {
  override async *stream(context: string, signal: AbortSignal) {
    const title: unknown = (JSON.parse(context) as { title?: unknown }).title;
    yield 'Known facts\nThe incident is under investigation.\n';
    if (typeof title === 'string' && title.includes('[provider failure]'))
      throw new Error('private-provider-message');
    if (typeof title === 'string' && title.includes('[slow stream]')) {
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
      });
    }
    yield 'Impact\nUnknown\nTimeline\nSee investigation notes.\nOpen questions\nRoot cause is unknown.';
  }
}
if (!process.env.E2E_PASSWORD)
  throw new Error('The browser harness requires a generated test password.');
const f = await fixture({
  provider: new BrowserProvider(),
  origin: 'http://127.0.0.1:4173',
  staticRoot: fileURLToPath(new URL('../apps/web/dist', import.meta.url)),
});
await f.app.listen({ port: 4173, host: '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void f.close().then(() => process.exit(0));
  });
