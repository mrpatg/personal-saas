import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import journal from '../../migrations/meta/_journal.json';

/**
 * GET /health — confirms the Worker is running, can reach D1, and that every
 * migration in migrations/ has been applied to this database.
 * Returns 200 {"status":"ok","db":"ok","migrated":true}. If migrations are
 * missing it returns 503 with "migrated":false and the "pending" files.
 */
export const GET: APIRoute = async () => {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  try {
    const db = getDb();
    // Wrangler records applied migrations in d1_migrations (name = "0001_auth.sql").
    const hasTable = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'`,
    );
    const applied = hasTable.length
      ? new Set((await db.all<{ name: string }>(sql`SELECT name FROM d1_migrations`)).map((r) => r.name))
      : new Set<string>();
    const pending = journal.entries.map((e) => `${e.tag}.sql`).filter((name) => !applied.has(name));
    const migrated = pending.length === 0;
    return new Response(
      JSON.stringify(migrated ? { status: 'ok', db: 'ok', migrated } : { status: 'error', db: 'ok', migrated, pending }),
      { status: migrated ? 200 : 503, headers },
    );
  } catch (err) {
    console.error('Health check failed', err);
    return new Response(JSON.stringify({ status: 'error', db: 'unreachable' }), {
      status: 503,
      headers,
    });
  }
};
