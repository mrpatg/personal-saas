/**
 * Task comments and work entries (time and costs): parsing, formatting,
 * totals and queries shared by the admin and client task screens.
 */
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { site } from '../config/site';

export type WorkEntry = typeof schema.workEntry.$inferSelect;

/* ---------- Money and time ---------- */

const moneyFmt = new Intl.NumberFormat(site.locale, { style: 'currency', currency: site.currency });

/** 12345 -> "$123.45" */
export function formatMoney(cents: number): string {
  return moneyFmt.format(cents / 100);
}

/** Parses "150", "150.5", "$1,250.00" into cents. Null if blank or invalid. */
export function parseMoney(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Cents back to an input value, e.g. 15000 -> "150.00". */
export function centsToInput(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

/** Parses "1.5", "1:30", "90m" or "2h" into minutes. Null if blank, zero or invalid. */
export function parseDuration(value: string): number | null {
  const v = value.trim().toLowerCase();
  let minutes: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d+):([0-5]\d)$/))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = v.match(/^(\d+)\s*m(in)?$/))) minutes = Number(m[1]);
  else if ((m = v.match(/^(\d+(?:\.\d+)?)\s*h?$/))) minutes = Math.round(Number(m[1]) * 60);
  return minutes && minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}

/** 90 -> "1.5 h", 45 -> "0.75 h" */
export function formatHours(minutes: number): string {
  return `${Number((minutes / 60).toFixed(2))} h`;
}

/** Amount for a time entry, rounded to the cent. */
export function timeAmount(minutes: number, rateCents: number): number {
  return Math.round((minutes * rateCents) / 60);
}

/* ---------- Totals ---------- */

export interface WorkTotals {
  minutes: number;
  /** All billable amounts. */
  billableCents: number;
  /** Billable amounts not yet on an invoice. */
  unbilledCents: number;
}

export const emptyTotals = (): WorkTotals => ({ minutes: 0, billableCents: 0, unbilledCents: 0 });

export function totalsOf(entries: WorkEntry[]): WorkTotals {
  return entries.reduce((t, e) => {
    t.minutes += e.minutes ?? 0;
    if (e.billable) {
      t.billableCents += e.amountCents;
      if (!e.invoiceId) t.unbilledCents += e.amountCents;
    }
    return t;
  }, emptyTotals());
}

/** Work totals per task id. */
export async function totalsByTask(taskIds: string[]): Promise<Map<string, WorkTotals>> {
  const result = new Map<string, WorkTotals>();
  if (taskIds.length === 0) return result;
  const e = schema.workEntry;
  const rows = await getDb()
    .select({
      taskId: e.taskId,
      minutes: sql<number>`coalesce(sum(${e.minutes}), 0)`,
      billableCents: sql<number>`coalesce(sum(case when ${e.billable} then ${e.amountCents} else 0 end), 0)`,
      unbilledCents: sql<number>`coalesce(sum(case when ${e.billable} and ${e.invoiceId} is null then ${e.amountCents} else 0 end), 0)`,
    })
    .from(e)
    .where(inArray(e.taskId, taskIds))
    .groupBy(e.taskId)
    .all();
  for (const r of rows) result.set(r.taskId, { minutes: r.minutes, billableCents: r.billableCents, unbilledCents: r.unbilledCents });
  return result;
}

export function sumTotals(list: Iterable<WorkTotals>): WorkTotals {
  const t = emptyTotals();
  for (const x of list) {
    t.minutes += x.minutes;
    t.billableCents += x.billableCents;
    t.unbilledCents += x.unbilledCents;
  }
  return t;
}

/* ---------- Queries ---------- */

/** A task's work entries, newest work first. */
export function taskEntries(taskId: string) {
  return getDb()
    .select()
    .from(schema.workEntry)
    .where(eq(schema.workEntry.taskId, taskId))
    .orderBy(desc(schema.workEntry.workDate), desc(schema.workEntry.createdAt))
    .all();
}

/** Number of work entries on any task in a project (used to block deleting it). */
export async function projectEntryCount(projectId: string): Promise<number> {
  const row = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.workEntry)
    .innerJoin(schema.task, eq(schema.workEntry.taskId, schema.task.id))
    .where(eq(schema.task.projectId, projectId))
    .get();
  return row?.n ?? 0;
}

/** A task's comments, oldest first, with each author's name and role. */
export function taskComments(taskId: string) {
  return getDb()
    .select({
      id: schema.taskComment.id,
      body: schema.taskComment.body,
      createdAt: schema.taskComment.createdAt,
      authorId: schema.taskComment.authorId,
      authorName: schema.user.name,
      authorRole: schema.user.role,
    })
    .from(schema.taskComment)
    .innerJoin(schema.user, eq(schema.taskComment.authorId, schema.user.id))
    .where(eq(schema.taskComment.taskId, taskId))
    .orderBy(asc(schema.taskComment.createdAt))
    .all();
}

export type TaskComment = Awaited<ReturnType<typeof taskComments>>[number];

/** Comment counts per task id, for task lists. */
export async function commentCounts(taskIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (taskIds.length === 0) return result;
  const rows = await getDb()
    .select({ taskId: schema.taskComment.taskId, n: sql<number>`count(*)` })
    .from(schema.taskComment)
    .where(inArray(schema.taskComment.taskId, taskIds))
    .groupBy(schema.taskComment.taskId)
    .all();
  for (const r of rows) result.set(r.taskId, r.n);
  return result;
}

export const MAX_COMMENT_LENGTH = 5000;

/** Adds a comment; returns an error message or null. */
export async function addComment(taskId: string, authorId: string, body: string): Promise<string | null> {
  if (!body) return 'Write something first.';
  if (body.length > MAX_COMMENT_LENGTH) return `Comments can be up to ${MAX_COMMENT_LENGTH} characters.`;
  await getDb().insert(schema.taskComment).values({ id: crypto.randomUUID(), taskId, authorId, body }).run();
  return null;
}
