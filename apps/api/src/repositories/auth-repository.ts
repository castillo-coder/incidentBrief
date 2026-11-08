import { eq } from 'drizzle-orm';
import type { AuthRepository } from '../domain/ports.js';
import type { Database } from '../db/client.js';
import { users, sessions } from '../db/schema.js';

export function authRepository(db: Database): AuthRepository {
  return {
    async findUser(email) {
      return (
        await db
          .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
      )[0];
    },
    async createSession(userId, tokenHash, expiresAt) {
      await db.insert(sessions).values({ userId, tokenHash, expiresAt });
    },
    async getSession(tokenHash) {
      return (
        await db
          .select({ user: { id: users.id, email: users.email }, expiresAt: sessions.expiresAt })
          .from(sessions)
          .innerJoin(users, eq(users.id, sessions.userId))
          .where(eq(sessions.tokenHash, tokenHash))
          .limit(1)
      )[0];
    },
    async deleteSession(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
  };
}
