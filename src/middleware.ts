import { defineMiddleware } from 'astro:middleware';
import { auth, homeFor, ROLES } from './lib/auth';

/** Path prefixes and who may open them. Anything not listed is public. */
const protectedAreas: { prefix: string; allow: (role: string | null | undefined) => boolean }[] = [
  { prefix: '/admin', allow: (role) => role === ROLES.admin },
  { prefix: '/app', allow: (role) => role === ROLES.client || role === ROLES.admin },
];

function matches(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Loads the session into Astro.locals and guards protected areas:
 * signed-out visitors go to /login, signed-in users without access go to
 * their own home.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  // Auth API handles its own sessions; static/public files need no lookup.
  if (path.startsWith('/api/auth/')) return next();

  const result = await auth.api.getSession({ headers: context.request.headers });
  context.locals.user = result?.user ?? null;
  context.locals.session = result?.session ?? null;

  const area = protectedAreas.find((a) => matches(path, a.prefix));
  if (area) {
    const user = context.locals.user;
    if (!user) {
      const target = encodeURIComponent(path + context.url.search);
      return context.redirect(`/login?next=${target}`);
    }
    if (!area.allow(user.role)) return context.redirect(homeFor(user));
  }

  const response = await next();
  if (area) response.headers.set('cache-control', 'private, no-store');
  return response;
});
