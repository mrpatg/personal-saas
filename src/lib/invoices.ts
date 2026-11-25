/**
 * Invoices: building lines from unbilled work, totals, numbering, status
 * changes and queries. Pages call these instead of writing invoice rows
 * directly, so work entries always stay in step with the invoices that
 * claim them (an entry is billed by at most one non-void invoice).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { Tone } from '../components/ui/tones';
import { getDb, schema } from '../db';
import { site } from '../config/site';
import { formatDate } from './projects';
import type { InvoiceStatus } from '../db/schema';

export type Invoice = typeof schema.invoice.$inferSelect;
export type InvoiceLine = typeof schema.invoiceLine.$inferSelect;

/* ---------- Display ---------- */

/** What the invoice looks like to people: "overdue" is a sent invoice past its due date. */
export type InvoiceDisplayStatus = InvoiceStatus | 'overdue';

export const invoiceStatus: Record<InvoiceDisplayStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  sent: { label: 'Due', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
  void: { label: 'Void', tone: 'neutral' },
};

/** Today's date as YYYY-MM-DD (UTC). */
/** Today's date (YYYY-MM-DD) in the business's time zone (site.timeZone), not UTC. */
const isoDateFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: site.timeZone });
export const todayISO = () => isoDateFmt.format(new Date());

export function displayStatus(inv: Pick<Invoice, 'status' | 'dueDate'>, today = todayISO()): InvoiceDisplayStatus {
  return inv.status === 'sent' && inv.dueDate < today ? 'overdue' : inv.status;
}

/** "INV-1001", or "Draft" before the invoice is sent. */
export function invoiceNumber(inv: Pick<Invoice, 'number'>): string {
  return inv.number == null ? 'Draft' : `${site.billing.invoicePrefix}${inv.number}`;
}

