// services/billing-service/src/routes/billing.routes.js
const express = require('express');
const router  = express.Router();

const { auth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/billing.controller');

// ── Webhook CinetPay — PUBLIC (CinetPay n'a pas de JWT) ──────────
router.post('/webhooks/cinetpay', ctrl.webhookCinetpay);

// ── Routes protégées (JWT vérifié par la gateway) ────────────────
router.use(auth);

// Catalogue des offres
router.get('/plans', ctrl.listerPlans);

// État de l'abonnement de mon établissement
router.get('/subscription', ctrl.getMonAbonnement);

// Souscrire / changer de plan (admin ou super_admin)
router.post('/subscriptions', requireRole('admin', 'super_admin'), ctrl.creerAbonnement);

// Payer une facture en attente (admin ou super_admin)
router.post('/subscriptions/:id/payer', requireRole('admin', 'super_admin'), ctrl.initierPaiementFacture);

// Annuler l'abonnement (admin ou super_admin)
router.post('/subscriptions/cancel', requireRole('admin', 'super_admin'), ctrl.annulerAbonnement);

// Déclencher manuellement la vérification des expirations (super_admin)
router.get('/expirations/check', requireRole('super_admin'), ctrl.verifierExpirationsRoute);

module.exports = router;
