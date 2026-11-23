import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Placeholder table that proves the Drizzle → D1 migration pipeline works.
 * Real tables (users, clients, projects, invoices…) arrive with their features.
 * Every schema change here must be followed by `npm run db:generate`.
 */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});
