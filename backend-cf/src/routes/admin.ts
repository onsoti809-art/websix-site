// Admin API (auth-guarded): overview metrics, CRM reads/writes, activity feed, global search.
import { Hono } from 'hono';
import type { Env } from '../types';
import { one, many, run, count } from '../lib/db';
import { id } from '../lib/id';
import { notifyActivity } from '../lib/notify';
import { requireAuth } from '../middleware/auth';

const admin = new Hono<{ Bindings: Env }>();
admin.use('*', requireAuth);

admin.get('/overview', async (c) => {
  const revenue = await one<{ s: number }>(c.env, "SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='succeeded'");
  return c.json({
    leads: await count(c.env, 'SELECT COUNT(*) AS n FROM leads'),
    clients: await count(c.env, 'SELECT COUNT(*) AS n FROM clients'),
    projects: await count(c.env, 'SELECT COUNT(*) AS n FROM projects'),
    quotesRequested: await count(c.env, "SELECT COUNT(*) AS n FROM projects WHERE status='quote_requested'"),
    unpaidInvoices: await count(c.env, "SELECT COUNT(*) AS n FROM invoices WHERE status='unpaid'"),
    revenue: revenue?.s || 0,
    recentActivity: await many(c.env, 'SELECT * FROM activities ORDER BY created_at DESC LIMIT 15'),
  });
});

admin.get('/leads', async (c) => c.json(await many(c.env, 'SELECT * FROM leads ORDER BY created_at DESC LIMIT 200')));
admin.post('/leads', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.business_name) return c.json({ error: 'invalid' }, 400);
  const lid = id();
  await run(c.env, 'INSERT INTO leads (id, business_name, category, city, country, phone, email, website_status, score, priority, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    lid, b.business_name, b.category || null, b.city || null, b.country || 'USA', b.phone || null, b.email || null, b.website_status || null, b.score ?? null, b.priority || null, b.notes || null);
  return c.json({ ok: true, id: lid });
});

admin.get('/clients', async (c) => c.json(await many(c.env, 'SELECT * FROM clients ORDER BY created_at DESC LIMIT 200')));
admin.get('/projects', async (c) => c.json(await many(c.env, 'SELECT * FROM projects ORDER BY created_at DESC LIMIT 200')));
admin.get('/projects/:ref', async (c) => {
  const ref = c.req.param('ref');
  const p = await one(c.env, 'SELECT * FROM projects WHERE public_id=? OR id=?', ref, ref);
  if (!p) return c.json({ error: 'not_found' }, 404);
  return c.json(p);
});
admin.get('/quotes', async (c) => c.json(await many(c.env, 'SELECT * FROM quotes ORDER BY created_at DESC LIMIT 200')));
admin.get('/invoices', async (c) => c.json(await many(c.env, 'SELECT * FROM invoices ORDER BY created_at DESC LIMIT 200')));

admin.post('/invoices', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.projectId || !b.amount) return c.json({ error: 'invalid' }, 400);
  const iid = id();
  await run(c.env, 'INSERT INTO invoices (id, project_id, amount, currency, status) VALUES (?,?,?,?,?)',
    iid, b.projectId, Math.round(b.amount), b.currency || 'usd', 'unpaid');
  const project = await one<any>(c.env, 'SELECT * FROM projects WHERE id=?', b.projectId);
  const client = project?.client_id ? await one(c.env, 'SELECT * FROM clients WHERE id=?', project.client_id) : null;
  await notifyActivity(c.env, 'invoice_created', { project, client, extra: { amount: Math.round(b.amount) } });
  return c.json({ ok: true, id: iid });
});

admin.get('/activities', async (c) => c.json(await many(c.env, 'SELECT * FROM activities ORDER BY created_at DESC LIMIT 200')));

admin.get('/search', async (c) => {
  const q = `%${(c.req.query('q') || '').trim()}%`;
  return c.json({
    clients: await many(c.env, 'SELECT id, business_name, email FROM clients WHERE business_name LIKE ? OR email LIKE ? LIMIT 20', q, q),
    projects: await many(c.env, 'SELECT id, public_id, summary, status FROM projects WHERE public_id LIKE ? OR summary LIKE ? LIMIT 20', q, q),
    leads: await many(c.env, 'SELECT id, business_name, city FROM leads WHERE business_name LIKE ? OR city LIKE ? LIMIT 20', q, q),
  });
});

export default admin;
