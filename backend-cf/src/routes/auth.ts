// Auth: bootstrap first admin, login, me.
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import type { Env } from '../types';
import { hashPassword, verifyPassword } from '../lib/auth';
import { one, run, count } from '../lib/db';
import { id } from '../lib/id';
import { requireAuth } from '../middleware/auth';

const auth = new Hono<{ Bindings: Env }>();

// First user becomes super_admin. After that, registration is closed here
// (create further users from the admin panel).
auth.post('/register', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!email || password.length < 8) return c.json({ error: 'invalid_payload' }, 400);
  const existing = await count(c.env, 'SELECT COUNT(*) AS n FROM users');
  if (existing > 0) return c.json({ error: 'registration_closed' }, 403);
  const uid = id();
  await run(c.env, 'INSERT INTO users (id, email, password_hash, name, role) VALUES (?,?,?,?,?)',
    uid, email, await hashPassword(password), b.name || 'Owner', 'super_admin');
  return c.json({ id: uid, email, role: 'super_admin' });
});

auth.post('/login', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase();
  const user = await one<any>(c.env, 'SELECT * FROM users WHERE email=?', email);
  if (!user) return c.json({ error: 'bad_credentials' }, 401);
  const ok = await verifyPassword(String(b.password || ''), user.password_hash);
  if (!ok) return c.json({ error: 'bad_credentials' }, 401);
  const token = await sign(
    { sub: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 },
    c.env.JWT_SECRET
  );
  return c.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
});

auth.get('/me', requireAuth, (c) => c.json(c.get('user')));

export default auth;
