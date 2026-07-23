// One-off: create/reset the first admin user.
// Usage: node src/scripts/createAdmin.js you@example.com yourStrongPassword
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../db');

(async () => {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Usage: node src/scripts/createAdmin.js <email> <password>');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'super_admin' },
    create: { email, passwordHash, role: 'super_admin', name: 'Owner' },
  });
  console.log('Admin ready:', user.email);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
