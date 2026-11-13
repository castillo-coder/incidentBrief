import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile, readFile } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { and, eq, desc, lt, or, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Logger } from 'drizzle-orm/logger';
import { hash } from 'bcryptjs';
import { config as dotenv } from 'dotenv';
import * as schema from '../src/db/schema.js';
import { migrate } from '../src/db/migrate.js';
import { AesGcmCipher } from '../src/security/aes-gcm-cipher.js';
import { incidentContext, noteContext } from '../src/security/field-context.js';
import { StorageMapper } from '../src/repositories/storage-mapper.js';
import { incidentRepository } from '../src/repositories/incident-repository.js';
import { noteRepository } from '../src/repositories/note-repository.js';
import { authRepository } from '../src/repositories/auth-repository.js';
import { encodeCursor } from '../src/repositories/cursor.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
dotenv({ path: join(root, '.env'), quiet: true });
const { values } = parseArgs({
  options: { 'baseline-only': { type: 'boolean' }, output: { type: 'string' } },
});
const WARMUPS = 5,
  SAMPLES = 20,
  BATCH = 1000;
const USERS = 1000,
  INCIDENTS = 100000,
  NOTES = 300000,
  BUSY_INCIDENTS = 5000,
  LONG_NOTES = 3000;
const DATASET = 'incidentbrief-profile-v1';
const epoch = Date.parse('2025-01-01T00:00:00.000Z');
const indexNames = [
  'incidents_owner_created_idx',
  'incidents_owner_status_created_idx',
  'notes_incident_created_idx',
];
const cancellation = new AbortController();
process.once('SIGINT', () => cancellation.abort());
process.once('SIGTERM', () => cancellation.abort());

