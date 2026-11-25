import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { admin } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import { getDb, schema } from '../db';
import { site } from '../config/site';
import { logActivity } from './activity';
import { renderEmail, sendEmail, type EmailResult } from './email';

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

/**
 * Better Auth server instance: email/password sign-in, accounts and sessions
 * stored in D1. Public sign-up is off; admins create client accounts.
 * HTTP endpoints are mounted at /api/auth/* (src/pages/api/auth/[...all].ts).
 */
function createAuth(secret: string) {
  return betterAuth({
    secret,
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
      // Reset links double as invite links for new clients, so give them time.
      resetPasswordTokenExpiresIn: PASSWORD_LINK_HOURS * 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url, token }) => {
        // Better Auth's url points at its own API route; we link to our page
        // instead. An invite is a reset requested with redirectTo containing "invite=1".
        const parsed = new URL(url);
        const invite = (parsed.searchParams.get('callbackURL') ?? '').includes('invite=1');
        const link = `${parsed.origin}/reset-password?token=${encodeURIComponent(token)}${invite ? '&invite=1' : ''}`;
        const result = await sendEmail({ to: user.email, ...passwordEmail(user.name, link, invite) });
        lastPasswordEmail.set(user.email.toLowerCase(), result);
      },
      onPasswordReset: async ({ user }, request) => {
        const role = (user as { role?: string | null }).role ?? null;
        await logActivity(
          { id: user.id, name: user.name, role },
          { action: 'user.password_reset', summary: 'Set a new password from an emailed link', subjectType: role === ROLES.client ? 'client' : 'user', subjectId: user.id, clientId: role === ROLES.client ? user.id : null },
          request,
        );
      },
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
}

/**
 * Result of the most recent password/invite email per address, so admin
 * pages can tell whether an invite actually went out (Better Auth's
 * requestPasswordReset deliberately reports success either way).
 */
const lastPasswordEmail = new Map<string, EmailResult>();

/**
 * Emails a set-password link to an existing user: an invite (welcome wording)
 * or a normal reset. Returns whether the email was sent.
 */
export async function sendPasswordLink(email: string, kind: 'invite' | 'reset', headers: Headers): Promise<EmailResult> {
  const key = email.toLowerCase();
  lastPasswordEmail.delete(key);
  await getAuth().api.requestPasswordReset({
    body: { email, redirectTo: kind === 'invite' ? '/reset-password?invite=1' : '/reset-password' },
    headers,
  });
  const result = lastPasswordEmail.get(key) ?? { ok: false, error: 'No account with that email.' };
  lastPasswordEmail.delete(key);
  return result;
}

/** How long invite and reset-password links stay valid. */
export const PASSWORD_LINK_HOURS = 72;

function passwordEmail(name: string, link: string, invite: boolean) {
  const first = name.split(' ')[0];
  const { html, text } = invite
    ? renderEmail({
        preview: `Your ${site.name} account is ready`,
        heading: `Welcome, ${first}`,
        paragraphs: [
          `${site.owner} has set up an account for you on ${site.name}, where you can follow your projects, reply on tasks and view invoices.`,
          'Choose a password to get started.',
        ],
        button: { label: 'Set your password', url: link },
        footnote: `This link works once and expires in ${PASSWORD_LINK_HOURS / 24} days. If it has expired, use "Forgot password" on the sign-in page.`,
      })
    : renderEmail({
        preview: 'Reset your password',
        heading: 'Reset your password',
        paragraphs: [`Hi ${first}, we received a request to reset your ${site.name} password.`],
        button: { label: 'Choose a new password', url: link },
        footnote: `This link works once and expires in ${PASSWORD_LINK_HOURS / 24} days. If you didn't ask for this, you can ignore this email.`,
      });
  return { subject: invite ? `Your ${site.name} account is ready` : `Reset your ${site.name} password`, html, text };
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/**
 * Returns the Better Auth instance, created on first use. Created lazily (not
 * at import time) so the Worker can start, and public pages keep working,
 * even before BETTER_AUTH_SECRET is set.
 */
export function getAuth(): Auth {
  if (!instance) {
    if (!env.BETTER_AUTH_SECRET) {
      // Without it Better Auth would sign cookies with a public default secret.
      throw new Error(
        'BETTER_AUTH_SECRET is not set. Locally: add it to .dev.vars. Production: npx wrangler secret put BETTER_AUTH_SECRET',
      );
    }
    instance = createAuth(env.BETTER_AUTH_SECRET);
  }
  return instance;
}

export type SessionUser = Auth['$Infer']['Session']['user'];
export type Session = Auth['$Infer']['Session']['session'];

/** Where each role lands after signing in. */
export function homeFor(user: { role?: string | null }): string {
  return user.role === ROLES.admin ? '/admin' : '/app';
}
