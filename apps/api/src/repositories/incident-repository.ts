import { randomUUID } from 'node:crypto';
import { and, eq, desc, lt, or, inArray } from 'drizzle-orm';
import type { Incident, Note, Page } from '@incidentbrief/contracts';
import type { IncidentRepository } from '../domain/ports.js';
import type { Database } from '../db/client.js';
import { incidents, notes, type IncidentRow, type NoteRow } from '../db/schema.js';
import { decodeCursor, encodeCursor, type Cursor } from './cursor.js';

const incidentDto = (row: IncidentRow): Incident => ({
  id: row.id,
  title: row.title,
  description: row.description,
  severity: row.severity,
  status: row.status,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});
const noteDto = (row: NoteRow): Note => ({
  id: row.id,
  incident_id: row.incidentId,
  body: row.body,
  created_at: row.createdAt.toISOString(),
});

function page<T extends Cursor>(rows: T[], limit: number): Page<T> {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    next_cursor:
      rows.length > limit && last
        ? encodeCursor({ id: last.id, created_at: last.created_at })
        : null,
  };
}

export function incidentRepository(db: Database): IncidentRepository {
  const owned = (ownerId: string, id: string) =>
    and(eq(incidents.ownerId, ownerId), eq(incidents.id, id));
  const ownedIds = (ownerId: string, id: string) =>
    db.select({ id: incidents.id }).from(incidents).where(owned(ownerId, id));
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
      return page(rows.map(incidentDto), limit);
    },
    async get(ownerId, id) {
      const row = (await db.select().from(incidents).where(owned(ownerId, id)).limit(1))[0];
      return row ? incidentDto(row) : undefined;
    },
    async create(ownerId, input) {
      const row = (
        await db
          .insert(incidents)
          .values({ id: randomUUID(), ownerId, ...input })
          .returning()
      )[0]!;
      return incidentDto(row);
    },
    async update(ownerId, id, input) {
      const row = (
        await db
          .update(incidents)
          .set({ ...input, updatedAt: new Date() })
          .where(owned(ownerId, id))
          .returning()
      )[0];
      return row ? incidentDto(row) : undefined;
    },
    async delete(ownerId, id) {
      return (
        (await db.delete(incidents).where(owned(ownerId, id)).returning({ id: incidents.id }))
          .length > 0
      );
    },
    async listNotes(ownerId, incidentId, query) {
      const cursor = decodeCursor(query.cursor);
      const limit = query.limit ?? 20;
      const rows = await db
        .select()
        .from(notes)
        .where(
          and(
            inArray(notes.incidentId, ownedIds(ownerId, incidentId)),
            cursor
              ? or(
                  lt(notes.createdAt, new Date(cursor.created_at)),
                  and(eq(notes.createdAt, new Date(cursor.created_at)), lt(notes.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(limit + 1);
      return page(rows.map(noteDto), limit);
    },
    async addNote(ownerId, incidentId, body) {
      // The ownership guard and insert share a transaction; deletion cannot interleave.
      return db.transaction(async (tx) => {
        const parent = await tx
          .select({ id: incidents.id })
          .from(incidents)
          .where(owned(ownerId, incidentId))
          .for('update');
        if (!parent.length) return undefined;
        const row = (
          await tx.insert(notes).values({ id: randomUUID(), incidentId, body }).returning()
        )[0]!;
        return noteDto(row);
      });
    },
    async deleteNote(ownerId, incidentId, noteId) {
      return (
        (
          await db
            .delete(notes)
            .where(
              and(eq(notes.id, noteId), inArray(notes.incidentId, ownedIds(ownerId, incidentId))),
            )
            .returning({ id: notes.id })
        ).length > 0
      );
    },
    async summaryNotes(ownerId, incidentId) {
      const rows = await db
        .select()
        .from(notes)
        .where(inArray(notes.incidentId, ownedIds(ownerId, incidentId)))
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(30);
      return rows.map(noteDto).reverse();
    },
  };
}
