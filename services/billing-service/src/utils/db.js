// services/billing-service/src/utils/db.js
// Monorepo fix: on Render, `prisma generate` outputs the client to the
// root ../../node_modules/.prisma/client but require('@prisma/client') resolves
// to the service-local node_modules which only has the un-generated stub.
// We detect the generated client location dynamically.

const path = require('path');

let PrismaClient;
try {
  // On Render monorepo, prisma generate outputs to root node_modules
  // but local require resolves to the un-generated stub.
  // Try root first (Render prod), then local (dev).
  const rootMod = require(path.resolve(__dirname, '../../..', 'node_modules', '@prisma', 'client'));
  if (rootMod && rootMod.PrismaClient) {
    PrismaClient = rootMod.PrismaClient;
  } else {
    throw new Error('no PrismaClient on root');
  }
} catch (_) {
  PrismaClient = require('@prisma/client').PrismaClient;
}

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

const connectDB = async () => {
  await prisma.$connect();
  console.log('[Billing Service] PostgreSQL connecté');
};

module.exports = { prisma, connectDB };
