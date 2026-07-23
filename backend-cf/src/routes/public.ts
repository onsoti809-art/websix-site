// Public endpoints (no auth): quote submission from the on-site wizard.
import { Hono } from 'hono';
import type { Env } from '../types';
import { id, publicId } from '../lib/id';
import { one, run } from '../lib/db';
import { notifyActivity } from '../lib/notify';
import { verifyTurnstile } from '../lib/turnstile';

const pub = new Hono<{ Bindings: Env }>();

pub.post('/quotes', async (c) => {
  const body: any = await c.req.json().catch(() => null);
  if (!body || !body.type) return c.json({ error: 'invalid_payload' }, 400);

  const passed = await verifyTurnstile(c.env, body.turnstileToken, c.req.header('CF-Connecting-IP') || undefined);
  if (!passed) return c.json({ error: 'turnstile_failed' }, 403);

  const f = body.fields || {};
  const email = String(f.contact_email || f.email || '').trim().toLowerCase();
  let client: any = null;
  if (email) {
    client = await one(c.env, 'SELECT * FROM clients WHERE email=?', email);
    if (!client) {
      const cid = id();
      await run(c.env, 'INSERT INTO clients (id, business_name, contact_name, email, phone) VALUES (?,?,?,?,?)',
        cid, f.biz_name || 'Unknown business', f.contact_name || null, email, f.contact_phone || null);
      client = await one(c.env, 'SELECT * FROM clients WHERE id=?', cid);
    }
  }

  const pid = id();
  const pubid = publicId();
  const est = body.estimate || {};
  await run(c.env,
    'INSERT INTO projects (id, public_id, client_id, type, status, summary, tier, estimate_low, estimate_high, data) VALUES (?,?,?,?,?,?,?,?,?,?)',
    pid, pubid, client?.id || null, body.type, 'quote_requested', body.summary || null,
    est.tier || null, est.low || null, est.high || null, JSON.stringify(body));
  await run(c.env, 'INSERT INTO quotes (id, project_id, amount, scope, status) VALUES (?,?,?,?,?)',
    id(), pid, est.low || 0, JSON.stringify({ features: body.features || [], addons: body.addons || [] }), 'submitted');

  const project = await one(c.env, 'SELECT * FROM projects WHERE id=?', pid);
  // Emails BOTH the client (confirmation) and the owner (notification):
  await notifyActivity(c.env, 'quote_submitted', { project, client });

  return c.json({ ok: true, projectId: pubid });
});

export default pub;
