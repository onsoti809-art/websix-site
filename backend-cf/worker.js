// Websix backend - self-contained Cloudflare Worker (no build step / no npm deps).
// Deployable directly via the Cloudflare API. Mirrors the core of the Hono/TS source in src/.
// Bindings: DB (D1), CACHE (KV), MEDIA (R2). Vars: APP_URL, OWNER_EMAIL, FROM_EMAIL, API_BASE_URL.
// Secrets: JWT_SECRET, RESEND_API_KEY, (optional) TURNSTILE_SECRET, STRIPE_*, *_CLIENT_ID/SECRET.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};
const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json', ...CORS } });
const enc = new TextEncoder();
const dec = new TextDecoder();

const uuid = () => crypto.randomUUID();
function publicId() {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(5));
  let r = '';
  for (let i = 0; i < 5; i++) r += s[b[i] % s.length];
  return 'WX-' + new Date().getFullYear() + '-' + r;
}
function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function b64(bytes) { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
function fromB64(str) { const bin = atob(str); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
function b64url(buf) { return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return fromB64(s); }

// ---- JWT HS256 ----
async function hmacKey(secret) { return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function jwtSign(payload, secret) {
  const seg = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))) + '.' + b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(seg));
  return seg + '.' + b64url(sig);
}
async function jwtVerify(token, secret) {
  const p = token.split('.');
  if (p.length !== 3) throw new Error('bad');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlBytes(p[2]), enc.encode(p[0] + '.' + p[1]));
  if (!ok) throw new Error('sig');
  const payload = JSON.parse(dec.decode(b64urlBytes(p[1])));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('exp');
  return payload;
}

// ---- passwords (PBKDF2) ----
async function hashPw(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return 'pbkdf2$100000$' + b64(salt) + '$' + b64(bits);
}
async function verifyPw(pw, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts[0] !== 'pbkdf2') return false;
    const salt = fromB64(parts[2]);
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: Number(parts[1]), hash: 'SHA-256' }, key, 256));
    const exp = fromB64(parts[3]);
    if (bits.length !== exp.length) return false;
    let d = 0; for (let i = 0; i < bits.length; i++) d |= bits[i] ^ exp[i];
    return d === 0;
  } catch { return false; }
}

// ---- D1 helpers ----
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
async function all(env, sql, ...b) { const r = await env.DB.prepare(sql).bind(...b).all(); return r.results || []; }
const runq = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).run();
async function cnt(env, sql, ...b) { const r = await one(env, sql, ...b); return (r && (r.n || 0)) || 0; }

