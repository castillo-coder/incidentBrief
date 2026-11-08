import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import type { Login, User } from '@incidentbrief/contracts';
import type { AuthRepository } from '../domain/ports.js';
import { AppError, invalid, unauthenticated } from '../domain/errors.js';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const csrfToken = (token: string) =>
  createHmac('sha256', token).update('incidentbrief-csrf').digest('hex');
const safeMatch = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
// Equal-cost comparison also runs for unknown accounts.
const dummyHash = hash(randomBytes(32).toString('hex'), 12);

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async login(input: Login): Promise<{ user: User; token: string; csrf_token: string }> {
    const user = await this.repository.findUser(input.email.trim().toLowerCase());
    const valid = await compare(input.password, user?.passwordHash ?? (await dummyHash));
    if (!valid || !user || Buffer.byteLength(input.password) > 72)
      throw new AppError('invalid_credentials', 'Email or password is incorrect.', 401);
    const token = randomBytes(32).toString('hex');
    await this.repository.createSession(
      user.id,
      tokenHash(token),
      new Date(Date.now() + 8 * 60 * 60 * 1000),
    );
    return { user: { id: user.id, email: user.email }, token, csrf_token: csrfToken(token) };
  }

  async authenticate(token: string | undefined): Promise<User> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw unauthenticated();
    const session = await this.repository.getSession(tokenHash(token));
    if (!session) throw unauthenticated();
    if (session.expiresAt <= new Date()) {
      await this.repository.deleteSession(tokenHash(token));
      throw unauthenticated();
    }
    return session.user;
  }

  checkCsrf(token: string, provided: string | undefined): void {
    if (!provided || !safeMatch(csrfToken(token), provided))
      throw new AppError(
        'csrf_failed',
        'The request could not be verified. Refresh and try again.',
        403,
      );
  }

  async logout(token: string): Promise<void> {
    await this.repository.deleteSession(tokenHash(token));
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password) > 72)
    throw invalid('Password must have at least 12 characters and at most 72 UTF-8 bytes.');
  return hash(password, 12);
}
