// services/notification-service/src/index.js

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const morgan    = require('morgan');
const { PrismaClient } = require('@prisma/client');
const { initFirebase, sendPushToOne, sendPushToMany } = require('./firebase');

const app    = express();
const PORT   = process.env.PORT || 3003;
const prisma = new PrismaClient();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// ══════════════════════════════════════════════════════════════════
// MIDDLEWARES
// ══════════════════════════════════════════════════════════════════

const auth = (req, res, next) => {
  req.user = {
    id:              req.headers['x-user-id'],
    role:            req.headers['x-user-role'],
    etablissementId: req.headers['x-etab-id']   || null,
    departementId:   req.headers['x-dept-id']   || null,
    classeId:        req.headers['x-classe-id'] || null,
  };
  if (!req.user.id) return res.status(401).json({ error: 'Non authentifié' });
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });
  next();
};

// ══════════════════════════════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════════════════════════════

const resolveDestinataires = async (cible, user) => {
  const where = {};

  switch (cible) {
    case 'all':
      if (!user.etablissementId) return [];
      where.etablissementId = user.etablissementId;
      where.role = { in: ['etudiant', 'delegue', 'chef_departement'] };
      break;

    case 'dept':
      if (!user.departementId) return [];
      where.departementId   = user.departementId;
      where.etablissementId = user.etablissementId;
      where.role = { in: ['etudiant', 'delegue'] };
      break;

    case 'classe':
      if (!user.classeId) return [];
      where.classeEtudiantId = user.classeId;
      break;

    default:
      if (['L1','L2','L3','M1','M2'].includes(cible)) {
        if (!user.departementId) return [];
        where.departementId   = user.departementId;
        where.etablissementId = user.etablissementId;
        where.classeEtudiant  = { niveau: cible };
        where.role            = 'etudiant';
      } else {
        return [];
      }
  }

  return prisma.user.findMany({ where, select: { id: true, fcmToken: true } });
};

// ══════════════════════════════════════════════════════════════════
// POST /notifications — Envoyer une notification
// ══════════════════════════════════════════════════════════════════