// ---- notifications (Resend) ----
const CLIENT_FACING = new Set(['quote_submitted', 'payment_received', 'invoice_created', 'project_status_changed', 'project_launched', 'message_received']);
async function sendEmail(env, to, subject, html) {
  if (!to) return;
  if (!env.RESEND_API_KEY) { console.log('[mail:dry]', to, subject); return; }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.FROM_EMAIL || 'Websix <onboarding@resend.dev>', to: [to], subject, html }),
    });
  } catch (e) { console.error('[resend]', e); }
}
function msgFor(t, p) {
  if (t === 'quote_submitted') return 'New quote request ' + p.publicId + ' (' + p.type + ')';
  if (t === 'payment_received') return 'Payment received for ' + p.publicId + ': $' + (p.amount || '?');
  if (t === 'invoice_created') return 'Invoice created for ' + p.publicId + ': $' + (p.amount || '?');
  return 'Activity: ' + t + (p.publicId ? ' (' + p.publicId + ')' : '');
}
async function notify(env, type, ctx) {
  ctx = ctx || {};
  const project = ctx.project, client = ctx.client, extra = ctx.extra || {};
  const p = {
    publicId: project && project.public_id, type: project && project.type, summary: project && project.summary,
    estimateLow: project && project.estimate_low,
    clientName: (client && (client.contact_name || client.business_name)) || extra.clientName,
    clientEmail: (client && client.email) || extra.clientEmail, amount: extra.amount,
  };
  const message = extra.message || msgFor(type, p);
  try { await runq(env, 'INSERT INTO activities (id,project_id,type,message,meta) VALUES (?,?,?,?,?)', uuid(), (project && project.id) || null, type, message, Object.keys(extra).length ? JSON.stringify(extra) : null); } catch (e) { console.error(e); }
  const app = env.APP_URL || 'https://websix.site';
  const ownerHtml = '<h2 style="font-family:sans-serif">' + esc(message) + '</h2>'
    + (p.publicId ? '<p style="font-family:sans-serif"><b>Ref:</b> ' + esc(p.publicId) + '</p>' : '')
    + (p.clientName ? '<p style="font-family:sans-serif"><b>Client:</b> ' + esc(p.clientName) + ' (' + esc(p.clientEmail || '-') + ')</p>' : '')
    + (p.summary ? '<p style="font-family:sans-serif">' + esc(p.summary) + '</p>' : '')
    + '<p style="font-family:sans-serif"><a href="' + app + '/admin/">Open admin</a></p>';
  await sendEmail(env, env.OWNER_EMAIL, 'Websix - ' + message, ownerHtml);
  if (p.clientEmail && CLIENT_FACING.has(type)) {
    const nm = esc(p.clientName || 'there');
    let subject = 'Update on your project ' + p.publicId + ' - Websix';
    let html = '<div style="font-family:sans-serif"><p>Hi ' + nm + ',</p><p>' + esc(message) + '.</p><p>- The Websix team</p></div>';
    if (type === 'quote_submitted') { subject = 'We received your request (' + p.publicId + ') - Websix'; html = '<div style="font-family:sans-serif"><p>Hi ' + nm + ',</p><p>Thanks for your request - your project reference is <b>' + esc(p.publicId) + '</b>. We will follow up shortly with your quote and next steps.</p><p>- The Websix team</p></div>'; }
    else if (type === 'payment_received') { subject = 'Payment received - thank you (' + p.publicId + ')'; html = '<div style="font-family:sans-serif"><p>Hi ' + nm + ',</p><p>We received your payment' + (p.amount ? ' of $' + esc(p.amount) : '') + ' for project <b>' + esc(p.publicId) + '</b>. Thank you!</p></div>'; }
    await sendEmail(env, p.clientEmail, subject, html);
  }
}

// ---- auth guard ----
async function authUser(req, env) {
  const h = req.headers.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) return null;
  try { return await jwtVerify(t, env.JWT_SECRET); } catch { return null; }
}

// ---- OAuth ----
const PROVIDERS = {
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'openid email profile', userinfo: 'https://openidconnect.googleapis.com/v1/userinfo' },
  github: { authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', scope: 'read:user user:email' },
  microsoft: { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'openid email profile', userinfo: 'https://graph.microsoft.com/oidc/userinfo' },
};
function oauthCreds(env, p) { const up = p.toUpperCase(); return { id: env[up + '_CLIENT_ID'], secret: env[up + '_CLIENT_SECRET'] }; }
function redirectUri(env, p) { return (env.API_BASE_URL || '').replace(/\/$/, '') + '/api/auth/oauth/' + p + '/callback'; }
async function oauthStart(p, env) {
  const cfg = PROVIDERS[p]; if (!cfg) return json({ error: 'unknown_provider' }, 404);
  const cr = oauthCreds(env, p); if (!cr.id || !cr.secret) return json({ error: 'provider_not_configured' }, 503);
  const state = await jwtSign({ p, n: uuid(), exp: Math.floor(Date.now() / 1000) + 600 }, env.JWT_SECRET);
  const u = new URL(cfg.authorize);
  u.searchParams.set('client_id', cr.id); u.searchParams.set('redirect_uri', redirectUri(env, p));
  u.searchParams.set('response_type', 'code'); u.searchParams.set('scope', cfg.scope); u.searchParams.set('state', state);
  if (p === 'google') u.searchParams.set('access_type', 'online');
  if (p === 'microsoft') u.searchParams.set('response_mode', 'query');
  return Response.redirect(u.toString(), 302);
}
async function oauthCallback(p, env, url) {
  const cfg = PROVIDERS[p];
  const app = (env.APP_URL || 'https://websix.site').replace(/\/$/, '');
  const fail = (m) => Response.redirect(app + '/admin/#error=' + encodeURIComponent(m), 302);
  if (!cfg) return fail('unknown_provider');
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state) return fail('missing_code');
  try { const st = await jwtVerify(state, env.JWT_SECRET); if (st.p !== p) return fail('bad_state'); } catch { return fail('bad_state'); }
  const cr = oauthCreds(env, p); if (!cr.id || !cr.secret) return fail('provider_not_configured');
  const form = new URLSearchParams();
  form.set('client_id', cr.id); form.set('client_secret', cr.secret); form.set('code', code);
  form.set('redirect_uri', redirectUri(env, p)); form.set('grant_type', 'authorization_code');
  const tr = await fetch(cfg.token, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  const tok = await tr.json().catch(() => ({}));
  if (!tok.access_token) return fail('token_exchange_failed');
  let email = null, name = null;
  try {
    if (p === 'github') {
      const hh = { authorization: 'Bearer ' + tok.access_token, 'user-agent': 'websix-admin', accept: 'application/vnd.github+json' };
      const gu = await (await fetch('https://api.github.com/user', { headers: hh })).json();
      name = gu.name || gu.login;
      const emails = await (await fetch('https://api.github.com/user/emails', { headers: hh })).json();
      if (Array.isArray(emails)) { const pr = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified) || emails[0]; email = pr && pr.email; }
      email = email || gu.email;
    } else {
      const info = await (await fetch(cfg.userinfo, { headers: { authorization: 'Bearer ' + tok.access_token } })).json();
      email = info.email || info.preferred_username; name = info.name;
    }
  } catch { return fail('userinfo_failed'); }
  if (!email) return fail('no_email');
  email = String(email).toLowerCase();
  let user = await one(env, 'SELECT * FROM users WHERE email=?', email);
  if (!user) {
    if (email === String(env.OWNER_EMAIL || '').toLowerCase()) {
      const uid = uuid();
      await runq(env, 'INSERT INTO users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)', uid, email, 'oauth:' + p, name || 'Owner', 'super_admin');
      user = await one(env, 'SELECT * FROM users WHERE id=?', uid);
    } else return fail('no_account');
  }
  const jwt = await jwtSign({ sub: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 43200 }, env.JWT_SECRET);
  return Response.redirect(app + '/admin/#token=' + jwt, 302);
}

