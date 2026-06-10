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

      if (user.statut === 'inactif') {
        return res.status(403).json({ error: 'Compte désactivé. Contactez votre administrateur.' });
      }

      const passwordOk = await verifyPassword(password, user.passwordHash);
      if (!passwordOk) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      }

      const accessToken  = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user.id);

      // Sauvegarder le refresh token
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
        premierLogin: user.statut === 'premier_login',
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
        await prisma.refreshToken.deleteMany({
          where: { token: refreshToken },
        });
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

      if (!user || user.statut === 'inactif') {
        return res.status(401).json({ error: 'Utilisateur non trouvé ou inactif' });
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
  changePassword: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { ancienMotDePasse, nouveauMotDePasse } = req.body;

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
      });

      const passwordOk = await verifyPassword(ancienMotDePasse, user.passwordHash);
      if (!passwordOk) {
        return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
      }

      const newHash = await hashPassword(nouveauMotDePasse);

      await prisma.user.update({
        where: { id: req.user.id },
        data: {
          passwordHash: newHash,
          statut: 'actif',
        },
      });

      // Notifier par email
      await EmailService.sendPasswordChanged({
        email:  user.email,
        prenom: user.prenom,
      });

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

      if (!user) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      return res.json({ user: serializeUser(user) });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── PUT /auth/fcm-token ─────────────────────────────────────────
  updateFcmToken: async (req, res) => {
    const { fcmToken } = req.body;
    try {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { fcmToken },
      });
      return res.json({ message: 'FCM token mis à jour' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── GET /utilisateurs (SaaS) ──
  getUsers: async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        where: {
          etablissementId: req.user.etablissementId,
        },
        select: {
          id: true,
          nom: true,
          prenom: true,
          email: true,
          role: true,
          statut: true,
          matricule: true,
        },
        orderBy: { prenom: 'asc' },
      });

       return res.json({ data: users }); // On renvoie 'data' pour correspondre au code Flutter
    } catch (err) {
      console.error('[GetUsers]', err);
      return res.status(500).json({ error: 'Erreur lors de la récupération' });
    }
  },

   // AJOUTE CETTE FONCTION ICI :
  updateUser: async (req, res) => {
    const { id } = req.params;
    const { nom, prenom, matricule } = req.body;

    try {
      // Vérification que l'utilisateur appartient au même établissement que l'admin
      const userToUpdate = await prisma.user.findUnique({ where: { id } });
      
      if (!userToUpdate || userToUpdate.etablissementId !== req.user.etablissementId) {
        return res.status(403).json({ error: "Action non autorisée" });
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          nom: nom || undefined,
          prenom: prenom || undefined,
          matricule: matricule || undefined,
        },
      });

      return res.json({ message: 'Utilisateur mis à jour', data: updated });
    } catch (err) {
      console.error('[UpdateUser]', err);
      return res.status(500).json({ error: 'Erreur lors de la modification' });
    }
  },
  // ── PATCH /auth/utilisateurs/:id ──
  updateUser: async (req, res) => {
    const { id } = req.params;
    const { nom, prenom, matricule } = req.body;

    try {
      // Vérification de sécurité : l'admin ne peut modifier que les gens de son établissement
      const userToUpdate = await prisma.user.findUnique({ where: { id } });
      
      if (!userToUpdate || userToUpdate.etablissementId !== req.user.etablissementId) {
        return res.status(403).json({ error: "Action non autorisée" });
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          nom: nom || undefined,
          prenom: prenom || undefined,
          matricule: matricule || undefined,
        },
      });
      return res.json({ message: 'Utilisateur mis à jour', data: updated });
    } catch (err) {
      console.error('[UpdateUser]', err);
      return res.status(500).json({ error: 'Erreur lors de la modification' });
    }
  },

  // ── DELETE /utilisateurs/:id ──
  deleteUser: async (req, res) => {
    const { id } = req.params;

    try {
      if (id === req.user.id) {
        return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte admin" });
      }

      const userToDelete = await prisma.user.findUnique({ where: { id } });
      
      if (!userToDelete || userToDelete.etablissementId !== req.user.etablissementId) {
        return res.status(403).json({ error: "Action non autorisée ou utilisateur inexistant" });
      }

      await prisma.user.delete({
        where: { id },
      });

      return res.json({ message: 'Utilisateur supprimé avec succès' });
    } catch (err) {
      console.error('[DeleteUser]', err);
      return res.status(500).json({ error: 'Erreur serveur lors de la suppression' });
    }
  },

  

    // ── GET /auth/admin-stats (Statistiques SaaS) ──
  getAdminStats: async (req, res) => {
    try {
      const etablissementId = req.user.etablissementId;

      // 1. Compte total
      const totalUsers = await prisma.user.count({ where: { etablissementId } });

      // 2. Répartition par rôle
      const roles = await prisma.user.groupBy({
        by: ['role'],
        where: { etablissementId },
        _count: { id: true }
      });

      // 3. Utilisateurs actifs vs inactifs
      const activeCount = await prisma.user.count({ 
        where: { etablissementId, statut: 'actif' } 
      });

      return res.json({
        totalUsers,
        activeUsers: activeCount,
        roleDistribution: roles.map(r => ({
          role: r.role,
          count: r._count.id
        }))
      });
    } catch (err) {
      console.error('[GetAdminStats]', err);
      return res.status(500).json({ error: 'Erreur stats' });
    }
  },

  // ── GET /auth/superadmin/etablissements ──
  getEtablissements: async (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: "Interdit" });
    try {
      const etabs = await prisma.etablissement.findMany({
        include: { _count: { select: { users: true } } }
      });
      res.json({ etablissements: etabs });
    } catch (err) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ── PUT /auth/superadmin/etablissement/:id ──
 // services/auth-service/src/controllers/auth.controller.js

updateEtablissement: async (req, res) => {
  try {
    const { nom, plan } = req.body;

    // CORRECTION : On force en MINUSCULES car ton schéma Prisma a : enum Plan { free, premium }
    const planFormatte = plan ? plan.toLowerCase() : undefined;

    await prisma.etablissement.update({
      where: { id: req.params.id },
      data: { 
        nom, 
        plan: planFormatte 
      }
    });
    
    res.json({ message: "Mis à jour avec succès" });
  } catch (error) {
    console.error("[UpdateEtablissement Error]", error);
    res.status(400).json({ 
      error: "Erreur de validation Prisma. Le plan doit être 'free' ou 'premium'." 
    });
  }
},

  // ── DELETE /auth/superadmin/etablissement/:id ──
  deleteEtablissement: async (req, res) => {
    try {
      await prisma.etablissement.delete({ where: { id: req.params.id } });
      res.json({ message: "Supprimé avec succès" });
    } catch (error) {
      console.error("[DeleteEtablissement Error]", error);
      res.status(500).json({ error: "Erreur lors de la suppression." });
    }
  }
};

  updateFcmToken: async (req, res) => {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'fcmToken requis' });
    try {
      await prisma.user.update({
        where: { id: req.user.id },
        data:  { fcmToken },
      });
      return res.json({ message: 'FCM token mis a jour' });
    } catch (err) {
      console.error('[FCM Token]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  },

module.exports = AuthController;

