import { isAPIError } from 'better-auth/api';

/** Turns a Better Auth error into a short message safe to show on a form. */
export function authErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isAPIError(err) && err.message) return err.message;
  console.error(err);
  return fallback;
}

/** Only allow same-site relative redirects (blocks "//evil.com" and absolute URLs). */
export function safeRedirect(target: string | null | undefined, fallback: string): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return fallback;
  return target;
}

/** Reads a trimmed string field from submitted form data. */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** A 303 redirect that also carries any Set-Cookie headers Better Auth returned. */
export function redirectWithCookies(location: string, authHeaders?: Headers | null): Response {
  const headers = new Headers({ location });
  authHeaders?.getSetCookie().forEach((c) => headers.append('set-cookie', c));
  return new Response(null, { status: 303, headers });
}

/**
 * A random temporary password, e.g. "kq7m-x2rd-pa9w". Avoids look-alike
 * characters so it is easy to read out or type.
 */
export function generatePassword(groups = 3, size = 4): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(groups * size));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return Array.from({ length: groups }, (_, i) => chars.slice(i * size, (i + 1) * size).join('')).join('-');
}
