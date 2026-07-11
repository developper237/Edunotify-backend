// services/auth-service/src/controllers/auth.controller.js

const { validationResult } = require('express-validator');
const { prisma }           = require('../utils/db');
const {
  verifyPassword,
  hashPassword,
  generateAccessToken,
  generateRefreshToken,
  serializeUser,
} = require('../utils/helpers');
const jwt          = require('jsonwebtoken');
const EmailService = require('../../../../shared/email/emailService');

const AuthController = {

  // ── POST /auth/login ────────────────────────────────────────────
  login: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          etablissement:   true,
          departementChef: true,
          classeEtudiant:  true,
          classeDelegue:   true,
        },
      });

      if (!user) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      }

      // FIX : 'inactif' = premier login autorisé (doit changer son mdp)
      // Seul le statut 'suspendu' bloque complètement la connexion
      if (user.statut === 'suspendu') {
        return res.status(403).json({ error: 'Compte suspendu. Contactez votre administrateur.' });
      }
      // Établissement suspendu (défaut de paiement)
if (user.etablissement && !user.etablissement.actif) {
  return res.status(403).json({
    error: 'Votre établissement est suspendu. Contactez le support SmartCampus.',
    code:  'ETABLISSEMENT_SUSPENDU',
  });
}

      const passwordOk = await verifyPassword(password, user.passwordHash);
      if (!passwordOk) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      }

      const accessToken  = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user.id);

      await prisma.refreshToken.create({
        data: {
          token:     refreshToken,
          userId:    user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return res.json({
        accessToken,
        refreshToken,
        user: serializeUser(user),
        // true si c'est le premier login → Flutter affiche l'écran de changement forcé
        doitChangerMotDePasse: user.statut === 'premier_login',
      });
    } catch (err) {
      console.error('[Login]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── POST /auth/logout ───────────────────────────────────────────
  logout: async (req, res) => {
    const { refreshToken } = req.body;
    try {
      if (refreshToken) {
        await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
      }
      return res.json({ message: 'Déconnecté' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── POST /auth/refresh ──────────────────────────────────────────
  refresh: async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token manquant' });
    }

    try {
      const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        return res.status(401).json({ error: 'Refresh token invalide ou expiré' });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        include: {
          etablissement:   true,
          departementChef: true,
          classeEtudiant:  true,
          classeDelegue:   true,
        },
      });

      if (!user || user.statut === 'suspendu') {
        return res.status(401).json({ error: 'Utilisateur non trouvé ou suspendu' });
      }

      const newAccessToken = generateAccessToken(user);

      return res.json({
        accessToken: newAccessToken,
        user: serializeUser(user),
      });
    } catch (err) {
      return res.status(401).json({ error: 'Refresh token invalide' });
    }
  },

  // ── POST /auth/change-password ──────────────────────────────────
  // Utilisé depuis les paramètres (compte déjà actif)
  // ET depuis ForceChangePasswordScreen (premier login, statut inactif)
  // Dans les deux cas, on passe statut à 'actif' après succès.
  changePassword: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { ancienMotDePasse, nouveauMotDePasse } = req.body;

    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });

      const passwordOk = await verifyPassword(ancienMotDePasse, user.passwordHash);
      if (!passwordOk) {
        return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
      }

      const newHash = await hashPassword(nouveauMotDePasse);

      await prisma.user.update({
        where: { id: req.user.id },
        data: {
          passwordHash: newHash,
          statut: 'actif', // active le compte si c'était un premier login
        },
      });

      await EmailService.sendPasswordChanged({ email: user.email, prenom: user.prenom });

      return res.json({ message: 'Mot de passe modifié avec succès' });
    } catch (err) {
      console.error('[ChangePassword]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── POST /auth/first-login ──────────────────────────────────────
  
  firstLogin: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { nouveauMotDePasse } = req.body;

    try {
      const newHash = await hashPassword(nouveauMotDePasse);

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: {
          passwordHash: newHash,
          statut: 'actif',
        },
        include: {
          etablissement:   true,
          departementChef: true,
          classeEtudiant:  true,
          classeDelegue:   true,
        },
      });

      const accessToken  = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user.id);

      await prisma.refreshToken.create({
        data: {
          token:     refreshToken,
          userId:    user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return res.json({
        message: 'Mot de passe défini avec succès',
        accessToken,
        refreshToken,
        user: serializeUser(user),
      });
    } catch (err) {
      console.error('[FirstLogin]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /auth/me ────────────────────────────────────────────────
  me: async (req, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          etablissement:   true,
          departementChef: true,
          classeEtudiant:  true,
          classeDelegue:   true,
        },
      });

      if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

      return res.json({ user: serializeUser(user) });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── PATCH /auth/fcm-token ───────────────────────────────────────
  updateFcmToken: async (req, res) => {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'fcmToken requis' });
    try {
      await prisma.user.update({
        where: { id: req.user.id },
        data:  { fcmToken },
      });
      return res.json({ message: 'FCM token mis à jour' });
    } catch (err) {
      console.error('[FCM Token]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /auth/utilisateurs ──────────────────────────────────────
  getUsers: async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        where: { etablissementId: req.user.etablissementId },
        select: {
          id:        true,
          nom:       true,
          prenom:    true,
          email:     true,
          role:      true,
          statut:    true,
          matricule: true,
        },
        orderBy: { prenom: 'asc' },
      });
      return res.json({ data: users });
    } catch (err) {
      console.error('[GetUsers]', err);
      return res.status(500).json({ error: 'Erreur lors de la récupération' });
    }
  },

  // ── PATCH /auth/utilisateurs/:id ───────────────────────────────
  updateUser: async (req, res) => {
    const { id } = req.params;
    const { nom, prenom, matricule } = req.body;

    try {
      const userToUpdate = await prisma.user.findUnique({ where: { id } });

      if (!userToUpdate || userToUpdate.etablissementId !== req.user.etablissementId) {
        return res.status(403).json({ error: 'Action non autorisée' });
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          nom:       nom       || undefined,
          prenom:    prenom    || undefined,
          matricule: matricule || undefined,
        },
      });

      return res.json({ message: 'Utilisateur mis à jour', data: updated });
    } catch (err) {
      console.error('[UpdateUser]', err);
      return res.status(500).json({ error: 'Erreur lors de la modification' });
    }
  },

  // ── DELETE /auth/utilisateurs/:id ──────────────────────────────
  deleteUser: async (req, res) => {
    const { id } = req.params;

    try {
      if (id === req.user.id) {
        return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
      }

      const userToDelete = await prisma.user.findUnique({ where: { id } });

      if (!userToDelete || userToDelete.etablissementId !== req.user.etablissementId) {
        return res.status(403).json({ error: 'Action non autorisée ou utilisateur inexistant' });
      }

      await prisma.user.delete({ where: { id } });

      return res.json({ message: 'Utilisateur supprimé avec succès' });
    } catch (err) {
      console.error('[DeleteUser]', err);
      return res.status(500).json({ error: 'Erreur serveur lors de la suppression' });
    }
  },

  // ── GET /auth/admin-stats ───────────────────────────────────────
  getAdminStats: async (req, res) => {
    try {
      const etablissementId = req.user.etablissementId;

      const totalUsers = await prisma.user.count({ where: { etablissementId } });

      const roles = await prisma.user.groupBy({
        by: ['role'],
        where: { etablissementId },
        _count: { id: true },
      });

      const activeCount = await prisma.user.count({
        where: { etablissementId, statut: 'actif' },
      });

      return res.json({
        totalUsers,
        activeUsers: activeCount,
        roleDistribution: roles.map(r => ({ role: r.role, count: r._count.id })),
      });
    } catch (err) {
      console.error('[GetAdminStats]', err);
      return res.status(500).json({ error: 'Erreur stats' });
    }
  },
