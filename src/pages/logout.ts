import type { APIRoute } from 'astro';
import { auth } from '../lib/auth';
import { redirectWithCookies } from '../lib/auth-helpers';

/** POST /logout — ends the session and returns to the login page. */
export const POST: APIRoute = async ({ request }) => {
  const res = await auth.api.signOut({ headers: request.headers, returnHeaders: true }).catch(() => null);
  return redirectWithCookies('/login', res?.headers);
};
