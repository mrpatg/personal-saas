/**
 * Starts the built site on a throwaway local database for the regression
 * tests (see playwright.config.ts). Every run starts from an empty database
 * with all migrations applied, so tests never touch your dev or live data.
 */
import { execSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const STATE = '.wrangler/test-state';
const PORT = process.env.TEST_PORT ?? '8788';

rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply DB --local --persist-to ${STATE}`, { stdio: 'inherit' });

const vars = {
  BETTER_AUTH_SECRET: 'test-only-secret-not-used-anywhere-else-0123456789',
  // Tests sign their own webhook events with this; email and Stripe API calls stay off.
  STRIPE_WEBHOOK_SECRET: 'whsec_regression_tests',
  RESEND_API_KEY: '',
  STRIPE_SECRET_KEY: '',
};
const args = ['wrangler', 'dev', '--port', PORT, '--persist-to', STATE, '--log-level', 'warn'];
for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);

const child = spawn('npx', args, { stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
