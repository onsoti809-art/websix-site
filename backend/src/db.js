// Single shared Prisma client instance.
const { PrismaClient } = require('@prisma/client');

const prisma = global.__websixPrisma || new PrismaClient();
if (!global.__websixPrisma) global.__websixPrisma = prisma;

module.exports = prisma;
