# Architecture

One application serves the API and built React interface on the same origin. In development, Vite proxies `/api` to Fastify. Public schemas live in `packages/contracts`; persistence records stay on the server.

Dependencies flow from HTTP → services → repository interfaces. IncidentService handles incident operations; NoteService handles note operations; SummaryService reads both ports. The composition root supplies Drizzle repositories, a StorageMapper and the OpenAI adapter. Services do not import HTTP, encryption or database implementations. `npm run lint` checks the HTTP/database boundaries.

Every incident belongs to one user. Note reads and writes validate parent ownership, including deletion through a different parent. Sessions store only hashed opaque tokens; CSRF tokens and identity remain in browser memory. No incident content or credentials are stored in browser storage.

The React interface fetches incident details and notes concurrently. Hash navigation preserves direct incident links and browser history. Shared response schemas reject incompatible payloads before rendering. Stream decoding buffers bytes and SSE lines across chunks, validates events, and requires a terminal event; cancellation releases the reader. Output is rendered as text. Failed or stopped drafts are visibly incomplete and cannot be copied with the complete-draft action.

StorageMapper encrypts incident descriptions and note bodies using AES-256-GCM before database writes and decrypts them for domain/API reads. Each write uses a random 12-byte nonce and 16-byte tag. A versioned `ib:v1` envelope contains nonce, tag and ciphertext. Additional authenticated data binds the owner, record, field and note parent. Altered or misplaced ciphertext and incorrect keys fail closed; there is no plaintext fallback. Database checks reject values without the envelope format; authentication is checked by the application.

Keep the base64-encoded 32-byte `ENCRYPTION_KEY` outside the database and preserve it across restarts. Missing/noncanonical keys prevent startup. A different valid key cannot read existing data; replacing the key is not a rotation procedure. Titles, status, timestamps and account metadata remain queryable plaintext. This is application field encryption, not whole-disk or historical-backup encryption.

Run `npm run db:migrate` with the application stopped. Migration 002 renames the fields and converts existing text in batches inside one transaction, then validates the envelope checks and records completion. Failure rolls back that migration's schema and data changes; rerunning completed migrations leaves ciphertext unchanged. Large datasets require a maintenance window because the transaction holds table locks.

Application logs contain operational metadata only. AI requests send decrypted incident facts and the latest 30 notes to the configured provider when the user generates a summary.

Unit and integration tests use isolated PostgreSQL and mocked AI responses. Browser tests serve the production frontend build through the real HTTP/service/repository stack with a test-only provider. They never call OpenAI. The browser harness lives under `tests/` and is not part of the compiled API.

References: [Node.js authenticated encryption APIs](https://nodejs.org/docs/latest-v24.x/api/crypto.html#ciphersetaadbuffer-options) inform AAD/tag handling. [React’s guidance on deriving state](https://react.dev/learn/you-might-not-need-an-effect) informed keyed resets and computed view state. The parser follows [WHATWG’s SSE framing rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation) for line endings, comments, UTF-8 and multiline data, with strict validation of this application's event types and no automatic reconnection. [OpenAI’s streaming protocol](https://developers.openai.com/api/docs/guides/streaming-responses) informs the backend adapter.
