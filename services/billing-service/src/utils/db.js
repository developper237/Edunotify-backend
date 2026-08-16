// services/billing-service/src/utils/db.js

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

const connectDB = async () => {
  await prisma.$connect();
  console.log('[Billing Service] PostgreSQL connecté');
};

module.exports = { prisma, connectDB };
