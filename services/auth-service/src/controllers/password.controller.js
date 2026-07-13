// services/auth-service/src/controllers/password.controller.js

const { prisma }   = require('../utils/db');
const {
  generateOTP,
  hashPassword,
  verifyPassword,
} = require('../utils/helpers');
const EmailService = require('../../../../shared/email/emailService');

const CODE_EXPIRATION_MINUTES = 10;
const MAX_TENTATIVES          = 5;

// Réponse volontairement identique qu'un compte existe ou non pour cet
// email, afin de ne pas révéler si une adresse email est enregistrée
// dans le système (évite l'énumération de comptes).
const REPONSE_GENERIQUE = {
  message: 'Si cet email est associé à un compte, un code de vérification a été envoyé.',
};

const PasswordController = {

  // ── POST /auth/mot-de-passe-oublie ──────────────────────────────
  // Body: { email }
  demanderReinitialisation: async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    try {
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        // Même réponse que si le compte existait, pour ne rien révéler.
        return res.json(REPONSE_GENERIQUE);
      }

      const code       = generateOTP();
      const codeHash   = await hashPassword(code);
      const expiresAt  = new Date(Date.now() + CODE_EXPIRATION_MINUTES * 60 * 1000);

      // On invalide les anciens codes non utilisés de ce user, pour
      // qu'un seul code à la fois soit valide.
      await prisma.passwordResetCode.updateMany({
        where: { userId: user.id, utilise: false },
        data:  { utilise: true },
      });

      await prisma.passwordResetCode.create({
        data: { userId: user.id, codeHash, expiresAt },
      });

      await EmailService.sendPasswordResetCode({
        email:  user.email,
        prenom: user.prenom,
        code,
      });

      return res.json(REPONSE_GENERIQUE);
    } catch (err) {
      console.error('[DemanderReinitialisation]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── POST /auth/reinitialiser-mot-de-passe ───────────────────────
  // Body: { email, code, nouveauMotDePasse }
  reinitialiserMotDePasse: async (req, res) => {
    const { email, code, nouveauMotDePasse } = req.body;

    if (!email || !code || !nouveauMotDePasse) {
      return res.status(400).json({ error: 'Tous les champs sont obligatoires' });
    }
    if (nouveauMotDePasse.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    }

    try {
      const user = await prisma.user.findUnique({ where: { email } });
      // Message volontairement identique (code invalide/expiré) que
      // l'email existe ou non, ou que le code soit faux/expiré/épuisé —
      // pour ne pas laisser deviner lequel de ces cas s'est produit.
      const erreurCodeInvalide = { error: 'Code invalide ou expiré' };

      if (!user) {
        return res.status(400).json(erreurCodeInvalide);
      }

      const resetCode = await prisma.passwordResetCode.findFirst({
        where:   { userId: user.id, utilise: false },
        orderBy: { createdAt: 'desc' },
      });

      if (!resetCode || resetCode.expiresAt < new Date()) {
        return res.status(400).json(erreurCodeInvalide);
      }

      if (resetCode.tentatives >= MAX_TENTATIVES) {
        return res.status(429).json({ error: 'Trop de tentatives. Demandez un nouveau code.' });
      }

      const codeValide = await verifyPassword(code, resetCode.codeHash);

      if (!codeValide) {
        await prisma.passwordResetCode.update({
          where: { id: resetCode.id },
          data:  { tentatives: { increment: 1 } },
        });
        return res.status(400).json(erreurCodeInvalide);
      }

      const passwordHash = await hashPassword(nouveauMotDePasse);

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data:  { passwordHash, statut: 'actif' },
        }),
        prisma.passwordResetCode.update({
          where: { id: resetCode.id },
          data:  { utilise: true },
        }),
      ]);

      // Best-effort : si l'email de confirmation échoue, on ne bloque pas
      // la réinitialisation qui, elle, a déjà réussi.
      EmailService.sendPasswordChanged({
        email:  user.email,
        prenom: user.prenom,
      }).catch((e) => console.error('[ReinitialiserMotDePasse] Email confirmation:', e));

      return res.json({ message: 'Mot de passe réinitialisé avec succès' });
    } catch (err) {
      console.error('[ReinitialiserMotDePasse]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = PasswordController;