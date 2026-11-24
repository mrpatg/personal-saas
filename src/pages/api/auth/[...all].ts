import type { APIRoute } from 'astro';
import { auth } from '../../../lib/auth';

/** Mounts every Better Auth endpoint (sign-in, sign-out, admin API…) under /api/auth/*. */
export const ALL: APIRoute = ({ request }) => auth.handler(request);
