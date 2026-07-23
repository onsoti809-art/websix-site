// Stripe payments: create Checkout session + verify webhook (manual HMAC, Workers-safe).
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { id } from '../lib/id';
import { one, run } from '../lib/db';
import { notifyActivity } from '../lib/notify';

const pay = new Hono<{ Bindings: Env }>();

pay.post('/checkout', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const b = await c.req.json().catch(() => ({}));
  const invoice: any = b.invoiceId ? await one(c.env, 'SELECT * FROM invoices WHERE id=?', b.invoiceId) : null;
  if (!invoice) return c.json({ error: 'invoice_not_found' }, 404);
  const project: any = await one(c.env, 'SELECT * FROM projects WHERE id=?', invoice.project_id);
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', (c.env.APP_URL || '') + '/dashboard?paid=1');
  params.set('cancel_url', (c.env.APP_URL || '') + '/dashboard?canceled=1');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', invoice.currency || 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(invoice.amount * 100));
  params.set('line_items[0][price_data][product_data][name]', 'Websix project ' + (project?.public_id || ''));
  params.set('metadata[invoiceId]', invoice.id);
  if (invoice.project_id) params.set('metadata[projectId]', invoice.project_id);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data: any = await r.json();
  if (!r.ok) return c.json({ error: 'stripe_error', detail: data }, 502);
  return c.json({ url: data.url });
});

async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  try {
    const parts: Record<string, string> = {};
    header.split(',').forEach((kv) => { const [k, v] = kv.split('='); parts[k] = v; });
    const t = parts['t']; const v1 = parts['v1'];
    if (!t || !v1) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
    const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// Mounted at top-level in index.ts so we can read the raw body for signature verification.
export async function stripeWebhook(c: Context<{ Bindings: Env }>) {
  const env = c.env;
  if (!env.STRIPE_WEBHOOK_SECRET) return c.json({ error: 'stripe_not_configured' }, 503);
  const raw = await c.req.text();
  const sig = c.req.header('stripe-signature') || '';
  if (!(await verifySignature(raw, sig, env.STRIPE_WEBHOOK_SECRET))) return c.text('bad signature', 400);
  const event: any = JSON.parse(raw);
  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const obj = event.data.object;
    const md = obj.metadata || {};
    const amount = Math.round((obj.amount_total || obj.amount || 0) / 100);
    let project: any = null, client: any = null;
    if (md.projectId) {
      project = await one(env, 'SELECT * FROM projects WHERE id=?', md.projectId);
      if (project?.client_id) client = await one(env, 'SELECT * FROM clients WHERE id=?', project.client_id);
    }
    await run(env, 'INSERT INTO payments (id, project_id, invoice_id, amount, status, stripe_id) VALUES (?,?,?,?,?,?)',
      id(), md.projectId || null, md.invoiceId || null, amount || 0, 'succeeded', obj.id);
    if (md.invoiceId) await run(env, "UPDATE invoices SET status='paid' WHERE id=?", md.invoiceId);
    await notifyActivity(env, 'payment_received', { project, client, extra: { amount } });
  }
  return c.json({ received: true });
}

export default pay;
