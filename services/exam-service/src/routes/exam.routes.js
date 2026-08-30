const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/exam.controller');
const { authenticate: auth } = require('../middleware/authJwt');

// ── Toutes les routes examen exigent un utilisateur authentifié ──
router.use(auth);

// ── Routes Prof ────────────────────────────────────────────────

// Créer une session d'examen
router.post('/sessions', ctrl.creerSession);

// Démarrer l'examen
router.post('/sessions/:id/start', ctrl.demarrerSession);

// Terminer l'examen + corriger
router.post('/sessions/:id/finish', ctrl.terminerSession);

// Résultats
router.get('/sessions/:id/results', ctrl.getResultats);

// ── Routes Étudiant ────────────────────────────────────────────

// Rejoindre par code d'invitation
router.post('/sessions/:code/join', ctrl.rejoindreSession);

// Infos session + sujets
router.get('/sessions/:id', ctrl.getSession);

// Soumettre une réponse
router.post('/sessions/:id/answer', ctrl.soumettreReponse);

// Signaler un avertissement (caméra ou quit)
router.post('/sessions/:id/warning', ctrl.signalerAvertissement);

module.exports = router;