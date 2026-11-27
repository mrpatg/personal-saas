/**
 * End-to-end regression tests for the portal. They run in order on an empty
 * database: set up the admin, add clients, run a project, bill it, get paid.
 * If a change breaks any of these features, `npm test` (and the PR check) fails.
 */
import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CLIENT, OTHER, alert, expectNoSidewaysScroll, notice, signIn, sql, stripeSignature } from './helpers';

test.describe.configure({ mode: 'serial' });

let admin: Page;
let client: Page;
const ids: Record<string, string> = {};

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext()).newPage();
  client = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
});

test.afterAll(async () => {
  await admin.context().close();
  await client.context().close();
});

/* ---------- Basics ---------- */

test('health check reports the database and migrations are fine', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok', db: 'ok', migrated: true });
});

test('a fresh site sends visitors to first-time setup', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/setup$/);
});

test('setup creates the admin account and signs in', async () => {
  await admin.goto('/setup');
  await admin.fill('input[name=name]', ADMIN.name);
  await admin.fill('input[name=email]', ADMIN.email);
  await admin.fill('input[name=password]', ADMIN.password);
  await admin.fill('input[name=confirm]', ADMIN.password);
  await admin.click('button[type=submit]');
  await expect(admin).toHaveURL(/\/admin$/);
  await expect(admin.locator('h1')).toContainText('Hello');
});

test('setup is locked once an admin exists', async ({ page }) => {
  await page.goto('/setup');
  await expect(page).not.toHaveURL(/\/setup$/);
});

test('signed-out visitors are sent to sign in from protected pages', async ({ page, request }) => {
  for (const path of ['/admin', '/admin/clients', '/app', '/app/invoices']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login/);
  }
  const media = await request.get('/media/does-not-exist');
  expect(media.status()).toBe(404);
});

