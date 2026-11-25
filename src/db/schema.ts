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
 * of work is billed exactly once. Deleting a draft or voiding an invoice
 * clears invoiceId/invoiceLineId so the work can be billed again. (These are
 * plain columns rather than foreign keys: SQLite can't add a foreign key to an
 * existing table without rebuilding it. src/lib/invoices.ts keeps them in step.)
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
    /** The invoice line this entry was rolled into (cleared with invoiceId). */
    invoiceLineId: text('invoice_line_id'),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('work_entry_task_id_idx').on(t.taskId, t.workDate),
    index('work_entry_invoice_id_idx').on(t.invoiceId),
  ],
);

/*
 * Invoices. A draft is private to the admin and freely editable. Sending
 * assigns the next invoice number, locks the lines and shows it to the
 * client. "Overdue" is not stored: it is a sent invoice past its due date.
 */
export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoice = sqliteTable(
  'invoice',
  {
    id: text('id').primaryKey(),
    /** Running number, set when the invoice is sent; shown as prefix + number. */
    number: integer('number').unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    /** The project this invoice bills (optional for one-off invoices). */
    projectId: text('project_id').references(() => project.id, { onDelete: 'restrict' }),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('draft'),
    title: text('title'),
    /** Billing address block, captured when the invoice is created. */
    billTo: text('bill_to').notNull(),
    /** Calendar dates, YYYY-MM-DD. */
    issueDate: text('issue_date').notNull(),
    dueDate: text('due_date').notNull(),
    /** Only work logged on or before this date was pulled in (YYYY-MM-DD). */
    workThrough: text('work_through'),
    notes: text('notes'),
    /** Tax rate in basis points (825 = 8.25%). */
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    /** Totals in cents, recalculated whenever lines change. */
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    /** Date the payment arrived, YYYY-MM-DD. */
    paidDate: text('paid_date'),
    /** How it was paid: "manual" (marked by the admin) or "stripe". */
    paidVia: text('paid_via'),
    /** Latest Stripe Checkout session for this invoice, and the payment that settled it. */
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => [
    index('invoice_client_id_idx').on(t.clientId),
    index('invoice_project_id_idx').on(t.projectId),
  ],
);

export const INVOICE_LINE_KINDS = ['time', 'expense', 'custom'] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

export const invoiceLine = sqliteTable(
  'invoice_line',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: INVOICE_LINE_KINDS }).notNull().default('custom'),
    /** The task this line bills, for time and expense lines. */
    taskId: text('task_id').references(() => task.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    /** Extra detail under the description, e.g. what was done and when. */
    details: text('details'),
    /** Quantity in hundredths (1.5 hours = 150). */
    quantityHundredths: integer('quantity_hundredths').notNull().default(100),
    unitCents: integer('unit_cents').notNull(),
    /** round(quantity x unit price), in cents. */
    amountCents: integer('amount_cents').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('invoice_line_invoice_id_idx').on(t.invoiceId, t.position)],
);
