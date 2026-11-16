import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', { id: text('id').primaryKey(), data: text('data').notNull(), revision: integer('revision').notNull().default(1), updatedAt: text('updated_at').notNull() });
// Fixed-window counters for public intake and sign-in (key = bucket:sha256(client)).
export const rateLimits = sqliteTable('rate_limits', { key: text('key').primaryKey(), windowStart: integer('window_start').notNull(), count: integer('count').notNull().default(0) });
