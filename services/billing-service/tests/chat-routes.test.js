// Test de non-régression — parcours complet du chat contre un Prisma simulé.
// Usage : node tests/chat-routes.test.js [sans-clientid|avec-clientid]
//   npm test   (exécute les deux scénarios)
//
// Le stub refuse TOUTE référence à `clientId` quand le scénario est
// « sans-clientid », exactement comme un client Prisma non régénéré ou une
// base non migrée. Si une route y touche, le test échoue.
const jwt = require('jsonwebtoken');

const scenario = process.argv[2] || 'sans-clientid';
const avecClientId = scenario === 'avec-clientid';
process.env.JWT_SECRET = 'test-secret';

const erreur = () =>
  Object.assign(new Error('Unknown argument `clientId`'), {
    name: 'PrismaClientValidationError',
  });

// Parcourt les arguments Prisma et échoue si `clientId` est utilisé.
const garde = (args, contexte) => {
  if (avecClientId) return;
  const visiter = (valeur, chemin) => {
    if (!valeur || typeof valeur !== 'object') return;
    for (const [cle, v] of Object.entries(valeur)) {
      if (cle === 'clientId') throw erreur();
      visiter(v, `${chemin}.${cle}`);
    }
  };
  visiter(args, contexte);
};

const utilisateur = { id: 'user-1', nom: 'Doe', prenom: 'Jean', photoUrl: null };
const maintenant = new Date().toISOString();
const groupe = {
  id: 'groupe-1', nom: 'Cours de Maths', codeInvitation: 'SC-ABC123',
  photoUrl: null, creeParId: 'user-1', createdAt: maintenant,
  etablissementId: 'etab-1', _count: { membres: 3, messages: 12 },
  messages: [{ texte: 'Salut', createdAt: maintenant }],
};
const conversation = {
  id: 'conv-1', userAId: 'user-1', userBId: 'user-2',
  etablissementId: 'etab-1', createdAt: maintenant, updatedAt: maintenant,
  initiateur: utilisateur, invite: { ...utilisateur, id: 'user-2', prenom: 'Ada' },
  messages: [{ texte: 'Coucou', createdAt: maintenant, userId: 'user-2', lu: false }],
};
const messageGroupe = (data = {}) => ({
  id: 'msg-g1', groupId: 'groupe-1', userId: 'user-1', texte: 'Bonjour',
  pieceJointe: null, luPar: ['user-1'], createdAt: maintenant, user: utilisateur, ...data,
});
const messagePrive = (data = {}) => ({
  id: 'msg-p1', conversationId: 'conv-1', userId: 'user-1', texte: 'Bonjour',
  pieceJointe: null, lu: false, createdAt: maintenant, user: utilisateur, ...data,
});

const prisma = {
  groupeChat: {
    findUnique: async (a) => { garde(a, 'groupeChat.findUnique'); return groupe; },
    findMany: async (a) => { garde(a, 'groupeChat.findMany'); return [groupe]; },
    update: async (a) => { garde(a, 'groupeChat.update'); return groupe; },
  },
  membreGroupe: {
    findUnique: async (a) => { garde(a, 'membreGroupe.findUnique'); return { id: 'm-1' }; },
    findMany: async (a) => { garde(a, 'membreGroupe.findMany'); return a.select?.fcmToken ? [] : [{ groupId: 'groupe-1', dernierMessageLuLe: new Date(0) }]; },
    updateMany: async (a) => { garde(a, 'membreGroupe.updateMany'); return { count: 1 }; },
  },
  conversationPrivee: {
    findUnique: async (a) => { garde(a, 'conversationPrivee.findUnique'); return conversation; },
    findMany: async (a) => { garde(a, 'conversationPrivee.findMany'); return [conversation]; },
    update: async (a) => { garde(a, 'conversationPrivee.update'); return conversation; },
    delete: async (a) => { garde(a, 'conversationPrivee.delete'); return conversation; },
  },
  messageGroupe: {
    findFirst: async (a) => { garde(a, 'messageGroupe.findFirst'); return null; },
    findMany: async (a) => { garde(a, 'messageGroupe.findMany'); return [messageGroupe()]; },
    findUnique: async (a) => { garde(a, 'messageGroupe.findUnique'); return messageGroupe(); },
    create: async (a) => { garde(a, 'messageGroupe.create'); return messageGroupe(a.data || {}); },
    update: async (a) => { garde(a, 'messageGroupe.update'); return { id: 'msg-g1' }; },
    delete: async (a) => { garde(a, 'messageGroupe.delete'); return { id: 'msg-g1' }; },
    count: async (a) => { garde(a, 'messageGroupe.count'); return 2; },
  },
  messagePrive: {
    findFirst: async (a) => { garde(a, 'messagePrive.findFirst'); return null; },
    findMany: async (a) => { garde(a, 'messagePrive.findMany'); return [messagePrive()]; },
    findUnique: async (a) => { garde(a, 'messagePrive.findUnique'); return messagePrive(); },
    create: async (a) => { garde(a, 'messagePrive.create'); return messagePrive(a.data || {}); },
    updateMany: async (a) => { garde(a, 'messagePrive.updateMany'); return { count: 1 }; },
    delete: async (a) => { garde(a, 'messagePrive.delete'); return { id: 'msg-p1' }; },
    count: async (a) => { garde(a, 'messagePrive.count'); return 1; },
  },
  user: {
    findUnique: async (a) => { garde(a, 'user.findUnique'); return { etablissementId: 'etab-1', fcmToken: null }; },
    findMany: async (a) => { garde(a, 'user.findMany'); return [utilisateur]; },
  },
};