/** A short name for lists and page titles. */
export function invoiceName(inv: Pick<Invoice, 'number' | 'title'>): string {
  return inv.title || `Invoice ${invoiceNumber(inv)}`;
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 150 -> "1.5", 100 -> "1" */
export function formatQuantity(hundredths: number): string {
  return String(Number((hundredths / 100).toFixed(2)));
}

/** Parses "1", "1.5", "0.25" into hundredths. Null if blank or invalid. */
export function parseQuantity(value: string): number | null {
  const v = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const n = Math.round(Number(v) * 100);
  return n > 0 ? n : null;
}

/** Parses a tax percentage ("8.25") into basis points. Null if invalid. */
export function parseTaxRate(value: string): number | null {
  const v = value.trim() || '0';
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

export const lineAmount = (quantityHundredths: number, unitCents: number) =>
  Math.round((quantityHundredths * unitCents) / 100);

/* ---------- Building lines from work ---------- */

type NewLine = Omit<typeof schema.invoiceLine.$inferInsert, 'invoiceId' | 'position'> & { id: string; entryIds: string[] };

/** Billable work on a project that no invoice has claimed yet, up to a date. */
export function unbilledEntries(projectId: string, through?: string) {
  const e = schema.workEntry;
  const where: SQL[] = [eq(schema.task.projectId, projectId), eq(e.billable, true), isNull(e.invoiceId)];
  if (through) where.push(lte(e.workDate, through));
  return getDb()
    .select({ entry: e, taskTitle: schema.task.title, taskPosition: schema.task.position })
    .from(e)
    .innerJoin(schema.task, eq(e.taskId, schema.task.id))
    .where(and(...where))
    .orderBy(asc(schema.task.position), asc(e.workDate), asc(e.createdAt))
    .all();
}

type UnbilledRow = Awaited<ReturnType<typeof unbilledEntries>>[number];

function dateRange(dates: string[]): string {
  const sorted = [...dates].sort();
  const first = formatDate(sorted[0]);
  const last = formatDate(sorted[sorted.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Rolls work entries into invoice lines: time is grouped per task and rate
 * (one line per task in the usual case), each expense gets its own line.
 */
export function linesFromEntries(rows: UnbilledRow[]): NewLine[] {
  const lines: NewLine[] = [];
  const timeGroups = new Map<string, UnbilledRow[]>();
  for (const r of rows) {
    if (r.entry.kind === 'time') {
      const key = `${r.entry.taskId}:${r.entry.rateCents ?? 0}`;
      timeGroups.set(key, [...(timeGroups.get(key) ?? []), r]);
    } else {
      lines.push({
        id: crypto.randomUUID(),
        kind: 'expense',
        taskId: r.entry.taskId,
        description: r.entry.description || 'Expense',
        details: `${r.taskTitle} · ${formatDate(r.entry.workDate)}`,
        quantityHundredths: 100,
        unitCents: r.entry.amountCents,
        amountCents: r.entry.amountCents,
        entryIds: [r.entry.id],
      });
    }
  }
  for (const group of timeGroups.values()) {
    const first = group[0];
    const minutes = group.reduce((m, r) => m + (r.entry.minutes ?? 0), 0);
    const unitCents = first.entry.rateCents ?? 0;
    const quantityHundredths = Math.round((minutes * 100) / 60);
    const notes = [...new Set(group.map((r) => r.entry.description).filter(Boolean))].join('; ');
    lines.push({
      id: crypto.randomUUID(),
      kind: 'time',
      taskId: first.entry.taskId,
      description: first.taskTitle,
      details: [notes, dateRange(group.map((r) => r.entry.workDate))].filter(Boolean).join(' · '),
      quantityHundredths,
      unitCents,
      amountCents: lineAmount(quantityHundredths, unitCents),
      entryIds: group.map((r) => r.entry.id),
    });
  }
  // Time lines in task order first, then expenses by date.
  return lines.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'time' ? -1 : 1));
}

/** Writes lines onto an invoice and marks their work entries as claimed by it. */
async function attachLines(invoiceId: string, lines: NewLine[]) {
  if (lines.length === 0) return;
  const db = getDb();
  const start = await nextLinePosition(invoiceId);
  const statements = lines.flatMap(({ entryIds, ...line }, i) => [
    db.insert(schema.invoiceLine).values({ ...line, invoiceId, position: start + i }),
    ...(entryIds.length
      ? [
          db
            .update(schema.workEntry)
            .set({ invoiceId, invoiceLineId: line.id })
            // Only entries still unbilled, so two drafts can never claim the same work.
            .where(and(inArray(schema.workEntry.id, entryIds), isNull(schema.workEntry.invoiceId))),
        ]
      : []),
  ]);
  await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
}

async function nextLinePosition(invoiceId: string): Promise<number> {
  const row = await getDb()
    .select({ max: sql<number | null>`max(${schema.invoiceLine.position})` })
    .from(schema.invoiceLine)
    .where(eq(schema.invoiceLine.invoiceId, invoiceId))
    .get();
  return (row?.max ?? -1) + 1;
}

/** Recalculates an invoice's subtotal, tax and total from its lines. */
export async function recalcTotals(invoiceId: string) {
  const db = getDb();
  const inv = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId)).get();
  if (!inv) return;
  const row = await db
    .select({ sum: sql<number>`coalesce(sum(${schema.invoiceLine.amountCents}), 0)` })
    .from(schema.invoiceLine)
    .where(eq(schema.invoiceLine.invoiceId, invoiceId))
    .get();
  const subtotalCents = row?.sum ?? 0;
  const taxCents = Math.round((subtotalCents * inv.taxRateBps) / 10000);
  await db
    .update(schema.invoice)
    .set({ subtotalCents, taxCents, totalCents: subtotalCents + taxCents })
    .where(eq(schema.invoice.id, invoiceId))
    .run();
}

/** Default "Billed to" block for a client. */
export function billToFor(client: { name: string; company: string | null; email: string }): string {
  return [client.company, client.company ? `Attn: ${client.name}` : client.name, client.email].filter(Boolean).join('\n');
}

/* ---------- Lifecycle ---------- */

export interface NewInvoiceInput {
  client: { id: string; name: string; company: string | null; email: string };
  projectId: string | null;
  title: string | null;
  /** Pull in unbilled work up to this date (YYYY-MM-DD). */
  workThrough: string;
}

/** Creates a draft invoice, pulling in the project's unbilled work. Returns its id. */
export async function createDraft(input: NewInvoiceInput): Promise<{ id: string; lineCount: number }> {
  const id = crypto.randomUUID();
  const issueDate = todayISO();
  await getDb()
    .insert(schema.invoice)
    .values({
      id,
      clientId: input.client.id,
      projectId: input.projectId,
      title: input.title,
      billTo: billToFor(input.client),
      issueDate,
      dueDate: addDays(issueDate, site.billing.paymentTermsDays),
      workThrough: input.projectId ? input.workThrough : null,
      taxRateBps: Math.round(site.billing.defaultTaxRate * 100),
      notes: null,
    })
    .run();
  let lineCount = 0;
  if (input.projectId) {
    const lines = linesFromEntries(await unbilledEntries(input.projectId, input.workThrough));
    await attachLines(id, lines);
    lineCount = lines.length;
  }
  await recalcTotals(id);
  return { id, lineCount };
}

/** Adds any newer unbilled work on the draft's project. Returns how many lines were added. */
export async function pullUnbilledWork(inv: Invoice, through: string): Promise<number> {
  if (inv.status !== 'draft' || !inv.projectId) return 0;
  const lines = linesFromEntries(await unbilledEntries(inv.projectId, through));
  await attachLines(inv.id, lines);
  await getDb().update(schema.invoice).set({ workThrough: through }).where(eq(schema.invoice.id, inv.id)).run();
  await recalcTotals(inv.id);
  return lines.length;
}

export async function addCustomLine(inv: Invoice, line: { description: string; details: string | null; quantityHundredths: number; unitCents: number }) {
  await attachLines(inv.id, [
    { id: crypto.randomUUID(), kind: 'custom', taskId: null, ...line, amountCents: lineAmount(line.quantityHundredths, line.unitCents), entryIds: [] },
  ]);
  await recalcTotals(inv.id);
}

export async function updateLine(line: InvoiceLine, changes: { description: string; details: string | null; quantityHundredths: number; unitCents: number }) {
  await getDb()
    .update(schema.invoiceLine)
    .set({ ...changes, amountCents: lineAmount(changes.quantityHundredths, changes.unitCents) })
    .where(eq(schema.invoiceLine.id, line.id))
    .run();
  await recalcTotals(line.invoiceId);
}

/** Removes a line and frees its work entries to be billed later. */
export async function removeLine(line: InvoiceLine) {
  const db = getDb();
  await db.batch([
    db.update(schema.workEntry).set({ invoiceId: null, invoiceLineId: null }).where(eq(schema.workEntry.invoiceLineId, line.id)),
    db.delete(schema.invoiceLine).where(eq(schema.invoiceLine.id, line.id)),
  ]);
  await recalcTotals(line.invoiceId);
}

/** Deletes a draft and frees all of its work entries. */
export async function deleteDraft(inv: Invoice) {
  if (inv.status !== 'draft') throw new Error('Only drafts can be deleted.');
  const db = getDb();
  await db.batch([
    db.update(schema.workEntry).set({ invoiceId: null, invoiceLineId: null }).where(eq(schema.workEntry.invoiceId, inv.id)),
    db.delete(schema.invoice).where(eq(schema.invoice.id, inv.id)),
  ]);
}

/** Finalizes a draft: assigns the next number and shows it to the client. */
export async function sendInvoice(inv: Invoice) {
  if (inv.status !== 'draft') throw new Error('Only drafts can be sent.');
  const db = getDb();
  const row = await db.select({ max: sql<number | null>`max(${schema.invoice.number})` }).from(schema.invoice).get();
  const number = Math.max((row?.max ?? 0) + 1, site.billing.firstInvoiceNumber);
  await db
    .update(schema.invoice)
    .set({ status: 'sent', number, sentAt: new Date() })
    .where(and(eq(schema.invoice.id, inv.id), eq(schema.invoice.status, 'draft')))
    .run();
}

export async function markPaid(inv: Invoice, paidDate: string) {
  await getDb().update(schema.invoice).set({ status: 'paid', paidDate, paidVia: 'manual' }).where(eq(schema.invoice.id, inv.id)).run();
}

export async function markUnpaid(inv: Invoice) {
  await getDb().update(schema.invoice).set({ status: 'sent', paidDate: null, paidVia: null }).where(eq(schema.invoice.id, inv.id)).run();
}

/** Cancels a sent invoice. Its number stays used; its work becomes unbilled again. */
export async function voidInvoice(inv: Invoice) {
  if (inv.status !== 'sent') throw new Error('Only unpaid sent invoices can be voided.');
  const db = getDb();
  await db.batch([
    db.update(schema.workEntry).set({ invoiceId: null, invoiceLineId: null }).where(eq(schema.workEntry.invoiceId, inv.id)),
    db.update(schema.invoice).set({ status: 'void', voidedAt: new Date() }).where(eq(schema.invoice.id, inv.id)),
  ]);
}

/* ---------- Queries ---------- */

export function invoiceLines(invoiceId: string) {
  return getDb()
    .select()
    .from(schema.invoiceLine)
    .where(eq(schema.invoiceLine.invoiceId, invoiceId))
    .orderBy(asc(schema.invoiceLine.position), asc(schema.invoiceLine.createdAt))
    .all();
}

/** Invoices with client and project names, newest first. */
export function listInvoices(filter: { clientId?: string; projectId?: string; statuses?: InvoiceStatus[] } = {}) {
  const where: SQL[] = [];
  if (filter.clientId) where.push(eq(schema.invoice.clientId, filter.clientId));
  if (filter.projectId) where.push(eq(schema.invoice.projectId, filter.projectId));
  if (filter.statuses) where.push(inArray(schema.invoice.status, filter.statuses));
  return getDb()
    .select({
      invoice: schema.invoice,
      clientName: schema.user.name,
      clientCompany: schema.user.company,
      projectName: schema.project.name,
    })
    .from(schema.invoice)
    .innerJoin(schema.user, eq(schema.invoice.clientId, schema.user.id))
    .leftJoin(schema.project, eq(schema.invoice.projectId, schema.project.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.invoice.issueDate), desc(schema.invoice.createdAt))
    .all();
}

/** Statuses a client can see: never drafts. */
export const CLIENT_INVOICE_STATUSES: InvoiceStatus[] = ['sent', 'paid', 'void'];

/** Total of sent (unpaid) invoices, optionally for one client, and how much of it is overdue. */
export async function outstanding(clientId?: string) {
  const i = schema.invoice;
  const today = todayISO();
  const row = await getDb()
    .select({
      due: sql<number>`coalesce(sum(${i.totalCents}), 0)`,
      overdue: sql<number>`coalesce(sum(case when ${i.dueDate} < ${today} then ${i.totalCents} else 0 end), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(i)
    .where(clientId ? and(eq(i.status, 'sent'), eq(i.clientId, clientId)) : eq(i.status, 'sent'))
    .get();
  return { dueCents: row?.due ?? 0, overdueCents: row?.overdue ?? 0, count: row?.count ?? 0 };
}

/** Invoice numbers for a set of invoice ids (used to label invoiced work entries). */
export async function invoiceRefs(ids: string[]) {
  const result = new Map<string, { number: number | null; status: InvoiceStatus }>();
  if (ids.length === 0) return result;
  const rows = await getDb()
    .select({ id: schema.invoice.id, number: schema.invoice.number, status: schema.invoice.status })
    .from(schema.invoice)
    .where(inArray(schema.invoice.id, ids))
    .all();
  for (const r of rows) result.set(r.id, { number: r.number, status: r.status });
  return result;
}

/** Unbilled billable amount per project id (only projects that have some). */
export async function unbilledByProject(): Promise<Map<string, number>> {
  const e = schema.workEntry;
  const rows = await getDb()
    .select({ projectId: schema.task.projectId, cents: sql<number>`sum(${e.amountCents})` })
    .from(e)
    .innerJoin(schema.task, eq(e.taskId, schema.task.id))
    .where(and(eq(e.billable, true), isNull(e.invoiceId)))
    .groupBy(schema.task.projectId)
    .all();
  return new Map(rows.filter((r) => r.cents > 0).map((r) => [r.projectId, r.cents]));
}

/* ---------- Money summary (admin invoices screen) ---------- */

export const MONEY_PERIODS = {
  today: 'Today',
  week: 'Week',
  month: 'Month',
  ytd: 'YTD',
  all: 'All time',
} as const;
export type MoneyPeriod = keyof typeof MONEY_PERIODS;
export const isMoneyPeriod = (v: string): v is MoneyPeriod => v in MONEY_PERIODS;

/** First day (YYYY-MM-DD) of a period ending today. Weeks start on Monday. */
export function periodStart(period: MoneyPeriod, today = todayISO()): string {
  const d = new Date(`${today}T00:00:00Z`);
  if (period === 'today') return today;
  if (period === 'week') return addDays(today, -((d.getUTCDay() + 6) % 7));
  if (period === 'month') return `${today.slice(0, 8)}01`;
  if (period === 'ytd') return `${today.slice(0, 4)}-01-01`;
  return '0000-01-01';
}

/**
 * Invoiced (sent or paid invoices issued in the period) and collected
 * (payments received in the period, by paid date) for a period ending today.
 */
export async function moneySummary(period: MoneyPeriod) {
  const i = schema.invoice;
  const from = periodStart(period);
  const to = todayISO();
  const db = getDb();
  const [invoiced, collected] = await Promise.all([
    db
      .select({ cents: sql<number>`coalesce(sum(${i.totalCents}), 0)`, n: sql<number>`count(*)` })
      .from(i)
      .where(and(inArray(i.status, ['sent', 'paid']), gte(i.issueDate, from), lte(i.issueDate, to)))
      .get(),
    db
      .select({ cents: sql<number>`coalesce(sum(${i.totalCents}), 0)`, n: sql<number>`count(*)` })
      .from(i)
      .where(and(eq(i.status, 'paid'), gte(i.paidDate, from), lte(i.paidDate, to)))
      .get(),
  ]);
  return {
    from,
    invoicedCents: invoiced?.cents ?? 0,
    invoicedCount: invoiced?.n ?? 0,
    collectedCents: collected?.cents ?? 0,
    collectedCount: collected?.n ?? 0,
  };
}

/** The latest payments, newest first, with the client's name. */
export function recentPayments(limit = 5) {
  const i = schema.invoice;
  return getDb()
    .select({ invoice: i, clientName: schema.user.name, clientImage: schema.user.image })
    .from(i)
    .innerJoin(schema.user, eq(i.clientId, schema.user.id))
    .where(eq(i.status, 'paid'))
    .orderBy(desc(i.paidDate), desc(i.updatedAt))
    .limit(limit)
    .all();
}
