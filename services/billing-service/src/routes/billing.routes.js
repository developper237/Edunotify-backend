// services/billing-service/src/routes/billing.routes.js
const express = require('express');
const router  = express.Router();

const { auth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/billing.controller');

// ── Webhook CinetPay — PUBLIC (CinetPay n'a pas de JWT) ──────────
router.post('/webhooks/cinetpay', ctrl.webhookCinetpay);

// ── Retour utilisateur après paiement — PUBLIC ──────────────────
router.get('/retour', (req, res) => {
  const transactionId = req.query.transaction_id || req.query.metadata || '';
  res.send(`
    <html><head><title>Paiement SmartCampus</title>
    <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f4f8;}
    .card{background:white;padding:40px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
    h2{color:#2563EB;}p{color:#64748b;}</style></head><body>
    <div class="card">
      <h2>✅ Paiement en cours de traitement</h2>
      <p>Votre abonnement sera activé automatiquement après confirmation du paiement.</p>
      <p style="font-size:12px;color:#94a3b8;">Transaction: ${transactionId}</p>
    </div></body></html>
  `);
});

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
