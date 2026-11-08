import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword } from '../services/auth-service.js';

let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) stdout.write(chunk);
    done();
  },
});
const reader = createInterface({
  input: stdin,
  output,
  terminal: !!stdin.isTTY,
});
const { db, pool } = createDatabase(loadConfig().databaseUrl);
try {
  const email = (process.env.USER_EMAIL ?? (await reader.question('Email: '))).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email is required.');
  let password = process.env.USER_PASSWORD;
  if (password === undefined) {
    stdout.write('Password (12+ characters, hidden): ');
    muted = true;
    password = await reader.question('');
    muted = false;
    stdout.write('\n');
  }
  await db.insert(users).values({
    id: randomUUID(),
    email,
    passwordHash: await hashPassword(password),
  });
  console.log('User created.');
} catch {
  console.error('User creation failed. Check the email, password rules and database connection.');
  process.exitCode = 1;
} finally {
  reader.close();
  await pool.end();
}
