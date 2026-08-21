// services/billing-service/src/routes/exam.routes.js
const express = require('express');
const router = express.Router();

const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/exam.controller');

// ── Routes ──────────────────────────────────────────────────────
router.use(auth);

// Lister les sessions du prof
router.get('/sessions/mes-sessions', ctrl.mesSessions);

// Résultats étudiant (ses examens passés)
router.get('/sessions/mes-resultats', ctrl.mesResultats);

// Créer une session d'examen (prof)
router.post('/sessions', ctrl.creerSession);

// Démarrer l'examen (prof)
router.post('/sessions/:id/start', ctrl.demarrerSession);

// Terminer l'examen + corriger (prof)
router.post('/sessions/:id/finish', ctrl.terminerSession);

// Résultats (prof)
router.get('/sessions/:id/results', ctrl.getResultats);

// Rejoindre par code d'invitation (étudiant)
router.post('/sessions/:code/join', ctrl.rejoindreSession);

// Infos session + sujets
router.get('/sessions/:id', ctrl.getSession);

// Soumettre une réponse
router.post('/sessions/:id/answer', ctrl.soumettreReponse);

// Signaler un avertissement (caméra ou quit)
router.post('/sessions/:id/warning', ctrl.signalerAvertissement);

module.exports = router;
