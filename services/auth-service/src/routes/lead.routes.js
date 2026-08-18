// services/auth-service/src/routes/lead.routes.js
// Demandes de création d'établissement (landing page).

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const LeadController = require('../controllers/lead.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

// POST /auth/leads — Demande de création d'établissement (public, landing page)
router.post('/leads', [
  body('etablissementNom').trim().isLength({ min: 2, max: 120 }).withMessage("Nom d'établissement requis (2 caractères min)"),
  body('ville').trim().isLength({ min: 2, max: 80 }).withMessage('Ville requise'),
  body('prenomAdmin').trim().isLength({ min: 2, max: 60 }).withMessage('Prénom requis'),
  body('nomAdmin').trim().isLength({ min: 2, max: 60 }).withMessage('Nom requis'),
  body('emailAdmin').isEmail().normalizeEmail().withMessage('Adresse email professionnelle invalide'),
  body('plan').optional().isIn(['free', 'pro', 'institution']).withMessage('Plan invalide'),
], LeadController.creerDemande);

// GET /auth/leads — Lister les demandes (super admin)
router.get('/leads',
  authenticate,
  requireRole('super_admin'),
  LeadController.listerDemandes
);

// PATCH /auth/leads/:id — Changer le statut d'une demande (super admin)
router.patch('/leads/:id',
  authenticate,
  requireRole('super_admin'),
  LeadController.majStatutDemande
);

module.exports = router;
