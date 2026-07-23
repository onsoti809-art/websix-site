// JWT auth middleware for Hono.
import type { Context, Next } from 'hono';
import { verify } from 'hono/jwt';

export async function requireAuth(c: Context, next: Next) {
  const h = c.req.header('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  try {
    const payload = await verify(token, c.env.JWT_SECRET);
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }
}

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const u = c.get('user');
    if (!u) return c.json({ error: 'unauthorized' }, 401);
    if (roles.length && !roles.includes(u.role)) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
}
