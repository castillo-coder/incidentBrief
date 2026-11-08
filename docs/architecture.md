# Architecture

One application serves the API and built React interface on the same origin. In development, Vite proxies `/api` to Fastify. Public schemas live in `packages/contracts`; persistence records stay on the server.

Dependencies flow from HTTP → services → repository interfaces. The composition root supplies Drizzle repositories and the OpenAI adapter. Services do not import HTTP or database implementations. `npm run lint` checks these boundaries.

Every incident belongs to one user. Note reads and writes validate parent ownership, including deletion through a different parent. Sessions store only hashed opaque tokens; CSRF tokens and identity remain in browser memory. No incident content or credentials are stored in browser storage.

The React interface fetches incident details and notes concurrently. Hash navigation preserves direct incident links and browser history. Shared response schemas reject incompatible payloads before rendering. Stream decoding buffers bytes and SSE lines across chunks, validates events, and requires a terminal event; cancellation releases the reader. Output is rendered as text. Failed or stopped drafts are visibly incomplete and cannot be copied with the complete-draft action.

The current persistence layer stores incident descriptions and note bodies as text. Authenticated field encryption is pending; this milestone is intended for local use. Application logs contain operational metadata only. AI requests send incident facts and the latest 30 notes to the configured provider when the user generates a summary.

Unit and integration tests use isolated PostgreSQL and mocked AI responses. Browser tests serve the production frontend build through the real HTTP/service/repository stack with a test-only provider. They never call OpenAI. The browser harness lives under `tests/` and is not part of the compiled API.

References: [React’s guidance on deriving state](https://react.dev/learn/you-might-not-need-an-effect) informed keyed resets and computed view state. The parser follows [WHATWG’s SSE framing rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation) for line endings, comments, UTF-8 and multiline data, with strict validation of this application's event types and no automatic reconnection. [OpenAI’s streaming protocol](https://developers.openai.com/api/docs/guides/streaming-responses) informs the backend adapter.
