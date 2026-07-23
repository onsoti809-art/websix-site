// Activity + notification engine.
// Every event: (1) writes an activity row, (2) emails the OWNER, (3) emails the CLIENT
// on client-facing events. Email is sent via Resend.
import type { Env } from '../types';
import { id } from './id';
import { run } from './db';

const CLIENT_FACING = new Set([
  'quote_submitted', 'quote_sent', 'quote_approved', 'payment_received',
  'project_status_changed', 'message_received', 'project_launched', 'invoice_created',
]);

const esc = (s: any) => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendEmail(env: Env, opts: { to: string; subject: string; html: string }) {
  if (!opts.to) return;
  if (!env.RESEND_API_KEY) {
    console.log(`[mail:DRYRUN] to=${opts.to} subject="${opts.subject}"`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL || 'Websix <onboarding@resend.dev>',
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) console.error('[resend] failed', res.status, await res.text().catch(() => ''));
}

interface Ctx { project?: any; client?: any; extra?: Record<string, any>; }

function msg(type: string, p: any): string {
  switch (type) {
    case 'quote_submitted': return `New quote request ${p.publicId} (${p.type})`;
    case 'payment_received': return `Payment received for ${p.publicId}: $${p.amount || '?'}`;
    case 'invoice_created': return `Invoice created for ${p.publicId}: $${p.amount || '?'}`;
    case 'project_status_changed': return `Project ${p.publicId} status → ${p.status}`;
    case 'message_received': return `New message on ${p.publicId}`;
    case 'project_launched': return `Project ${p.publicId} launched`;
    default: return `Activity: ${type}${p.publicId ? ' (' + p.publicId + ')' : ''}`;
  }
}

export async function notifyActivity(env: Env, type: string, ctx: Ctx = {}) {
  const { project, client, extra = {} } = ctx;
  const p = {
    publicId: project?.public_id,
    type: project?.type,
    summary: project?.summary,
    estimateLow: project?.estimate_low,
    status: project?.status,
    clientName: client?.contact_name || client?.business_name || extra.clientName,
    clientEmail: client?.email || extra.clientEmail,
    amount: extra.amount,
  };

  // 1) audit trail
  try {
    await run(env, 'INSERT INTO activities (id, project_id, type, message, meta) VALUES (?,?,?,?,?)',
      id(), project?.id || null, type, extra.message || msg(type, p),
      Object.keys(extra).length ? JSON.stringify(extra) : null);
  } catch (e) { console.error('[notify] activity failed', e); }

  // 2) owner — every activity
  try {
    await sendEmail(env, {
      to: env.OWNER_EMAIL,
      subject: `Websix · ${msg(type, p)}`,
      html: `<h2 style="font-family:sans-serif">${esc(msg(type, p))}</h2>
        <table style="font-family:sans-serif;font-size:14px">
        ${p.publicId ? `<tr><td><b>Ref</b>&nbsp;</td><td>${esc(p.publicId)}</td></tr>` : ''}
        ${p.clientName ? `<tr><td><b>Client</b>&nbsp;</td><td>${esc(p.clientName)} &lt;${esc(p.clientEmail || '-')}&gt;</td></tr>` : ''}
        ${p.estimateLow ? `<tr><td><b>Estimate</b>&nbsp;</td><td>$${esc(p.estimateLow)}</td></tr>` : ''}
        ${p.amount ? `<tr><td><b>Amount</b>&nbsp;</td><td>$${esc(p.amount)}</td></tr>` : ''}
        </table>${p.summary ? `<p style="font-family:sans-serif">${esc(p.summary)}</p>` : ''}
        <p style="font-family:sans-serif"><a href="${env.APP_URL}/admin">Open admin →</a></p>`,
    });
  } catch (e) { console.error('[notify] owner email failed', e); }

  // 3) client — client-facing events only
  if (p.clientEmail && CLIENT_FACING.has(type)) {
    const name = esc(p.clientName || 'there');
    let subject = `Update on your project ${p.publicId} — Websix`;
    let html = `<div style="font-family:sans-serif"><p>Hi ${name},</p><p>${esc(msg(type, p))}.</p><p>— The Websix team</p></div>`;
    if (type === 'quote_submitted') {
      subject = `We received your request (${p.publicId}) — Websix`;
      html = `<div style="font-family:sans-serif"><p>Hi ${name},</p>
        <p>Thanks for your request — we've got it, and your project reference is <b>${esc(p.publicId)}</b>. We'll follow up shortly with your written quote and next steps.</p>
        <p>— The Websix team · <a href="${env.APP_URL}">websix.site</a></p></div>`;
    } else if (type === 'payment_received') {
      subject = `Payment received — thank you (${p.publicId})`;
      html = `<div style="font-family:sans-serif"><p>Hi ${name},</p><p>We've received your payment${p.amount ? ' of $' + esc(p.amount) : ''} for project <b>${esc(p.publicId)}</b>. Thank you!</p><p>— The Websix team</p></div>`;
    }
    try { await sendEmail(env, { to: p.clientEmail, subject, html }); }
    catch (e) { console.error('[notify] client email failed', e); }
  }
}
