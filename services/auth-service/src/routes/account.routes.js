// services/auth-service/src/routes/account.routes.js
const express = require('express');
const router  = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { prisma } = require('../utils/db');

// ── GET /auth/accounts/users ──────────────────────────────────────
router.get('/users',
  authenticate,
  requireRole('admin', 'super_admin'),
  async (req, res) => {
    try {
      const user  = await prisma.user.findUnique({ where: { id: req.user.id } });
      const where = req.user.role === 'super_admin'
        ? {}
        : { etablissementId: user.etablissementId };

      const users = await prisma.user.findMany({
        where,
        select: {
          id:        true,
          nom:       true,
          prenom:    true,
          email:     true,
          role:      true,
          statut:    true,
          matricule: true,
          createdAt: true,
          etablissement:   { select: { nom: true } },
          departementChef: { select: { nom: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ users, total: users.length });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── PUT /auth/accounts/users/:id/statut ──────────────────────────
router.put('/users/:id/statut',
  authenticate,
  requireRole('admin', 'super_admin'),
  async (req, res) => {
    const { id } = req.params;
    const { statut } = req.body;
    if (!['actif', 'inactif'].includes(statut))
      return res.status(400).json({ error: 'Statut invalide' });

    try {
      const updated = await prisma.user.update({
        where:  { id },
        data:   { statut },
        select: { id: true, email: true, statut: true },
      });
      return res.json({ user: updated });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── DELETE /auth/accounts/users/:id ──────────────────────────────
router.delete('/users/:id',
  authenticate,
  requireRole('admin', 'super_admin'),
  async (req, res) => {
    try {
      await prisma.user.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Compte supprimé' });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── GET /auth/accounts/stats ──────────────────────────────────────
router.get('/stats',
  authenticate,
  requireRole('super_admin'),
  async (req, res) => {
    try {
      const [nbEtabs, nbUsers, nbSessions, nbPremium] = await Promise.all([
        prisma.etablissement.count(),
        prisma.user.count({ where: { role: { not: 'super_admin' } } }),
        prisma.sessionPresence.count(),
        prisma.etablissement.count({ where: { plan: 'premium' } }),
      ]);

      const etablissements = await prisma.etablissement.findMany({
        include: {
          _count: { select: { users: true } },
          departements: {
            include: {
              classes: {
                include: {
                  _count:   { select: { etudiants: true } },
                  sessions: {
                    where:   { actif: false },
                    include: {
                      presences: { select: { statut: true } },
                      _count:    { select: { presences: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const statsEtabs = etablissements.map(e => {
        const allClasses    = e.departements.flatMap(d => d.classes);
        const allSessions   = allClasses.flatMap(c => c.sessions);
        const nbEtudiants   = allClasses.reduce((s, c) => s + c._count.etudiants, 0);
        const totalPresents = allSessions.reduce(
          (s, sess) => s + sess.presences.filter(p => p.statut === 'present').length, 0
        );
        const totalPossible = allSessions.reduce(
          (s, sess) => s + sess._count.presences, 0
        );

        return {
          id:        e.id,
          nom:       e.nom,
          ville:     e.ville,
          plan:      e.plan,
          actif:     e.actif,
          nbUsers:   e._count.users,
          etudiants: nbEtudiants,
          sessions:  allSessions.length,
          taux:      totalPossible > 0
            ? Math.round((totalPresents / totalPossible) * 100)
            : 0,
        };
      });

      return res.json({
        plateforme: {
          nbEtablissements: nbEtabs,
          nbUtilisateurs:   nbUsers,
          nbSessions:       nbSessions,
          nbPremium,
        },
        etablissements: statsEtabs,
      });
    } catch (err) {
      console.error('[Stats]', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

module.exports = router;