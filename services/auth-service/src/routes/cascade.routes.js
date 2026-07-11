// services/auth-service/src/routes/cascade.routes.js
const { prisma } = require('../utils/db'); // Ajoutez cette ligne en haut
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const CascadeController = require('../controllers/cascade.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

// ── Super Admin → crée Etablissement + compte Admin ───────────────
// POST /auth/cascade/etablissement
router.post('/etablissement',
  authenticate,
  requireRole('super_admin'),
  [
    body('nom').notEmpty().trim(),
    body('ville').notEmpty().trim(),
    body('plan').isIn(['free', 'premium']),
    body('emailAdmin').isEmail().normalizeEmail(),
    body('prenomAdmin').notEmpty().trim(),
    body('nomAdmin').notEmpty().trim(),
  ],
  CascadeController.creerEtablissement
);

// ── Admin → crée Département + compte Chef Dept ───────────────────
// POST /auth/cascade/departement
router.post('/departement',
  authenticate,
  requireRole('admin'),
  [
    body('nom').notEmpty().trim(),
    body('description').optional().trim(),
    body('emailChef').isEmail().normalizeEmail(),
    body('prenomChef').notEmpty().trim(),
    body('nomChef').notEmpty().trim(),
  ],
  CascadeController.creerDepartement
);

// ── Admin → modifie Département ───────────────────────────────────
// PUT /auth/cascade/departement/:id
router.put('/departement/:id',
  authenticate,
  requireRole('admin'),
  [
    body('nom').optional().trim(),
    body('description').optional().trim(),
  ],
  CascadeController.modifierDepartement
);

// ── Admin → supprime Département ──────────────────────────────────
// DELETE /auth/cascade/departement/:id
router.delete('/departement/:id',
  authenticate,
  requireRole('admin'),
  CascadeController.supprimerDepartement
);

// ── Chef Dept → crée Classe + compte Délégué ──────────────────────
// POST /auth/cascade/classe
router.post('/classe',
  authenticate,
  requireRole('chef_departement'),
  [
    body('nomSalle').notEmpty().trim(),
    body('filiere').notEmpty().trim(),
    body('niveau').isIn(['L1', 'L2', 'L3', 'M1', 'M2']),
    body('formation').isIn(['FI', 'FA']),
    body('emailDelegue').isEmail().normalizeEmail(),
    body('prenomDelegue').notEmpty().trim(),
    body('nomDelegue').notEmpty().trim(),
  ],
  CascadeController.creerClasse
);
// DELETE /auth/cascade/classe/:id — Chef supprime sa classe
router.delete('/classe/:id',
  authenticate,
  requireRole('chef_departement'),
  async (req, res) => {
    try {
      const classe = await prisma.classe.findUnique({
        where: { id: req.params.id },
        include: { _count: { select: { etudiants: true } } },
      });

      if (!classe)
        return res.status(404).json({ error: 'Classe introuvable' });

      // Vérifier que la classe appartient bien au département du chef
      const chef = await prisma.user.findUnique({
        where:  { id: req.user.id },
        select: { departementId: true },
      });

      if (classe.departementId !== chef.departementId)
        return res.status(403).json({ error: 'Accès refusé' });

      // Supprimer dans l'ordre des FK
      await prisma.presence.deleteMany({
        where: { session: { classeId: req.params.id } },
      });
      await prisma.sessionPresence.deleteMany({
        where: { classeId: req.params.id },
      });
      await prisma.note.deleteMany({
        where: { matiere: { classeId: req.params.id } },
      });
      await prisma.matiere.deleteMany({
        where: { classeId: req.params.id },
      });
      // Détacher les étudiants et le délégué
      await prisma.user.updateMany({
        where: { classeEtudiantId: req.params.id },
        data:  { classeEtudiantId: null },
      });
      await prisma.user.updateMany({
        where: { classeDelegueId: req.params.id },
        data:  { classeDelegueId: null },
      });
      await prisma.classe.delete({ where: { id: req.params.id } });

      return res.json({ message: 'Classe supprimée' });
    } catch (err) {
      console.error('[Cascade] Delete classe:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── GET listes ────────────────────────────────────────────────────

// GET /auth/cascade/etablissements (super admin)
router.get('/etablissements',
  authenticate,
  requireRole('super_admin'),
  CascadeController.getEtablissements
);

// GET /auth/cascade/departements (admin)
router.get('/departements',
  authenticate,
  requireRole('admin', 'super_admin'),
  CascadeController.getDepartements
);

// GET /auth/cascade/classes (chef dept)
router.get('/classes',
  authenticate,
  requireRole('chef_departement', 'admin'),
  CascadeController.getClasses
);
// ── Super Admin → modifier statut établissement ─────────────────
// PATCH /auth/cascade/etablissement/:id/statut
router.patch('/etablissement/:id/statut',
  authenticate,
  requireRole('super_admin'),
  CascadeController.toggleStatutEtablissement
);

// ── Super Admin → modifier plan établissement ───────────────────
// PATCH /auth/cascade/etablissement/:id/plan
router.patch('/etablissement/:id/plan',
  authenticate,
  requireRole('super_admin'),
  CascadeController.togglePlanEtablissement
);
// GET /auth/cascade/ma-classe — étudiants de la classe du délégué
router.get('/ma-classe',
  authenticate,
  requireRole('delegue'),
  async (req, res) => {
    try {
      const delegue = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { classeDelegueId: true, classeDelegue: { select: { codeGenere: true, filiere: true, niveau: true } } }
      });
      if (!delegue?.classeDelegueId)
        return res.json({ etudiants: [], classe: null });

      const etudiants = await prisma.user.findMany({
        where:   { classeEtudiantId: delegue.classeDelegueId, role: 'etudiant' },
        select:  { id: true, nom: true, prenom: true, matricule: true, email: true },
        orderBy: { nom: 'asc' },
      });

      return res.json({ etudiants, classe: delegue.classeDelegue });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);
module.exports = router;
