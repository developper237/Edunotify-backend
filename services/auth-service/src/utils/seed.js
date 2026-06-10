// services/auth-service/src/utils/seed.js
// Lance avec : npm run db:seed

const { PrismaClient } = require('../../../node_modules/.prisma/client');
const bcrypt           = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding EduNotify...');

  // Créer le Super Admin
  const existing = await prisma.user.findUnique({
    where: { email: 'superadmin@edunotify.cm' },
  });

  if (existing) {
    console.log('✅ Super Admin existe déjà');
  } else {
    const passwordHash = await bcrypt.hash('EduNotify@2025!', 12);

    const superAdmin = await prisma.user.create({
      data: {
        nom:          'ADMIN',
        prenom:       'Super',
        email:        'superadmin@edunotify.cm',
        passwordHash,
        role:         'super_admin',
        statut:       'actif',
      },
    });

    console.log('✅ Super Admin créé:');
    console.log('   Email    :', superAdmin.email);
    console.log('   Password : EduNotify@2025!');
    console.log('   ⚠️  Changez ce mot de passe en production !');
  }

  console.log('✅ Seed terminé');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
