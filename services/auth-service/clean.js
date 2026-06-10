const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.voteSondage.deleteMany();
  await prisma.notificationDestinataire.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.presence.deleteMany();
  await prisma.sessionPresence.deleteMany();
  await prisma.note.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany({ where: { role: { not: 'super_admin' } } });
  await prisma.classe.deleteMany();
  await prisma.departement.deleteMany();
  await prisma.etablissement.deleteMany();
  console.log('Tout supprime, super admin conserve');
  await prisma.disconnect();
}

main().catch(console.error);