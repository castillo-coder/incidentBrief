import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = process.env.CONTAINER_URL ?? 'http://localhost:3100';
const url = new URL(origin);
if (
  url.origin !== origin ||
  url.protocol !== 'http:' ||
  !['localhost', '127.0.0.1'].includes(url.hostname)
)
  throw new Error('Container smoke requires a loopback HTTP origin.');
const email = `container-smoke-${randomBytes(10).toString('hex')}@example.test`;
const password = randomBytes(24).toString('hex');
let provisioned = false;
let step = 'runtime inspection';

function compose(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync('docker', ['compose', ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Container command failed.');
  return result.stdout.trim();
}
function probe(code: string, env: Record<string, string> = {}) {
  const flags = Object.keys(env).flatMap((name) => ['-e', name]);
  return compose(['exec', '-T', ...flags, 'app', 'node', '--input-type=module', '-e', code], env);
}
let headers: Record<string, string> = { origin };
async function request(path: string, method = 'GET', body?: unknown) {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
}

try {
  const runtime: {
    uid: number;
    node: string;
    privateFiles: boolean;
    devTools: boolean;
  } = JSON.parse(
    probe(`
    import { existsSync } from 'node:fs';
    console.log(JSON.stringify({uid:process.getuid(),node:process.version,
      privateFiles:['/app/.env','/app/.git','/app/tests'].some(existsSync),
      devTools:['tsx','typescript','@playwright/test'].some(name=>existsSync('/app/node_modules/'+name))}));
  `),
  );
  assert.notEqual(runtime.uid, 0);
  assert.match(runtime.node, /^v24\./);
  assert.equal(runtime.privateFiles, false);
  assert.equal(runtime.devTools, false);
  step = 'frontend and health';
  assert.equal((await request('/healthz')).status, 200);
  const home = await request('/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.includes('IncidentBrief'));
  const script = /src="(\/assets\/[^"<>]+\.js)"/.exec(html)?.[1];
  assert.ok(script);
  assert.equal((await request(script)).status, 200);
  step = 'user provisioning';
  const created = compose(
    [
      'exec',
      '-T',
      '-e',
      'USER_EMAIL',
      '-e',
      'USER_PASSWORD',
      'app',
      'node',
      'apps/api/dist/cli/create-user.js',
    ],
    { USER_EMAIL: email, USER_PASSWORD: password },
  );
  assert.ok(created.includes('User created.'));
  provisioned = true;
  step = 'authentication';
  const login = await request('/api/auth/login', 'POST', { email, password });
  assert.equal(login.status, 200);
  const auth = (await login.json()) as { csrf_token: string };
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  headers = { origin, cookie, 'x-csrf-token': auth.csrf_token };
  assert.equal((await request('/api/auth/session')).status, 200);
  step = 'incident and notes CRUD';
  const response = await request('/api/incidents', 'POST', {
    title: 'Container verification',
    description: 'Ephemeral synthetic investigation.',
    severity: 'low',
  });
  assert.equal(response.status, 201);
  const incident = (await response.json()) as {
    id: string;
    description: string;
  };
  const path = `/api/incidents/${incident.id}`;
  assert.equal((await request('/api/incidents')).status, 200);
  assert.equal((await request(path)).status, 200);
  assert.equal((await request(path, 'PATCH', { status: 'resolved' })).status, 200);
  const added = await request(`${path}/notes`, 'POST', {
    body: 'A temporary finding.',
  });
  assert.equal(added.status, 201);
  const note = (await added.json()) as { id: string; body: string };
  assert.equal((await request(`${path}/notes`)).status, 200);
  step = 'encrypted persistence';
  const encrypted: { incident: boolean; note: boolean } = JSON.parse(
    probe(
      `
    import pg from 'pg';
    const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
    try {
      const a=(await pool.query('SELECT description_ciphertext FROM incidents WHERE id=$1',[process.env.SMOKE_INCIDENT_ID])).rows[0];
      const b=(await pool.query('SELECT body_ciphertext FROM notes WHERE id=$1',[process.env.SMOKE_NOTE_ID])).rows[0];
      console.log(JSON.stringify({incident:a.description_ciphertext.startsWith('ib:v1:'),note:b.body_ciphertext.startsWith('ib:v1:')}));
    } finally {await pool.end();}
  `,
      { SMOKE_INCIDENT_ID: incident.id, SMOKE_NOTE_ID: note.id },
    ),
  );
  assert.deepEqual(encrypted, { incident: true, note: true });
  step = 'deletion and revocation';
  assert.equal((await request(`${path}/notes/${note.id}`, 'DELETE')).status, 204);
  assert.equal((await request(path, 'DELETE')).status, 204);
  assert.equal((await request('/api/auth/logout', 'POST')).status, 204);
  assert.equal((await request('/api/auth/session')).status, 401);
  console.log(
    `Container smoke passed: Node ${runtime.node}, UID ${runtime.uid}, static assets, provisioning/auth/CRUD, encrypted fields and session revocation.`,
  );
} catch {
  console.error(`Container smoke failed during ${step}. Sensitive details withheld.`);
  process.exitCode = 1;
} finally {
  if (provisioned) {
    probe(
      `import pg from 'pg'; const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}); try {await pool.query('DELETE FROM users WHERE email=$1',[process.env.USER_EMAIL]);} finally {await pool.end();}`,
      { USER_EMAIL: email },
    );
  }
}
