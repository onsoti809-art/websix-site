// Central activity + notification engine.
// EVERY meaningful event calls notifyActivity(type, ctx). It:
//   1) records an Activity row (audit trail), and
//   2) emails the OWNER on every activity, and
//   3) emails the CLIENT on client-relevant activities (when we have their email).
// This is the heart of the "owner + client get emailed on every activity" requirement.
const prisma = require('./db');
const { sendMail } = require('./mailer');

const OWNER = () => process.env.OWNER_EMAIL || process.env.SMTP_USER;
const APP = () => process.env.APP_URL || 'https://websix.site';
const esc = (s) => String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Which event types should also email the client.
const CLIENT_FACING = new Set([
  'quote_submitted',
  'quote_sent',
  'quote_approved',
  'payment_received',
  'project_status_changed',
  'message_received',
  'project_launched',
  'invoice_created',
]);

function defaultMessage(type, p) {
  switch (type) {
    case 'quote_submitted': return `New quote request ${p.publicId} (${p.type})`;
    case 'payment_received': return `Payment received for ${p.publicId}: $${p.amount || '?'}`;
    case 'project_status_changed': return `Project ${p.publicId} status → ${p.status}`;
    case 'message_received': return `New message on ${p.publicId}`;
    case 'project_launched': return `Project ${p.publicId} launched`;
    case 'invoice_created': return `Invoice created for ${p.publicId}: $${p.amount || '?'}`;
    case 'consultation_requested': return `Consultation requested for ${p.publicId}`;
    default: return `Activity: ${type}${p.publicId ? ' (' + p.publicId + ')' : ''}`;
  }
}

function ownerEmail(type, p) {
  const subject = `Websix · ${defaultMessage(type, p)}`;
  const html = `
    <h2 style="font-family:sans-serif">${esc(defaultMessage(type, p))}</h2>
    <table style="font-family:sans-serif;font-size:14px">
      ${p.publicId ? `<tr><td><b>Ref</b></td><td>${esc(p.publicId)}</td></tr>` : ''}
      ${p.type ? `<tr><td><b>Type</b></td><td>${esc(p.type)}</td></tr>` : ''}
      ${p.clientName ? `<tr><td><b>Client</b></td><td>${esc(p.clientName)} &lt;${esc(p.clientEmail || '-')}&gt;</td></tr>` : ''}
      ${p.estimateLow ? `<tr><td><b>Estimate</b></td><td>$${esc(p.estimateLow)}</td></tr>` : ''}
      ${p.amount ? `<tr><td><b>Amount</b></td><td>$${esc(p.amount)}</td></tr>` : ''}
    </table>
    ${p.summary ? `<p style="font-family:sans-serif">${esc(p.summary)}</p>` : ''}
    <p style="font-family:sans-serif"><a href="${APP()}/admin">Open the admin dashboard →</a></p>`;
  return { subject, html };
}

function clientEmail(type, p) {
  const name = p.clientName || 'there';
  if (type === 'quote_submitted') {
    return {
      subject: `We received your request (${p.publicId}) — Websix`,
      html: `<div style="font-family:sans-serif"><p>Hi ${esc(name)},</p>
        <p>Thanks for your request — we've got it, and your project reference is <b>${esc(p.publicId)}</b>.</p>
        <p>Our team will review the details and follow up shortly with your written quote and next steps.</p>
        <p>— The Websix team<br><a href="${APP()}">websix.site</a></p></div>`,
    };
  }
  if (type === 'payment_received') {
    return {
      subject: `Payment received — thank you (${p.publicId})`,
      html: `<div style="font-family:sans-serif"><p>Hi ${esc(name)},</p>
        <p>We've received your payment${p.amount ? ' of $' + esc(p.amount) : ''} for project <b>${esc(p.publicId)}</b>. A receipt is attached to your dashboard.</p>
        <p>— The Websix team</p></div>`,
    };
  }
  return {
    subject: `Update on your project ${p.publicId} — Websix`,
    html: `<div style="font-family:sans-serif"><p>Hi ${esc(name)},</p><p>${esc(defaultMessage(type, p))}.</p><p>— The Websix team</p></div>`,
  };
}

async function notifyActivity(type, ctx = {}) {
  const { project, client, extra = {} } = ctx;
  const p = {
    publicId: project && project.publicId,
    type: project && project.type,
    summary: project && project.summary,
    estimateLow: project && project.estimateLow,
    status: project && project.status,
    clientName: (client && (client.contactName || client.businessName)) || extra.clientName,
    clientEmail: (client && client.email) || extra.clientEmail,
    amount: extra.amount,
  };

  // 1) audit trail
  try {
    await prisma.activity.create({
      data: {
        projectId: (project && project.id) || null,
        type,
        message: extra.message || defaultMessage(type, p),
        meta: Object.keys(extra).length ? extra : undefined,
      },
    });
  } catch (e) {
    console.error('[notify] activity log failed:', e.message);
  }

  // 2) owner is notified of EVERYTHING
  try {
    const oe = ownerEmail(type, p);
    await sendMail({ to: OWNER(), subject: oe.subject, html: oe.html });
  } catch (e) {
    console.error('[notify] owner email failed:', e.message);
  }

  // 3) client notified on client-facing events (when we have an address)
  if (p.clientEmail && CLIENT_FACING.has(type)) {
    try {
      const ce = clientEmail(type, p);
      await sendMail({ to: p.clientEmail, subject: ce.subject, html: ce.html });
    } catch (e) {
      console.error('[notify] client email failed:', e.message);
    }
  }
}

module.exports = { notifyActivity };
