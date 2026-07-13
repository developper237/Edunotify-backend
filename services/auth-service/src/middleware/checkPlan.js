// services/auth-service/src/middlewares/checkPlan.js

const { prisma } = require('../utils/db');

const LIMITES_FREE = {
  maxEtudiants:    50,
  maxClasses:      3,
  maxDepartements: 1,
  historiqueJours: 30,
  maxNotifsMois:   10,
  sondages:        false,
  chatbot:         false,
  exportPdf:       false,
};

const checkPlan = (feature) => async (req, res, next) => {
  try {
    const etab = await prisma.etablissement.findUnique({
      where:  { id: req.user.etablissementId },
      select: { plan: true },
    });

    if (!etab) return res.status(403).json({ error: 'Établissement introuvable' });
    if (etab.plan === 'premium') return next();

    // Plan gratuit — vérifier la limite
    const limite = LIMITES_FREE[feature];

    if (feature === 'sondages' && !limite)
      return res.status(403).json({
        error:   'Fonctionnalité réservée au plan Premium.',
        upgrade: true,
        feature: 'sondages',
      });

    if (feature === 'chatbot' && !limite)
      return res.status(403).json({
        error:   'SmartCampus IA est réservé au plan Premium.',
        upgrade: true,
        feature: 'chatbot',
      });

    if (feature === 'exportPdf' && !limite)
      return res.status(403).json({
        error:   'L\'export PDF est réservé au plan Premium.',
        upgrade: true,
        feature: 'exportPdf',
      });

    if (feature === 'maxClasses') {
      const count = await prisma.classe.count({
        where: { departement: { etablissementId: req.user.etablissementId } },
      });
      if (count >= limite)
        return res.status(403).json({
          error:   `Plan gratuit limité à ${limite} classes.`,
          upgrade: true,
          feature: 'maxClasses',
          limite,
        });
    }

    if (feature === 'maxDepartements') {
      const count = await prisma.departement.count({
        where: { etablissementId: req.user.etablissementId },
      });
      if (count >= limite)
        return res.status(403).json({
          error:   `Plan gratuit limité à ${limite} département.`,
          upgrade: true,
          feature: 'maxDepartements',
          limite,
        });
    }

    if (feature === 'maxEtudiants') {
      const count = await prisma.user.count({
        where: { etablissementId: req.user.etablissementId, role: 'etudiant' },
      });
      if (count >= limite)
        return res.status(403).json({
          error:   `Plan gratuit limité à ${limite} étudiants.`,
          upgrade: true,
          feature: 'maxEtudiants',
          limite,
        });
    }

    next();
  } catch (err) {
    console.error('[checkPlan]', err);
    next();
  }
};

module.exports = { checkPlan, LIMITES_FREE };