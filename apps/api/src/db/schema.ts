import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid().primaryKey(),
  email: text().notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      precision: 3,
    }).notNull(),
  },
  (table) => [index('sessions_expiry_idx').on(table.expiresAt)],
);
export const incidents = pgTable(
  'incidents',
  {
    id: uuid().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    descriptionCiphertext: text('description_ciphertext').notNull(),
    severity: text({ enum: ['low', 'medium', 'high'] }).notNull(),
    status: text({ enum: ['open', 'resolved'] })
      .notNull()
      .default('open'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('incidents_owner_created_idx').on(table.ownerId, table.createdAt.desc(), table.id.desc()),
    index('incidents_owner_status_created_idx').on(
      table.ownerId,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
export const notes = pgTable(
  'notes',
  {
    id: uuid().primaryKey(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    bodyCiphertext: text('body_ciphertext').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('notes_incident_created_idx').on(
      table.incidentId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
export type UserRow = typeof users.$inferSelect;
export type IncidentRow = typeof incidents.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
