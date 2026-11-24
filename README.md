# Client Portal (personal-saas)

A client portal for a consulting business: clients log in to see projects,
tasks and invoices, and pay online. Built to be reused for other SaaS sites:
all branding lives in [`src/config/site.ts`](src/config/site.ts).

**Stack:** Astro (SSR) · Cloudflare Workers · D1 + Drizzle ORM · TypeScript · Tailwind CSS

## Prerequisites

- Node.js 22.23.4 or newer (24 recommended; pinned in `.node-version`)
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up) (only needed to deploy)

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars     # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
npm run db:migrate:local           # creates the local D1 database
npm run dev                        # http://localhost:4321
```

Check http://localhost:4321/health. It should return
`{"status":"ok","db":"ok","migrated":true}`.

Local development uses a simulated D1 database stored in `.wrangler/`, so no
Cloudflare login is needed.

Open http://localhost:4321/login. With no accounts yet it sends you to
`/setup`, a one-time page that creates the admin account. After that, add
clients from **Admin → Clients**.

## First deploy (one time)

```bash
npx wrangler login                             # opens a browser to sign in to Cloudflare
npx wrangler d1 create personal-saas-db        # prints a database_id
```

Paste the printed `database_id` into `wrangler.jsonc` (replacing the zeros), then:

```bash
npm run db:migrate:remote                      # create tables in the real database
npx wrangler secret put BETTER_AUTH_SECRET     # paste the output of: openssl rand -base64 32
npm run deploy                                 # build and upload; prints your live URL
```

Then open `/setup` on the live site to create the admin account. If the site
uses a custom domain, add it to `AUTH_HOSTS` in `wrangler.jsonc`.

Visit `https://<your-worker>.<your-subdomain>.workers.dev/health` to confirm.

## Day-to-day

| Task | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Type check | `npm run check` |
| Change the database | edit `src/db/schema.ts`, then `npm run db:generate` |
| Apply migrations | `npm run db:migrate:local` / `npm run db:migrate:remote` |
| Deploy | `npm run deploy` |

## Reusing for a new site

1. Edit `src/config/site.ts` (name, tagline, email, colors, nav).
2. In `wrangler.jsonc`, change `name` and `database_name`, and create a new D1 database.
   Set `BETTER_AUTH_SECRET` for the new Worker and visit `/setup` to create its admin.
3. Update the `db:` scripts only if you rename the `DB` binding.

See [CLAUDE.md](CLAUDE.md) for conventions and the planned feature list.
