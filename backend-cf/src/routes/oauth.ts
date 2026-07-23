// OAuth sign-in (Google / GitHub / Microsoft). Config-driven; a provider is enabled
// only when its CLIENT_ID/SECRET secrets are set. State is a short-lived signed JWT (CSRF-safe).
// Security: OAuth only logs in an EXISTING user by email; the configured OWNER_EMAIL is
// auto-provisioned as super_admin on first login. Everyone else must be added by an admin.
import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import type { Env } from '../types';
import { one, run } from '../lib/db';
import { id } from '../lib/id';

interface Provider { authorize: string; token: string; scope: string; userinfo?: string; }
const PROVIDERS: Record<string, Provider> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
  microsoft: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email profile',
    userinfo: 'https://graph.microsoft.com/oidc/userinfo',
  },
};

function creds(env: Env, p: string) {
  const up = p.toUpperCase();
  return { id: (env as any)[`${up}_CLIENT_ID`] as string, secret: (env as any)[`${up}_CLIENT_SECRET`] as string };
}
function redirectUri(env: Env, p: string) {
  return `${(env.API_BASE_URL || '').replace(/\/$/, '')}/api/auth/oauth/${p}/callback`;
}

const oauth = new Hono<{ Bindings: Env }>();

oauth.get('/:provider/start', async (c) => {
  const p = c.req.param('provider');
  const cfg = PROVIDERS[p];
  if (!cfg) return c.json({ error: 'unknown_provider' }, 404);
  const cr = creds(c.env, p);
  if (!cr.id || !cr.secret) return c.json({ error: 'provider_not_configured' }, 503);
  const state = await sign({ p, n: id(), exp: Math.floor(Date.now() / 1000) + 600 }, c.env.JWT_SECRET);
  const u = new URL(cfg.authorize);
  u.searchParams.set('client_id', cr.id);
  u.searchParams.set('redirect_uri', redirectUri(c.env, p));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', cfg.scope);
  u.searchParams.set('state', state);
  if (p === 'google') u.searchParams.set('access_type', 'online');
  if (p === 'microsoft') u.searchParams.set('response_mode', 'query');
  return c.redirect(u.toString());
});

oauth.get('/:provider/callback', async (c) => {
  const p = c.req.param('provider');
  const cfg = PROVIDERS[p];
  const appUrl = (c.env.APP_URL || '').replace(/\/$/, '');
  const fail = (msg: string) => c.redirect(`${appUrl}/admin/#error=${encodeURIComponent(msg)}`);
  if (!cfg) return fail('unknown_provider');

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return fail('missing_code');
  try {
    const st: any = await verify(state, c.env.JWT_SECRET);
    if (st.p !== p) return fail('bad_state');
  } catch {
    return fail('bad_state');
  }

  const cr = creds(c.env, p);
  if (!cr.id || !cr.secret) return fail('provider_not_configured');

  const form = new URLSearchParams();
  form.set('client_id', cr.id);
  form.set('client_secret', cr.secret);
  form.set('code', code);
  form.set('redirect_uri', redirectUri(c.env, p));
  form.set('grant_type', 'authorization_code');
  const tr = await fetch(cfg.token, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const tok: any = await tr.json().catch(() => ({}));
  const access = tok.access_token;
  if (!access) return fail('token_exchange_failed');

  let email: string | null = null;
  let name: string | null = null;
  try {
    if (p === 'github') {
      const h = { Authorization: `Bearer ${access}`, 'User-Agent': 'websix-admin', Accept: 'application/vnd.github+json' };
      const gu: any = await (await fetch('https://api.github.com/user', { headers: h })).json();
      name = gu.name || gu.login;
      const emails: any = await (await fetch('https://api.github.com/user/emails', { headers: h })).json();
      if (Array.isArray(emails)) {
        const prim = emails.find((e: any) => e.primary && e.verified) || emails.find((e: any) => e.verified) || emails[0];
        email = prim && prim.email;
      }
      email = email || gu.email;
    } else {
      const info: any = await (await fetch(cfg.userinfo as string, { headers: { Authorization: `Bearer ${access}` } })).json();
      email = info.email || info.preferred_username;
      name = info.name;
    }
  } catch {
    return fail('userinfo_failed');
  }
  if (!email) return fail('no_email');
  email = String(email).toLowerCase();

  let user: any = await one(c.env, 'SELECT * FROM users WHERE email=?', email);
  if (!user) {
    if (email === String(c.env.OWNER_EMAIL || '').toLowerCase()) {
      const uid = id();
      await run(c.env, 'INSERT INTO users (id, email, password_hash, name, role) VALUES (?,?,?,?,?)',
        uid, email, `oauth:${p}`, name || 'Owner', 'super_admin');
      user = await one(c.env, 'SELECT * FROM users WHERE id=?', uid);
    } else {
      return fail('no_account');
    }
  }

  const jwt = await sign(
    { sub: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 },
    c.env.JWT_SECRET
  );
  return c.redirect(`${appUrl}/admin/#token=${jwt}`);
});

export default oauth;
