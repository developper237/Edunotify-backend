// services/presence-service/src/utils/db.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const connectDB = async () => {
  await prisma.$connect();
  console.log('[Presence Service] PostgreSQL connecté');
};
module.exports = { prisma, connectDB };
