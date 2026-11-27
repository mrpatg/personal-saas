import type { APIRoute } from 'astro';
import { migrationStatus } from '../lib/status';

/**
 * GET /health — confirms the Worker is running, can reach D1, and that every
 * migration in migrations/ has been applied to this database.
 * Returns 200 {"status":"ok","db":"ok","migrated":true}. If migrations are
 * missing it returns 503 with "migrated":false and the "pending" files.
 * The admin Status page (/admin/status) runs fuller checks.
 */
export const GET: APIRoute = async () => {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  try {
    const { pending } = await migrationStatus();
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
