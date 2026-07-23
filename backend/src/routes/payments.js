// Stripe checkout + webhook. On successful payment we record it and email client + owner.
const express = require('express');
const prisma = require('../db');
const { notifyActivity } = require('../notify');

const Stripe = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const router = express.Router();

// Create a Checkout Session for an existing invoice.
router.post('/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'stripe_not_configured' });
  const { invoiceId } = req.body || {};
  try {
    const invoice = invoiceId
      ? await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { project: true } })
      : null;
    if (!invoice) return res.status(404).json({ error: 'invoice_not_found' });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: invoice.currency || 'usd',
          product_data: { name: 'Websix project ' + (invoice.project ? invoice.project.publicId : '') },
          unit_amount: invoice.amount * 100,
        },
        quantity: 1,
      }],
      success_url: (process.env.APP_URL || '') + '/dashboard?paid=1',
      cancel_url: (process.env.APP_URL || '') + '/dashboard?canceled=1',
      metadata: { invoiceId: invoice.id, projectId: invoice.projectId },
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[payments] checkout error:', e.message);
    res.status(500).json({ error: 'checkout_failed' });
  }
});

// Stripe webhook — server.js mounts this with express.raw so the signature verifies.
async function webhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'stripe_not_configured' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] signature verification failed:', err.message);
    return res.status(400).send('Webhook Error: ' + err.message);
  }
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      const obj = event.data.object;
      const md = obj.metadata || {};
      const amount = Math.round((obj.amount_total || obj.amount || 0) / 100);
      let project = null, client = null;
      if (md.projectId) {
        project = await prisma.project.findUnique({ where: { id: md.projectId }, include: { client: true } });
        client = project && project.client;
      }
      await prisma.payment.create({
        data: { projectId: md.projectId || null, invoiceId: md.invoiceId || null, amount: amount || 0, status: 'succeeded', stripeId: obj.id },
      });
      if (md.invoiceId) {
        await prisma.invoice.update({ where: { id: md.invoiceId }, data: { status: 'paid' } }).catch(() => {});
      }
      await notifyActivity('payment_received', { project, client, extra: { amount } });
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[stripe] handler error:', e.message);
    res.status(500).json({ error: 'handler_error' });
  }
}

module.exports = { router, webhookHandler };
