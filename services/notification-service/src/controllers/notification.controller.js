// services/notification-service/src/controllers/notification.controller.js

const { validationResult } = require('express-validator');
const { prisma }           = require('../utils/db');

// ── Résoudre les destinataires en liste d'IDs ─────────────────────
const resolveDestinataires = async (destinataires, user) => {
  let where = {};

  switch (destinataires) {
    case 'classe':
      // Tous les étudiants de la classe du délégué
      where = {
        role:            'etudiant',
        classeDelegueId: user.classeId,
      };
      break;

    case 'presents':
    case 'absents':
      // Étudiants présents/absents aujourd'hui dans la classe
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sessions = await prisma.sessionPresence.findMany({
        where: {
          classeId:  user.classeId,
          ouverteLe: { gte: today },
        },
        include: { presences: true },
      });
      const presentsIds = sessions.flatMap(s =>
        s.presences
          .filter(p => p.statut === 'present')
          .map(p => p.userId)
      );
      if (destinataires === 'presents') {
        where = { id: { in: presentsIds } };
      } else {
        where = {
          role:             'etudiant',
          classeEtudiantId: user.classeId,
          id:               { notIn: presentsIds },
        };
      }
      break;

    case 'dept':
      where = {
        role:         'etudiant',
        departementId: user.departementId,
      };
      break;

    case 'L1':
    case 'L2':
    case 'L3':
    case 'M1':
    case 'M2':
      where = {
        role:         'etudiant',
        departementId: user.departementId,
        classeEtudiant: { niveau: destinataires },
      };
      break;

    case 'all':
      where = { etablissementId: user.etablissementId };
      break;

    case 'etudiants':
      where = {
        role:            'etudiant',
        etablissementId: user.etablissementId,
      };
      break;

    case 'staff':
      where = {
        role:            { in: ['chef_departement', 'delegue', 'admin'] },
        etablissementId: user.etablissementId,
      };
      break;

    case 'platform':
      where = { role: { not: 'super_admin' } };
      break;

    default:
      where = {};
  }

  const users = await prisma.user.findMany({
    where,
    select: { id: true, fcmToken: true },
  });

  return users;
};