const cheminDb = require.resolve('../src/utils/db.js');
require.cache[cheminDb] = { id: cheminDb, filename: cheminDb, loaded: true, exports: { prisma, connectDB: async () => {} } };

const express = require('express');
const app = express();
app.use(express.json());
app.use('/chat', require('../src/routes/chat.routes.js'));

const serveur = app.listen(0, async () => {
  const base = `http://127.0.0.1:${serveur.address().port}/chat`;
  const token = jwt.sign({ id: 'user-1', role: 'etudiant', etablissementId: 'etab-1' }, process.env.JWT_SECRET);
  const entetes = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  let ok = true;
  const verifier = (nom, condition, detail = '') => {
    console.log(`${condition ? '✅' : '❌'} ${nom} ${detail}`);
    if (!condition) ok = false;
  };
  const appel = async (methode, chemin, corps) => {
    const r = await fetch(`${base}${chemin}`, {
      method: methode,
      headers: entetes,
      body: corps ? JSON.stringify(corps) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch (_) {}
    return { statut: r.status, data };
  };

  try {
    // ── Envoi de groupe ──
    const envoiG = await appel('POST', '/groups/groupe-1/messages', { texte: 'Bonjour', clientId: 'cid-g1' });
    verifier('POST message de groupe', envoiG.statut === 201, `(HTTP ${envoiG.statut})`);
    verifier('clientId présent dans la réponse seulement si supporté',
      avecClientId ? envoiG.data?.clientId === 'cid-g1' : envoiG.data?.clientId === undefined);
    verifier('Champs attendus par le mobile présents',
      envoiG.data?.id && envoiG.data?.texte === 'Bonjour' && 'luPar' in envoiG.data && envoiG.data?.user?.id === 'user-1');

    // ── Envoi privé ──
    const envoiP = await appel('POST', '/privates/conv-1/messages', { texte: 'Bonjour', clientId: 'cid-p1' });
    verifier('POST message privé', envoiP.statut === 201, `(HTTP ${envoiP.statut})`);
    verifier('Champ lu présent (contrat mobile)', 'lu' in (envoiP.data || {}));

    // ── Lectures ──
    const listeG = await appel('GET', '/groups/groupe-1/messages?limit=10');
    verifier('GET messages de groupe', listeG.statut === 200 && Array.isArray(listeG.data?.messages), `(HTTP ${listeG.statut})`);
    const listeP = await appel('GET', '/privates/conv-1/messages');
    verifier('GET messages privés', listeP.statut === 200 && Array.isArray(listeP.data?.messages), `(HTTP ${listeP.statut})`);
    const hubs = await appel('GET', '/groups');
    verifier('GET liste des groupes', hubs.statut === 200 && hubs.data?.groupes?.[0]?.dernierMessage === 'Salut', `(HTTP ${hubs.statut})`);
    const convs = await appel('GET', '/privates');
    verifier('GET liste des conversations', convs.statut === 200 && convs.data?.conversations?.[0]?.dernierMessage === 'Coucou', `(HTTP ${convs.statut})`);
    const nonLus = await appel('GET', '/non-lus');
    verifier('GET compteur non-lus', nonLus.statut === 200 && typeof nonLus.data?.count === 'number', `(HTTP ${nonLus.statut})`);

    // ── Suppressions ──
    const suppG = await appel('DELETE', '/groups/groupe-1/messages/msg-g1');
    verifier('DELETE message de groupe', suppG.statut === 200, `(HTTP ${suppG.statut})`);
    const suppP = await appel('DELETE', '/privates/conv-1/messages/msg-p1');
    verifier('DELETE message privé', suppP.statut === 200, `(HTTP ${suppP.statut})`);
  } catch (e) {
    console.log('❌ Exception:', e.message);
    ok = false;
  } finally {
    serveur.close();
    process.exit(ok ? 0 : 1);
  }
});
