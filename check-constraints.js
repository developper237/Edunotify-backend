// check-constraints.js
// Usage (depuis edunotify-backend) :
//   $env:DATABASE_URL="postgresql://edunotify:edunotify_secret@localhost:5432/edunotify"
//   node check-constraints.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('── Contraintes FK: User -> Classe ──────────────────────');
  const userToClasse = await prisma.$queryRawUnsafe(`
    SELECT
      con.conname                                   AS contrainte,
      att.attname                                   AS colonne,
      CASE con.confdeltype
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE con.confdeltype
      END                                            AS on_delete
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
    WHERE con.conrelid = '"User"'::regclass
      AND con.confrelid = '"Classe"'::regclass
      AND con.contype = 'f';
  `);
  console.table(userToClasse);

  console.log('\n── Contrainte FK: SessionPresence -> Classe ────────────');
  const sessionToClasse = await prisma.$queryRawUnsafe(`
    SELECT
      con.conname AS contrainte,
      att.attname AS colonne,
      CASE con.confdeltype
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE con.confdeltype
      END AS on_delete
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
    WHERE con.conrelid = '"SessionPresence"'::regclass
      AND con.confrelid = '"Classe"'::regclass
      AND con.contype = 'f';
  `);
  console.table(sessionToClasse);

  console.log('\nAttendu : on_delete = CASCADE pour les 3 lignes ci-dessus.');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
