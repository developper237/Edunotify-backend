const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://edunotify:edunotify_secret@localhost:5432/edunotify'
});
async function run() {
  await client.connect();
  try {
    await client.query("ALTER TYPE \"StatutCompte\" ADD VALUE IF NOT EXISTS 'suspendu'");
    console.log('Succes : suspendu ajoute a StatutCompte');
  } catch (e) {
    console.error('Erreur:', e.message);
  } finally {
    await client.end();
  }
}
run();
