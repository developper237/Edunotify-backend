// services/billing-service/src/utils/db.js
// Monorepo fix: on Render, `prisma generate` outputs the client to the
// root node_modules/.prisma/client but require('@prisma/client') resolves
// to the service-local node_modules which only has the un-generated stub.
// We load the generated client DIRECTLY from .prisma/client (not @prisma/client).

const path = require('path');

let PrismaClient;

// __dirname = .../services/billing-service/src/utils  (4 levels from repo root)
const ROOT = path.resolve(__dirname, '../../../..');
const generatedPath = path.join(ROOT, 'node_modules', '.prisma', 'client');

try {
  // Load generated client directly from root (bypasses @prisma/client stub)
  const generated = require(generatedPath);
  PrismaClient = generated.PrismaClient;
  if (!PrismaClient) throw new Error('PrismaClient not exported');
  console.log('[Billing] PrismaClient chargé depuis:', generatedPath);
} catch (e1) {
  console.warn('[Billing] Client racine introuvable, essai local:', e1.message);
  try {
    // Local dev or single-service deploy
    PrismaClient = require('@prisma/client').PrismaClient;
  } catch (e2) {
    // Last resort: try root via @prisma/client package
    try {
      const rootPkg = path.join(ROOT, 'node_modules', '@prisma', 'client');
      PrismaClient = require(rootPkg).PrismaClient;
    } catch (e3) {
      console.error('[Billing] Impossible de charger PrismaClient:', e3.message);
      throw e3;
    }
  }
}

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

const connectDB = async () => {
  await prisma.$connect();
  console.log('[Billing Service] PostgreSQL connecté');
};

module.exports = { prisma, connectDB };
