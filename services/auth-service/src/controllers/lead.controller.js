// services/auth-service/src/controllers/lead.controller.js
// Demandes de création d'établissement (landing page SmartCampus).

const { validationResult } = require('express-validator');
const EmailService = require('../../../../shared/email/emailService');
const { prisma } = require('../utils/db');

const PLANS = {
  free:        { label: 'Gratuit (0 FCFA — jusqu\'à 50 étudiants)' },
  pro:         { label: 'Pro (15 000 FCFA/mois — jusqu\'à 500 étudiants)' },
  institution: { label: 'Institution (35 000 FCFA/mois — effectif illimité)' },
};

const LeadController = {
  // POST /auth/leads — body: { etablissementNom, ville, prenomAdmin, nomAdmin, emailAdmin, plan }
  // Route publique : enregistre la demande en base puis envoie l'email au super admin.
  creerDemande: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { etablissementNom, ville, prenomAdmin, nomAdmin, emailAdmin, plan } = req.body;
    const planCode = PLANS[plan] ? plan : 'pro';
    const planInfo = PLANS[planCode];

    try {
      // 1. Persister la demande (pour le suivi super admin)
      const lead = await prisma.lead.create({
        data: {
          etablissementNom: String(etablissementNom).trim(),
          ville:            String(ville).trim(),
          prenomAdmin:      String(prenomAdmin).trim(),
          nomAdmin:         String(nomAdmin).trim(),
          emailAdmin:       String(emailAdmin).trim().toLowerCase(),
          plan:             planCode,
        },
      });

      // 2. Envoyer l'email de notification
      const result = await EmailService.sendLeadRequest({
        etablissementNom: lead.etablissementNom,
        ville:            lead.ville,
        prenomAdmin:      lead.prenomAdmin,
        nomAdmin:         lead.nomAdmin,
        emailAdmin:       lead.emailAdmin,
        planLabel:        planInfo.label,
      });

      if (!result.success) {
        console.error('[Lead] Échec envoi email:', result.error);
        // La demande est enregistrée : on prévient quand même l'utilisateur d'une erreur.
        return res.status(502).json({ error: "Impossible d'envoyer la demande pour le moment" });
      }

      return res.status(201).json({
        message: 'Demande reçue. Nous vous contacterons sous 24 h pour finaliser l\'inscription.',
        id:      lead.id,
      });
    } catch (err) {
      console.error('[Lead]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // GET /auth/leads?statut=nouveau — liste des demandes (super admin)
  listerDemandes: async (req, res) => {
    try {
      const { statut } = req.query;
      const where = statut && ['nouveau', 'contacte', 'converti', 'ignore'].includes(statut)
        ? { statut }
        : {};

      const leads = await prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ leads });
    } catch (err) {
      console.error('[Lead] Lister:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // PATCH /auth/leads/:id — body: { statut } (super admin)
  majStatutDemande: async (req, res) => {
    const { statut } = req.body;
    if (!statut || !['nouveau', 'contacte', 'converti', 'ignore'].includes(statut)) {
      return res.status(400).json({ error: 'Statut invalide (nouveau, contacte, converti, ignore)' });
    }

    try {
      const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
      if (!lead) return res.status(404).json({ error: 'Demande introuvable' });

      const updated = await prisma.lead.update({
        where: { id: req.params.id },
        data:  { statut },
      });

      return res.json({ message: 'Statut mis à jour', lead: updated });
    } catch (err) {
      console.error('[Lead] MajStatut:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = LeadController;
