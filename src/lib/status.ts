/**
 * System status checks for /admin/status (and /admin/status.json): is each
 * part of the portal set up and working? Each check returns quickly and never
 * throws; slow outside services time out after a few seconds.
 */
import { env } from 'cloudflare:workers';
import { and, desc, gte, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { site } from '../config/site';
import { allowedHosts } from './auth';
import { emailEnabled } from './email';
import { stripeEnabled, stripeTestMode } from './stripe';
import { formatWhen } from './activity';
import journal from '../../migrations/meta/_journal.json';

export type CheckState = 'ok' | 'warn' | 'fail' | 'off';

export interface Check {
  id: string;
  label: string;
  state: CheckState;
  /** One plain sentence on what was found. */
  detail: string;
  /** What to do about it, when something needs doing. */
  fix?: string;
}

/** Applied vs. pending migrations (also used by /health). */
export async function migrationStatus(): Promise<{ pending: string[] }> {
  const db = getDb();
  const hasTable = await db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'`);
  const applied = hasTable.length ? new Set((await db.all<{ name: string }>(sql`SELECT name FROM d1_migrations`)).map((r) => r.name)) : new Set<string>();
  return { pending: journal.entries.map((e) => `${e.tag}.sql`).filter((name) => !applied.has(name)) };
}

async function timed<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms)));
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Wraps a check so an unexpected error shows as a failed check instead of breaking the page. */
async function safely(id: string, label: string, run: () => Promise<Omit<Check, 'id' | 'label'>>): Promise<Check> {
  try {
    return { id, label, ...(await run()) };
  } catch (err) {
    return { id, label, state: 'fail', detail: `The check itself failed: ${message(err)}` };
  }
}

