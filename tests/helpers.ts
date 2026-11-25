import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export const ADMIN = { name: 'Test Admin', email: 'admin@test.local', password: 'admin-password-1' };
export const CLIENT = { name: 'Casey Client', company: 'Casey Co', email: 'casey@test.local', password: 'client-password-1' };
export const OTHER = { name: 'Olive Other', email: 'olive@test.local', password: 'other-password-1' };
export const WEBHOOK_SECRET = 'whsec_regression_tests';

/** Runs SQL against the test database and returns the rows. */
export function sql<T = Record<string, unknown>>(query: string): T[] {
  const out = execSync(`npx wrangler d1 execute DB --local --persist-to .wrangler/test-state --json --command ${JSON.stringify(query)}`, {
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString();
  return JSON.parse(out)[0].results as T[];
}

export async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.fill('input[name=email]', who.email);
  await page.fill('input[name=password]', who.password);
  await page.click('button[type=submit]');
  await page.waitForLoadState();
}

/** A Stripe-Signature header for a webhook body. */
export function stripeSignature(body: string, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** Fails if the page scrolls sideways (every screen must fit 375px). */
export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `page is ${overflow}px wider than the screen`).toBeLessThanOrEqual(0);
}

/** Text of the green notice (role=status) on the page. */
export const notice = (page: Page) => page.locator('main [role=status]').first();
export const alert = (page: Page) => page.locator('[role=alert]').first();
