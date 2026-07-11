// services/notification-service/src/index.js

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const morgan    = require('morgan');
const { PrismaClient } = require('../../../node_modules/.prisma/client');
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

// Ajoute l'expéditeur dans la liste des destinataires s'il n'y est pas
const ajouterExpediteur = (dests, expediteurId) => {
  const ids = new Set(dests.map(d => d.id));
  if (!ids.has(expediteurId)) {
    dests.push({ id: expediteurId, fcmToken: null });
  }
  return dests;
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
    let dests = await resolveDestinataires(cibleEffective, req.user);
    if (dests.length === 0)
      return res.status(400).json({ error: 'Aucun destinataire trouvé' });

    // ← Ajouter l'expéditeur pour traçabilité
    dests = ajouterExpediteur(dests, req.user.id);

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

    // Push FCM (sauf à l'expéditeur lui-même)
    const tokens = dests
      .filter(d => d.fcmToken && d.id !== req.user.id)
      .map(d => d.fcmToken);
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

  // 1. Récupération du 'titre' depuis le body
  const { titre, questions, cible, destinataires } = req.body;
  const target = destinataires ?? cible ?? 'classe';

  // 2. Validation du titre
  if (!titre || !titre.trim()) {
    return res.status(400).json({ error: 'L\'objet du sondage est requis' });
  }

  try {
    // Validation et normalisation des questions (existant)
    const rawQuestions = Array.isArray(questions) && questions.length > 0
      ? questions
      : []; // On force l'usage du tableau questions envoyé par Flutter

    if (rawQuestions.length === 0) {
      return res.status(400).json({ error: 'Au moins une question est requise' });
    }

    const normalizedQuestions = rawQuestions.map(item => {
      const questionText = typeof item?.question === 'string' ? item.question.trim() : '';
      if (!questionText) throw new Error('Chaque question doit avoir un texte');

      const options = Array.isArray(item?.choix) ? item.choix : [];
      if (options.length < 2) throw new Error('Chaque question doit contenir au moins 2 choix');

      return {
        question:    questionText,
        obligatoire: Boolean(item?.obligatoire === true || item?.required === true),
        choix:       options
          .map((texte, i) => ({ texte: String(texte).trim(), ordre: i }))
          .filter(option => option.texte.length > 0),
      };
    });

    let dests = await resolveDestinataires(target, req.user);
    if (dests.length === 0)
      return res.status(400).json({ error: 'Aucun destinataire trouvé' });

    dests = ajouterExpediteur(dests, req.user.id);

    // 3. Utilisation du TITRE envoyé par l'utilisateur
    const notif = await prisma.notification.create({
      data: {
        titre:     ` ${titre.trim()}`, // Titre personnalisé
        contenu:   normalizedQuestions.map(item => item.question).join(' • '),
        categorie:    'administratif',
        urgence:      false,
        estSondage:   true,
        expediteurId: req.user.id,
        destinataires: { create: dests.map(d => ({ userId: d.id })) },
      },
    });

    // Insertion des questions et choix (existant)
    for (const [qIndex, item] of normalizedQuestions.entries()) {
      const q = await prisma.questionSondage.create({
        data: {
          notificationId: notif.id,
          texte:          item.question,
          ordre:          qIndex,
          obligatoire:    item.obligatoire ?? false,
        },
      });

      for (const [choiceIndex, option] of item.choix.entries()) {
        await prisma.choixSondage.create({
          data: {
            questionId:     q.id,
            notificationId: notif.id,
            texte:          option.texte,
            ordre:          option.ordre ?? choiceIndex,
          },
        });
      }
    }

    const fullNotif = await prisma.notification.findUnique({
      where:   { id: notif.id },
      include: { questionsSondage: { include: { choixSondage: true } } },
    });

    res.status(201).json({ 
      message: 'Sondage envoyé', 
      notification: fullNotif,
      nbDestinataires: dests.length 
    });

  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'Erreur lors de la création du sondage' });
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

    const [total, items] = await Promise.all([
      prisma.notificationDestinataire.count({ where: whereDestinataire }),
      prisma.notificationDestinataire.findMany({
        where:   whereDestinataire,
        include: {
          notification: {
            include: {
              expediteur: { select: { nom: true, prenom: true, role: true } },
              // CORRECTION ICI : On ne peut pas utiliser 'item' ici. 
              // Prisma inclura l'expediteurId automatiquement car c'est une clé étrangère.
              questionsSondage: {
                orderBy: { ordre: 'asc' },
                include: {
                  choixSondage: {
                    orderBy: { ordre: 'asc' },
                    include: { _count: { select: { votes: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: { notification: { createdAt: 'desc' } },
        skip,
        take: parseInt(limit),
      }),
    ]);


    const notifIds = items
      .filter(item => item.notification.estSondage)
      .map(item => item.notification.id);

    // Récupérer les votes de l'utilisateur sur ces sondages
    const votesUtilisateur = notifIds.length > 0
      ? await prisma.voteSondage.findMany({
          where: {
            userId:  req.user.id,
            choix: {
              notificationId: { in: notifIds }
            }
          },
          select: { choixId: true },
        })
      : [];

    const choixVotes = new Set(votesUtilisateur.map(v => v.choixId));

    return res.json({
      total,
      page: parseInt(page),
      notifications: items.map(item => {
        const notif = item.notification;
        // CORRECTION : expediteurId est disponible directement sur l'objet notif
        const estExpediteur = notif.expediteurId === req.user.id;

        return {
          id:  item.id,
          lue: item.lue,
          notification: {
            id:          notif.id,
            titre:       notif.titre,
            contenu:     notif.contenu,
            categorie:   notif.categorie,
            urgence:     notif.urgence,
            estSondage:  notif.estSondage,
            createdAt:   notif.createdAt,
            expediteur:  `${notif.expediteur.prenom} ${notif.expediteur.nom}`,
            expediteurId: notif.expediteurId,
            estExpediteur, 
            questionsSondage: (notif.questionsSondage ?? []).map(q => {
              const totalQ = q.choixSondage.reduce(
                (s, c) => s + (c._count?.votes ?? 0), 0
              );
              return {
                id:          q.id,
                texte:       q.texte,
                ordre:       q.ordre,
                obligatoire: q.obligatoire ?? false,
                choixSondage: (q.choixSondage ?? []).map(c => ({
                  id:          c.id,
                  texte:       c.texte,
                  questionId:  c.questionId,
                  ordre:       c.ordre,
                  votes:       c._count?.votes ?? 0,
                  pourcentage: totalQ > 0
                    ? Math.round(((c._count?.votes ?? 0) / totalQ) * 100)
                    : 0,
                  aVote: choixVotes.has(c.id),
                })),
              };
            }),
          },
        };
      }),
    });
  } catch (err) {
    console.error('[Notifications] MesNotifs:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ... (reste du fichier identique)

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
  const { choixId, choixIds } = req.body;
  const tousLesChoix = choixIds ?? (choixId ? [choixId] : []);

  if (tousLesChoix.length === 0)
    return res.status(400).json({ error: 'choixId(s) requis' });

  try {
    const dest = await prisma.notificationDestinataire.findFirst({
      where: { notificationId: req.params.notifId, userId: req.user.id },
    });
    if (!dest) return res.status(403).json({ error: 'Non destinataire' });

    // ← L'expéditeur peut voir les résultats sans voter
    const notif = await prisma.notification.findUnique({
      where:  { id: req.params.notifId },
      select: { expediteurId: true },
    });
    if (notif?.expediteurId === req.user.id) {
      return res.status(403).json({
        error: 'En tant qu\'auteur du sondage, vous pouvez voir les résultats sans voter',
      });
    }

    // Vérifier si déjà voté
    const existingVote = await prisma.voteSondage.findFirst({
      where: { userId: req.user.id, choixId: { in: tousLesChoix } },
    });
    if (existingVote) return res.status(409).json({ error: 'Déjà voté' });

    await prisma.voteSondage.createMany({
      data:           tousLesChoix.map(cId => ({ choixId: cId, userId: req.user.id })),
      skipDuplicates: true,
    });

    await prisma.notificationDestinataire.updateMany({
      where: { notificationId: req.params.notifId, userId: req.user.id },
      data:  { lue: true, lueLe: new Date() },
    });

    // Retourner les résultats
    const questions = await prisma.questionSondage.findMany({
      where:   { notificationId: req.params.notifId },
      orderBy: { ordre: 'asc' },
      include: {
        choixSondage: {
          orderBy: { ordre: 'asc' },
          include: { _count: { select: { votes: true } } },
        },
      },
    });

    return res.json({
      message:   'Vote enregistré',
      questions: questions.map(q => {
        const totalQ = q.choixSondage.reduce((s, c) => s + c._count.votes, 0);
        return {
          id:    q.id,
          texte: q.texte,
          ordre: q.ordre,
          choixSondage: q.choixSondage.map(c => ({
            id:          c.id,
            texte:       c.texte,
            questionId:  c.questionId,
            ordre:       c.ordre,
            votes:       c._count.votes,
            pourcentage: totalQ > 0
              ? Math.round((c._count.votes / totalQ) * 100)
              : 0,
          })),
        };
      }),
      // Rétrocompat — liste plate
      resultats: questions.flatMap(q => {
        const totalQ = q.choixSondage.reduce((s, c) => s + c._count.votes, 0);
        return q.choixSondage.map(c => ({
          id:          c.id,
          texte:       c.texte,
          questionId:  c.questionId,
          votes:       c._count.votes,
          pourcentage: totalQ > 0
            ? Math.round((c._count.votes / totalQ) * 100)
            : 0,
        }));
      }),
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
    // Ajouter l'expéditeur s'il n'est pas déjà destinataire
    const tousIds = [...new Set([...destinataires, expediteurId].filter(Boolean))];

    const notif = await prisma.notification.create({
      data: {
        titre,
        contenu,
        categorie:    categorie || 'administratif',
        urgence:      false,
        estSondage:   false,
        expediteurId: expediteurId || destinataires[0],
        destinataires: { create: tousIds.map(userId => ({ userId })) },
      },
    });

    const users = await prisma.user.findMany({
      where:  { id: { in: destinataires } }, // push seulement aux vrais destinataires
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

app.delete('/notifications/:id', auth, async (req, res) => {
  try {
    await prisma.notificationDestinataire.delete({
      where: {
        id:     req.params.id,
        userId: req.user.id, // sécurité : on ne peut supprimer que ses propres notifs
      },
    });
    res.json({ success: true });
  } catch (e) {
    res.status(404).json({ error: 'Notification introuvable' });
  }
});

// GET /notifications/sondage/:notifId/resultats — Auteur voit les résultats
app.get('/notifications/sondage/:notifId/resultats', auth, async (req, res) => {
  try {
    const notif = await prisma.notification.findUnique({
      where:  { id: req.params.notifId },
      select: { expediteurId: true, estSondage: true },
    });

    if (!notif) return res.status(404).json({ error: 'Sondage introuvable' });
    if (!notif.estSondage) return res.status(400).json({ error: 'Pas un sondage' });

    // Seul l'auteur peut accéder à cette route
    if (notif.expediteurId !== req.user.id)
      return res.status(403).json({ error: 'Accès réservé à l\'auteur' });

    const questions = await prisma.questionSondage.findMany({
      where:   { notificationId: req.params.notifId },
      orderBy: { ordre: 'asc' },
      include: {
        choixSondage: {
          orderBy: { ordre: 'asc' },
          include: { _count: { select: { votes: true } } },
        },
      },
    });

    // Nombre total de participants (personnes ayant voté sur au moins 1 choix)
    const votants = await prisma.voteSondage.findMany({
      where:  { choix: { notificationId: req.params.notifId } },
      select: { userId: true },
      distinct: ['userId'],
    });

    // Nombre total de destinataires
    const nbDestinataires = await prisma.notificationDestinataire.count({
      where: { notificationId: req.params.notifId },
    });

    return res.json({
      nbVotants:       votants.length,
      nbDestinataires,
      tauxParticipation: nbDestinataires > 0
        ? Math.round((votants.length / nbDestinataires) * 100)
        : 0,
      questions: questions.map(q => {
        const totalQ = q.choixSondage.reduce(
          (s, c) => s + c._count.votes, 0
        );
        return {
          id:    q.id,
          texte: q.texte,
          ordre: q.ordre,
          choixSondage: q.choixSondage.map(c => ({
            id:          c.id,
            texte:       c.texte,
            votes:       c._count.votes,
            pourcentage: totalQ > 0
              ? Math.round((c._count.votes / totalQ) * 100)
              : 0,
          })),
        };
      }),
    });
  } catch (err) {
    console.error('[Notifications] Resultats sondage:', err);
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

