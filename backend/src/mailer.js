// Email transport. Uses SMTP (Gmail App Password or any SMTP provider).
// If SMTP is not configured, emails are logged (dry-run) so the server never crashes.
const nodemailer = require('nodemailer');

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) {
    console.warn('[mailer] SMTP not configured — emails will be logged only (dry-run).');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  if (!to) return { skipped: 'no recipient' };
  const from = process.env.FROM_EMAIL || 'Websix <no-reply@websix.site>';
  const plain = text || (html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
  const t = getTransport();
  if (!t) {
    console.log(`[mailer:DRYRUN] to=${to} | subject="${subject}"`);
    return { dryRun: true };
  }
  try {
    const info = await t.sendMail({ from, to, subject, html, text: plain });
    console.log(`[mailer] sent to=${to} id=${info.messageId}`);
    return info;
  } catch (e) {
    console.error(`[mailer] FAILED to=${to}: ${e.message}`);
    throw e;
  }
}

module.exports = { sendMail };
