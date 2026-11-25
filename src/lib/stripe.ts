/**
 * Online invoice payments with Stripe Checkout, using Stripe's REST API
 * directly (no SDK needed on Workers).
 *
 * Flow: the client presses "Pay now" -> we create a Checkout Session for the
 * invoice total -> Stripe hosts the payment page -> Stripe calls our webhook
 * (/api/stripe/webhook) and we mark the invoice paid. The return page also
 * checks the session, so the invoice shows as paid even if the webhook is late.
 */
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { site } from '../config/site';
import { invoiceName, invoiceNumber, todayISO, type Invoice } from './invoices';
import { logActivity } from './activity';
import { formatMoney } from './work';

const API = 'https://api.stripe.com/v1';

/** An error whose message is safe to show the client. */
export class PaymentError extends Error {}

/** True when a Stripe secret key is configured. */
export function stripeEnabled(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/** Test-mode keys start with sk_test_ (or rk_test_ for restricted keys). */
export function stripeTestMode(): boolean {
  return /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? '');
}

/** Link to a payment in the Stripe dashboard. */
export function stripePaymentUrl(paymentIntentId: string): string {
  return `https://dashboard.stripe.com/${stripeTestMode() ? 'test/' : ''}payments/${paymentIntentId}`;
}

/** Flattens nested params into Stripe's form encoding (a[b][0][c]=…). */
function encode(params: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((v, i) => (typeof v === 'object' ? encode(v as Record<string, unknown>, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(v))));
    else if (typeof value === 'object') encode(value as Record<string, unknown>, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function stripe<T>(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' && params ? encode(params).toString() : undefined,
  });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${body.error?.message ?? res.status}`);
  return body;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | null;
  metadata: Record<string, string> | null;
}

/**
 * Returns a Stripe Checkout URL for a sent invoice. Reuses the invoice's
 * open session if there is one, so a client can't start two payments.
 */
export async function checkoutUrlFor(inv: Invoice, clientEmail: string, origin: string): Promise<string> {
  if (inv.status !== 'sent') throw new PaymentError('This invoice isn’t awaiting payment.');
  if (inv.stripeCheckoutSessionId) {
    const existing = await stripe<CheckoutSession>('GET', `/checkout/sessions/${inv.stripeCheckoutSessionId}`);
    if (existing.status === 'complete') {
      await applyCheckoutSession(existing);
      throw new PaymentError('This invoice has already been paid.');
    }
    if (existing.status === 'open' && existing.url && existing.amount_total === inv.totalCents) return existing.url;
  }
  const label = `Invoice ${invoiceNumber(inv)}`;
  const session = await stripe<CheckoutSession>('POST', '/checkout/sessions', {
    mode: 'payment',
    client_reference_id: inv.id,
    customer_email: clientEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: site.currency.toLowerCase(),
          unit_amount: inv.totalCents,
          product_data: { name: label, description: inv.title && inv.title !== label ? inv.title : undefined },
        },
      },
    ],
    metadata: { invoice_id: inv.id },
    payment_intent_data: { description: `${site.owner}: ${invoiceName(inv)}`, metadata: { invoice_id: inv.id } },
    success_url: `${origin}/app/invoices/${inv.id}?checkout=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/invoices/${inv.id}?checkout=cancelled`,
  });
  await getDb().update(schema.invoice).set({ stripeCheckoutSessionId: session.id }).where(eq(schema.invoice.id, inv.id)).run();
  if (!session.url) throw new Error('Stripe did not return a payment page.');
  return session.url;
}

export function getCheckoutSession(id: string) {
  return stripe<CheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
}

/** Closes an unfinished Checkout session (e.g. when an invoice is voided or paid by hand). Best effort. */
export async function expireCheckout(inv: Invoice) {
  if (!stripeEnabled() || !inv.stripeCheckoutSessionId) return;
  try {
    const s = await getCheckoutSession(inv.stripeCheckoutSessionId);
    if (s.status === 'open') await stripe('POST', `/checkout/sessions/${s.id}/expire`);
  } catch (err) {
    console.error('Could not expire Stripe checkout session', err);
  }
}

const STRIPE = { system: 'Stripe' };

export type ApplyResult = { invoice: Invoice; newlyPaid: boolean } | null;

/**
 * Marks the invoice behind a completed, paid Checkout session as paid.
 * Safe to call repeatedly (webhook retries, the return page): only the first
 * call changes anything. Returns null when the session isn't a paid invoice.
 */
export async function applyCheckoutSession(session: CheckoutSession): Promise<ApplyResult> {
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId || session.payment_status !== 'paid') return null;
  const db = getDb();
  const inv = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId)).get();
  if (!inv) return null;
  if (inv.status === 'paid') return { invoice: inv, newlyPaid: false };
  if (session.amount_total !== inv.totalCents || (session.currency ?? '').toLowerCase() !== site.currency.toLowerCase()) {
    console.error(`Stripe amount mismatch for invoice ${inv.id}: paid ${session.amount_total} ${session.currency}, invoice ${inv.totalCents}`);
  }
  const changes = {
    status: 'paid' as const,
    paidDate: todayISO(),
    paidVia: 'stripe',
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: session.payment_intent,
  };
  // Only a sent invoice flips to paid; the status guard makes concurrent calls safe.
  const result = await db
    .update(schema.invoice)
    .set(changes)
    .where(and(eq(schema.invoice.id, inv.id), eq(schema.invoice.status, 'sent')))
    .returning()
    .all();
  if (result.length === 0) {
    // Paid while void (or otherwise not payable): keep the payment reference for the admin.
    console.error(`Stripe payment for invoice ${inv.id} in status ${inv.status}`);
    await db.update(schema.invoice).set({ stripePaymentIntentId: session.payment_intent }).where(eq(schema.invoice.id, inv.id)).run();
    await logActivity(STRIPE, {
      action: 'invoice.paid_while_void',
      summary: `Stripe payment of ${formatMoney(session.amount_total ?? 0)} arrived for ${invoiceNumber(inv)}, which is ${inv.status}. Review or refund it in Stripe.`,
      subjectType: 'invoice',
      subjectId: inv.id,
      clientId: inv.clientId,
    });
    return { invoice: inv, newlyPaid: false };
  }
  await logActivity(STRIPE, {
    action: 'invoice.paid',
    summary: `${invoiceNumber(inv)} paid online (${formatMoney(session.amount_total ?? inv.totalCents)})`,
    subjectType: 'invoice',
    subjectId: inv.id,
    clientId: inv.clientId,
  });
  return { invoice: result[0], newlyPaid: true };
}

/* ---------- Webhook signatures ---------- */

const TOLERANCE_SECONDS = 5 * 60;

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checks a Stripe-Signature header against the raw request body. */
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const timestamp = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
  return signatures.some((s) => timingSafeEqual(s, expected));
}
