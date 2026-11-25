/** Admin only (see src/middleware.ts): the Status page's checks as JSON. */
import type { APIRoute } from 'astro';
import { overall, runChecks } from '../../lib/status';

export const GET: APIRoute = async ({ url }) => {
  const checks = await runChecks(url.origin);
  return new Response(JSON.stringify({ state: overall(checks), checkedAt: new Date().toISOString(), checks }, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
};
