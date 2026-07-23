// Admin activity feed (audit trail of every event).
const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const items = await prisma.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(items);
});

module.exports = router;
