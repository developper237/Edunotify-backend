// services/billing-service/src/seed/plans.js
// Catalogue des offres EduNotify — tarification par taille d'établissement (FCFA/XAF).
// maxEtudiants: null = illimité.

const { prisma } = require('../utils/db');

const PLANS = [
  {
    code:            'free',
    nom:             'Gratuit',
    description:     'Pour découvrir EduNotify — jusqu\'à 50 étudiants.',
    maxEtudiants:    50,
    prixMensuelXAF:  0,
    prixAnnuelXAF:   0,
    fonctionnalites: {
      maxEtudiants: 50, maxClasses: 3, maxDepartements: 1,
      sondages: false, chatbot: false, exportPdf: false,
    },
  },
  {
    code:            'pro',
    nom:             'Pro',
    description:     'Pour les établissements en croissance — jusqu\'à 500 étudiants.',
    maxEtudiants:    500,
    prixMensuelXAF:  15000,
    prixAnnuelXAF:   150000,
    fonctionnalites: {
      maxEtudiants: null, maxClasses: null, maxDepartements: null,
      sondages: true, chatbot: true, exportPdf: true,
    },
  },
  {
    code:            'institution',
    nom:             'Institution',
    description:     'Effectif illimité + priorité support — pour les grandes institutions.',
    maxEtudiants:    null,
    prixMensuelXAF:  35000,
    prixAnnuelXAF:   350000,
    fonctionnalites: {
      maxEtudiants: null, maxClasses: null, maxDepartements: null,
      sondages: true, chatbot: true, exportPdf: true,
    },
  },
];

const semerPlans = async () => {
  for (const plan of PLANS) {
    await prisma.billingPlan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
  }
  console.log(`[Billing] ${PLANS.length} plans initialisés`);
};

module.exports = { semerPlans, PLANS };
