import { randomUUID } from 'node:crypto';
import { and, eq, desc, exists } from 'drizzle-orm';
import type { NoteRepository } from '../domain/ports.js';
import type { Database } from '../db/client.js';
import { incidents, notes } from '../db/schema.js';
import { decodeCursor, beforeCursor } from './cursor.js';
import { page } from './page.js';
import type { StorageMapper } from './storage-mapper.js';

export function noteRepository(db: Database, mapper: StorageMapper): NoteRepository {
  const parent = (ownerId: string, incidentId: string) =>
    and(eq(incidents.ownerId, ownerId), eq(incidents.id, incidentId));
  const parentIds = (ownerId: string, incidentId: string) =>
    db.select({ id: incidents.id }).from(incidents).where(parent(ownerId, incidentId));
  const ownedParent = (ownerId: string, incidentId: string) =>
    and(eq(notes.incidentId, incidentId), exists(parentIds(ownerId, incidentId)));
  return {
    async list(ownerId, incidentId, query) {
      const cursor = decodeCursor(query.cursor);
      const limit = query.limit ?? 20;
      const rows = await db
        .select()
        .from(notes)
        .where(
          and(ownedParent(ownerId, incidentId), beforeCursor(notes.createdAt, notes.id, cursor)),
        )
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(limit + 1);
      return page(
        rows.map((row) => mapper.note(row, ownerId)),
        limit,
      );
    },
    async add(ownerId, incidentId, body) {
      return db.transaction(async (tx) => {
        // Lock the owned parent before writing; deletion cannot interleave.
        const owned = await tx
          .select({ id: incidents.id })
          .from(incidents)
          .where(parent(ownerId, incidentId))
          .for('update');
        if (!owned.length) return undefined;
        const row = (
          await tx
            .insert(notes)
            .values(mapper.noteValues(ownerId, incidentId, randomUUID(), body))
            .returning()
        )[0]!;
        return mapper.note(row, ownerId);
      });
    },
    async delete(ownerId, incidentId, noteId) {
      return (
        (
          await db
            .delete(notes)
            .where(and(eq(notes.id, noteId), ownedParent(ownerId, incidentId)))
            .returning({ id: notes.id })
        ).length > 0
      );
    },
    async latest(ownerId, incidentId) {
      const rows = await db
        .select()
        .from(notes)
        .where(ownedParent(ownerId, incidentId))
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(30);
      return rows.map((row) => mapper.note(row, ownerId)).reverse();
    },
  };
}
