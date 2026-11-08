# API contracts

All endpoints use JSON except the summary stream. Contracts and TypeScript types live in `packages/contracts`. Requests with unknown fields are rejected. IDs are UUIDs. Timestamps use ISO 8601 UTC.

## Authentication

`POST /api/auth/login` accepts `{ "email": "you@example.com", "password": "…" }`. Send `Origin` matching `APP_ORIGIN`, including from CLI clients. The response contains `{ "user": { "id": "…", "email": "…" }, "csrf_token": "…" }` and sets an HttpOnly session cookie. Browser clients use `credentials: 'same-origin'` through the same-origin API or development proxy.

`GET /api/auth/session` restores identity and the CSRF token. Send `X-CSRF-Token` plus the matching `Origin` on authenticated mutations. `POST /api/auth/logout` revokes the server session and returns 204. Sessions expire after eight hours; production requires HTTPS and sets Secure cookies and HSTS.

## Incidents and notes

| Method | Path                               | Body / result                                                |
| ------ | ---------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/incidents`                   | Paginated incidents; optional `status=open` or `resolved`.   |
| POST   | `/api/incidents`                   | `{title, description, severity}` → 201 incident.             |
| GET    | `/api/incidents/:id`               | Incident.                                                    |
| PATCH  | `/api/incidents/:id`               | Any nonempty subset of title, description, severity, status. |
| DELETE | `/api/incidents/:id`               | 204; cascades notes.                                         |
| GET    | `/api/incidents/:id/notes`         | Paginated notes.                                             |
| POST   | `/api/incidents/:id/notes`         | `{body}` → 201 note.                                         |
| DELETE | `/api/incidents/:id/notes/:noteId` | 204.                                                         |
| POST   | `/api/incidents/:id/summary`       | SSE stream.                                                  |

Severity is `low`, `medium` or `high`; new incidents are `open`. Titles have 1–160 characters, descriptions 1–12,000, and notes 1–8,000. Whitespace-only text is rejected. Every record is scoped to its owner; foreign and missing IDs return 404.

## Pagination

Both list endpoints accept `limit` (default 20, maximum 50) and an opaque `cursor`:

```json
{ "data": [], "next_cursor": null }
```

Use the returned `next_cursor` unchanged to fetch the next page, retaining the same filters. A null cursor means the end. Ordering is newest first by `(created_at, id)`; the ID breaks timestamp ties so equal timestamps do not lose records. Invalid cursors return 400. Lists are not immutable snapshots: concurrent edits can change membership.

## Errors and limits

```json
{ "error": "The record was not found.", "code": "not_found", "request_id": "…" }
```

Common statuses: 400 invalid input, 401 unauthenticated, 403 origin/CSRF failure, 404 missing record, 409 generation already active, 429 rate limit, 503 unconfigured AI. Login allows 10 attempts/minute/IP; summary generation allows 5/minute/IP and one active generation/user. These limits are process-local; the MVP runs one application instance.

## Summary stream

Use fetch with POST, the cookie, Origin and CSRF header. The response has `Content-Type: text/event-stream`. Each frame contains a JSON event:

```text
event: delta
data: {"type":"delta","text":"Known facts\n"}

event: done
data: {"type":"done"}

```

An `error` event contains `{type: 'error', code, error}` and is terminal; it replaces `done`. A connection ending without either terminal event is incomplete. A network chunk may contain part of a frame or several frames. Cancel fetch to stop generation; do not automatically retry a started request or treat partial text as a complete summary.

The backend sends the incident and its latest 30 notes to the configured OpenAI model, caps context at 20,000 characters and output at 1,500 tokens, and times out after 30 seconds. Summaries are unsaved drafts; verify their facts. Provider storage is disabled. See the [official Responses streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses) for the underlying event protocol.
