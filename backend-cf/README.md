# Websix Backend — Cloudflare Workers + D1

Serverless backend for the Websix agency, running on the **Cloudflare** edge. This is the **foundation** (core services + the Resend notification engine + security). The full enterprise spec (OAuth providers, Durable Objects real-time, Queues, Workflows, AI service, blog/media, monitoring, reporting) extends from this base in phases.

**Stack:** Cloudflare Workers · Hono (TypeScript) · D1 (SQLite) · KV · R2 · Cron · Turnstile · Resend (email) · Stripe (payments).

## Notifications (the priority)

`src/lib/notify.ts` → `notifyActivity(env, type, ctx)` runs on every event and:
1. writes an **activity** row (audit trail),
2. **emails the owner** (`OWNER_EMAIL`) on every event, and
3. **emails the client** on client-facing events (quote submitted, payment received, status change, invoice, launch…).

So a quote submission emails the client **and** you; a Stripe payment webhook does the same. New event types inherit this automatically.

## Endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | public | health check |
| POST | `/api/quotes` | public | wizard submission → project + unique ID + dual emails (Turnstile-protected if secret set) |
| POST | `/api/auth/register` | bootstrap | create first admin (then closed) |
| POST | `/api/auth/login` | public | returns JWT |
| GET | `/api/auth/me` | auth | current user |
| GET | `/api/admin/overview` | auth | dashboard metrics + recent activity |
| GET/POST | `/api/admin/leads` | auth | list / create leads |
| GET | `/api/admin/clients` `/projects` `/projects/:ref` `/quotes` `/invoices` `/activities` | auth | CRM reads |
| POST | `/api/admin/invoices` | auth | create invoice (emails client + owner) |
| GET | `/api/admin/search?q=` | auth | global search |
| POST | `/api/payments/checkout` | app | Stripe Checkout session |
| POST | `/api/webhooks/stripe` | Stripe | payment events → record + dual emails |

## Deploy

```bash
cd backend-cf
npm install
npx wrangler login                       # authorize your Cloudflare account

# 1) Database (D1)
npx wrangler d1 create websix-db          # copy the database_id into wrangler.toml
npx wrangler d1 migrations apply websix-db --remote

# 2) KV + R2
npx wrangler kv namespace create CACHE    # copy the id into wrangler.toml
npx wrangler r2 bucket create websix-media

# 3) Secrets (never committed)
npx wrangler secret put JWT_SECRET        # any long random string
npx wrangler secret put RESEND_API_KEY    # your Resend key
# optional:
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET

# 4) Deploy
npx wrangler deploy

# 5) Create your admin login (against the deployed API)
curl -X POST https://<your-worker-url>/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@websix.site","password":"a-strong-password","name":"Owner"}'
```

Point a route/custom domain (e.g. `api.websix.site`) at the Worker in the Cloudflare dashboard, then set the quote wizard's `FORM_ENDPOINT` to `https://api.websix.site/api/quotes`.

## Email sender

Resend requires a verified sender. `onboarding@resend.dev` works instantly for testing; after verifying **websix.site** in Resend, set `FROM_EMAIL="Websix <hello@websix.site>"` in `wrangler.toml`.

## OAuth sign-in (Google / GitHub / Microsoft)

A provider turns on automatically once its secrets are set. The callback URL for every provider is:

```
{API_BASE_URL}/api/auth/oauth/<provider>/callback
# e.g. https://api.websix.site/api/auth/oauth/google/callback
```

1. Set `API_BASE_URL` in `wrangler.toml` to your Worker's public URL.
2. Create the OAuth app and register that callback URL:
   - **Google** — Cloud Console → APIs & Services → Credentials → OAuth client (Web).
   - **GitHub** — Settings → Developer settings → OAuth Apps (Authorization callback URL).
   - **Microsoft** — Entra ID → App registrations → Redirect URI (Web).
3. Store the credentials as secrets: `wrangler secret put GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (and GITHUB_* / MICROSOFT_* as needed).

**Security model:** OAuth signs in an **existing** user by email only; the configured `OWNER_EMAIL` is auto-provisioned as `super_admin` on first login. Add other staff from the admin panel (or the register bootstrap). The admin UI's "Continue with…" buttons call `/api/auth/oauth/<provider>/start` and receive the JWT back at `/admin/#token=…`.

## Admin dashboard

A static SPA lives at `/admin/` (served with the site). It signs in against this API (password or OAuth), then shows overview metrics, leads, clients, projects, quotes, invoices, activity, and global search, with manual create actions. Set its **Backend API URL** field to your deployed Worker URL on first load.

## Roadmap (phased, per the platform plan)

Auth providers (Google/GitHub/Microsoft, magic links, 2FA) · Durable Objects (live chat, presence, real-time dashboards) · Queues (email, reports, backups) · Workflows · R2 media & backups · blog/SEO · hosting/domain/SSL/uptime monitoring · AI service · reporting · tests.
