const path = require('path');

let PrismaClient;
try {
  const rootGenerated = path.resolve(__dirname, '../../../../node_modules/.prisma/client');
  const generated = require(rootGenerated);
  PrismaClient = generated.PrismaClient;
  if (!PrismaClient) throw new Error('PrismaClient not exported');
} catch (_) {
  PrismaClient = require('@prisma/client').PrismaClient;
}

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

const connectDB = async () => {
  await prisma.$connect();
  console.log('[Exam Service] PostgreSQL connecté');
};

module.exports = { prisma, connectDB };
