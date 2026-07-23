// Websix backend — Cloudflare Worker (Hono).
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Env } from './types';
import authRoutes from './routes/auth';
import pub from './routes/public';
import admin from './routes/admin';
import pay, { stripeWebhook } from './routes/payments';
import oauth from './routes/oauth';

const app = new Hono<{ Bindings: Env }>();

app.use('*', secureHeaders());
app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true, service: 'websix-backend' }));

app.route('/api/auth', authRoutes);
app.route('/api/auth/oauth', oauth);
app.route('/api', pub);              // POST /api/quotes
app.route('/api/admin', admin);      // admin.* (auth-guarded)
app.route('/api/payments', pay);     // POST /api/payments/checkout
app.post('/api/webhooks/stripe', stripeWebhook); // raw-body webhook

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => { console.error(err); return c.json({ error: 'server_error' }, 500); });

export default {
  fetch: app.fetch,
  // Daily cron (see wrangler.toml). Extend with reminders/backups/monitoring per service.
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext) {
    console.log('[cron] tick', new Date().toISOString());
  },
};
