/**
 * Activity log: who did what, and when. Pages call logActivity() after an
 * action succeeds; the admin reads it at /admin/activity and in the History
 * panels on invoices, projects and clients.
 *
 * Writing a log row never throws, so a logging problem can't break the page.
 */
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { site } from '../config/site';

export type ActivityRow = typeof schema.activityLog.$inferSelect;
export type SubjectType = 'invoice' | 'project' | 'task' | 'client' | 'user';

/** The person who acted, or "system" for automatic actions such as Stripe webhooks. */
export type Actor = { id: string; name: string; role?: string | null } | { system: string };

export interface ActivityInput {
  /** Dotted action name, e.g. "invoice.sent". */
  action: string;
  /** One readable sentence, e.g. "Sent INV-1004 ($1,250.00)". */
  summary: string;
  subjectType?: SubjectType;
  subjectId?: string | null;
  /** The client the action concerns, so their history can be filtered. */
  clientId?: string | null;
}

/** Records one action. Pass the request to keep the visitor's IP address. */
export async function logActivity(actor: Actor | null | undefined, input: ActivityInput, request?: Request): Promise<void> {
  try {
    const person = actor && 'id' in actor ? actor : null;
    await getDb()
      .insert(schema.activityLog)
      .values({
        id: crypto.randomUUID(),
        actorId: person?.id ?? null,
        actorName: person ? person.name : actor && 'system' in actor ? actor.system : 'Unknown',
        actorRole: person?.role ?? null,
        action: input.action,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        clientId: input.clientId ?? null,
        summary: input.summary.slice(0, 500),
        ip: request?.headers.get('cf-connecting-ip') ?? null,
      })
      .run();
  } catch (err) {
    console.error('logActivity failed', err);
  }
}

/** True if this actor already has this action on this subject within the last `minutes`. */
export async function loggedRecently(actorId: string, action: string, subjectId: string, minutes: number): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60_000);
  const l = schema.activityLog;
  const row = await getDb()
    .select({ id: l.id, createdAt: l.createdAt })
    .from(l)
    .where(and(eq(l.actorId, actorId), eq(l.action, action), eq(l.subjectId, subjectId)))
    .orderBy(desc(l.createdAt))
    .limit(1)
    .get();
  return Boolean(row && row.createdAt >= since);
}

/** What the activity page can filter by. */
export const ACTIVITY_FILTERS = {
  all: { label: 'Everything', types: null },
  invoice: { label: 'Invoices', types: ['invoice'] },
  project: { label: 'Projects and tasks', types: ['project', 'task'] },
  client: { label: 'Clients and sign-ins', types: ['client', 'user'] },
} as const satisfies Record<string, { label: string; types: SubjectType[] | null }>;

export type ActivityFilter = keyof typeof ACTIVITY_FILTERS;
export const isActivityFilter = (v: string): v is ActivityFilter => v in ACTIVITY_FILTERS;

export const PAGE_SIZE = 50;

/**
 * Newest activity first, one page at a time. `before` is the createdAt (ms)
 * of the last row on the previous page.
 */
export async function recentActivity(opts: { filter?: ActivityFilter; clientId?: string; before?: number; limit?: number } = {}) {
  const l = schema.activityLog;
  const conds: (SQL | undefined)[] = [];
  const types = ACTIVITY_FILTERS[opts.filter ?? 'all'].types;
  if (types) conds.push(or(...types.map((t) => eq(l.subjectType, t))));
  if (opts.clientId) conds.push(eq(l.clientId, opts.clientId));
  if (opts.before) conds.push(lt(l.createdAt, new Date(opts.before)));
  const limit = opts.limit ?? PAGE_SIZE;
  const rows = await getDb()
    .select()
    .from(l)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(l.createdAt))
    .limit(limit + 1)
    .all();
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

/** History of one record (an invoice, project…), newest first. */
export function subjectActivity(subjectType: SubjectType, subjectId: string, limit = 100) {
  const l = schema.activityLog;
  return getDb()
    .select()
    .from(l)
    .where(and(eq(l.subjectType, subjectType), eq(l.subjectId, subjectId)))
    .orderBy(desc(l.createdAt))
    .limit(limit)
    .all();
}

/** Link to the page for a log row's subject, if it has one. */
export function subjectHref(row: Pick<ActivityRow, 'subjectType' | 'subjectId'>): string | null {
  if (!row.subjectId) return null;
  switch (row.subjectType) {
    case 'invoice':
      return `/admin/invoices/${row.subjectId}`;
    case 'project':
      return `/admin/projects/${row.subjectId}`;
    case 'task':
      return `/admin/tasks/${row.subjectId}`;
    case 'client':
      return `/admin/clients#client-${row.subjectId}`;
    default:
      return null;
  }
}

const whenFmt = new Intl.DateTimeFormat(site.locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: site.timeZone, timeZoneName: 'short' });

/** A timestamp in the site's time zone, e.g. "Nov 25, 2026, 2:04 PM EST". */
export function formatWhen(date: Date): string {
  return whenFmt.format(date);
}
