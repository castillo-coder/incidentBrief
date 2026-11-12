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

To serve a production frontend build natively, run `npm run build` then `APP_ORIGIN=http://localhost:3100 npm start` and open port 3100.

Descriptions and note bodies are encrypted before storage. Preserve the generated `ENCRYPTION_KEY`; replacing it makes existing records unreadable. Run migrations with the application stopped. See [storage and migration details](docs/architecture.md).

## Run with Docker

Stop the native development server first. After `npm run setup` has generated `.env`:

```sh
docker compose up --build --wait
docker compose exec app node apps/api/dist/cli/create-user.js
```

Open `http://localhost:3100`. Startup waits for PostgreSQL and applies migrations before serving requests. The CLI prompts for the first user's email and password. The database is also available on `127.0.0.1:55439`. The local image uses development cookie settings for HTTP; production configuration is described in [deployment](docs/deployment.md).

```sh
docker compose logs app
docker compose down
```

The database volume is retained. Secrets and local dependencies are excluded from the build context.

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
