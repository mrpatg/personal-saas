/**
 * Notification emails for portal activity. Each function looks up what it
 * needs, sends one email and never throws, so a mail problem can't break
 * the page that triggered it.
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { site } from '../config/site';
import { ROLES } from './auth';
import { renderEmail, sendEmail } from './email';
import { formatDate } from './projects';
import { formatMoney } from './work';
import { invoiceNumber, type Invoice } from './invoices';

const firstName = (name: string) => name.split(' ')[0];
const excerpt = (s: string, max = 1200) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** Tells the client a new invoice is ready. `origin` is the site's base URL. */
export async function notifyInvoiceSent(inv: Invoice, origin: string) {
  try {
    const db = getDb();
    const sent = (await db.select().from(schema.invoice).where(eq(schema.invoice.id, inv.id)).get()) ?? inv;
    const client = await db.select().from(schema.user).where(eq(schema.user.id, sent.clientId)).get();
    if (!client || client.banned) return;
    const amount = formatMoney(sent.totalCents);
    const { html, text } = renderEmail({
      preview: `${invoiceNumber(sent)} for ${amount}, due ${formatDate(sent.dueDate)}`,
      heading: `New invoice: ${amount}`,
      paragraphs: [
        `Hi ${firstName(client.name)}, ${site.owner} has sent you invoice ${invoiceNumber(sent)}${sent.title ? ` (${sent.title})` : ''}.`,
        `Amount: ${amount}\nDue: ${formatDate(sent.dueDate)}`,
      ],
      button: { label: 'View invoice', url: `${origin}/app/invoices/${sent.id}` },
      footnote: 'You can print or save it as a PDF from that page. Reply to this email with any questions.',
    });
    await sendEmail({ to: client.email, subject: `Invoice ${invoiceNumber(sent)} from ${site.owner}: ${amount}`, html, text });
  } catch (err) {
    console.error('notifyInvoiceSent failed', err);
  }
}

/**
 * A new comment on a task: the admin's comments go to the project's client,
 * and the client's comments go to the admin notice address.
 */
export async function notifyTaskComment(taskId: string, authorId: string, body: string, origin: string) {
  try {
    const db = getDb();
    const row = await db
      .select({ task: schema.task, project: schema.project })
      .from(schema.task)
      .innerJoin(schema.project, eq(schema.task.projectId, schema.project.id))
      .where(eq(schema.task.id, taskId))
      .get();
    const author = await db.select().from(schema.user).where(eq(schema.user.id, authorId)).get();
    if (!row || !author) return;
    const { task, project } = row;

    if (author.role === ROLES.admin) {
      const client = await db.select().from(schema.user).where(eq(schema.user.id, project.clientId)).get();
      if (!client || client.banned || project.status === 'archived') return;
      const { html, text } = renderEmail({
        preview: `${author.name} commented on "${task.title}"`,
        heading: `New comment on “${task.title}”`,
        paragraphs: [`Hi ${firstName(client.name)}, there's a new comment on a task in ${project.name}.`],
        quote: { author: author.name, body: excerpt(body) },
        button: { label: 'View and reply', url: `${origin}/app/tasks/${task.id}#comments` },
      });
      await sendEmail({ to: client.email, subject: `${project.name}: new comment on “${task.title}”`, html, text });
    } else {
      if (!site.email.adminNotify) return;
      const { html, text } = renderEmail({
        preview: `${author.name} commented on "${task.title}"`,
        heading: `${author.name} commented`,
        paragraphs: [`On “${task.title}” in ${project.name}${author.company ? ` (${author.company})` : ''}.`],
        quote: { author: author.name, body: excerpt(body) },
        button: { label: 'Open the task', url: `${origin}/admin/tasks/${task.id}#comments` },
      });
      // Replying from the inbox goes to the client directly.
      await sendEmail({ to: site.email.adminNotify, replyTo: author.email, subject: `${author.name} commented on “${task.title}”`, html, text });
    }
  } catch (err) {
    console.error('notifyTaskComment failed', err);
  }
}

/** After an online payment: a thank-you receipt to the client and a heads-up to the admin. */
export async function notifyPaymentReceived(inv: Invoice, origin: string) {
  try {
    const client = await getDb().select().from(schema.user).where(eq(schema.user.id, inv.clientId)).get();
    const amount = formatMoney(inv.totalCents);
    if (client) {
      const { html, text } = renderEmail({
        preview: `We received ${amount} for ${invoiceNumber(inv)}`,
        heading: 'Payment received, thank you',
        paragraphs: [
          `Hi ${firstName(client.name)}, we received your payment of ${amount} for invoice ${invoiceNumber(inv)}${inv.title ? ` (${inv.title})` : ''}.`,
        ],
        button: { label: 'View paid invoice', url: `${origin}/app/invoices/${inv.id}` },
        footnote: 'You can print or save the paid invoice as a PDF from that page.',
      });
      await sendEmail({ to: client.email, subject: `Payment received for ${invoiceNumber(inv)}`, html, text });
    }
    if (site.email.adminNotify) {
      const who = client ? `${client.name}${client.company ? ` (${client.company})` : ''}` : 'A client';
      const { html, text } = renderEmail({
        preview: `${who} paid ${amount}`,
        heading: `${amount} received`,
        paragraphs: [`${who} paid invoice ${invoiceNumber(inv)} online. It's been marked as paid.`],
        button: { label: 'Open the invoice', url: `${origin}/admin/invoices/${inv.id}` },
      });
      await sendEmail({ to: site.email.adminNotify, subject: `Paid: ${invoiceNumber(inv)} (${amount})`, html, text });
    }
  } catch (err) {
    console.error('notifyPaymentReceived failed', err);
  }
}