const NotifController = {

  // ── POST /notifications/envoyer ─────────────────────────────────
  envoyer: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      titre, contenu, categorie,
      urgence = false, destinataires,
    } = req.body;

    try {
      // Résoudre les destinataires
      const users = await resolveDestinataires(destinataires, req.user);

      if (users.length === 0) {
        return res.status(400).json({
          error: 'Aucun destinataire trouvé',
        });
      }

      // Créer la notification
      const notification = await prisma.notification.create({
        data: {
          titre,
          contenu,
          categorie,
          urgence,
          expediteurId:   req.user.id,
          etablissementId: req.user.etablissementId || null,
          estSondage:     false,
          destinataires: {
            create: users.map(u => ({ userId: u.id })),
          },
        },
      });

      // TODO: Envoyer FCM push notifications aux users avec fcmToken

      return res.status(201).json({
        message:        `Notification envoyée à ${users.length} destinataire(s)`,
        notificationId: notification.id,
        nbDestinataires: users.length,
      });
    } catch (err) {
      console.error('[Envoyer]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── POST /notifications/sondage ─────────────────────────────────
  lancerSondage: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { question, choix, destinataires } = req.body;

    try {
      const users = await resolveDestinataires(destinataires, req.user);

      if (users.length === 0) {
        return res.status(400).json({ error: 'Aucun destinataire trouvé' });
      }

      const notification = await prisma.notification.create({
        data: {
          titre:          `📊 ${question}`,
          contenu:        question,
          categorie:      'administratif',
          urgence:        false,
          expediteurId:   req.user.id,
          etablissementId: req.user.etablissementId || null,
          estSondage:     true,
          destinataires: {
            create: users.map(u => ({ userId: u.id })),
          },
          choixSondage: {
            create: choix.map((texte, index) => ({
              texte,
              ordre: index,
            })),
          },
        },
        include: { choixSondage: true },
      });

      return res.status(201).json({
        message:         `Sondage envoyé à ${users.length} destinataire(s)`,
        notificationId:  notification.id,
        choix:           notification.choixSondage,
        nbDestinataires: users.length,
      });
    } catch (err) {
      
      console.error('[LancerSondage]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── POST /notifications/sondage/:notifId/voter ───────────────────
  voter: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { notifId } = req.params;
    const { choixId } = req.body;

    try {
      // Vérifier que le choix appartient bien au sondage
      const choix = await prisma.choixSondage.findFirst({
        where: { id: choixId, notificationId: notifId },
      });

      if (!choix) {
        return res.status(404).json({ error: 'Choix non trouvé' });
      }

      // Vérifier que l'utilisateur n'a pas déjà voté
      const existingVote = await prisma.voteSondage.findFirst({
        where: {
          userId: req.user.id,
          choix:  { notificationId: notifId },
        },
      });

      if (existingVote) {
        return res.status(409).json({ error: 'Vous avez déjà voté' });
      }

      await prisma.voteSondage.create({
        data: { choixId, userId: req.user.id },
      });

      // Marquer la notification comme lue
      await prisma.notificationDestinataire.updateMany({
        where: {
          notificationId: notifId,
          userId:         req.user.id,
        },
        data: { lue: true, lueLe: new Date() },
      });

      return res.json({ message: 'Vote enregistré' });
    } catch (err) {
      console.error('[Voter]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /notifications/mes-notifications ────────────────────────
  getMesNotifications: async (req, res) => {
    const { page = 1, limit = 20, nonLues } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    try {
      const where = {
        userId: req.user.id,
        ...(nonLues === 'true' ? { lue: false } : {}),
      };

      const [destEntries, total] = await Promise.all([
        prisma.notificationDestinataire.findMany({
          where,
          include: {
            notification: {
              include: {
                expediteur:  {
                  select: {
                    id: true, nom: true, prenom: true, role: true,
                  },
                },
                choixSondage: {
                  include: {
                    _count: { select: { votes: true } },
                    votes: {
                      where: { userId: req.user.id },
                      select: { id: true },
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
        prisma.notificationDestinataire.count({ where }),
      ]);

      const notifications = destEntries.map(d => ({
        id:        d.notificationId,
        lue:       d.lue,
        lueLe:     d.lueLe,
        ...d.notification,
        expediteur: d.notification.expediteur,
        monVote:   d.notification.estSondage
          ? d.notification.choixSondage.find(
              c => c.votes.length > 0
            )?.id || null
          : null,
        choixSondage: d.notification.choixSondage.map(c => ({
          id:     c.id,
          texte:  c.texte,
          ordre:  c.ordre,
          votes:  c._count.votes,
        })),
      }));

      const nonLuesCount = await prisma.notificationDestinataire.count({
        where: { userId: req.user.id, lue: false },
      });

      return res.json({
        notifications,
        nonLues: nonLuesCount,
        pagination: {
          total,
          page:  parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      console.error('[GetMesNotifications]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── PUT /notifications/:notifId/lire ────────────────────────────
  marquerLu: async (req, res) => {
    const { notifId } = req.params;
    try {
      await prisma.notificationDestinataire.updateMany({
        where: { notificationId: notifId, userId: req.user.id },
        data:  { lue: true, lueLe: new Date() },
      });
      return res.json({ message: 'Marqué comme lu' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── PUT /notifications/tout-lire ─────────────────────────────────
  toutMarquerLu: async (req, res) => {
    try {
      await prisma.notificationDestinataire.updateMany({
        where: { userId: req.user.id, lue: false },
        data:  { lue: true, lueLe: new Date() },
      });
      return res.json({ message: 'Tout marqué comme lu' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /notifications/sondage/:notifId/resultats ────────────────
  getResultatsSondage: async (req, res) => {
    const { notifId } = req.params;
    try {
      const notification = await prisma.notification.findUnique({
        where: { id: notifId },
        include: {
          choixSondage: {
            include: {
              _count: { select: { votes: true } },
            },
            orderBy: { ordre: 'asc' },
          },
          _count: { select: { destinataires: true } },
        },
      });

      if (!notification || !notification.estSondage) {
        return res.status(404).json({ error: 'Sondage non trouvé' });
      }

      const totalVotes = notification.choixSondage.reduce(
        (sum, c) => sum + c._count.votes, 0
      );

      return res.json({
        question:    notification.contenu,
        totalVotes,
        participants: notification._count.destinataires,
        choix: notification.choixSondage.map(c => ({
          id:     c.id,
          texte:  c.texte,
          votes:  c._count.votes,
          taux:   totalVotes > 0
            ? Math.round(c._count.votes / totalVotes * 100)
            : 0,
        })),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = NotifController;
