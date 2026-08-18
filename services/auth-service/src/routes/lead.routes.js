// services/auth-service/src/routes/lead.routes.js
// Routes publiques de demande d'établissement (landing page).

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const LeadController = require('../controllers/lead.controller');

// POST /auth/leads — Demande de création d'établissement
router.post('/leads', [
  body('etablissementNom').trim().isLength({ min: 2, max: 120 }).withMessage("Nom d'établissement requis (2 caractères min)"),
  body('ville').trim().isLength({ min: 2, max: 80 }).withMessage('Ville requise'),
  body('prenomAdmin').trim().isLength({ min: 2, max: 60 }).withMessage('Prénom requis'),
  body('nomAdmin').trim().isLength({ min: 2, max: 60 }).withMessage('Nom requis'),
  body('emailAdmin').isEmail().normalizeEmail().withMessage('Adresse email professionnelle invalide'),
  body('plan').optional().isIn(['free', 'pro', 'institution']).withMessage('Plan invalide'),
], LeadController.creerDemande);

module.exports = router;
