# IncidentBrief

A personal incident notebook with investigation notes and streamed AI summaries.

TypeScript · Fastify · PostgreSQL · React (UI in progress)

## Run the API

Requires Node.js 24–26, npm, and PostgreSQL 18 or Docker Compose.

```sh
npm ci
npm run setup
docker compose up -d --wait db
npm run build -w @incidentbrief/contracts
npm run db:migrate
npm run user:create
npm run build -w @incidentbrief/api
npm start
```

The API listens on `http://localhost:3100`; check `/healthz`. User creation prompts for an email and a hidden password (12+ characters, at most 72 UTF-8 bytes). There is no public registration.

Setup generates an ignored `.env` without replacing existing values. With native PostgreSQL, set `DATABASE_URL` and `TEST_DATABASE_URL` there instead. Add `OPENAI_API_KEY` and `OPENAI_MODEL` to enable summaries; otherwise their endpoint returns 503. Keep credentials out of Git.

For API development, use `npm run dev -w @incidentbrief/api` after building contracts. The React interface and application Docker image are not available in this milestone. Compose currently runs the database only, bound to `127.0.0.1:55439`.

## Check

Create an isolated test database once:

```sh
docker compose exec db createdb -U incidentbrief incidentbrief_test
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
```

Integration tests migrate and reset only a database whose name ends in `_test`. They use a fake AI provider; adapter tests mock the OpenAI SDK. No test calls a paid model. Coverage reports are written to `coverage/`.

## Stop

Stop the API with Ctrl+C, then run `docker compose down`. The database volume is retained.

See [API contracts](docs/api.md) for authentication, pagination and stream events.
