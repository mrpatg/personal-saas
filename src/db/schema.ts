import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

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

/*
 * Auth tables used by Better Auth (src/lib/auth.ts), including the admin
 * plugin's role/ban fields. Property names must match Better Auth's field
 * names; column names are snake_case.
 */
const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
};

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  /** Client's company or organization (optional). */
  company: text('company'),
  /** "admin" or "client" (see src/lib/auth.ts). */
  role: text('role').notNull().default('client'),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
  ...timestamps,
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
    ...timestamps,
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    /** Password hash for email/password sign-in (providerId "credential"). */
    password: text('password'),
    ...timestamps,
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ...timestamps,
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/*
 * Projects and tasks. An admin creates projects for a client; the client
 * sees their own projects read-only.
 *
 * Invoicing plan (not built yet): hours and costs will not live on tasks.
 * A future `work_entry` table will hold billable work per task (hours x rate
 * or a flat amount, in cents) with a nullable `invoice_id`. An invoice for a
 * project claims every entry whose invoice_id is still empty, so several
 * invoices can cover one project over time without double-billing.
 */
export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const project = sqliteTable(
  'project',
  {
    id: text('id').primaryKey(),
    /** The client (a user with role "client") this project belongs to. */
    clientId: text('client_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('active'),
    /** Calendar dates as YYYY-MM-DD (no time zone). */
    startDate: text('start_date'),
    dueDate: text('due_date'),
    /** Default hourly rate in cents for new time entries (optional). */
    hourlyRateCents: integer('hourly_rate_cents'),
    ...timestamps,
  },
  (t) => [index('project_client_id_idx').on(t.clientId)],
);

export const task = sqliteTable(
  'task',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('todo'),
    /** Sort order within the project, lowest first. */
    position: integer('position').notNull().default(0),
    /** Set when the task moves to "done", cleared if it moves back. */
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => [index('task_project_id_idx').on(t.projectId, t.position)],
);

/** A comment on a task, by the admin or the project's client. */
export const taskComment = sqliteTable(
  'task_comment',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    ...timestamps,
  },
  (t) => [index('task_comment_task_id_idx').on(t.taskId, t.createdAt)],
);

export const WORK_ENTRY_KINDS = ['time', 'expense'] as const;
export type WorkEntryKind = (typeof WORK_ENTRY_KINDS)[number];

/**
 * Billable work on a task: either time (minutes x hourly rate) or a flat
 * expense. Amounts are integer cents, fixed when the entry is saved so later
 * rate changes don't alter past work.
 *
 * `invoiceId` is empty until an invoice claims the entry. An invoice for a
 * project picks up every billable entry with an empty invoiceId, so each piece
 * of work is billed exactly once. (The invoice table and its foreign key
 * arrive with the invoicing feature.)
 */
export const workEntry = sqliteTable(
  'work_entry',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: WORK_ENTRY_KINDS }).notNull().default('time'),
    /** Calendar date the work was done, YYYY-MM-DD. */
    workDate: text('work_date').notNull(),
    description: text('description'),
    /** Time entries only. */
    minutes: integer('minutes'),
    /** Time entries only: hourly rate in cents at the time of entry. */
    rateCents: integer('rate_cents'),
    /** What this entry bills: round(minutes / 60 * rate) for time, the cost for expenses. */
    amountCents: integer('amount_cents').notNull(),
    /** Non-billable entries are tracked but never invoiced. */
    billable: integer('billable', { mode: 'boolean' }).notNull().default(true),
    /** Set when an invoice includes this entry; empty means unbilled. */
    invoiceId: text('invoice_id'),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('work_entry_task_id_idx').on(t.taskId, t.workDate),
    index('work_entry_invoice_id_idx').on(t.invoiceId),
  ],
);
