/**
 * Projects and tasks: status labels, queries and small helpers shared by the
 * admin (/admin/projects) and client (/app/projects) pages.
 */
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Tone } from '../components/ui/tones';
import { getDb, schema } from '../db';
import {
  PROJECT_STATUSES,
  TASK_STATUSES,
  type ProjectStatus,
  type TaskStatus,
} from '../db/schema';

export { PROJECT_STATUSES, TASK_STATUSES, type ProjectStatus, type TaskStatus };

export type Project = typeof schema.project.$inferSelect;
export type Task = typeof schema.task.$inferSelect;

export const projectStatus: Record<ProjectStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'progress' },
  on_hold: { label: 'On hold', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  archived: { label: 'Archived', tone: 'neutral' },
};

export const taskStatus: Record<TaskStatus, { label: string; tone: Tone }> = {
  todo: { label: 'To do', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'progress' },
  review: { label: 'In review', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
};

export const isProjectStatus = (v: string): v is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(v);
export const isTaskStatus = (v: string): v is TaskStatus => (TASK_STATUSES as readonly string[]).includes(v);

/** Statuses a client can see. Archived projects are hidden from clients. */
export const CLIENT_VISIBLE_STATUSES: ProjectStatus[] = ['active', 'on_hold', 'completed'];

/** Returns a YYYY-MM-DD string, or null for blank/invalid input. */
export function parseDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Formats a YYYY-MM-DD date, e.g. "Jan 30, 2027". */
export function formatDate(value: string | null | undefined): string {
  return value ? dateFmt.format(new Date(`${value}T00:00:00Z`)) : '';
}

export interface TaskCounts {
  total: number;
  done: number;
  /** Whole-number percent of tasks done (0 when there are no tasks). */
  percent: number;
}

export function countsFrom(total: number, done: number): TaskCounts {
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Task totals per project id, for progress bars on lists. */
export async function taskCountsFor(projectIds: string[]): Promise<Map<string, TaskCounts>> {
  const result = new Map<string, TaskCounts>();
  if (projectIds.length === 0) return result;
  const rows = await getDb()
    .select({
      projectId: schema.task.projectId,
      total: sql<number>`count(*)`,
      done: sql<number>`sum(case when ${schema.task.status} = 'done' then 1 else 0 end)`,
    })
    .from(schema.task)
    .where(inArray(schema.task.projectId, projectIds))
    .groupBy(schema.task.projectId)
    .all();
  for (const r of rows) result.set(r.projectId, countsFrom(r.total, r.done ?? 0));
  return result;
}

/** Order for project lists: active first, then on hold, completed, archived; newest first within each. */
const statusOrder = sql`case ${schema.project.status} when 'active' then 0 when 'on_hold' then 1 when 'completed' then 2 else 3 end`;

/** A client's own projects (archived ones hidden), with task counts. */
export async function clientProjects(clientId: string) {
  const projects = await getDb()
    .select()
    .from(schema.project)
    .where(and(eq(schema.project.clientId, clientId), inArray(schema.project.status, CLIENT_VISIBLE_STATUSES)))
    .orderBy(statusOrder, desc(schema.project.createdAt))
    .all();
  const counts = await taskCountsFor(projects.map((p) => p.id));
  return projects.map((p) => ({ ...p, counts: counts.get(p.id) ?? countsFrom(0, 0) }));
}

/** Every project with its client's name, optionally for one client, with task counts. */
export async function allProjects(clientId?: string) {
  const projects = await getDb()
    .select({ project: schema.project, clientName: schema.user.name, clientCompany: schema.user.company })
    .from(schema.project)
    .innerJoin(schema.user, eq(schema.project.clientId, schema.user.id))
    .where(clientId ? eq(schema.project.clientId, clientId) : undefined)
    .orderBy(statusOrder, desc(schema.project.createdAt))
    .all();
  const counts = await taskCountsFor(projects.map((r) => r.project.id));
  return projects.map((r) => ({
    ...r.project,
    clientName: r.clientName,
    clientCompany: r.clientCompany,
    counts: counts.get(r.project.id) ?? countsFrom(0, 0),
  }));
}

/** A project's tasks in display order. */
export function projectTasks(projectId: string) {
  return getDb()
    .select()
    .from(schema.task)
    .where(eq(schema.task.projectId, projectId))
    .orderBy(asc(schema.task.position), asc(schema.task.createdAt))
    .all();
}

/** Number of open (not done) tasks across a set of projects. */
export function openTaskCount(projects: { counts: TaskCounts; status: ProjectStatus }[]): number {
  return projects.filter((p) => p.status !== 'archived').reduce((n, p) => n + p.counts.total - p.counts.done, 0);
}

/** Where a new task goes: after the last one. */
export async function nextTaskPosition(projectId: string): Promise<number> {
  const row = await getDb()
    .select({ max: sql<number | null>`max(${schema.task.position})` })
    .from(schema.task)
    .where(eq(schema.task.projectId, projectId))
    .get();
  return (row?.max ?? -1) + 1;
}

/** Fields to write when a task's status changes; keeps completedAt in step with "done". */
export function statusChange(current: Task, status: TaskStatus): Partial<Task> {
  if (status === current.status) return {};
  if (status === 'done') return { status, completedAt: new Date() };
  return { status, completedAt: null };
}

/** Swaps a task with its neighbour above or below. */
export async function moveTask(t: Task, direction: 'up' | 'down') {
  const db = getDb();
  const siblings = await projectTasks(t.projectId);
  const i = siblings.findIndex((s) => s.id === t.id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= siblings.length) return;
  // Re-number the whole list so equal or gapped positions can't get stuck.
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  const updates = siblings
    .map((s, position) => ({ s, position }))
    .filter(({ s, position }) => s.position !== position)
    .map(({ s, position }) => db.update(schema.task).set({ position }).where(eq(schema.task.id, s.id)));
  if (updates.length) await db.batch(updates as [(typeof updates)[0], ...typeof updates]);
}

/** Clients for the "new project" picker (active accounts only). */
export function clientOptions() {
  return getDb()
    .select({ id: schema.user.id, name: schema.user.name, company: schema.user.company })
    .from(schema.user)
    .where(and(eq(schema.user.role, 'client'), ne(schema.user.banned, true)))
    .orderBy(asc(schema.user.name))
    .all();
}
