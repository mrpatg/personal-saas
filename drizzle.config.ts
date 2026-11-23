import { defineConfig } from 'drizzle-kit';

// drizzle-kit only generates SQL migration files from src/db/schema.ts.
// Wrangler applies them to D1 (see `npm run db:migrate:local` / `db:migrate:remote`).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