function hostAllowed(host: string): boolean {
  return allowedHosts.some((pattern) => {
    const re = new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '[^.]*')}$`);
    return re.test(host) || re.test(host.replace(/:\d+$/, ''));
  });
}

/** Runs every check. `origin` is this site's URL, e.g. https://portal.example.com. */
export async function runChecks(origin: string): Promise<Check[]> {
  const db = getDb();
  const url = new URL(origin);

  const checks = await Promise.all([
    safely('database', 'Database', async () => {
      const row = await db.select({ n: sql<number>`count(*)` }).from(schema.user).get();
      return { state: 'ok', detail: `Connected. ${row?.n ?? 0} user account${row?.n === 1 ? '' : 's'}.` };
    }),

    safely('migrations', 'Database migrations', async () => {
      const { pending } = await migrationStatus();
      return pending.length
        ? { state: 'fail', detail: `${pending.length} not applied: ${pending.join(', ')}.`, fix: 'Check that the Cloudflare deploy command is "npm run deploy:ci", or run "npm run db:migrate:remote".' }
        : { state: 'ok', detail: `All ${journal.entries.length} applied.` };
    }),

    safely('auth', 'Sign-in', async () => {
      const secret = env.BETTER_AUTH_SECRET ?? '';
      if (secret.length < 32) return { state: 'fail', detail: 'BETTER_AUTH_SECRET is missing or too short.', fix: 'Run: npx wrangler secret put BETTER_AUTH_SECRET (use openssl rand -base64 32).' };
      if (!hostAllowed(url.host)) return { state: 'fail', detail: `${url.host} isn't in AUTH_HOSTS, so sign-in fails on this address.`, fix: 'Add it to AUTH_HOSTS in wrangler.jsonc.' };
      return { state: 'ok', detail: `Secret set, and ${url.hostname} is an allowed address.` };
    }),

    safely('email', 'Email (Resend)', async () => {
      if (!emailEnabled()) return { state: 'off', detail: 'RESEND_API_KEY isn’t set, so no emails are sent.', fix: 'Run: npx wrangler secret put RESEND_API_KEY' };
      const senderDomain = site.email.from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? '';
      let domainNote = '';
      let state: CheckState = 'ok';
      let fix: string | undefined;
      try {
        const res = await timed(fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${env.RESEND_API_KEY}` } }));
        if (res.status === 401 || res.status === 403) domainNote = 'Key works for sending (it can’t list domains, so the domain wasn’t checked).';
        else if (!res.ok) {
          state = 'warn';
          domainNote = `Resend answered ${res.status}.`;
        } else {
          const body = (await res.json()) as { data?: { name: string; status: string }[] };
          const domain = body.data?.find((d) => d.name.toLowerCase() === senderDomain);
          if (!domain) {
            state = 'fail';
            domainNote = `The sender domain ${senderDomain} isn’t in your Resend account, so Resend will refuse to send (403).`;
            fix = `Verify ${senderDomain} in Resend, or change site.email.from to an address on a verified domain.`;
          } else if (domain.status !== 'verified') {
            state = 'warn';
            domainNote = `${senderDomain} is "${domain.status}" in Resend, not verified yet.`;
            fix = 'Finish the DNS records Resend shows for the domain.';
          } else domainNote = `Sending from ${senderDomain}, which is verified.`;
        }
      } catch (err) {
        state = 'warn';
        domainNote = `Couldn’t reach Resend: ${message(err)}.`;
      }
      // The latest email outcome the portal recorded.
      const l = schema.activityLog;
      const last = await db
        .select()
        .from(l)
        .where(inArray(l.action, ['invoice.emailed', 'invoice.email_failed', 'client.invited', 'client.invite_failed']))
        .orderBy(desc(l.createdAt))
        .limit(1)
        .get();
      if (last?.action.endsWith('_failed')) {
        if (state === 'ok') state = 'warn';
        domainNote += ` The last email failed (${formatWhen(last.createdAt)}): ${last.summary}`;
      } else if (last) domainNote += ` Last email sent ${formatWhen(last.createdAt)}.`;
      return { state, detail: domainNote.trim(), fix };
    }),

    safely('stripe', 'Payments (Stripe)', async () => {
      if (!stripeEnabled()) return { state: 'off', detail: 'STRIPE_SECRET_KEY isn’t set, so clients don’t see “Pay now”.', fix: 'Run: npx wrangler secret put STRIPE_SECRET_KEY' };
      const mode = stripeTestMode() ? 'test mode' : 'live mode';
      const headers = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
      try {
        const res = await timed(fetch('https://api.stripe.com/v1/balance', { headers }));
        if (!res.ok) return { state: 'fail', detail: `Stripe rejected the secret key (${res.status}).`, fix: 'Set the right key: npx wrangler secret put STRIPE_SECRET_KEY' };
      } catch (err) {
        return { state: 'warn', detail: `Couldn’t reach Stripe: ${message(err)}.` };
      }
      return { state: stripeTestMode() ? 'warn' : 'ok', detail: `Key works, in ${mode}.${stripeTestMode() ? ' Payments are test payments only.' : ''}`, fix: stripeTestMode() ? 'Switch to live keys when you’re ready to take real payments.' : undefined };
    }),

    safely('webhook', 'Stripe webhook', async () => {
      if (!stripeEnabled()) return { state: 'off', detail: 'Off until Stripe is set up.' };
      const endpoint = `${origin}/api/stripe/webhook`;
      if (!env.STRIPE_WEBHOOK_SECRET) return { state: 'fail', detail: 'STRIPE_WEBHOOK_SECRET isn’t set, so payments won’t mark invoices paid automatically.', fix: 'Run: npx wrangler secret put STRIPE_WEBHOOK_SECRET' };
      const needed = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'];
      try {
        const res = await timed(fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100', { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }));
        if (!res.ok) return { state: 'warn', detail: `Secret set, but Stripe answered ${res.status} when listing webhooks (a restricted key can’t).` };
        const body = (await res.json()) as { data: { url: string; status: string; enabled_events: string[] }[] };
        const hook = body.data.find((h) => h.url === endpoint);
        if (!hook) return { state: 'fail', detail: `No webhook in this Stripe mode points at ${endpoint}.`, fix: 'In Stripe → Developers → Webhooks, add a destination for that URL with the checkout.session events.' };
        if (hook.status !== 'enabled') return { state: 'fail', detail: 'The webhook is disabled in Stripe.', fix: 'Enable it in Stripe → Developers → Webhooks.' };
        const missing = hook.enabled_events.includes('*') ? [] : needed.filter((e) => !hook.enabled_events.includes(e));
        if (missing.length) return { state: 'warn', detail: `Missing events: ${missing.join(', ')}.`, fix: 'Add them to the webhook in Stripe.' };
      } catch (err) {
        return { state: 'warn', detail: `Secret set; couldn’t reach Stripe to check the webhook: ${message(err)}.` };
      }
      const last = await db.select().from(schema.activityLog).where(inArray(schema.activityLog.action, ['invoice.paid'])).orderBy(desc(schema.activityLog.createdAt)).limit(1).get();
      return { state: 'ok', detail: `Enabled, pointing at this site, with the right events.${last ? ` Last payment recorded ${formatWhen(last.createdAt)}.` : ''}` };
    }),

    safely('problems', 'Problems in the last 7 days', async () => {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const l = schema.activityLog;
      const rows = await db
        .select({ action: l.action, n: sql<number>`count(*)` })
        .from(l)
        .where(and(gte(l.createdAt, since), inArray(l.action, ['invoice.email_failed', 'client.invite_failed', 'invoice.payment_failed', 'invoice.paid_while_void', 'user.sign_in_failed'])))
        .groupBy(l.action)
        .all();
      const count = (a: string) => rows.find((r) => r.action === a)?.n ?? 0;
      const emails = count('invoice.email_failed') + count('client.invite_failed');
      const payments = count('invoice.payment_failed') + count('invoice.paid_while_void');
      const signins = count('user.sign_in_failed');
      const parts = [
        emails && `${emails} failed email${emails === 1 ? '' : 's'}`,
        payments && `${payments} payment problem${payments === 1 ? '' : 's'}`,
        signins && `${signins} failed sign-in${signins === 1 ? '' : 's'}`,
      ].filter(Boolean);
      if (!parts.length) return { state: 'ok', detail: 'None recorded.' };
      return { state: emails || payments ? 'warn' : 'ok', detail: `${parts.join(', ')}. See the Activity page for details.` };
    }),
  ]);
  return checks;
}

/** The worst state across checks ("off" counts as fine). */
export function overall(checks: Check[]): CheckState {
  if (checks.some((c) => c.state === 'fail')) return 'fail';
  if (checks.some((c) => c.state === 'warn')) return 'warn';
  return 'ok';
}