// ---- handlers ----
async function quoteSubmit(req, env) {
  const body = await req.json().catch(() => null);
  if (!body || !body.type) return json({ error: 'invalid_payload' }, 400);
  if (env.TURNSTILE_SECRET) {
    const tk = body.turnstileToken; if (!tk) return json({ error: 'turnstile_failed' }, 403);
    const fd = new FormData(); fd.append('secret', env.TURNSTILE_SECRET); fd.append('response', tk);
    const tv = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: fd })).json();
    if (!tv.success) return json({ error: 'turnstile_failed' }, 403);
  }
  const f = body.fields || {};
  const email = String(f.contact_email || f.email || '').trim().toLowerCase();
  let client = null;
  if (email) {
    client = await one(env, 'SELECT * FROM clients WHERE email=?', email);
    if (!client) {
      const cid = uuid();
      await runq(env, 'INSERT INTO clients (id,business_name,contact_name,email,phone) VALUES (?,?,?,?,?)', cid, f.biz_name || 'Unknown business', f.contact_name || null, email, f.contact_phone || null);
      client = await one(env, 'SELECT * FROM clients WHERE id=?', cid);
    }
  }
  const pid = uuid(), pub = publicId(), est = body.estimate || {};
  await runq(env, 'INSERT INTO projects (id,public_id,client_id,type,status,summary,tier,estimate_low,estimate_high,data) VALUES (?,?,?,?,?,?,?,?,?,?)',
    pid, pub, (client && client.id) || null, body.type, 'quote_requested', body.summary || null, est.tier || null, est.low || null, est.high || null, JSON.stringify(body));
  await runq(env, 'INSERT INTO quotes (id,project_id,amount,scope,status) VALUES (?,?,?,?,?)', uuid(), pid, est.low || 0, JSON.stringify({ features: body.features || [], addons: body.addons || [] }), 'submitted');
  const project = await one(env, 'SELECT * FROM projects WHERE id=?', pid);
  await notify(env, 'quote_submitted', { project, client });
  return json({ ok: true, projectId: pub });
}
async function authRegister(req, env) {
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  if (!email || password.length < 8) return json({ error: 'invalid_payload' }, 400);
  if ((await cnt(env, 'SELECT COUNT(*) AS n FROM users')) > 0) return json({ error: 'registration_closed' }, 403);
  const uid = uuid();
  await runq(env, 'INSERT INTO users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)', uid, email, await hashPw(password), b.name || 'Owner', 'super_admin');
  return json({ id: uid, email, role: 'super_admin' });
}
async function authLogin(req, env) {
  const b = await req.json().catch(() => ({}));
  const user = await one(env, 'SELECT * FROM users WHERE email=?', String(b.email || '').trim().toLowerCase());
  if (!user || !(await verifyPw(String(b.password || ''), user.password_hash))) return json({ error: 'bad_credentials' }, 401);
  const token = await jwtSign({ sub: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 43200 }, env.JWT_SECRET);
  return json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
}
async function adminRoutes(path, m, req, env) {
  if (path === '/api/admin/overview') {
    const rev = await one(env, "SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='succeeded'");
    return json({
      leads: await cnt(env, 'SELECT COUNT(*) AS n FROM leads'), clients: await cnt(env, 'SELECT COUNT(*) AS n FROM clients'),
      projects: await cnt(env, 'SELECT COUNT(*) AS n FROM projects'), quotesRequested: await cnt(env, "SELECT COUNT(*) AS n FROM projects WHERE status='quote_requested'"),
      unpaidInvoices: await cnt(env, "SELECT COUNT(*) AS n FROM invoices WHERE status='unpaid'"), revenue: (rev && rev.s) || 0,
      recentActivity: await all(env, 'SELECT * FROM activities ORDER BY created_at DESC LIMIT 15'),
    });
  }
  if (path === '/api/admin/leads' && m === 'GET') return json(await all(env, 'SELECT * FROM leads ORDER BY created_at DESC LIMIT 200'));
  if (path === '/api/admin/leads' && m === 'POST') { const b = await req.json().catch(() => ({})); if (!b.business_name) return json({ error: 'invalid' }, 400); const lid = uuid(); await runq(env, 'INSERT INTO leads (id,business_name,category,city,country,phone,email,website_status,score,priority,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)', lid, b.business_name, b.category || null, b.city || null, b.country || 'USA', b.phone || null, b.email || null, b.website_status || null, b.score == null ? null : b.score, b.priority || null, b.notes || null); return json({ ok: true, id: lid }); }
  if (path === '/api/admin/clients') return json(await all(env, 'SELECT * FROM clients ORDER BY created_at DESC LIMIT 200'));
  if (path === '/api/admin/projects') return json(await all(env, 'SELECT * FROM projects ORDER BY created_at DESC LIMIT 200'));
  if (path === '/api/admin/quotes') return json(await all(env, 'SELECT * FROM quotes ORDER BY created_at DESC LIMIT 200'));
  if (path === '/api/admin/invoices' && m === 'GET') return json(await all(env, 'SELECT * FROM invoices ORDER BY created_at DESC LIMIT 200'));
  if (path === '/api/admin/invoices' && m === 'POST') { const b = await req.json().catch(() => ({})); if (!b.projectId || !b.amount) return json({ error: 'invalid' }, 400); const iid = uuid(); await runq(env, 'INSERT INTO invoices (id,project_id,amount,currency,status) VALUES (?,?,?,?,?)', iid, b.projectId, Math.round(b.amount), b.currency || 'usd', 'unpaid'); const project = await one(env, 'SELECT * FROM projects WHERE id=?', b.projectId); const client = project && project.client_id ? await one(env, 'SELECT * FROM clients WHERE id=?', project.client_id) : null; await notify(env, 'invoice_created', { project, client, extra: { amount: Math.round(b.amount) } }); return json({ ok: true, id: iid }); }
  if (path === '/api/admin/activities') return json(await all(env, 'SELECT * FROM activities ORDER BY created_at DESC LIMIT 200'));
  if (path === '/api/admin/search') { const url = new URL(req.url); const q = '%' + (url.searchParams.get('q') || '').trim() + '%'; return json({ clients: await all(env, 'SELECT id,business_name,email FROM clients WHERE business_name LIKE ? OR email LIKE ? LIMIT 20', q, q), projects: await all(env, 'SELECT id,public_id,summary,status FROM projects WHERE public_id LIKE ? OR summary LIKE ? LIMIT 20', q, q), leads: await all(env, 'SELECT id,business_name,city FROM leads WHERE business_name LIKE ? OR city LIKE ? LIMIT 20', q, q) }); }
  const mp = path.match(/^\/api\/admin\/projects\/(.+)$/);
  if (mp) { const p = await one(env, 'SELECT * FROM projects WHERE public_id=? OR id=?', mp[1], mp[1]); return p ? json(p) : json({ error: 'not_found' }, 404); }
  return json({ error: 'not_found' }, 404);
}
async function checkout(req, env) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe_not_configured' }, 503);
  const b = await req.json().catch(() => ({}));
  const invoice = b.invoiceId ? await one(env, 'SELECT * FROM invoices WHERE id=?', b.invoiceId) : null;
  if (!invoice) return json({ error: 'invoice_not_found' }, 404);
  const project = await one(env, 'SELECT * FROM projects WHERE id=?', invoice.project_id);
  const pr = new URLSearchParams();
  pr.set('mode', 'payment'); pr.set('success_url', (env.APP_URL || '') + '/dashboard?paid=1'); pr.set('cancel_url', (env.APP_URL || '') + '/dashboard?canceled=1');
  pr.set('line_items[0][quantity]', '1'); pr.set('line_items[0][price_data][currency]', invoice.currency || 'usd');
  pr.set('line_items[0][price_data][unit_amount]', String(invoice.amount * 100)); pr.set('line_items[0][price_data][product_data][name]', 'Websix project ' + ((project && project.public_id) || ''));
  pr.set('metadata[invoiceId]', invoice.id); if (invoice.project_id) pr.set('metadata[projectId]', invoice.project_id);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: pr });
  const data = await r.json(); if (!r.ok) return json({ error: 'stripe_error', detail: data }, 502);
  return json({ url: data.url });
}
async function stripeHook(req, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'stripe_not_configured' }, 503);
  const raw = await req.text(); const sigHeader = req.headers.get('stripe-signature') || '';
  const parts = {}; sigHeader.split(',').forEach(kv => { const i = kv.indexOf('='); parts[kv.slice(0, i)] = kv.slice(i + 1); });
  if (!parts.t || !parts.v1) return new Response('bad signature', { status: 400 });
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(env.STRIPE_WEBHOOK_SECRET), enc.encode(parts.t + '.' + raw));
  const hex = [...new Uint8Array(mac)].map(x => x.toString(16).padStart(2, '0')).join('');
  let d = 0; if (hex.length !== parts.v1.length) return new Response('bad signature', { status: 400 });
  for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  if (d !== 0) return new Response('bad signature', { status: 400 });
  const event = JSON.parse(raw);
  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const obj = event.data.object, md = obj.metadata || {}, amount = Math.round((obj.amount_total || obj.amount || 0) / 100);
    let project = null, client = null;
    if (md.projectId) { project = await one(env, 'SELECT * FROM projects WHERE id=?', md.projectId); if (project && project.client_id) client = await one(env, 'SELECT * FROM clients WHERE id=?', project.client_id); }
    await runq(env, 'INSERT INTO payments (id,project_id,invoice_id,amount,status,stripe_id) VALUES (?,?,?,?,?,?)', uuid(), md.projectId || null, md.invoiceId || null, amount || 0, 'succeeded', obj.id);
    if (md.invoiceId) await runq(env, "UPDATE invoices SET status='paid' WHERE id=?", md.invoiceId);
    await notify(env, 'payment_received', { project, client, extra: { amount } });
  }
  return json({ received: true });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname, m = req.method;
    if (m === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
      if (path === '/health') return json({ ok: true, service: 'websix-backend' });
      if (path === '/api/quotes' && m === 'POST') return await quoteSubmit(req, env);
      if (path === '/api/auth/register' && m === 'POST') return await authRegister(req, env);
      if (path === '/api/auth/login' && m === 'POST') return await authLogin(req, env);
      if (path === '/api/auth/me' && m === 'GET') { const u = await authUser(req, env); return u ? json(u) : json({ error: 'unauthorized' }, 401); }
      let mo;
      if ((mo = path.match(/^\/api\/auth\/oauth\/([^/]+)\/start$/))) return await oauthStart(mo[1], env);
      if ((mo = path.match(/^\/api\/auth\/oauth\/([^/]+)\/callback$/))) return await oauthCallback(mo[1], env, url);
      if (path.startsWith('/api/admin/')) { const u = await authUser(req, env); if (!u) return json({ error: 'unauthorized' }, 401); return await adminRoutes(path, m, req, env); }
      if (path === '/api/payments/checkout' && m === 'POST') return await checkout(req, env);
      if (path === '/api/webhooks/stripe' && m === 'POST') return await stripeHook(req, env);
      return json({ error: 'not_found' }, 404);
    } catch (e) { console.error(e); return json({ error: 'server_error' }, 500); }
  },
};
