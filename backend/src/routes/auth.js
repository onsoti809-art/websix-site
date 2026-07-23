// Admin/staff auth. First user becomes super_admin. Further registrations require
// ADMIN_BOOTSTRAP_TOKEN so the endpoint can't be abused once you're set up.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../db');

const router = express.Router();
const cred = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  token: z.string().optional(),
});

router.post('/register', async (req, res) => {
  const p = cred.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid_payload' });
  const { email, password, name, token } = p.data;
  const count = await prisma.user.count();
  if (count > 0) {
    if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
      return res.status(403).json({ error: 'registration_closed' });
    }
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, name: name || null, role: count === 0 ? 'super_admin' : 'admin' },
  });
  res.json({ id: user.id, email: user.email, role: user.role });
});

router.post('/login', async (req, res) => {
  const p = cred.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid_payload' });
  const user = await prisma.user.findUnique({ where: { email: p.data.email } });
  if (!user) return res.status(401).json({ error: 'bad_credentials' });
  const ok = await bcrypt.compare(p.data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'bad_credentials' });
  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '12h' }
  );
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
});

module.exports = router;
