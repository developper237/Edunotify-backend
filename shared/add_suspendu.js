const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.$queryRawUnsafe("ALTER TYPE \"StatutCompte\" ADD VALUE IF NOT EXISTS 'suspendu'");
    console.log('OK - suspendu ajoute avec succes');
  } catch (e) {
    console.error('Erreur:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();