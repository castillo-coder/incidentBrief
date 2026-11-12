# Query performance

The API's list queries are scoped by owner or incident and ordered by `(created_at, id)` descending. Migration 003 adds matching B-tree indexes. Ciphertext stays outside these indexes.

Cursor pages use the row comparison `(created_at, id) < (timestamp, uuid)`. It preserves timestamp tie-breaking while letting PostgreSQL use one index range. The equivalent `timestamp < cutoff OR (timestamp = cutoff AND id < cutoff_id)` can produce bitmap scans and an extra sort.

Notes retain SQL ownership enforcement with explicit `incident_id` equality and an `EXISTS` check for that owned parent. This avoids a repeated semi-join while keeping authorization in the query. A tuple predicate alone did not remove the notes sort under the previous `IN` ownership formulation in the synthetic profile.

## Local measurements

PostgreSQL 18.6, ARM64 Docker, warm cache; medians of 20 server execution times in milliseconds. The before/after values below come from the same seeded run. Q3's before case uses the original OR/IN query form; the other two queries retain their original SQL.

| Query                  | Before | After | Main change                                                     |
| ---------------------- | -----: | ----: | --------------------------------------------------------------- |
| Q1: incident list      |  4.379 | 0.006 | Owner/date index; ordered scan instead of full scan/sort.       |
| Q2: resolved incidents |  7.533 | 0.006 | Owner/status/date index.                                        |
| Q3: middle notes page  |  6.877 | 0.274 | Incident/date index, tuple cursor and one-time ownership guard. |
| Q4: email lookup       |  0.005 | 0.004 | Existing unique index retained.                                 |
| Q5: session lookup     |  0.004 | 0.004 | Existing primary-key indexes retained.                          |

Additional comparisons with all indexes present: the middle incident page drops from 0.308 ms with the OR cursor to 0.007 ms with the tuple cursor. For notes, tuple + IN is 0.339 ms versus 0.338 ms for OR + IN; that change alone offers no material gain. Tuple + EXISTS is 0.274 ms. The final notes plan still uses a bitmap scan and sorts 1,499 matching rows; it is not a constant-work page lookup in this distribution. Q4/Q5 differences are timing noise, not claimed improvements.

| Query                            | Access path                       | Index documented in migration                                     |
| -------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| Q1: incident list                | owner, newest first, bounded page | `incidents_owner_created_idx` — 003                               |
| Q2: status-filtered incidents    | owner + status, same ordering     | `incidents_owner_status_created_idx` — 003                        |
| Q3: notes / latest summary notes | owned parent + newest notes       | `notes_incident_created_idx`, parent `incidents_pkey` — 003 / 001 |
| Q4: login lookup                 | normalized email equality         | `users_email_key` — 001                                           |
| Q5: session identity             | token hash equality, user join    | `sessions_pkey`, `users_pkey` — 001                               |

Detail/update/delete operations use primary-key equality plus ownership checks and inspect at most one candidate row. Note creation locks the owned parent by primary key. Incident deletion uses the notes index's leading `incident_id` for its FK cascade. Login/session inserts and deletes use existing unique/primary-key constraints. Account deletion has no API endpoint. Migration backfills intentionally enumerate existing data in bounded primary-key batches; index construction and fixture loading are bulk operations.

## Reproduce

```sh
npm run db:profile
```

Requires the configured local `TEST_DATABASE_URL`, or `PROFILE_DATABASE_URL`; the host must be loopback and the database name must end in `_test`. The tool creates a new `incidentbrief_profile` schema and removes only that schema afterward. It refuses to replace an existing schema. Reports go to a new temporary directory; `--output=/absolute/new/directory` chooses an external destination.

The dataset contains 1,000 users, 100,000 incidents and 300,000 notes. One busy owner has 5,000 incidents, including 1,000 older resolved incidents; one investigation has 3,000 notes. IDs, text, timestamps and skew are deterministic; encryption uses an ephemeral key and fresh nonces. This is a synthetic stress distribution.

SQL is captured from the actual repositories with a memory-only Drizzle logger. All values stay parameterized. The profiler measures a baseline without the three candidate indexes, then restores each index from the current migration's catalog definition. It also captures a middle-page incident query and historical OR/IN formulations as explicit comparison controls. All formulations must return the same ordered IDs. The same data/session are used throughout; five warmups precede twenty measurements per query/variant. Medians average the middle pair; p95 uses nearest rank. No planner switches, artificial delays or cold-cache tricks are used.

JSON reports retain SQL/parameters, raw `EXPLAIN (ANALYZE, BUFFERS)` plans, environment settings, source hashes and timings. Measurements describe PostgreSQL execution, not HTTP or user-perceived latency. New indexes consume storage and add write maintenance; write-throughput impact is not measured by this read workload.

References: PostgreSQL's official [EXPLAIN guide](https://www.postgresql.org/docs/18/using-explain.html), [multicolumn index rules](https://www.postgresql.org/docs/18/indexes-multicolumn.html), [index ordering](https://www.postgresql.org/docs/18/indexes-ordering.html) and [row comparisons](https://www.postgresql.org/docs/18/functions-comparisons.html#ROW-WISE-COMPARISON) explain the chosen access paths and cursor semantics.
