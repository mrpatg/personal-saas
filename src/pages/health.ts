import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';

/**
 * GET /health — confirms the Worker is running and can reach D1.
 * Returns 200 {"status":"ok"} or 503 {"status":"error"}.
 */
export const GET: APIRoute = async () => {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  try {
    const db = getDb();
    const tables = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'`,
    );
    return new Response(
      JSON.stringify({ status: 'ok', db: 'ok', migrated: tables.length === 1 }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error('Health check failed', err);
    return new Response(JSON.stringify({ status: 'error', db: 'unreachable' }), {
      status: 503,
      headers,
    });
  }
};
