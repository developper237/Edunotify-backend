// services/billing-service/src/controllers/billing.controller.js

const { prisma } = require('../utils/db');
const fapshi = require('../services/fapshi');
const cinetpay = require('../services/cinetpay');

const ESSAI_GRATUIT_JOURS = 14;

const genererNumeroFacture = () =>
  `INV-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

const nbEtudiantsEtab = (etablissementId) =>
  prisma.user.count({ where: { etablissementId, role: 'etudiant' } });

// Active (ou réactive) l'abonnement après un paiement confirmé.
const activerAbonnement = async (subscriptionId, montantXAF, cycle) => {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });
  if (!sub) return null;

  const now       = new Date();
  const jours     = cycle === 'annuel' ? 365 : 30;
  const finPeriode = new Date(now.getTime() + jours * 24 * 3600 * 1000);

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      statut:            'actif',
      essaiJusqua:       null,
      debutPeriode:      now,
      finPeriode,
      prixXAF:           montantXAF,
      renouvellementAuto: true,
      annuleLe:          null,
    },
  });

  await prisma.etablissement.update({
    where: { id: sub.etablissementId },
    data:  { plan: sub.planCode },
  });

  return updated;
};

// ──────────────────────────────────────────────────────────────────
// GET /billing/plans — catalogue des offres
// ──────────────────────────────────────────────────────────────────

const listerPlans = async (req, res) => {
  try {
    const plans = await prisma.billingPlan.findMany({
      where:  { actif: true },
      orderBy: { prixMensuelXAF: 'asc' },
    });
    return res.json({ plans });
  } catch (err) {
    console.error('[listerPlans]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /billing/subscriptions — souscrire / changer de plan
// Body: { planCode: 'pro'|'institution'|'free', cycle?: 'mensuel'|'annuel',
//         methodePaiement?: 'mtn_momo'|'orange_money', telephone?, email? }
// ──────────────────────────────────────────────────────────────────

const creerAbonnement = async (req, res) => {
  try {
    const { planCode, cycle = 'mensuel', methodePaiement, telephone, email } = req.body;
    const etabId = req.user.etablissementId;

    if (!etabId)
      return res.status(400).json({ error: 'Aucun établissement associé à ce compte' });
    if (!['free', 'pro', 'institution'].includes(planCode))
      return res.status(400).json({ error: 'Plan invalide (free, pro, institution)' });
    if (!['mensuel', 'annuel'].includes(cycle))
      return res.status(400).json({ error: 'Cycle invalide (mensuel, annuel)' });
    if (methodePaiement && !['mtn_momo', 'orange_money'].includes(methodePaiement))
      return res.status(400).json({ error: 'Méthode de paiement invalide' });

    const etab = await prisma.etablissement.findUnique({ where: { id: etabId } });
    if (!etab) return res.status(404).json({ error: 'Établissement introuvable' });

    const plan = await prisma.billingPlan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.actif) return res.status(404).json({ error: 'Plan introuvable' });

    // Vérification de la taille de l'établissement
    const etudiants = await nbEtudiantsEtab(etabId);
    if (plan.maxEtudiants !== null && etudiants > plan.maxEtudiants) {
      return res.status(400).json({
        error: `Le plan ${plan.nom} est limité à ${plan.maxEtudiants} étudiants (effectif actuel : ${etudiants}).`,
      });
    }

    const prixXAF = cycle === 'annuel' ? plan.prixAnnuelXAF : plan.prixMensuelXAF;
    let sub = await prisma.subscription.findUnique({ where: { etablissementId: etabId } });

    // ── Plan gratuit : activation immédiate ──
    if (planCode === 'free') {
      const data = {
        planCode: 'free', statut: 'actif', essaiJusqua: null,
        debutPeriode: null, finPeriode: null, prixXAF: 0,
        renouvellementAuto: false, annuleLe: null,
      };
      sub = sub
        ? await prisma.subscription.update({ where: { id: sub.id }, data })
        : await prisma.subscription.create({ data: { etablissementId: etabId, ...data } });
      await prisma.etablissement.update({ where: { id: etabId }, data: { plan: 'free' } });
      return res.json({
        message: 'Plan gratuit activé',
        abonnement: sub,
        facture: null,
        paiementUrl: null,
      });
    }

    // ── Plan payant ──
    const nouveauDebut =
      !sub || sub.planCode === 'free' || (sub.statut !== 'actif' && sub.statut !== 'essai');

    let essaiJusqua = null;
    if (nouveauDebut) {
      // Essai gratuit de 14 jours
      essaiJusqua = new Date(Date.now() + ESSAI_GRATUIT_JOURS * 24 * 3600 * 1000);
      const data = {
        planCode, cycle, statut: 'essai', essaiJusqua,
        debutPeriode: null, finPeriode: null, prixXAF,
        renouvellementAuto: true, annuleLe: null,
      };
      sub = sub
        ? await prisma.subscription.update({ where: { id: sub.id }, data })
        : await prisma.subscription.create({ data: { etablissementId: etabId, ...data } });
    } else {
      // Changement de plan en cours de période
      sub = await prisma.subscription.update({
        where: { id: sub.id },
        data:  { planCode, cycle, prixXAF },
      });
    }

    // L'essai donne accès au plan immédiatement
    await prisma.etablissement.update({ where: { id: etabId }, data: { plan: planCode } });

    // Facture pour la période
    const numero  = genererNumeroFacture();
    const facture = await prisma.invoice.create({
      data: {
        numero, subscriptionId: sub.id, etablissementId: etabId,
        montantXAF: prixXAF, cycle,
      },
    });

    // Paiement immédiat si une méthode est fournie
    let paiementUrl = null;
    let providerUtilise = null;
    if (methodePaiement) {
      // Fapshi en primaire, CinetPay en fallback
      try {
        const p = await fapshi.initierPaiement({
          numero, montantXAF: prixXAF,
          description: `Abonnement ${plan.nom} EduNotify — période ${cycle}`,
          email, telephone, methode: methodePaiement,
        });
        paiementUrl = p.url;
        providerUtilise = 'fapshi';
      } catch (errFapshi) {
        console.warn('[Billing] Fapshi échoué, repli CinetPay:', errFapshi.message);
        try {
          const p = await cinetpay.initierPaiement({
            numero, montantXAF: prixXAF,
            description: `Abonnement ${plan.nom} EduNotify — période ${cycle}`,
            email, telephone, methode: methodePaiement,
          });
          paiementUrl = p.url;
          providerUtilise = 'cinetpay';
        } catch (errCinetpay) {
          console.error('[Billing] Tous les providers de paiement ont échoué:', errCinetpay.message);
        }
      }
      if (paiementUrl) {
        await prisma.invoice.update({
          where: { id: facture.id },
          data:  { urlPaiement: paiementUrl, methodePaiement, referencePaiement: numero },
        });
      }
    }

    return res.status(201).json({
      message: nouveauDebut
        ? `Abonnement ${plan.nom} activé avec ${ESSAI_GRATUIT_JOURS} jours d'essai gratuit`
        : `Abonnement mis à jour vers ${plan.nom}`,
      abonnement: sub,
      facture,
      paiementUrl,
      essaiGratuit: nouveauDebut,
      essaiJusqua,
    });
  } catch (err) {
    console.error('[creerAbonnement]', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /billing/subscriptions/:id/payer — initier le paiement d'une facture
// Body: { methodePaiement: 'mtn_momo'|'orange_money', telephone?, email? }
// ──────────────────────────────────────────────────────────────────

const initierPaiementFacture = async (req, res) => {
  try {
    const { id } = req.params;
    const { methodePaiement, telephone, email } = req.body;

    if (!['mtn_momo', 'orange_money'].includes(methodePaiement))
      return res.status(400).json({ error: 'Méthode de paiement invalide' });

    const sub = await prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.etablissementId !== req.user.etablissementId)
      return res.status(404).json({ error: 'Abonnement introuvable' });

    const facture = await prisma.invoice.findFirst({
      where:  { subscriptionId: sub.id, statut: 'en_attente' },
      orderBy: { createdAt: 'desc' },
    });
    if (!facture)
      return res.status(400).json({ error: 'Aucune facture en attente' });

    // Fapshi en primaire, CinetPay en fallback
    let p = null;
    let providerUtilise = null;
    try {
      p = await fapshi.initierPaiement({
        numero: facture.numero, montantXAF: facture.montantXAF,
        description: `Abonnement EduNotify — période ${facture.cycle}`,
        email, telephone, methode: methodePaiement,
      });
      providerUtilise = 'fapshi';
    } catch (errFapshi) {
      console.warn('[Billing] Fapshi échoué pour facture, repli CinetPay:', errFapshi.message);
      p = await cinetpay.initierPaiement({
        numero: facture.numero, montantXAF: facture.montantXAF,
        description: `Abonnement EduNotify — période ${facture.cycle}`,
        email, telephone, methode: methodePaiement,
      });
      providerUtilise = 'cinetpay';
    }

    await prisma.invoice.update({
      where: { id: facture.id },
      data:  { urlPaiement: p.url, methodePaiement, referencePaiement: facture.numero },
    });

    return res.json({ paiementUrl: p.url, provider: providerUtilise, facture });
  } catch (err) {
    console.error('[initierPaiementFacture]', err.message);
    return res.status(502).json({ error: `Paiement: ${err.message}` });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /billing/subscriptions/:id/payer-direct — Direct Pay (sans redirect)
// Body: { methodePaiement: 'mtn_momo'|'orange_money', telephone, email? }
// L'utilisateur reçoit une notification sur son MoMo/OM et valide
// directement sur son téléphone, sans quitter l'app.
// ──────────────────────────────────────────────────────────────────

const initierPaiementDirectCtrl = async (req, res) => {
  try {
    const { id } = req.params;
    const { methodePaiement, telephone, email } = req.body;

    if (!['mtn_momo', 'orange_money'].includes(methodePaiement))
      return res.status(400).json({ error: 'Méthode de paiement invalide' });
    if (!telephone)
      return res.status(400).json({ error: 'Le numéro de téléphone est obligatoire pour le paiement direct' });

    const sub = await prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.etablissementId !== req.user.etablissementId)
      return res.status(404).json({ error: 'Abonnement introuvable' });

    const facture = await prisma.invoice.findFirst({
      where:  { subscriptionId: sub.id, statut: 'en_attente' },
      orderBy: { createdAt: 'desc' },
    });
    if (!facture)
      return res.status(400).json({ error: 'Aucune facture en attente' });

    // Fapshi Direct Pay en primaire
    let transId = null;
    let providerUtilise = null;
    try {
      const p = await fapshi.initierPaiementDirect({
        numero: facture.numero, montantXAF: facture.montantXAF,
        description: `Abonnement EduNotify — ${facture.cycle}`,
        email, telephone, methode: methodePaiement,
      });
      transId = p.token;
      providerUtilise = 'fapshi';
      console.log('[Billing] Fapshi Direct Pay OK:', transId);
    } catch (errFapshi) {
      console.error('[Billing] Fapshi Direct Pay échoué:', errFapshi.message, errFapshi.body || '');
      return res.status(502).json({
        error: `Paiement direct impossible: ${errFapshi.message}`,
        details: errFapshi.body || null,
        hint: 'Vérifiez votre numéro de téléphone (format: 6XXXXXXXX) et réessayez',
      });
    }

    if (transId) {
      await prisma.invoice.update({
        where: { id: facture.id },
        data:  { methodePaiement, referencePaiement: transId },
      });
    }

    return res.json({
      message: 'Demande de paiement envoyée sur votre téléphone. Validez le paiement sur votre MoMo/Orange Money.',
      transactionId: transId,
      provider: providerUtilise,
      facture,
    });
  } catch (err) {
    console.error('[initierPaiementDirectCtrl]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /billing/payment-status/:transId — vérifier le statut d'un paiement
// ──────────────────────────────────────────────────────────────────

const verifierStatutPaiement = async (req, res) => {
  try {
    const { transId } = req.params;
    if (!transId)
      return res.status(400).json({ error: 'Identifiant de transaction manquant' });

    let statut = 'PENDING';
    try {
      const v = await fapshi.verifierPaiement(transId);
      statut = v.status; // ACCEPTED | REFUSED | PENDING
    } catch (err) {
      console.warn('[verifierStatutPaiement] Fapshi:', err.message);
    }

    return res.json({ transactionId: transId, statut });
  } catch (err) {
    console.error('[verifierStatutPaiement]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /billing/subscription — état de l'abonnement de mon établissement
// ──────────────────────────────────────────────────────────────────

const getMonAbonnement = async (req, res) => {
  try {
    const etabId = req.user.etablissementId;
    if (!etabId) return res.status(400).json({ error: 'Aucun établissement associé' });

    const [etab, etudiants, sub] = await Promise.all([
      prisma.etablissement.findUnique({
        where:  { id: etabId },
        select: { id: true, nom: true, plan: true },
      }),
      nbEtudiantsEtab(etabId),
      prisma.subscription.findUnique({
        where:  { etablissementId: etabId },
        include: {
          factures: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    if (!etab) return res.status(404).json({ error: 'Établissement introuvable' });

    if (!sub) {
      const plan = await prisma.billingPlan.findUnique({ where: { code: 'free' } });
      return res.json({
        etablissement: etab,
        nbEtudiants: etudiants,
        abonnement: { planCode: 'free', statut: 'actif', essaiJusqua: null, finPeriode: null },
        plan,
        facture: null,
      });
    }

    const plan = await prisma.billingPlan.findUnique({ where: { code: sub.planCode } });
    return res.json({
      etablissement: etab,
      nbEtudiants: etudiants,
      abonnement: sub,
      plan,
      facture: sub.factures[0] || null,
    });
  } catch (err) {
    console.error('[getMonAbonnement]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /billing/subscriptions/cancel — annuler (actif jusqu'à fin de période)
// ──────────────────────────────────────────────────────────────────

const annulerAbonnement = async (req, res) => {
  try {
    const sub = await prisma.subscription.findUnique({
      where: { etablissementId: req.user.etablissementId },
    });
    if (!sub) return res.status(404).json({ error: 'Aucun abonnement' });

    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data:  { renouvellementAuto: false, annuleLe: new Date() },
    });

    return res.json({
      message: 'Abonnement annulé — vos fonctionnalités restent actives jusqu\'à la fin de la période',
      abonnement: updated,
    });
  } catch (err) {
    console.error('[annulerAbonnement]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /billing/webhooks/fapshi — IPN Fapshi (route PUBLIQUE)
// ──────────────────────────────────────────────────────────────────

const webhookFapshi = async (req, res) => {
  try {
    const body = req.body || {};
    // Fapshi envoie : { transId, status, externalId, ... }
    const transId = body.transId || body.transaction_id;
    if (!transId)
      return res.status(400).json({ error: 'Identifiant de transaction manquant' });

    let facture = await prisma.invoice.findFirst({ where: { referencePaiement: transId } });
    if (!facture) {
      facture = await prisma.invoice.findUnique({ where: { numero: transId } });
    }
    // Aussi chercher par externalId
    if (!facture && body.externalId) {
      facture = await prisma.invoice.findUnique({ where: { numero: body.externalId } });
    }
    if (!facture)
      return res.status(404).json({ error: 'Facture inconnue' });

    // Vérification serveur
    let statut = body.status;
    try {
      const verification = await fapshi.verifierPaiement(transId);
      statut = verification.status;
    } catch (err) {
      console.warn('[Webhook Fapshi] Vérification impossible, repli sur IPN:', err.message);
    }

    if (statut === 'ACCEPTED' || statut === 'SUCCESSFUL') {
      await prisma.invoice.update({
        where: { id: facture.id },
        data:  { statut: 'payee', payeeLe: new Date() },
      });
      await activerAbonnement(facture.subscriptionId, facture.montantXAF, facture.cycle);
      return res.json({ message: 'Paiement confirmé', statut: 'payee' });
    }

    if (statut === 'REFUSED' || statut === 'FAILED' || statut === 'EXPIRED') {
      await prisma.invoice.update({
        where: { id: facture.id },
        data:  { statut: 'echouee' },
      });
      return res.json({ message: 'Paiement refusé', statut: 'echouee' });
    }

    return res.json({ message: 'Paiement en attente', statut: 'en_attente' });
  } catch (err) {
    console.error('[webhookFapshi]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /billing/webhooks/cinetpay — IPN CinetPay (route PUBLIQUE)
// ──────────────────────────────────────────────────────────────────

const webhookCinetpay = async (req, res) => {
  try {
    // Formats supportés : ancienne API v2 (cpm_trans_id/cpm_trans_status)
    // et nouvelle API (merchant_transaction_id/status ou transaction_id).
    const body = req.body || {};
    const transId = body.cpm_trans_id
      || body.merchant_transaction_id
      || body.transaction_id;
    if (!transId)
      return res.status(400).json({ error: 'Identifiant de transaction manquant' });

    let facture = await prisma.invoice.findUnique({ where: { numero: transId } });
    if (!facture) {
      facture = await prisma.invoice.findFirst({ where: { referencePaiement: transId } });
    }
    if (!facture)
      return res.status(404).json({ error: 'Facture inconnue' });

    // Vérification serveur (ne jamais se fier à l'IPN seul)
    let statut = body.cpm_trans_status || body.status;
    try {
      statut = (await verifierPaiement(transId)).status;
    } catch (err) {
      console.warn('[Webhook] Vérification CinetPay impossible, repli sur l\'IPN:', err.message);
    }

    if (statut === 'ACCEPTED' || statut === 'SUCCESS') {
      await prisma.invoice.update({
        where: { id: facture.id },
        data:  { statut: 'payee', payeeLe: new Date() },
      });
      await activerAbonnement(facture.subscriptionId, facture.montantXAF, facture.cycle);
      return res.json({ message: 'Paiement confirmé', statut: 'payee' });
    }

    if (statut === 'REFUSED' || statut === 'CANCELED' || statut === 'FAILED' || statut === 'EXPIRED') {
      await prisma.invoice.update({
        where: { id: facture.id },
        data:  { statut: 'echouee' },
      });
      return res.json({ message: 'Paiement refusé', statut: 'echouee' });
    }

    // PENDING : on répond 200 pour éviter les renvois intempestifs
    return res.json({ message: 'Paiement en attente', statut: 'en_attente' });
  } catch (err) {
    console.error('[webhookCinetpay]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ──────────────────────────────────────────────────────────────────
// Expiration des abonnements (essai terminé / période payée échue)
// ──────────────────────────────────────────────────────────────────

const verifierExpirations = async () => {
  const now   = new Date();
  const subs  = await prisma.subscription.findMany({
    where: { statut: { in: ['essai', 'actif'] } },
  });

  let expirations = 0;
  for (const sub of subs) {
    const essaiExpire  = sub.statut === 'essai' && sub.essaiJusqua && sub.essaiJusqua < now;
    const periodeExpiree = sub.statut === 'actif' && sub.finPeriode && sub.finPeriode < now;
    if (!essaiExpire && !periodeExpiree) continue;

    const facturesEnAttente = await prisma.invoice.count({
      where: { subscriptionId: sub.id, statut: 'en_attente' },
    });

    // Une facture en attente non payée → statut 'impaye' (relance possible)
    const nouveauStatut = facturesEnAttente > 0 ? 'impaye' : 'expire';

    await prisma.subscription.update({
      where: { id: sub.id },
      data:  { statut: nouveauStatut },
    });
    await prisma.etablissement.update({
      where: { id: sub.etablissementId },
      data:  { plan: 'free' },
    });
    expirations++;
  }

  if (expirations > 0) {
    console.log(`[Billing] ${expirations} abonnement(s) expiré(s) → plan gratuit`);
  }
  return expirations;
};

// Route de contrôle (super_admin) + déclenchement manuel
const verifierExpirationsRoute = async (req, res) => {
  try {
    const expirations = await verifierExpirations();
    return res.json({ expirations, message: 'Vérification des expirations terminée' });
  } catch (err) {
    console.error('[verifierExpirationsRoute]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  listerPlans,
  creerAbonnement,
  initierPaiementFacture,
  initierPaiementDirectCtrl,
  verifierStatutPaiement,
  getMonAbonnement,
  annulerAbonnement,
  webhookFapshi,
  webhookCinetpay,
  verifierExpirations,
  verifierExpirationsRoute,
};