test('a wrong password is rejected and logged', async ({ page }) => {
  await signIn(page, { email: ADMIN.email, password: 'wrong-password-1' });
  await expect(alert(page)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

/* ---------- Clients ---------- */

async function createClient(who: { name: string; email: string; password: string; company?: string }) {
  await admin.goto('/admin/clients?add=1');
  const dialog = admin.locator('#add-client');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name=name]').fill(who.name);
  if (who.company) await dialog.locator('input[name=company]').fill(who.company);
  await dialog.locator('input[name=email]').fill(who.email);
  await dialog.locator('input[name=password]').fill(who.password);
  await dialog.locator('button:has-text("Create client account")').click();
  await admin.waitForLoadState();
  await expect(admin.locator('main')).toContainText(`${who.name} can now sign in`);
}

test('admin adds clients from the Add client pop-up', async () => {
  await createClient(CLIENT);
  await createClient(OTHER);
  ids.client = sql<{ id: string }>(`select id from user where email='${CLIENT.email}'`)[0].id;
  ids.other = sql<{ id: string }>(`select id from user where email='${OTHER.email}'`)[0].id;
});

test('a duplicate email keeps the pop-up open with an error', async () => {
  await admin.goto('/admin/clients?add=1');
  const dialog = admin.locator('#add-client');
  await dialog.locator('input[name=name]').fill('Duplicate');
  await dialog.locator('input[name=email]').fill(CLIENT.email);
  await dialog.locator('input[name=password]').fill('duplicate-pass-1');
  await dialog.locator('button:has-text("Create client account")').click();
  await expect(admin.locator('#add-client [role=alert]')).toBeVisible();
  await expect(admin.locator('#add-client input[name=name]')).toHaveValue('Duplicate');
});

test('admin edits a client and the change is logged', async () => {
  await admin.goto(`/admin/clients?edit=${ids.client}`);
  const dialog = admin.locator('#edit-client');
  await expect(dialog.locator('input[name=email]')).toHaveValue(CLIENT.email);
  await dialog.locator('input[name=company]').fill('Casey & Co');
  await dialog.locator('button:has-text("Save changes")').click();
  await expect(notice(admin)).toContainText('Saved changes');
  await admin.goto('/admin/activity?kind=client');
  await expect(admin.locator('main')).toContainText('company “Casey Co” → “Casey & Co”');
});

test('editing a client to an email already in use is refused', async () => {
  await admin.goto(`/admin/clients?edit=${ids.client}`);
  await admin.locator('#edit-client input[name=email]').fill(OTHER.email);
  await admin.locator('#edit-client button:has-text("Save changes")').click();
  await expect(admin.locator('#edit-client [role=alert]')).toContainText('already uses that email');
});

test('clients sign in to their own area and cannot open the admin area', async () => {
  await signIn(client, CLIENT);
  await expect(client).toHaveURL(/\/app$/);
  await client.goto('/admin');
  await expect(client).toHaveURL(/\/app$/);
});

/* ---------- Projects, tasks, comments ---------- */

test('admin creates a project with a rate and tasks', async () => {
  await admin.goto(`/admin/projects?client=${ids.client}`);
  await admin.selectOption('select[name=clientId]', ids.client);
  await admin.fill('input[name=name]', 'Website rebuild');
  await admin.locator('form:has(select[name=clientId]) button[type=submit]').click();
  await expect(admin).toHaveURL(/\/admin\/projects\/[^/?]+/);
  ids.project = new URL(admin.url()).pathname.split('/').pop()!;

  await admin.fill('#details input[name=hourlyRate]', '100');
  await admin.locator('#details button[type=submit]').first().click();
  await admin.waitForLoadState();

  for (const title of ['Design homepage', 'Build contact form']) {
    const form = admin.locator('form:has(input[name=intent][value=add-task])');
    await form.locator('input[name=title]').fill(title);
    await form.locator('button[type=submit]').click();
    await admin.waitForLoadState();
  }
  const tasks = sql<{ id: string; title: string }>(`select id, title from task where project_id='${ids.project}' order by position`);
  expect(tasks.map((t) => t.title)).toEqual(['Design homepage', 'Build contact form']);
  ids.task = tasks[0].id;
});

test('the client sees their project read-only; other clients get 404', async ({ browser }) => {
  await client.goto('/app/projects');
  await expect(client.locator('main')).toContainText('Website rebuild');
  await client.goto(`/app/projects/${ids.project}`);
  await expect(client.locator('main')).toContainText('Design homepage');
  await expect(client.locator('main form:has(input[value=add-task])')).toHaveCount(0);

  const other = await (await browser.newContext()).newPage();
  await signIn(other, OTHER);
  const res = await other.goto(`/app/projects/${ids.project}`);
  expect(res?.status()).toBe(404);
  const taskRes = await other.goto(`/app/tasks/${ids.task}`);
  expect(taskRes?.status()).toBe(404);
  await other.context().close();
});

test('admin and client can comment on a task', async () => {
  await admin.goto(`/admin/tasks/${ids.task}`);
  await admin.fill('#comments textarea', 'Which colours do you prefer?');
  await admin.click('#comments button:has-text("Post comment")');
  await admin.waitForLoadState();

  await client.goto(`/app/tasks/${ids.task}`);
  await expect(client.locator('#comments')).toContainText('Which colours do you prefer?');
  await client.fill('#comments textarea', 'Greens, please.');
  await client.click('#comments button:has-text("Post comment")');
  await client.waitForLoadState();
  await expect(client.locator('#comments')).toContainText('Greens, please.');
});

test('task status changes show for the client', async () => {
  await admin.goto(`/admin/projects/${ids.project}`);
  await Promise.all([admin.waitForURL(/#task-/), admin.selectOption(`#status-${ids.task}`, 'done')]);
  await client.goto(`/app/projects/${ids.project}`);
  await expect(client.locator('main')).toContainText('1 of 2 tasks done');
});

/* ---------- Time, invoices, payments ---------- */

test('admin logs time and a cost on a task', async () => {
  await admin.goto(`/admin/tasks/${ids.task}`);
  const time = admin.locator('form:has(input[name=intent][value=add-time])');
  await time.locator('input[name=hours]').fill('1:30');
  await time.locator('button[type=submit]').click();
  await admin.waitForLoadState();
  await admin.locator('summary:has-text("Add a cost")').click();
  const cost = admin.locator('form:has(input[name=intent][value=add-cost])');
  await cost.locator('input[name=amount]').fill('20');
  await cost.locator('input[name=description]').fill('Stock photo');
  await cost.locator('button[type=submit]').click();
  await admin.waitForLoadState();
  const entries = sql<{ amount_cents: number }>(`select amount_cents from work_entry where task_id='${ids.task}' order by amount_cents`);
  expect(entries.map((e) => e.amount_cents)).toEqual([2000, 15000]); // $20 cost, 1.5 h x $100
});

test('a draft invoice pulls in unbilled work and is hidden from the client', async () => {
  await admin.goto(`/admin/invoices?project=${ids.project}`);
  await admin.selectOption('select[name=projectId]', ids.project);
  await admin.locator('form:has(select[name=projectId]) button[type=submit]').click();
  await expect(admin).toHaveURL(/\/admin\/invoices\/[^/?]+\?created=2/);
  ids.invoice = new URL(admin.url()).pathname.split('/').pop()!;
  const inv = sql<{ total_cents: number; status: string }>(`select total_cents, status from invoice where id='${ids.invoice}'`)[0];
  expect(inv).toEqual({ total_cents: 17000, status: 'draft' });

  const res = await client.goto(`/app/invoices/${ids.invoice}`);
  expect(res?.status()).toBe(404);
});

test('work on an invoice is never billed twice', async () => {
  const unbilled = sql<{ n: number }>(`select count(*) n from work_entry where task_id='${ids.task}' and invoice_id is null`)[0].n;
  expect(unbilled).toBe(0);
  await admin.goto(`/admin/tasks/${ids.task}`);
  await expect(admin.locator('main')).toContainText('On draft invoice');
});

test('sending numbers the invoice and the client can see it', async () => {
  await admin.goto(`/admin/invoices/${ids.invoice}`);
  await admin.click('button:has-text("Send to client")');
  await expect(notice(admin)).toContainText('Invoice sent');
  const inv = sql<{ number: number; status: string }>(`select number, status from invoice where id='${ids.invoice}'`)[0];
  expect(inv).toEqual({ number: 1001, status: 'sent' });
  await expect(admin.locator('input[readonly]')).toHaveValue(new RegExp(`/app/invoices/${ids.invoice}$`));

  await client.goto('/app/invoices');
  await expect(client.locator('main')).toContainText('INV-1001');
  await client.goto(`/app/invoices/${ids.invoice}`);
  await expect(client.locator('main')).toContainText('$170.00');
});

test('the invoice history records each step, including the client viewing it', async () => {
  await admin.goto(`/admin/invoices/${ids.invoice}`);
  const history = admin.locator('#history');
  await expect(history).toContainText('Created a draft invoice');
  await expect(history).toContainText('Sent INV-1001 ($170.00)');
  await expect(history).toContainText('Viewed INV-1001');
});

test('Stripe webhook rejects bad signatures and marks the invoice paid once', async ({ request }) => {
  const body = JSON.stringify({
    id: 'evt_test',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test', status: 'complete', payment_status: 'paid', amount_total: 17000, currency: 'usd', payment_intent: 'pi_test', metadata: { invoice_id: ids.invoice } } },
  });
  const post = (signature: string) => request.post('/api/stripe/webhook', { data: body, headers: { 'content-type': 'application/json', 'stripe-signature': signature } });

  expect((await post(stripeSignature(body, 'whsec_wrong'))).status()).toBe(400);
  expect((await post(stripeSignature(body, undefined, Math.floor(Date.now() / 1000) - 3600))).status()).toBe(400);
  expect((await post(stripeSignature(body))).status()).toBe(200);
  expect((await post(stripeSignature(body))).status()).toBe(200); // retries are harmless

  const inv = sql<{ status: string; paid_via: string }>(`select status, paid_via from invoice where id='${ids.invoice}'`)[0];
  expect(inv).toEqual({ status: 'paid', paid_via: 'stripe' });
  const paidLogs = sql<{ n: number }>(`select count(*) n from activity_log where action='invoice.paid' and subject_id='${ids.invoice}'`)[0].n;
  expect(paidLogs).toBe(1);
});

test('voiding an invoice releases its work for a new invoice', async () => {
  // Undo the payment, then void.
  await admin.goto(`/admin/invoices/${ids.invoice}`);
  await admin.click('button:has-text("Undo: mark as unpaid")');
  await admin.waitForLoadState();
  await admin.locator('summary:has-text("Void this invoice")').click();
  await admin.check('input[name=confirm]');
  await admin.click('button:has-text("Void invoice")');
  await expect(notice(admin)).toContainText('voided');
  const unbilled = sql<{ n: number }>(`select count(*) n from work_entry where task_id='${ids.task}' and invoice_id is null`)[0].n;
  expect(unbilled).toBe(2);
});

test('marking a sent invoice paid by hand works', async () => {
  await admin.goto(`/admin/invoices?project=${ids.project}`);
  await admin.selectOption('select[name=projectId]', ids.project);
  await admin.locator('form:has(select[name=projectId]) button[type=submit]').click();
  await admin.waitForURL(/created=/);
  await admin.click('button:has-text("Send to client")');
  await admin.waitForLoadState();
  await admin.click('button:has-text("Mark as paid")');
  await expect(notice(admin)).toContainText('Marked as paid');
  const latest = sql<{ number: number; status: string; paid_via: string }>(`select number, status, paid_via from invoice order by created_at desc limit 1`)[0];
  expect(latest).toEqual({ number: 1002, status: 'paid', paid_via: 'manual' });
});

test('the invoices screen totals what was invoiced and collected', async () => {
  await admin.goto('/admin/invoices?period=today');
  const main = admin.locator('main');
  // INV-1001 was voided, so only INV-1002 ($170, marked paid today) counts.
  await expect(main.locator('p:text-is("Collected") + p')).toHaveText('$170.00');
  await expect(main.locator('p:text-is("Invoiced") + p')).toHaveText('$170.00');
  await expect(main.locator('#payments-title + *')).toContainText(CLIENT.name);
  await expect(main.locator('#payments-title + *')).toContainText('+$170.00');
});

/* ---------- Activity log, status, layout ---------- */

test('the activity log lists actions with filters', async () => {
  await admin.goto('/admin/activity');
  const main = admin.locator('main');
  for (const text of ['Created project “Website rebuild”', 'Logged 1.5 h', 'Commented on “Design homepage”', 'paid online', 'Signed in', 'Failed sign-in attempt']) {
    await expect(main, text).toContainText(text);
  }
  await admin.goto('/admin/activity?kind=invoice');
  await expect(main).not.toContainText('Signed in');
});

test('the admin Status page shows the core checks passing', async () => {
  await admin.goto('/admin/status');
  const main = admin.locator('main');
  await expect(main.locator('[data-check="database"]')).toHaveAttribute('data-state', 'ok');
  await expect(main.locator('[data-check="migrations"]')).toHaveAttribute('data-state', 'ok');
  await expect(main.locator('[data-check="auth"]')).toHaveAttribute('data-state', 'ok');
  const json = await admin.request.get('/admin/status.json');
  expect(json.status()).toBe(200);
  expect((await json.json()).checks.length).toBeGreaterThan(3);
});

test('main screens fit a 375px phone without sideways scrolling', async () => {
  for (const path of ['/app', '/app/projects', `/app/projects/${ids.project}`, `/app/tasks/${ids.task}`, '/app/invoices', `/app/invoices/${ids.invoice}`]) {
    await client.goto(path);
    await expectNoSidewaysScroll(client);
  }
  await admin.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/admin', '/admin/clients', '/admin/projects', `/admin/projects/${ids.project}`, `/admin/tasks/${ids.task}`, '/admin/invoices', `/admin/invoices/${ids.invoice}`, '/admin/activity', '/admin/status']) {
    await admin.goto(path);
    await expectNoSidewaysScroll(admin);
  }
});
