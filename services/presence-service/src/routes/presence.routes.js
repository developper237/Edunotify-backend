// services/presence-service/src/routes/presence.routes.js

const express = require('express');
const { body } = require('express-validator');
const router  = express.Router();
const PresenceController = require('../controllers/presence.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

// ── Délégué — lancer une session ──────────────────────────────────
// POST /presence/sessions
router.post('/sessions',
  authenticate,
  requireRole('delegue'),
  [
    body('matiere').notEmpty().trim(),
    body('professeur').notEmpty().trim(),
    body('salle').notEmpty().trim(),
    body('type').isIn(['Cours', 'TD', 'TP', 'Examen', 'Rattrapage']),
    body('dureeMinutes').isInt({ min: 1, max: 60 }).optional(),
  ],
  PresenceController.lancerSession
);

// ── Délégué — fermer une session ──────────────────────────────────
// PUT /presence/sessions/:sessionId/fermer
router.put('/sessions/:sessionId/fermer',
  authenticate,
  requireRole('delegue'),
  PresenceController.fermerSession
);

// ── Étudiant — confirmer présence ─────────────────────────────────
// POST /presence/confirmer
router.post('/confirmer',
  authenticate,
  requireRole('etudiant'),
  [
    body('code').isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  PresenceController.confirmerPresence
);

// ── Session active pour une classe ───────────────────────────────
// GET /presence/active/:classeId
router.get('/active/:classeId',
  authenticate,
  PresenceController.getSessionActive
);

// ── Historique des sessions d'une classe ─────────────────────────
// GET /presence/historique/:classeId
router.get('/historique/:classeId',
  authenticate,
  requireRole('delegue', 'chef_departement', 'admin'),
  PresenceController.getHistorique
);

// ── Détail d'une session ──────────────────────────────────────────
// GET /presence/sessions/:sessionId
router.get('/sessions/:sessionId',
  authenticate,
  PresenceController.getSession
);

// ── Historique présences d'un étudiant ────────────────────────────
// GET /presence/etudiant/historique
router.get('/etudiant/historique',
  authenticate,
  requireRole('etudiant'),
  PresenceController.getHistoriqueEtudiant
);

// Vérifie bien que le chemin est EXACTEMENT celui-là :
router.post('/sessions/:sessionId/envoyer-rapport', authenticate, PresenceController.envoyerRapport);
module.exports = router;
