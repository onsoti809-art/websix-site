// Public quote submission + admin listing.
// POST /api/quotes  -> creates a Project (+ unique ID) and Quote, then emails client + owner.
const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const { notifyActivity } = require('../notify');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function publicId() {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 5; i++) r += s[Math.floor(Math.random() * s.length)];
  return 'WX-' + new Date().getFullYear() + '-' + r;
}

const schema = z.object({
  type: z.string(),
  fields: z.record(z.any()).default({}),
  features: z.array(z.string()).optional().default([]),
  addons: z.array(z.string()).optional().default([]),
  estimate: z.object({ low: z.number().optional(), high: z.number().optional(), tier: z.string().optional() }).partial().optional(),
  summary: z.string().optional(),
});

router.post('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', details: parsed.error.issues });
  const d = parsed.data;
  const f = d.fields || {};
  try {
    const email = String(f.contact_email || f.email || '').trim().toLowerCase();
    let client = null;
    if (email) {
      client = await prisma.client.upsert({
        where: { email },
        update: { businessName: f.biz_name || undefined, phone: f.contact_phone || undefined },
        create: { email, businessName: f.biz_name || 'Unknown business', contactName: f.contact_name || null, phone: f.contact_phone || null },
      });
    }
    const project = await prisma.project.create({
      data: {
        publicId: publicId(),
        clientId: client ? client.id : null,
        type: d.type,
        status: 'quote_requested',
        summary: d.summary || null,
        tier: (d.estimate && d.estimate.tier) || null,
        estimateLow: (d.estimate && d.estimate.low) || null,
        estimateHigh: (d.estimate && d.estimate.high) || null,
        data: d,
      },
    });
    await prisma.quote.create({
      data: { projectId: project.id, amount: (d.estimate && d.estimate.low) || 0, scope: { features: d.features, addons: d.addons }, status: 'submitted' },
    });
    // Emails BOTH the client (confirmation) and the owner (notification):
    await notifyActivity('quote_submitted', { project, client });
    res.json({ ok: true, projectId: project.publicId });
  } catch (e) {
    console.error('[quotes] error:', e.message);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  const items = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { client: true, quotes: true },
  });
  res.json(items);
});

module.exports = router;
