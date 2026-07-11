// services/notification-service/src/routes/notification.routes.js

const express = require('express');
const { body } = require('express-validator');
const router  = express.Router();
const NotifController = require('../controllers/notification.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

// ── Envoyer une notification ──────────────────────────────────────
// POST /notifications/envoyer
router.post('/envoyer',
  authenticate,
  requireRole('delegue', 'chef_departement', 'admin', 'super_admin'),
  [
    body('titre').notEmpty().trim(),
    body('contenu').notEmpty().trim(),
    body('categorie').isIn(['administratif', 'examen', 'resultat', 'cours']),
    body('urgence').isBoolean().optional(),
    body('destinataires').isIn([
      'classe', 'presents', 'absents',
      'dept', 'L1', 'L2', 'L3', 'M1', 'M2',
      'all', 'etudiants', 'staff',
      'platform',
    ]),
  ],
  NotifController.envoyer
);

// ── Lancer un sondage ─────────────────────────────────────────────
// POST /notifications/sondage
router.post('/sondage',
  authenticate,
  requireRole('delegue', 'chef_departement', 'admin', 'super_admin'),
  [
    body('question').optional().trim(),
    body('choix').optional().isArray({ min: 2, max: 4 }),
    body('questions').optional().isArray({ min: 1 }),
    body('questions.*.question').optional().trim().notEmpty(),
    body('questions.*.choix').optional().isArray({ min: 2, max: 4 }),
    body('destinataires').optional().notEmpty(),
    body('cible').optional().notEmpty(),
    body().custom((value) => {
      const hasLegacyFormat = Boolean(
        value.question && Array.isArray(value.choix) && value.choix.length >= 2
      );
      const hasQuestionsFormat = Array.isArray(value.questions) && value.questions.length > 0
        && value.questions.every((item) =>
          typeof item?.question === 'string'
          && item.question.trim().length > 0
          && Array.isArray(item.choix)
          && item.choix.length >= 2
        );

      if (!hasLegacyFormat && !hasQuestionsFormat) {
        throw new Error('Fournissez question/choix ou questions[] avec au moins 2 choix par question');
      }

      return true;
    }),
  ],
  NotifController.lancerSondage
);

// ── Voter à un sondage ────────────────────────────────────────────
// POST /notifications/sondage/:notifId/voter
router.post('/sondage/:notifId/voter',
  authenticate,
  [
    body('choixId').notEmpty(),
  ],
  NotifController.voter
);

// ── Mes notifications ─────────────────────────────────────────────
// GET /notifications/mes-notifications
router.get('/mes-notifications',
  authenticate,
  NotifController.getMesNotifications
  
);

// ── Marquer comme lu ──────────────────────────────────────────────
// PUT /notifications/:notifId/lire
router.put('/:notifId/lire',
  authenticate,
  NotifController.marquerLu
);

// ── Tout marquer comme lu ─────────────────────────────────────────
// PUT /notifications/tout-lire
router.put('/tout-lire',
  authenticate,
  NotifController.toutMarquerLu
);

// ── Statistiques sondage ──────────────────────────────────────────
// GET /notifications/sondage/:notifId/resultats
router.get('/sondage/:notifId/resultats',
  authenticate,
  NotifController.getResultatsSondage
);

module.exports = router;