// ── PATCH /auth/etablissement/logo ─────────────────────────────
  
  uploadLogoEtablissement: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Réservé aux administrateurs d\'établissement' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier reçu' });
      }
      if (!req.user.etablissementId) {
        return res.status(400).json({ error: 'Aucun établissement associé à ce compte' });
      }
 
      // URL absolue et accessible depuis les téléphones du réseau local
      // (même host que celui utilisé par ApiClient._devHost côté Flutter)
      const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
      const logoUrl = `${baseUrl}/uploads/logos/${req.file.filename}`;
 
      await prisma.etablissement.update({
        where: { id: req.user.etablissementId },
        data:  { logoUrl },
      });
 
      return res.json({ message: 'Logo mis à jour', logoUrl });
    } catch (err) {
      console.error('[UploadLogoEtablissement]', err);
      return res.status(500).json({ error: 'Erreur serveur lors de l\'upload du logo' });
    }
  },
  // ── GET /auth/superadmin/etablissements ────────────────────────
  getEtablissements: async (req, res) => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Interdit' });
    }
    try {
      const etabs = await prisma.etablissement.findMany({
        include: { _count: { select: { users: true } } },
      });
      res.json({ etablissements: etabs });
    } catch (err) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── PUT /auth/superadmin/etablissement/:id ─────────────────────
  updateEtablissement: async (req, res) => {
    try {
      const { nom, plan } = req.body;
      const planFormatte = plan ? plan.toLowerCase() : undefined;

      await prisma.etablissement.update({
        where: { id: req.params.id },
        data: { nom, plan: planFormatte },
      });

      res.json({ message: 'Mis à jour avec succès' });
    } catch (error) {
      console.error('[UpdateEtablissement]', error);
      res.status(400).json({
        error: "Erreur de validation. Le plan doit être 'free' ou 'premium'.",
      });
    }
  },

  // ── DELETE /auth/superadmin/etablissement/:id ──────────────────
  deleteEtablissement: async (req, res) => {
    try {
      await prisma.etablissement.delete({ where: { id: req.params.id } });
      res.json({ message: 'Supprimé avec succès' });
    } catch (error) {
      console.error('[DeleteEtablissement]', error);
      res.status(500).json({ error: 'Erreur lors de la suppression.' });
    }
  },
};

module.exports = AuthController;