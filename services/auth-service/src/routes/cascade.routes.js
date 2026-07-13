// services/auth-service/src/routes/cascade.routes.js
const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/cascade.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { checkPlan } = require('../middleware/checkPlan');

// ══════════════════════════════════════════════════════════════════
// SUPER ADMIN — Établissements
// ══════════════════════════════════════════════════════════════════

// Créer un établissement + compte admin
router.post('/etablissement',
  authenticate,
  requireRole('super_admin'),
  ctrl.creerEtablissement
);

// Lister tous les établissements
router.get('/etablissements',
  authenticate,
  requireRole('super_admin'),
  ctrl.listerEtablissements
);

// Activer / désactiver un établissement
router.patch('/etablissement/:id/statut',
  authenticate,
  requireRole('super_admin'),
  ctrl.toggleStatutEtablissement
);

// Changer le plan (free → premium)
router.patch('/etablissement/:id/plan',
  authenticate,
  requireRole('super_admin'),
  ctrl.changerPlanEtablissement
);

// ══════════════════════════════════════════════════════════════════
// ADMIN — Départements
// ══════════════════════════════════════════════════════════════════

// Créer un département + compte chef
// ← checkPlan : max 1 département en gratuit
router.post('/departement',
  authenticate,
  requireRole('admin'),
  checkPlan('maxDepartements'),
  ctrl.creerDepartement
);

// Lister les départements de l'établissement
router.get('/departements',
  authenticate,
  requireRole('admin', 'super_admin'),
  ctrl.listerDepartements
);

// Modifier un département
router.patch('/departement/:id',
  authenticate,
  requireRole('admin'),
  ctrl.modifierDepartement
);

// Supprimer un département
router.delete('/departement/:id',
  authenticate,
  requireRole('admin'),
  ctrl.supprimerDepartement
);

// ══════════════════════════════════════════════════════════════════
// CHEF DE DÉPARTEMENT — Classes
// ══════════════════════════════════════════════════════════════════

// Créer une classe + compte délégué
// ← checkPlan : max 3 classes en gratuit
router.post('/classe',
  authenticate,
  requireRole('chef_departement'),
  checkPlan('maxClasses'),
  ctrl.creerClasse
);

// Lister les classes du département
router.get('/classes',
  authenticate,
  requireRole('chef_departement', 'admin'),
  ctrl.listerClasses
);

// Modifier une classe
router.patch('/classe/:id',
  authenticate,
  requireRole('chef_departement'),
  ctrl.modifierClasse
);

// Supprimer une classe
router.delete('/classe/:id',
  authenticate,
  requireRole('chef_departement'),
  ctrl.supprimerClasse
);

// Étudiants de la classe du délégué
router.get('/ma-classe',
  authenticate,
  requireRole('delegue'),
  ctrl.maClasse
);

// ══════════════════════════════════════════════════════════════════
// CHEF / ADMIN — Utilisateurs
// ══════════════════════════════════════════════════════════════════

// Lister les utilisateurs de l'établissement
router.get('/utilisateurs',
  authenticate,
  requireRole('admin', 'chef_departement', 'super_admin'),
  ctrl.listerUtilisateurs
);

// Créer un compte manuellement
router.post('/utilisateur',
  authenticate,
  requireRole('admin', 'chef_departement'),
  ctrl.creerUtilisateur
);

// Modifier un utilisateur
router.patch('/utilisateur/:id',
  authenticate,
  requireRole('admin', 'chef_departement'),
  ctrl.modifierUtilisateur
);

// Désactiver / réactiver un utilisateur
router.patch('/utilisateur/:id/statut',
  authenticate,
  requireRole('admin', 'chef_departement'),
  ctrl.toggleStatutUtilisateur
);

// Supprimer un utilisateur
router.delete('/utilisateur/:id',
  authenticate,
  requireRole('admin', 'chef_departement'),
  ctrl.supprimerUtilisateur
);

// Réinitialiser le mot de passe d'un utilisateur
router.post('/utilisateur/:id/reset-password',
  authenticate,
  requireRole('admin', 'chef_departement'),
  ctrl.resetPassword
);

// ══════════════════════════════════════════════════════════════════
// IMPORT CSV — Étudiants
// ══════════════════════════════════════════════════════════════════
// ← checkPlan : max 50 étudiants en gratuit (vérifié dans le middleware)

router.post('/csv/import',
  authenticate,
  requireRole('delegue', 'chef_departement', 'admin'),
  checkPlan('maxEtudiants'),
  ctrl.importCsv
);

// ══════════════════════════════════════════════════════════════════
// PLAN & TARIFICATION
// ══════════════════════════════════════════════════════════════════

// Infos du plan actuel (visible par l'admin)
router.get('/plan',
  authenticate,
  requireRole('admin', 'chef_departement', 'delegue', 'etudiant'),
  ctrl.getPlanInfo
);

module.exports = router;