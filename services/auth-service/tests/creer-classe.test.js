// Vérification — POST /auth/cascade/classe
// Création d'une classe : le compte délégué doit recevoir son matricule et
// être rattaché comme étudiant de la classe (sinon l'import des notes le
// déclare « Étudiant introuvable » et il ne reçoit jamais ses notes).
//
// Usage : node tests/creer-classe.test.js
const path = require('path');

// ── Stub Prisma ──────────────────────────────────────────────────
const etat = {
  classeCreee: null,
  delegueCree: null,
  matriculePris: null, // matricule déjà occupé par un autre compte
};

const prisma = {
  user: {
    findUnique: async () => ({
      id: 'chef-1',
      etablissementId: 'etab-1',
      departementId: 'dept-1',
      departementChef: { nom: 'Génie Informatique' },
    }),
    findFirst: async ({ where }) => {
      const cible = where?.matricule?.equals ?? where?.matricule;
      if (!etat.matriculePris || !cible) return null;
      return String(etat.matriculePris).toLowerCase() === String(cible).toLowerCase()
        ? { id: 'autre-user' }
        : null;
    },
    create: async ({ data }) => {
      etat.delegueCree = data;
      return { id: 'delegue-1', email: data.email, matricule: data.matricule };
    },
  },
  classe: {
    create: async ({ data }) => {
      etat.classeCreee = data;
      return { id: 'classe-1', ...data };
    },
  },
};

// ── Stub EmailService (aucun envoi réel) ─────────────────────────
const email = { echoue: false };
const stubEmail = {
  sendDelegueCredentials: async () => {
    if (email.echoue) throw new Error('SMTP indisponible');
    return true;
  },
};

const cheminDb = require.resolve(path.join(__dirname, '../src/utils/db.js'));
require.cache[cheminDb] = {
  id: cheminDb, filename: cheminDb, loaded: true,
  exports: { prisma, connectDB: async () => {} },
};

const cheminEmail = require.resolve(
  path.join(__dirname, '../../../shared/email/emailService.js')
);
require.cache[cheminEmail] = {
  id: cheminEmail, filename: cheminEmail, loaded: true, exports: stubEmail,
};

const controleur = require('../src/controllers/cascade.controller.js');
const creerClasse = controleur.creerClasse || controleur.default?.creerClasse;

// ── Helpers req/res ──────────────────────────────────────────────
const fausseReponse = () => {
  const res = { code: null, corps: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.corps = b; return res; };
  return res;
};

const fausseRequete = (body) => ({
  user: { id: 'chef-1', role: 'chef_departement' },
  body,
});

const corpsDeBase = (extra = {}) => ({
  nomSalle: 'Salle 12',
  filiere: 'Génie Informatique',
  niveau: 'L3',
  formation: 'FI',
  emailDelegue: 'delegue@classe.cm',
  prenomDelegue: 'Delegue',
  nomDelegue: 'Salle 12',
  ...extra,
});

let ok = true;
const verifier = (nom, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${nom} ${detail}`);
  if (!condition) ok = false;
};

const executer = async (body) => {
  etat.delegueCree = null;
  etat.classeCreee = null;
  const res = fausseReponse();
  await creerClasse(fausseRequete(corpsDeBase(body)), res);
  return res;
};

(async () => {
  // 1. Cas nominal : le chef saisit le matricule du délégué
  let res = await executer({ matriculeDelegue: '21G0042' });
  verifier('Classe créée (201)', res.code === 201, `(HTTP ${res.code})`);
  verifier('Matricule du délégué enregistré', etat.delegueCree?.matricule === '21G0042',
    `(reçu : ${etat.delegueCree?.matricule})`);
  verifier('Délégué rattaché comme étudiant de la classe',
    etat.delegueCree?.classeEtudiantId === 'classe-1');
  verifier('Délégué rattaché comme délégué de la classe',
    etat.delegueCree?.classeDelegueId === 'classe-1');
  verifier('Rôle délégué conservé', etat.delegueCree?.role === 'delegue');
  verifier('Aucun avertissement', res.corps?.avertissement === undefined);
  verifier('Récapitulatif du délégué renvoyé au mobile',
    res.corps?.delegue?.matricule === '21G0042');

  // 2. Matricule déjà utilisé par un autre compte → création non bloquée
  etat.matriculePris = '21G0042';
  res = await executer({ matriculeDelegue: '21G0042' });
  verifier('Classe créée malgré le matricule déjà pris', res.code === 201, `(HTTP ${res.code})`);
  verifier('Délégué créé sans matricule', etat.delegueCree?.matricule === null);
  verifier('Avertissement renvoyé au chef', typeof res.corps?.avertissement === 'string');
  verifier('Délégué toujours étudiant de sa classe',
    etat.delegueCree?.classeEtudiantId === 'classe-1');

  // 3. Matricule saisi dans une autre casse que celui déjà en base
  etat.matriculePris = '21g0042';
  res = await executer({ matriculeDelegue: '21G0042' });
  verifier('Collision détectée sans tenir compte de la casse', res.code === 201 &&
    typeof res.corps?.avertissement === 'string');
  etat.matriculePris = null;

  // 4. Ancien formulaire sans matricule → aucun blocage
  res = await executer({});
  verifier('Classe créée sans matricule', res.code === 201, `(HTTP ${res.code})`);
  verifier('Délégué quand même rattaché comme étudiant',
    etat.delegueCree?.classeEtudiantId === 'classe-1');

  // 5. Échec d'envoi des identifiants → la classe reste créée
  email.echoue = true;
  res = await executer({ matriculeDelegue: '21G0043' });
  verifier('Classe créée même si l\'email échoue', res.code === 201, `(HTTP ${res.code})`);
  verifier('Matricule conservé malgré l\'échec email',
    etat.delegueCree?.matricule === '21G0043');
  email.echoue = false;

  console.log(ok ? '\n✅ Tous les cas passent' : '\n❌ Au moins un cas échoue');
  process.exit(ok ? 0 : 1);
})();
