// services/auth-service/src/controllers/lead.controller.js
// Demande de création d'établissement depuis la landing page SmartCampus.

const { validationResult } = require('express-validator');
const EmailService = require('../../../../shared/email/emailService');

const PLANS = {
  free:        { label: 'Gratuit (0 FCFA — jusqu\'à 50 étudiants)' },
  pro:         { label: 'Pro (15 000 FCFA/mois — jusqu\'à 500 étudiants)' },
  institution: { label: 'Institution (35 000 FCFA/mois — effectif illimité)' },
};

const LeadController = {
  // POST /auth/leads — body: { etablissementNom, ville, prenomAdmin, nomAdmin, emailAdmin, plan }
  creerDemande: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { etablissementNom, ville, prenomAdmin, nomAdmin, emailAdmin, plan } = req.body;
    const planInfo = PLANS[plan] || PLANS.pro;

    try {
      const result = await EmailService.sendLeadRequest({
        etablissementNom: String(etablissementNom).trim(),
        ville:            String(ville).trim(),
        prenomAdmin:      String(prenomAdmin).trim(),
        nomAdmin:         String(nomAdmin).trim(),
        emailAdmin:       String(emailAdmin).trim().toLowerCase(),
        planLabel:        planInfo.label,
      });

      if (!result.success) {
        console.error('[Lead] Échec envoi email:', result.error);
        return res.status(502).json({ error: "Impossible d'envoyer la demande pour le moment" });
      }

      return res.status(201).json({
        message: 'Demande reçue. Nous vous contacterons sous 24 h pour finaliser l\'inscription.',
      });
    } catch (err) {
      console.error('[Lead]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = LeadController;