app.post('/notifications', auth, async (req, res) => {
  const allowed = ['delegue','chef_departement','admin','super_admin'];
  if (!allowed.includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  const { titre, contenu, categorie, urgence, cible } = req.body;
  if (!titre || !contenu)
    return res.status(400).json({ error: 'Titre et contenu obligatoires' });

  let cibleEffective = cible;
  if (req.user.role === 'admin')            cibleEffective = 'all';
  if (req.user.role === 'chef_departement') cibleEffective = cible || 'dept';
  if (req.user.role === 'delegue')          cibleEffective = 'classe';

  try {
    const dests = await resolveDestinataires(cibleEffective, req.user);
    if (dests.length === 0)
      return res.status(400).json({ error: 'Aucun destinataire trouvé' });

    const notif = await prisma.notification.create({
      data: {
        titre, contenu,
        categorie:       categorie || 'administratif',
        urgence:         urgence   || false,
        expediteurId:    req.user.id,
        etablissementId: req.user.etablissementId || null,
        destinataires:   { create: dests.map(d => ({ userId: d.id })) },
      },
    });

    // Push FCM
    const tokens = dests.filter(d => d.fcmToken).map(d => d.fcmToken);
    if (tokens.length > 0) {
      sendPushToMany(tokens, titre, contenu, { notificationId: notif.id })
        .catch(console.error);
    }

    return res.status(201).json({
      message:         `Envoyée à ${dests.length} destinataire(s)`,
      notificationId:  notif.id,
      nbDestinataires: dests.length,
    });
  } catch (err) {
    console.error('[Notifications] Envoyer:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /notifications/sondage — Créer un sondage
// ══════════════════════════════════════════════════════════════════

app.post('/notifications/sondage', auth, async (req, res) => {
  const allowed = ['delegue','chef_departement','admin','super_admin'];
  if (!allowed.includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  const { question, choix, cible } = req.body;
  if (!question || !choix || choix.length < 2)
    return res.status(400).json({ error: 'Question et 2 choix minimum requis' });

  try {
    const dests = await resolveDestinataires(cible || 'classe', req.user);

    const notif = await prisma.notification.create({
      data: {
        titre:        `📊 ${question}`,
        contenu:      question,
        categorie:    'administratif',
        urgence:      false,
        estSondage:   true,
        expediteurId: req.user.id,
        choixSondage: { create: choix.map((texte, i) => ({ texte, ordre: i })) },
        destinataires: { create: dests.map(d => ({ userId: d.id })) },
      },
      include: { choixSondage: true },
    });

    const tokens = dests.filter(d => d.fcmToken).map(d => d.fcmToken);
    if (tokens.length > 0) {
      sendPushToMany(tokens, '📊 Sondage', question, { notificationId: notif.id })
        .catch(console.error);
    }

    return res.status(201).json({
      message:        `Sondage envoyé à ${dests.length} destinataire(s)`,
      notificationId: notif.id,
      choix:          notif.choixSondage,
    });
  } catch (err) {
    console.error('[Notifications] Sondage:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /notifications/non-lues — Badge compteur
// ══════════════════════════════════════════════════════════════════

app.get('/notifications/non-lues', auth, async (req, res) => {
  try {
    const count = await prisma.notificationDestinataire.count({
      where: { userId: req.user.id, lue: false },
    });
    return res.json({ count });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /notifications/mes-notifications — Liste paginée
// ══════════════════════════════════════════════════════════════════

app.get('/notifications/mes-notifications', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const whereDestinataire = { userId: req.user.id };
    const notifFilter = {};

    const [total, items] = await Promise.all([
      prisma.notificationDestinataire.count({
        where: { ...whereDestinataire, ...notifFilter },
      }),
      prisma.notificationDestinataire.findMany({
        where: { ...whereDestinataire, ...notifFilter },
        include: {
          notification: {
            include: {
              expediteur:   { select: { nom: true, prenom: true, role: true } },
              choixSondage: { include: { _count: { select: { votes: true } } } },
            },
          },
        },
        orderBy: { notification: { createdAt: 'desc' } },
        skip,
        take: parseInt(limit),
      }),
    ]);

    return res.json({
      total,
      page: parseInt(page),
      notifs: items.map(item => ({
        id:  item.id,
        lue: item.lue,
        notification: {
          id:         item.notification.id,
          titre:      item.notification.titre,
          contenu:    item.notification.contenu,
          categorie:  item.notification.categorie,
          urgence:    item.notification.urgence,
          estSondage: item.notification.estSondage,
          createdAt:  item.notification.createdAt,
          expediteur: `${item.notification.expediteur.prenom} ${item.notification.expediteur.nom}`,
          choixSondage: item.notification.choixSondage.map(c => ({
            id: c.id, texte: c.texte, votes: c._count.votes,
          })),
        },
      })),
    });
  } catch (err) {
    console.error('[Notifications] MesNotifs:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// PUT /notifications/:id/lire — Marquer comme lue
// ══════════════════════════════════════════════════════════════════

app.put('/notifications/:id/lire', auth, async (req, res) => {
  try {
    await prisma.notificationDestinataire.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data:  { lue: true, lueLe: new Date() },
    });
    return res.json({ message: 'Lu' });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /notifications/sondage/:notifId/voter — Voter
// ══════════════════════════════════════════════════════════════════

app.post('/notifications/sondage/:notifId/voter', auth, async (req, res) => {
  const { choixId } = req.body;
  if (!choixId) return res.status(400).json({ error: 'choixId requis' });

  try {
    const dest = await prisma.notificationDestinataire.findFirst({
      where: { notificationId: req.params.notifId, userId: req.user.id },
    });
    if (!dest) return res.status(403).json({ error: 'Non destinataire' });

    const existingVote = await prisma.voteSondage.findFirst({
      where: { userId: req.user.id, choix: { notificationId: req.params.notifId } },
    });
    if (existingVote) return res.status(409).json({ error: 'Déjà voté' });

    await prisma.voteSondage.create({ data: { choixId, userId: req.user.id } });

    await prisma.notificationDestinataire.updateMany({
      where: { notificationId: req.params.notifId, userId: req.user.id },
      data:  { lue: true, lueLe: new Date() },
    });

    const choix      = await prisma.choixSondage.findMany({
      where:   { notificationId: req.params.notifId },
      include: { _count: { select: { votes: true } } },
    });
    const totalVotes = choix.reduce((sum, c) => sum + c._count.votes, 0);

    return res.json({
      message: 'Vote enregistré',
      resultats: choix.map(c => ({
        id:          c.id,
        texte:       c.texte,
        votes:       c._count.votes,
        pourcentage: totalVotes > 0
          ? Math.round((c._count.votes / totalVotes) * 100)
          : 0,
      })),
    });
  } catch (err) {
    console.error('[Notifications] Voter:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /notifications/interne — Appelée par d'autres services
// ══════════════════════════════════════════════════════════════════

app.post('/notifications/interne', async (req, res) => {
  const { titre, contenu, categorie, destinataires, expediteurId } = req.body;
  if (!titre || !contenu || !destinataires?.length)
    return res.status(400).json({ error: 'Données manquantes' });

  try {
    const notif = await prisma.notification.create({
      data: {
        titre,
        contenu,
        categorie:    categorie || 'administratif',
        urgence:      false,
        estSondage:   false,
        expediteurId: expediteurId || destinataires[0], // fallback
        destinataires: {
          create: destinataires.map(userId => ({ userId })),
        },
      },
    });

    // Push FCM aux destinataires
    const users = await prisma.user.findMany({
      where:  { id: { in: destinataires } },
      select: { fcmToken: true },
    });
    const tokens = users.filter(u => u.fcmToken).map(u => u.fcmToken);
    if (tokens.length > 0) {
      sendPushToMany(tokens, titre, contenu, { notificationId: notif.id })
        .catch(console.error);
    }

    return res.status(201).json({ message: 'Notification créée', id: notif.id });
  } catch (err) {
    console.error('[Notif] interne:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════════════

app.get('/health', (_, res) =>
  res.json({ status: 'ok', service: 'notification-service' }));

// ══════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════

const start = async () => {
  initFirebase();
  await prisma.$connect();
  app.listen(PORT, () =>
    console.log(`[Notification Service] Port ${PORT} — OK`));
};

start().catch(err => { console.error(err); process.exit(1); });