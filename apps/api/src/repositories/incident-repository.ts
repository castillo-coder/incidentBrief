import { randomUUID } from 'node:crypto';
import { and, eq, desc, lt, or } from 'drizzle-orm';
import type { IncidentRepository } from '../domain/ports.js';
import type { Database } from '../db/client.js';
import { incidents } from '../db/schema.js';
import { decodeCursor } from './cursor.js';
import { page } from './page.js';
import type { StorageMapper } from './storage-mapper.js';

export function incidentRepository(db: Database, mapper: StorageMapper): IncidentRepository {
  const owned = (ownerId: string, id: string) =>
    and(eq(incidents.ownerId, ownerId), eq(incidents.id, id));
  return {
    async list(ownerId, query) {
      const cursor = decodeCursor(query.cursor);
      const limit = query.limit ?? 20;
      const conditions = [eq(incidents.ownerId, ownerId)];
      if (query.status) conditions.push(eq(incidents.status, query.status));
      if (cursor)
        conditions.push(
          or(
            lt(incidents.createdAt, new Date(cursor.created_at)),
            and(eq(incidents.createdAt, new Date(cursor.created_at)), lt(incidents.id, cursor.id)),
          )!,
        );
      const rows = await db
        .select()
        .from(incidents)
        .where(and(...conditions))
        .orderBy(desc(incidents.createdAt), desc(incidents.id))
        .limit(limit + 1);
      return page(
        rows.map((row) => mapper.incident(row)),
        limit,
      );
    },
    async get(ownerId, id) {
      const row = (await db.select().from(incidents).where(owned(ownerId, id)).limit(1))[0];
      return row ? mapper.incident(row) : undefined;
    },
    async create(ownerId, input) {
      const row = (
        await db
          .insert(incidents)
          .values(mapper.incidentValues(ownerId, randomUUID(), input))
          .returning()
      )[0]!;
      return mapper.incident(row);
    },
    async update(ownerId, id, input) {
      const row = (
        await db
          .update(incidents)
          .set(mapper.incidentPatch(ownerId, id, input))
          .where(owned(ownerId, id))
          .returning()
      )[0];
      return row ? mapper.incident(row) : undefined;
    },
    async delete(ownerId, id) {
      return (
        (await db.delete(incidents).where(owned(ownerId, id)).returning({ id: incidents.id }))
          .length > 0
      );
    },
  };
}