function id(kind: string, number: number) {
  const bytes = createHash('sha256')
    .update(`${DATASET}/${kind}/${number}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const owner = (index: number) =>
  index < BUSY_INCIDENTS ? id('user', 0) : id('user', 1 + ((index - BUSY_INCIDENTS) % (USERS - 1)));
const sessionHash = (index: number) =>
  createHash('sha256').update(`${DATASET}/synthetic-session/${index}`).digest('hex');
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const percentile = (numbers: number[], fraction: number) =>
  [...numbers].sort((a, b) => a - b)[Math.max(0, Math.ceil(numbers.length * fraction) - 1)]!;

function median(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

interface PlanNode {
  'Node Type': string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Index Name'?: string;
  'Relation Name'?: string;
  'Rows Removed by Filter'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}
interface Explain {
  Plan: PlanNode;
  'Execution Time': number;
  'Planning Time': number;
}
interface Query {
  id: string;
  purpose: string;
  sql: string;
  params: unknown[];
}
interface Run {
  explain: Explain;
  client_ms: number;
}
function nodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}
function summarize(runs: Run[]) {
  return {
    median_ms: median(runs.map((run) => run.explain['Execution Time'])),
    p95_ms: percentile(
      runs.map((run) => run.explain['Execution Time']),
      0.95,
    ),
    median_client_ms: median(runs.map((run) => run.client_ms)),
    median_shared_blocks: median(
      runs.map(
        (run) =>
          (run.explain.Plan['Shared Hit Blocks'] ?? 0) +
          (run.explain.Plan['Shared Read Blocks'] ?? 0),
      ),
    ),
    indexes: [
      ...new Set(
        runs.flatMap((run) =>
          nodes(run.explain.Plan).flatMap((node) =>
            node['Index Name'] ? [node['Index Name']] : [],
          ),
        ),
      ),
    ],
    node_types: [
      ...new Set(runs.flatMap((run) => nodes(run.explain.Plan).map((node) => node['Node Type']))),
    ],
  };
}
function databaseUrl() {
  const raw = process.env.PROFILE_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('Set PROFILE_DATABASE_URL or TEST_DATABASE_URL.');
  const url = new URL(raw);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Profiling requires a loopback database with a name ending in _test.');
  return url.toString();
}
async function outputDirectory() {
  const output = values.output
    ? resolve(values.output)
    : await mkdtemp(join(tmpdir(), 'incidentbrief-profile-'));
  const inside = (path: string, parent: string) => {
    const part = relative(parent, path);
    return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
  };
  if (inside(output, root)) throw new Error('Choose a report directory outside the application.');
  if (values.output) await mkdir(output);
  if (inside(await realpath(output), await realpath(root)))
    throw new Error('Reports cannot resolve inside the application.');
  return output;
}

async function seed(pool: Pool, cipher: AesGcmCipher) {
  const passwordHash = await hash(randomBytes(24).toString('hex'), 12);
  await pool.query(
    'INSERT INTO users(id,email,password_hash) SELECT * FROM unnest($1::uuid[],$2::text[],$3::text[])',
    [
      Array.from({ length: USERS }, (_, n) => id('user', n)),
      Array.from({ length: USERS }, (_, n) => `profile-${n}@example.test`),
      Array.from({ length: USERS }, () => passwordHash),
    ],
  );
  await pool.query(
    'INSERT INTO sessions(token_hash,user_id,expires_at) SELECT * FROM unnest($1::text[],$2::uuid[],$3::timestamptz[])',
    [
      Array.from({ length: USERS }, (_, n) => sessionHash(n)),
      Array.from({ length: USERS }, (_, n) => id('user', n)),
      Array.from({ length: USERS }, () => '2030-01-01T00:00:00.000Z'),
    ],
  );
  for (let start = 0; start < INCIDENTS; start += BATCH) {
    cancellation.signal.throwIfAborted();
    const rows = Array.from({ length: Math.min(BATCH, INCIDENTS - start) }, (_, offset) => {
      const n = start + offset,
        recordId = id('incident', n),
        ownerId = owner(n);
      return {
        id: recordId,
        owner: ownerId,
        title: `Synthetic incident ${n}`,
        content: cipher.encrypt(
          `Synthetic investigation ${n}. A dependency exceeded its expected response time. Impact and root cause remain under investigation. `.repeat(
            2,
          ),
          incidentContext(ownerId, recordId),
        ),
        severity: n % 3 === 0 ? 'high' : 'medium',
        status:
          n < BUSY_INCIDENTS ? (n < 1000 ? 'resolved' : 'open') : n % 5 === 0 ? 'resolved' : 'open',
        at: new Date(epoch + n * 60000).toISOString(),
      };
    });
    await pool.query(
      'INSERT INTO incidents(id,owner_id,title,description_ciphertext,severity,status,created_at,updated_at) SELECT * FROM unnest($1::uuid[],$2::uuid[],$3::text[],$4::text[],$5::text[],$6::text[],$7::timestamptz[],$8::timestamptz[])',
      [
        rows.map((row) => row.id),
        rows.map((row) => row.owner),
        rows.map((row) => row.title),
        rows.map((row) => row.content),
        rows.map((row) => row.severity),
        rows.map((row) => row.status),
        rows.map((row) => row.at),
        rows.map((row) => row.at),
      ],
    );
    if ((start + BATCH) % 50000 === 0) console.log(`Seeded ${start + BATCH} incidents.`);
  }
  for (let start = 0; start < NOTES; start += BATCH) {
    cancellation.signal.throwIfAborted();
    const rows = Array.from({ length: Math.min(BATCH, NOTES - start) }, (_, offset) => {
      const n = start + offset,
        incidentNumber = n < LONG_NOTES ? 0 : 1 + ((n - LONG_NOTES) % (INCIDENTS - 1));
      const recordId = id('note', n),
        parentId = id('incident', incidentNumber);
      return {
        id: recordId,
        parent: parentId,
        content: cipher.encrypt(
          `Synthetic finding ${n}: dependency traces captured; next step is to verify the timeout configuration.`,
          noteContext(owner(incidentNumber), parentId, recordId),
        ),
        at: new Date(epoch + Math.floor(n / 2) * 1000).toISOString(),
      };
    });
    await pool.query(
      'INSERT INTO notes(id,incident_id,body_ciphertext,created_at) SELECT * FROM unnest($1::uuid[],$2::uuid[],$3::text[],$4::timestamptz[])',
      [
        rows.map((row) => row.id),
        rows.map((row) => row.parent),
        rows.map((row) => row.content),
        rows.map((row) => row.at),
      ],
    );
    if ((start + BATCH) % 50000 === 0) console.log(`Seeded ${start + BATCH} notes.`);
  }
  for (const statement of [
    'VACUUM (ANALYZE) users',
    'VACUUM (ANALYZE) sessions',
    'VACUUM (ANALYZE) incidents',
    'VACUUM (ANALYZE) notes',
  ])
    await pool.query(statement);
}

async function captureQueries(pool: Pool, cipher: AesGcmCipher): Promise<Query[]> {
  let logged: { sql: string; params: unknown[] }[] = [];
  const logger: Logger = {
    logQuery(sql, params) {
      logged.push({ sql, params });
    },
  };
  const db = drizzle(pool, { schema, logger });
  const mapper = new StorageMapper(cipher);
  const incidents = incidentRepository(db, mapper),
    notes = noteRepository(db, mapper),
    auth = authRepository(db);
  const queries: Query[] = [];
  async function capture(id: string, purpose: string, call: () => Promise<unknown>) {
    logged = [];
    await call();
    if (logged.length !== 1 || !logged[0]!.sql.startsWith('select '))
      throw new Error('Expected one repository SELECT.');
    queries.push({ id, purpose, ...logged[0]! });
  }
  await capture('Q1', 'Incident list for a busy owner, first page', () =>
    incidents.list(id('user', 0), { limit: 20 }),
  );
  await capture('Q2', 'Resolved incidents for the same owner, first page', () =>
    incidents.list(id('user', 0), { status: 'resolved', limit: 20 }),
  );
  await capture('Q3', 'Notes for a long investigation, middle page', () =>
    notes.list(id('user', 0), id('incident', 0), {
      limit: 20,
      cursor: encodeCursor({
        id: id('note', 1499),
        created_at: new Date(epoch + 749000).toISOString(),
      }),
    }),
  );
  await capture('Q4', 'Normalized email lookup at login', () =>
    auth.findUser('profile-0@example.test'),
  );
  await capture('Q5', 'Hashed session lookup joined to public user identity', () =>
    auth.getSession(sessionHash(0)),
  );
  await capture('Q1_cursor', 'Incident list at a middle cursor', () =>
    incidents.list(id('user', 0), {
      limit: 20,
      cursor: encodeCursor({
        id: id('incident', 2499),
        created_at: new Date(epoch + 2499 * 60000).toISOString(),
      }),
    }),
  );
  // Historical equivalent used ONLY as a benchmark control, never a serving path.
  const cutoff = new Date(epoch + 749000);
  await capture('Q3_OR_control', 'Historical OR cursor form on the identical data', () =>
    db
      .select()
      .from(schema.notes)
      .where(
        and(
          inArray(
            schema.notes.incidentId,
            db
              .select({ id: schema.incidents.id })
              .from(schema.incidents)
              .where(
                and(
                  eq(schema.incidents.ownerId, id('user', 0)),
                  eq(schema.incidents.id, id('incident', 0)),
                ),
              ),
          ),
          or(
            lt(schema.notes.createdAt, cutoff),
            and(eq(schema.notes.createdAt, cutoff), lt(schema.notes.id, id('note', 1499))),
          ),
        ),
      )
      .orderBy(desc(schema.notes.createdAt), desc(schema.notes.id))
      .limit(21),
  );
  await capture('Q3_tuple_IN_control', 'Tuple cursor with the historical IN ownership check', () =>
    db
      .select()
      .from(schema.notes)
      .where(
        and(
          inArray(
            schema.notes.incidentId,
            db
              .select({ id: schema.incidents.id })
              .from(schema.incidents)
              .where(
                and(
                  eq(schema.incidents.ownerId, id('user', 0)),
                  eq(schema.incidents.id, id('incident', 0)),
                ),
              ),
          ),
          sql`(${schema.notes.createdAt}, ${schema.notes.id}) < (${cutoff.toISOString()}::timestamptz, ${id('note', 1499)}::uuid)`,
        ),
      )
      .orderBy(desc(schema.notes.createdAt), desc(schema.notes.id))
      .limit(21),
  );
  const incidentCutoff = new Date(epoch + 2499 * 60000);
  await capture('Q1_OR_control', 'Historical OR incident cursor on the identical data', () =>
    db
      .select()
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.ownerId, id('user', 0)),
          or(
            lt(schema.incidents.createdAt, incidentCutoff),
            and(
              eq(schema.incidents.createdAt, incidentCutoff),
              lt(schema.incidents.id, id('incident', 2499)),
            ),
          ),
        ),
      )
      .orderBy(desc(schema.incidents.createdAt), desc(schema.incidents.id))
      .limit(21),
  );
  return queries;
}

async function explain(pool: Pool, query: Query): Promise<Run> {
  cancellation.signal.throwIfAborted();
  const started = performance.now();
  // SQL text comes from the ORM logger (repositories plus the documented control). Values stay bound.
  const result = await pool.query<{ 'QUERY PLAN': Explain[] }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
    query.params,
  );
  const document = result.rows[0]?.['QUERY PLAN'][0];
  if (!document || typeof document['Execution Time'] !== 'number')
    throw new Error('Invalid EXPLAIN response.');
  return { explain: document, client_ms: performance.now() - started };
}

async function main() {
  const output = await outputDirectory();
  const url = databaseUrl();
  const admin = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const pool = new Pool({
    connectionString: url,
    options: '-c search_path=incidentbrief_profile',
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  let created = false;
  try {
    await admin.query('CREATE SCHEMA incidentbrief_profile');
    created = true;
    const cipher = new AesGcmCipher(randomBytes(32).toString('base64'));
    await migrate(pool, cipher);
    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($1::text[])',
      [indexNames],
    );
    const definitions = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));
    if (!values['baseline-only'] && definitions.size !== indexNames.length)
      throw new Error('Apply the index migration before comparing variants.');
    // These names resolve ONLY in this run's new disposable schema, never public.
    await pool.query('DROP INDEX IF EXISTS incidents_owner_created_idx');
    await pool.query('DROP INDEX IF EXISTS incidents_owner_status_created_idx');
    await pool.query('DROP INDEX IF EXISTS notes_incident_created_idx');
    await seed(pool, cipher);
    const queries = await captureQueries(pool, cipher);
    const fingerprints = new Map<string, string>();
    for (const query of queries) {
      const result = await pool.query<{ id: string }>(query.sql, query.params);
      if (result.rows.length !== (['Q4', 'Q5'].includes(query.id) ? 1 : 21))
        throw new Error('Unexpected profiling result cardinality.');
      fingerprints.set(query.id, digest(result.rows.map((row) => row.id)));
    }
    if (fingerprints.get('Q1_cursor') !== fingerprints.get('Q1_OR_control'))
      throw new Error('Incident cursor formulations returned different rows.');
    if (fingerprints.get('Q3') !== fingerprints.get('Q3_tuple_IN_control'))
      throw new Error('Ownership formulations returned different rows.');
    if (fingerprints.get('Q3') !== fingerprints.get('Q3_OR_control'))
      throw new Error('Cursor formulations returned different rows.');
    const version = (await pool.query<{ version: string }>('SELECT version()')).rows[0]!.version;
    const settings = (
      await pool.query(
        'SELECT name, setting, unit FROM pg_settings WHERE name = ANY($1::text[]) ORDER BY name',
        [
          [
            'shared_buffers',
            'effective_cache_size',
            'work_mem',
            'max_parallel_workers_per_gather',
            'random_page_cost',
            'jit',
            'plan_cache_mode',
          ],
        ],
      )
    ).rows;
    const tableSizes = (
      await pool.query(
        "SELECT relname, reltuples, pg_relation_size(oid) AS bytes FROM pg_class WHERE relnamespace = 'incidentbrief_profile'::regnamespace AND relname IN ('users','sessions','incidents','notes') ORDER BY relname",
      )
    ).rows;
    const sourceHashes: Record<string, string> = {};
    for (const file of [
      'apps/api/scripts/profile-queries.ts',
      'apps/api/src/repositories/incident-repository.ts',
      'apps/api/src/repositories/note-repository.ts',
      'apps/api/src/repositories/auth-repository.ts',
      'apps/api/src/repositories/cursor.ts',
      'apps/api/src/db/schema.ts',
      'apps/api/migrations/001_initial.sql',
      'apps/api/migrations/002_encrypted_fields.sql',
      'apps/api/migrations/003_query_indexes.sql',
    ]) {
      try {
        sourceHashes[file] = createHash('sha256')
          .update(await readFile(join(root, file)))
          .digest('hex');
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
          throw error;
      }
    }
    const code = {
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty: !!execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      sourceHashes,
    };
    const report = {
      captured_at: new Date().toISOString(),
      code,
      dataset: {
        seed: DATASET,
        users: USERS,
        incidents: INCIDENTS,
        notes: NOTES,
        busy_owner_incidents: BUSY_INCIDENTS,
        resolved_busy_owner_incidents: 1000,
        long_investigation_notes: LONG_NOTES,
        description:
          'Deterministic IDs/timestamps/content and skew; real encryption uses fresh random nonces and an ephemeral key.',
      },
      environment: {
        version,
        node: process.version,
        platform: platform(),
        arch: arch(),
        settings,
        tableSizes,
      },
      method: {
        warmups: WARMUPS,
        samples: SAMPLES,
        timing: 'EXPLAIN server execution time; not endpoint latency',
        cache: 'Warm, same seeded tables and session, no forced planner options',
        percentile: 'Median averages the middle pair; p95 uses nearest rank',
        baseline: 'Candidate indexes absent in the disposable schema',
      },
      queries,
      phases: [] as {
        name: string;
        queries: {
          id: string;
          fingerprint: string;
          summary: ReturnType<typeof summarize>;
          runs: Run[];
        }[];
      }[],
    };
    const phases = values['baseline-only']
      ? ['baseline']
      : ['baseline', 'owner_index', 'status_index', 'notes_index'];
    for (const [phaseNumber, phase] of phases.entries()) {
      if (phaseNumber) {
        const definition = definitions.get(indexNames[phaseNumber - 1]!)!;
        // Recreate our own migration's DDL, obtained from this schema's catalog.
        await pool.query(definition);
      }
      const results = [];
      for (const query of queries) {
        const current = await pool.query<{ id: string }>(query.sql, query.params);
        const fingerprint = digest(current.rows.map((row) => row.id));
        if (fingerprint !== fingerprints.get(query.id))
          throw new Error('An index changed query results.');
        for (let n = 0; n < WARMUPS; n++) await explain(pool, query);
        const runs = [];
        for (let n = 0; n < SAMPLES; n++) runs.push(await explain(pool, query));
        const summary = summarize(runs);
        console.log(
          `${phase} ${query.id}: median ${summary.median_ms} ms, p95 ${summary.p95_ms} ms; ${summary.indexes.join(', ') || 'no index'}`,
        );
        results.push({ id: query.id, fingerprint, summary, runs });
      }
      report.phases.push({ name: phase, queries: results });
      await writeFile(join(output, 'profile.json'), JSON.stringify(report, null, 2) + '\n');
    }
    const csv =
      [
        'phase,query,median_ms,p95_ms,median_shared_blocks',
        ...report.phases.flatMap((phase) =>
          phase.queries.map((query) =>
            [
              phase.name,
              query.id,
              query.summary.median_ms,
              query.summary.p95_ms,
              query.summary.median_shared_blocks,
            ].join(','),
          ),
        ),
      ].join('\n') + '\n';
    await writeFile(join(output, 'summary.csv'), csv);
    console.log(`Profile saved to ${output}`);
  } finally {
    await pool.end();
    if (created) await admin.query('DROP SCHEMA incidentbrief_profile CASCADE');
    await admin.end();
  }
}
await main().catch(() => {
  console.error(
    'Query profiling failed. Check the isolated test database and output directory; connection details withheld.',
  );
  process.exitCode = 1;
});
