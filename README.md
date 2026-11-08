# IncidentBrief

A personal incident notebook with investigation notes and streamed AI summaries.

TypeScript · Fastify · PostgreSQL · React

## Run locally

Requires Node.js 24–26, npm, and PostgreSQL 18 or Docker Compose.

```sh
npm ci
npm run setup
docker compose up -d --wait db
npm run build -w @incidentbrief/contracts
npm run db:migrate
npm run user:create
npm run dev
```

Open `http://localhost:5173`. The API listens on `http://localhost:3100`; check `/healthz`. User creation prompts for an email and a hidden password (12+ characters, at most 72 UTF-8 bytes). There is no public registration.

Setup generates an ignored `.env` without replacing existing values. With native PostgreSQL, set `DATABASE_URL` and `TEST_DATABASE_URL` there instead. Add `OPENAI_API_KEY` and `OPENAI_MODEL` to enable summaries; otherwise their endpoint returns 503. Keep credentials out of Git.

Compose currently runs the database only, bound to `127.0.0.1:55439`. The application Docker image is a later milestone. To serve a production frontend build locally, run `npm run build` then `npm start`; use `APP_ORIGIN=http://localhost:3100 npm start` when accessing it directly on port 3100.

Descriptions and note bodies are encrypted before storage. Preserve the generated `ENCRYPTION_KEY`; replacing it makes existing records unreadable. Run migrations with the application stopped. See [storage and migration details](docs/architecture.md).

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

For browser tests, install Chromium once and run the suite after the integration tests finish:

```sh
npx playwright install chromium
npm run test:e2e
```

Browser tests start the built frontend and a test API on port 4173 with generated credentials. They reset the same isolated test database, so do not run both suites simultaneously. Reports are written to `playwright-report/`; synthetic test screenshots and traces stay under `test-results/`.

## Stop

Stop the API with Ctrl+C, then run `docker compose down`. The database volume is retained.

See [API contracts](docs/api.md) and [architecture](docs/architecture.md) for authentication, pagination, streaming and dependency boundaries.

To reproduce the synthetic query plans and index comparisons, see [query performance](docs/query-performance.md). Profiling runs in a disposable schema of the local test database and saves reports outside the repository.
