import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
    ),
  );
  return files.flat();
}

const violations = [];
for (const path of await walk('apps')) {
  if (!/\.(ts|tsx)$/.test(path) || path.includes('/dist/')) continue;
  const source = await readFile(path, 'utf8');
  const imports = [...source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
  for (const name of imports) {
    if (
      path.includes('/services/') &&
      /fastify|drizzle|\/http\/|\/db\/|\/repositories\//.test(name)
    )
      violations.push(`${path}: service imports ${name}`);
    if (path.includes('/http/') && /drizzle|\/db\/|\/repositories\//.test(name))
      violations.push(`${path}: HTTP imports ${name}`);
    if (path.includes('/web/src/') && /\/api\/|drizzle|\/db\//.test(name))
      violations.push(`${path}: browser imports ${name}`);
  }
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else console.log('Dependency boundaries passed.');
