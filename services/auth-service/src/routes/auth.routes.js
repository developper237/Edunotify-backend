// services/auth-service/src/routes/auth.routes.js

const express = require('express');
const { body } = require('express-validator');
const router  = express.Router();
const AuthController = require('../controllers/auth.controller');
const PasswordController = require('../controllers/password.controller');
const { authenticate } = require('../middleware/auth.middleware');
const uploadLogo = require('../config/upload');
const { prisma } = require('../utils/db');

// ── AUTHENTIFICATION ──────────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], AuthController.login);

// ── MOT DE PASSE OUBLIÉ (routes publiques, pas de authenticate) ──
// POST /auth/mot-de-passe-oublie
router.post('/mot-de-passe-oublie', [
  body('email').isEmail().normalizeEmail(),
], PasswordController.demanderReinitialisation);

// POST /auth/reinitialiser-mot-de-passe
router.post('/reinitialiser-mot-de-passe', [
  body('email').isEmail().normalizeEmail(),
  body('code').isLength({ min: 6, max: 6 }),
  body('nouveauMotDePasse').isLength({ min: 8 }),
], PasswordController.reinitialiserMotDePasse);

router.post('/logout',  authenticate, AuthController.logout);
router.post('/refresh', AuthController.refresh);
router.get('/me',       authenticate, AuthController.me);

// change-password : utilisé pour le premier login (inactif → actif)
// ET pour changer le mdp depuis les paramètres (compte déjà actif)
router.post('/change-password', authenticate, [
  body('ancienMotDePasse').notEmpty(),
  body('nouveauMotDePasse').isLength({ min: 8 }),
], AuthController.changePassword);

// first-login : flux simplifié sans ancien mdp (optionnel)
router.post('/first-login', authenticate, [
  body('nouveauMotDePasse').isLength({ min: 8 }),
], AuthController.firstLogin);

// ── FCM TOKEN ─────────────────────────────────────────────────────
//router.patch('/fcm-token', authenticate, AuthController.updateFcmToken);
// PATCH /auth/fcm-token — Enregistrer le token FCM
router.patch('/fcm-token', authenticate, async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) return res.status(400).json({ error: 'fcmToken requis' });

  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data:  { fcmToken },
    });
    return res.json({ message: 'Token FCM enregistré' });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── ADMIN ÉTABLISSEMENT ───────────────────────────────────────────
router.get('/utilisateurs',      authenticate, AuthController.getUsers);
router.patch('/utilisateurs/:id', authenticate, AuthController.updateUser);
router.delete('/utilisateurs/:id', authenticate, AuthController.deleteUser);
router.get('/admin-stats',       authenticate, AuthController.getAdminStats);

// Logo de l'établissement (admin uniquement, vérifié dans le contrôleur)
router.patch(
  '/etablissement/logo',
  authenticate,
  uploadLogo.single('logo'),
  AuthController.uploadLogoEtablissement,
);

// ── SUPER ADMIN ───────────────────────────────────────────────────
router.get('/superadmin/etablissements',         authenticate, AuthController.getEtablissements);
router.put('/superadmin/etablissement/:id',      authenticate, AuthController.updateEtablissement);
router.delete('/superadmin/etablissement/:id',   authenticate, AuthController.deleteEtablissement);

module.exports = router;