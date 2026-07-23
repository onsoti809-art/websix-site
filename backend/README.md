# Websix Backend

The API behind the Websix agency site: quote submissions, projects, payments, and — the priority — **email notifications to both the client and the owner on every activity**.

Stack: **Node.js + Express + Prisma (PostgreSQL) + Nodemailer + Stripe**.

## How notifications work (the important part)

Every meaningful event calls `notifyActivity(type, ctx)` (`src/notify.js`), which:
1. Writes an **Activity** row (full audit trail).
2. **Emails the owner** (`OWNER_EMAIL`) on **every** activity.
3. **Emails the client** on client-facing events (quote submitted, payment received, status change, message, launch…) when we have their address.

So when a visitor submits a quote → the client gets a confirmation **and** you get a notification. When a payment succeeds (Stripe webhook) → both are emailed again. New event types inherit the same behavior automatically.

## Endpoints

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/quotes` | public | Submit a quote → creates a project + unique ID, emails client + owner |
| GET | `/api/quotes` | admin | List recent projects |
| POST | `/api/auth/register` | bootstrap | Create first admin (then locked by `ADMIN_BOOTSTRAP_TOKEN`) |
| POST | `/api/auth/login` | admin | Get a JWT |
| GET | `/api/activities` | admin | Activity feed |
| POST | `/api/payments/checkout` | app | Create a Stripe Checkout session for an invoice |
| POST | `/api/webhooks/stripe` | Stripe | Payment events → record + email client + owner |
| GET | `/health` | public | Health check |

## Setup

```bash
cd backend
cp .env.example .env        # fill in the values (see below)
npm install
npm run prisma:generate
npm run prisma:migrate      # creates the tables
node src/scripts/createAdmin.js you@websix.site "a-strong-password"
npm start                   # http://localhost:8080/health
```

## Required keys (what makes it go live)

- **DATABASE_URL** — a PostgreSQL database (free tiers: Supabase, Neon, Railway).
- **SMTP_HOST / SMTP_USER / SMTP_PASS** — email sending. For `websixagency@gmail.com` create a **Google App Password** (Google Account → Security → 2-Step Verification → App passwords) and use it as `SMTP_PASS`. Or use Resend/Postmark SMTP.
- **JWT_SECRET** — any long random string.
- **STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET** — only needed for payments.

Without SMTP configured the server still runs and **logs** the emails (dry-run) instead of sending — so nothing crashes while you set keys up.

## Deploy

Any Node host works — **Render**, **Railway**, or **Vercel** (as functions). Steps:
1. Push this repo, connect it to the host, set the env vars above.
2. Run `npm run prisma:deploy` on release.
3. Add the Stripe webhook endpoint `https://YOUR-BACKEND/api/webhooks/stripe` in the Stripe dashboard and copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

## Wire the quote wizard to this backend

In `quote.html`, set the wizard's endpoint to this API and it will POST the quote as JSON (it already sends the right shape):

```js
var FORM_ENDPOINT = 'https://YOUR-BACKEND/api/quotes';
```

Until the backend is deployed, the wizard falls back to opening the visitor's email app to `websixagency@gmail.com`, so submissions are never lost.

## Roadmap (see the thread's platform plan)

This is the foundation (Phase 1–2 + notifications). Next: client dashboard UI, admin command center UI, Stripe invoicing flows, and live monitoring integrations — all built on these models and the same notification engine.
