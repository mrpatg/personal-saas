import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

/** Returns a Drizzle client bound to the D1 database (binding `DB` in wrangler.jsonc). */
export function getDb() {
  return drizzle(env.DB, { schema });
}

export { schema };
