/**
 * Outgoing email through Resend (https://resend.com), plus the branded
 * template every message uses. Without a RESEND_API_KEY secret, emails are
 * logged and skipped so local development and fresh deploys keep working.
 */
import { env } from 'cloudflare:workers';
import { site } from '../config/site';

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Blind copies (e.g. the admin's own copy of an invoice email). */
  bcc?: string | string[];
}

export type EmailResult = { ok: true; id?: string } | { ok: false; skipped?: boolean; error: string };

/** True when a Resend API key is configured. */
export function emailEnabled(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/** Sends one email. Never throws: failures are logged and returned. */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email skipped: no RESEND_API_KEY] to=${String(msg.to)} subject="${msg.subject}"`);
    return { ok: false, skipped: true, error: 'Email is not set up (RESEND_API_KEY is missing).' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: site.email.from,
        to: Array.isArray(msg.to) ? msg.to : [msg.to],
        reply_to: msg.replyTo ?? site.email.replyTo,
        ...(msg.bcc ? { bcc: Array.isArray(msg.bcc) ? msg.bcc : [msg.bcc] } : {}),
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      console.error(`Resend error ${res.status}: ${body.message ?? 'unknown'}`);
      return { ok: false, error: body.message ?? `Resend returned ${res.status}` };
    }
    return { ok: true, id: body.id };
  } catch (err) {
    console.error('Email send failed', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Email send failed' };
  }
}

/* ---------- Template ---------- */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface TemplateInput {
  /** Short line shown in inbox previews. */
  preview: string;
  heading: string;
  /** Plain-text paragraphs (escaped and wrapped for HTML). */
  paragraphs: string[];
  /** Optional quoted block, e.g. a comment. */
  quote?: { author: string; body: string };
  button?: { label: string; url: string };
  /** Small print under the button. */
  footnote?: string;
}

/** Builds matching HTML and plain-text bodies in the site's colors. */
export function renderEmail(t: TemplateInput): { html: string; text: string } {
  const c = site.colors;
  const p = (s: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${c.ink}">${escapeHtml(s).replace(/\n/g, '<br>')}</p>`;
  const quote = t.quote
    ? `<div style="margin:0 0 20px;padding:14px 16px;border-left:3px solid ${c.primary};background:${c.canvas};border-radius:8px">
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280">${escapeHtml(t.quote.author)} wrote:</p>
        <p style="margin:0;font-size:15px;line-height:1.6;color:${c.ink}">${escapeHtml(t.quote.body).replace(/\n/g, '<br>')}</p>
      </div>`
    : '';
  const button = t.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(t.button.url)}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:${c.primary};color:${c.primaryForeground};font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(t.button.label)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${c.canvas};font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(t.preview)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.canvas};padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 16px"><span style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;border-radius:10px;background:${c.primary};color:${c.primaryForeground};font-family:Georgia,serif;font-size:16px">${escapeHtml(site.monogram)}</span>
<span style="margin-left:8px;font-size:14px;font-weight:600;color:${c.ink}">${escapeHtml(site.name)}</span></td></tr>
<tr><td style="background:#ffffff;border-radius:20px;padding:32px 28px;border:1px solid rgba(0,0,0,0.06)">
<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:26px;line-height:1.25;color:${c.ink}">${escapeHtml(t.heading)}</h1>
${t.paragraphs.map(p).join('\n')}
${quote}
${button}
${t.footnote ? `<p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(t.footnote)}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 4px;font-size:12px;color:#6b7280">${escapeHtml(site.owner)} · ${escapeHtml(site.email.replyTo)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    t.heading,
    '',
    ...t.paragraphs.flatMap((s) => [s, '']),
    ...(t.quote ? [`${t.quote.author} wrote:`, t.quote.body, ''] : []),
    ...(t.button ? [`${t.button.label}: ${t.button.url}`, ''] : []),
    ...(t.footnote ? [t.footnote, ''] : []),
    `${site.owner} · ${site.email.replyTo}`,
  ].join('\n');
  return { html, text };
}

/**
 * Runs a notification after the response is sent when the Worker allows it
 * (Cloudflare's waitUntil), so pages don't wait on the email API.
 */
export async function inBackground(locals: unknown, task: Promise<unknown>) {
  const ctx = (locals as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } }).cfContext;
  if (ctx?.waitUntil) ctx.waitUntil(task);
  else await task;
}
