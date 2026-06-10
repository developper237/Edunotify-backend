// services/presence-service/src/controllers/presence.controller.js

const { validationResult } = require('express-validator');
const { prisma }           = require('../utils/db');
const { RedisService }     = require('../utils/redis');

// Génération OTP 6 chiffres
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const PresenceController = {

  // ── POST /presence/sessions ─────────────────────────────────────
  lancerSession: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { matiere, professeur, salle, type, dureeMinutes = 5 } = req.body;

    try {
      // Récupérer la classe du délégué
      const delegue = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { classeDelegueId: true },
      });

      if (!delegue?.classeDelegueId) {
        return res.status(400).json({
          error: 'Délégué sans classe associée',
        });
      }

      // Vérifier qu'il n'y a pas déjà une session active
      const activeSession = await RedisService.getActiveSession(
        delegue.classeDelegueId
      );
      if (activeSession) {
        return res.status(409).json({
          error: 'Une session est déjà en cours pour cette classe',
          session: activeSession,
        });
      }

      // Générer le code OTP
      const code = generateOTP();

      // Créer la session en base
      const session = await prisma.sessionPresence.create({
        data: {
          code,
          matiere,
          professeur,
          salle,
          type,
          dureeMinutes,
          classeId:  delegue.classeDelegueId,
          delegueId: req.user.id,
          actif:     true,
        },
      });

      // Stocker dans Redis avec TTL
      await RedisService.setSession(
        code,
        {
          sessionId:  session.id,
          classeId:   delegue.classeDelegueId,
          delegueId:  req.user.id,
          matiere,
          professeur,
          salle,
          type,
        },
        dureeMinutes * 60
      );

      return res.status(201).json({
        code,
        session: {
          id:          session.id,
          code:        session.code,
          matiere:     session.matiere,
          professeur:  session.professeur,
          salle:       session.salle,
          type:        session.type,
          dureeMinutes: session.dureeMinutes,
          ouverteLe:   session.ouverteLe,
          expiresAt:   new Date(
            Date.now() + dureeMinutes * 60 * 1000
          ).toISOString(),
        },
      });
    } catch (err) {
      console.error('[LancerSession]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── PUT /presence/sessions/:sessionId/fermer ────────────────────
  fermerSession: async (req, res) => {
    const { sessionId } = req.params;

    try {
      const session = await prisma.sessionPresence.findFirst({
        where: {
          id:        sessionId,
          delegueId: req.user.id,
          actif:     true,
        },
        include: {
          classe:   { include: { etudiants: true } },
          presences: true,
        },
      });

      if (!session) {
        return res.status(404).json({
          error: 'Session non trouvée ou déjà fermée',
        });
      }

      // Fermer la session
      await prisma.sessionPresence.update({
        where: { id: sessionId },
        data: { actif: false, fermeeLe: new Date() },
      });

      // Supprimer de Redis
      await RedisService.deleteSession(session.code, session.classeId);

      // Calculer les absents
      const presentsIds = session.presences.map(p => p.userId);
      const absents     = session.classe.etudiants.filter(
        e => !presentsIds.includes(e.id)
      );

      // Créer les entrées Presence pour les absents
      if (absents.length > 0) {
        await prisma.presence.createMany({
          data: absents.map(e => ({
            sessionId,
            userId: e.id,
            statut: 'absent',
          })),
          skipDuplicates: true,
        });
      }

      // Rapport final
      const rapport = {
        sessionId,
        matiere:    session.matiere,
        presents:   presentsIds.length,
        absents:    absents.length,
        total:      session.classe.etudiants.length,
        taux:       session.classe.etudiants.length > 0
          ? Math.round(presentsIds.length / session.classe.etudiants.length * 100)
          : 0,
      };

      return res.json({
        message: 'Session fermée',
        rapport,
      });
    } catch (err) {
      console.error('[FermerSession]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },
  // ── POST /presence/sessions/:sessionId/envoyer-rapport ──────────
  envoyerRapport: async (req, res) => {
    const { sessionId } = req.params;
    const { urlPdf, salleNom } = req.body;
    const user = req.user; // Le délégué

    try {
      // 1. Trouver le Chef de Département du délégué
      const chef = await prisma.user.findFirst({
        where: {
          role: 'chef_departement',
          departementId: user.departementId
        }
      });

      if (!chef) {
        return res.status(404).json({ error: "Aucun chef de département trouvé pour ce département." });
      }

      // 2. Formater le titre comme demandé
      const dateStr = new Date().toLocaleDateString('fr-FR');
      const titreRapport = `Rapport d'appel ${salleNom} pour la journée du ${dateStr}`;

      // 3. Créer une notification pour le Chef (via la table Notification)
      // On crée la notif directement en base pour qu'elle apparaisse dans "mes-notifications" du chef
      const notification = await prisma.notification.create({
        data: {
          titre: titreRapport,
          contenu: `Le délégué ${user.prenom} ${user.nom} a transmis le rapport de présence. Cliquez pour voir le document.`,
          categorie: 'administratif',
          urgence: false,
          expediteurId: user.id,
          etablissementId: user.etablissementId,
          estSondage: false,
          // Lien vers le PDF stocké dans le contenu ou un champ spécifique si tu en as un
          // Ici on peut l'ajouter à la fin du contenu ou utiliser un champ "pieceJointe" si présent dans ton schéma
          destinataires: {
            create: [{ userId: chef.id }]
          }
        }
      });

      return res.status(201).json({ 
        message: 'Rapport envoyé au supérieur avec succès',
        notificationId: notification.id 
      });

    } catch (err) {
      console.error('[EnvoyerRapport]', err);
      return res.status(500).json({ error: 'Erreur serveur lors de l\'envoi du rapport' });
    }
  },
  // ── POST /presence/confirmer ────────────────────────────────────
  confirmerPresence: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { code } = req.body;

    try {
      // Récupérer la session depuis Redis
      const sessionData = await RedisService.getSession(code);
      if (!sessionData) {
        return res.status(400).json({
          error: 'Code invalide ou session expirée',
        });
      }

      // Vérifier que l'étudiant appartient à la classe
      const etudiant = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { classeEtudiantId: true },
      });

      if (etudiant?.classeEtudiantId !== sessionData.classeId) {
        return res.status(403).json({
          error: 'Ce code n\'est pas destiné à votre classe',
        });
      }

      // Vérifier si déjà enregistré
      const existing = await prisma.presence.findUnique({
        where: {
          sessionId_userId: {
            sessionId: sessionData.sessionId,
            userId:    req.user.id,
          },
        },
      });

      if (existing) {
        return res.status(409).json({
          error: 'Présence déjà enregistrée pour cette session',
        });
      }

      // Enregistrer la présence
      const presence = await prisma.presence.create({
        data: {
          sessionId: sessionData.sessionId,
          userId:    req.user.id,
          statut:    'present',
        },
      });

      // TTL restant
      const ttl = await RedisService.getTTL(code);

      return res.json({
        message:   'Présence confirmée !',
        confirmeA: presence.confirmeA,
        session: {
          matiere:    sessionData.matiere,
          professeur: sessionData.professeur,
          salle:      sessionData.salle,
          ttlRestant: ttl,
        },
      });
    } catch (err) {
      console.error('[ConfirmerPresence]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /presence/active/:classeId ──────────────────────────────
  getSessionActive: async (req, res) => {
    const { classeId } = req.params;

    try {
      const session = await RedisService.getActiveSession(classeId);

      if (!session) {
        return res.json({ active: false, session: null });
      }

      const ttl = await RedisService.getTTL(session.code);

      return res.json({
        active: true,
        session: {
          ...session,
          ttlRestant: ttl,
          expiresAt:  new Date(Date.now() + ttl * 1000).toISOString(),
        },
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /presence/historique/:classeId ──────────────────────────
  getHistorique: async (req, res) => {
    const { classeId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    try {
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [sessions, total] = await Promise.all([
        prisma.sessionPresence.findMany({
          where:   { classeId, actif: false },
          include: {
            presences: {
              include: {
                user: {
                  select: {
                    id: true, nom: true, prenom: true, matricule: true,
                  },
                },
              },
            },
            _count: { select: { presences: true } },
          },
          orderBy: { ouverteLe: 'desc' },
          skip,
          take: parseInt(limit),
        }),
        prisma.sessionPresence.count({
          where: { classeId, actif: false },
        }),
      ]);

      // Récupérer le total d'étudiants de la classe
      const classeEtudiants = await prisma.user.count({
        where: { classeEtudiantId: classeId, role: 'etudiant' },
      });

      const sessionsFormatees = sessions.map(s => {
        const presents = s.presences.filter(p => p.statut === 'present');
        const absents  = s.presences.filter(p => p.statut === 'absent');
        return {
          id:          s.id,
          matiere:     s.matiere,
          professeur:  s.professeur,
          salle:       s.salle,
          type:        s.type,
          ouverteLe:   s.ouverteLe,
          fermeeLe:    s.fermeeLe,
          nbPresents:  presents.length,
          nbAbsents:   absents.length,
          total:       classeEtudiants,
          taux:        classeEtudiants > 0
            ? Math.round(presents.length / classeEtudiants * 100)
            : 0,
          presents:    presents.map(p => ({
            id:         p.user.id,
            nom:        p.user.nom,
            prenom:     p.user.prenom,
            matricule:  p.user.matricule,
            confirmeA:  p.confirmeA,
          })),
          absents:     absents.map(p => ({
            id:        p.user.id,
            nom:       p.user.nom,
            prenom:    p.user.prenom,
            matricule: p.user.matricule,
          })),
        };
      });

      return res.json({
        sessions: sessionsFormatees,
        pagination: {
          total,
          page:  parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      console.error('[GetHistorique]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /presence/sessions/:sessionId ───────────────────────────
  getSession: async (req, res) => {
    const { sessionId } = req.params;

    try {
      const session = await prisma.sessionPresence.findUnique({
        where: { id: sessionId },
        include: {
          presences: {
            include: {
              user: {
                select: {
                  id: true, nom: true, prenom: true, matricule: true,
                },
              },
            },
          },
        },
      });

      if (!session) {
        return res.status(404).json({ error: 'Session non trouvée' });
      }

      return res.json({ session });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /presence/etudiant/historique ───────────────────────────
  getHistoriqueEtudiant: async (req, res) => {
    try {
      const presences = await prisma.presence.findMany({
        where:   { userId: req.user.id },
        include: {
          session: {
            select: {
              matiere:    true,
              professeur: true,
              salle:      true,
              type:       true,
              ouverteLe:  true,
            },
          },
        },
        orderBy: { confirmeA: 'desc' },
      });

      const formatted = presences.map(p => ({
        id:         p.id,
        statut:     p.statut,
        confirmeA:  p.confirmeA,
        matiere:    p.session.matiere,
        professeur: p.session.professeur,
        salle:      p.session.salle,
        type:       p.session.type,
        date:       p.session.ouverteLe,
      }));

      const presents = formatted.filter(p => p.statut === 'present').length;
      const absents  = formatted.filter(p => p.statut === 'absent').length;

      return res.json({
        historique: formatted,
        stats: {
          total:   formatted.length,
          presents,
          absents,
          taux:    formatted.length > 0
            ? Math.round(presents / formatted.length * 100)
            : 0,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = PresenceController;
