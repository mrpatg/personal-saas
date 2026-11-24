import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { admin } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import { getDb, schema } from '../db';

/** The two roles in the app. Admins manage everything; clients see their own work. */
export const ROLES = { admin: 'admin', client: 'client' } as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

/**
 * Hosts Better Auth accepts requests from. Covers local dev, the workers.dev
 * URL (including preview builds) and any custom domains listed in the
 * AUTH_HOSTS variable (comma-separated, e.g. "portal.example.com").
 */
const allowedHosts = [
  'localhost:*',
  '127.0.0.1:*',
  '*.workers.dev',
  ...String(env.AUTH_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
];

if (!env.BETTER_AUTH_SECRET) {
  // Without it Better Auth would sign cookies with a public default secret.
  throw new Error('BETTER_AUTH_SECRET is not set. Locally: add it to .dev.vars. Production: npx wrangler secret put BETTER_AUTH_SECRET');
}

/**
 * Better Auth server instance: email/password sign-in, accounts and sessions
 * stored in D1. Public sign-up is off; admins create client accounts.
 * HTTP endpoints are mounted at /api/auth/* (src/pages/api/auth/[...all].ts).
 */
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: { allowedHosts },
  database: drizzleAdapter(getDb(), {
    provider: 'sqlite',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
  },
  user: {
    additionalFields: {
      company: { type: 'string', required: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
  },
  plugins: [
    admin({
      defaultRole: ROLES.client,
      adminRoles: [ROLES.admin],
      roles: { [ROLES.admin]: adminAc, [ROLES.client]: userAc },
      bannedUserMessage: 'This account is disabled. Please get in touch if you think this is a mistake.',
    }),
  ],
});

export type SessionUser = typeof auth.$Infer.Session.user;
export type Session = typeof auth.$Infer.Session.session;

/** Where each role lands after signing in. */
export function homeFor(user: { role?: string | null }): string {
  return user.role === ROLES.admin ? '/admin' : '/app';
}
