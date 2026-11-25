/**
 * Stripe webhook. In the Stripe dashboard, point an endpoint at
 * https://<your domain>/api/stripe/webhook with these events:
 *   checkout.session.completed
 *   checkout.session.async_payment_succeeded
 *   checkout.session.async_payment_failed
 * and store its signing secret as STRIPE_WEBHOOK_SECRET.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { applyCheckoutSession, verifyStripeSignature, type CheckoutSession } from '../../../lib/stripe';
import { inBackground } from '../../../lib/email';
import { notifyPaymentReceived } from '../../../lib/notify';

export const POST: APIRoute = async ({ request, locals, url }) => {
  const raw = await request.text();
  const valid = await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET ?? '');
  if (!valid) return new Response('Invalid signature', { status: 400 });

  const event = JSON.parse(raw) as { type: string; data: { object: CheckoutSession } };
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const result = await applyCheckoutSession(event.data.object);
      if (result?.newlyPaid) await inBackground(locals, notifyPaymentReceived(result.invoice, url.origin));
      break;
    }
    case 'checkout.session.async_payment_failed':
      // Bank payments can fail days later; the invoice simply stays due.
      console.warn(`Stripe async payment failed for session ${event.data.object.id}`);
      break;
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'content-type': 'application/json' } });
};
