// Cloudflare Turnstile verification (bot protection on the public quote form).
import type { Env } from '../types';

export async function verifyTurnstile(env: Env, token?: string, ip?: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true; // not enforced until a secret is set
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data: any = await r.json();
    return !!data.success;
  } catch {
    return false;
  }
}
