import type { APIRoute } from 'astro';
import { getAuth } from '../../../lib/auth';

/** Mounts every Better Auth endpoint (sign-in, sign-out, admin API…) under /api/auth/*. */
export const ALL: APIRoute = ({ request }) => getAuth().handler(request);
