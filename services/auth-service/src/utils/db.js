// services/auth-service/src/utils/db.js

const { PrismaClient } = require('../../../node_modules/.prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

const connectDB = async () => {
  await prisma.$connect();
  console.log('[Auth Service] PostgreSQL connecté');
};

module.exports = { prisma, connectDB };
