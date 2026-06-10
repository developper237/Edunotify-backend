const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const AuthController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

// ── ROUTES AUTHENTIFICATION (Déjà existantes) ────────────────────
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
], AuthController.login);

router.post('/logout', authenticate, AuthController.logout);
router.post('/refresh', AuthController.refresh);
router.get('/me', authenticate, AuthController.me);
router.post('/change-password', authenticate, AuthController.changePassword);
router.post('/first-login', authenticate, AuthController.firstLogin);

// ── ROUTES ADMIN ÉTABLISSEMENT (Déjà fonctionnelles) ──────────────
router.get('/utilisateurs', authenticate, AuthController.getUsers);
router.patch('/utilisateurs/:id', authenticate, AuthController.updateUser);
router.delete('/utilisateurs/:id', authenticate, AuthController.deleteUser);
router.get('/admin-stats', authenticate, AuthController.getAdminStats);

// ── ROUTES SUPER ADMIN (À AJOUTER ICI) ───────────────────────────
// ATTENTION : Ne pas mettre '/auth' ici car il est déjà dans index.js
router.get('/superadmin/etablissements', authenticate, AuthController.getEtablissements);
router.put('/superadmin/etablissement/:id', authenticate, AuthController.updateEtablissement);
router.delete('/superadmin/etablissement/:id', authenticate, AuthController.deleteEtablissement);


router.patch('/fcm-token', authenticate, AuthController.updateFcmToken);
router.patch('/fcm-token', authenticate, AuthController.updateFcmToken);
module.exports = router;
