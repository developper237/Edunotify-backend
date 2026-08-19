// services/billing-service/src/services/fapshi.js
// Client Fapshi — paiement Mobile Money (MTN MoMo / Orange Money).
//
// Utilise le SDK officiel @fapshi/payments.
//
// Env requises :
//   FAPSHI_API_USER  — identifiant API user (e02a8096-...)
//   FAPSHI_API_KEY   — clé API (FAK_TEST_... ou FAK_...)
//
// Environnement détecté automatiquement :
//   FAK_TEST_xxx → sandbox (https://sandbox.fapshi.com)
//   FAK_xxx      → live   (https://live.fapshi.com)

const { createFapshiClient } = require('@fapshi/payments');

let _client = null;

const getClient = () => {
  if (_client) return _client;

  const apiUser = process.env.FAPSHI_API_USER;
  const apiKey  = process.env.FAPSHI_API_KEY;

  if (!apiUser || !apiKey) {
    throw new Error('FAPSHI_API_USER et FAPSHI_API_KEY sont requis');
  }

  _client = createFapshiClient({ apiUser, apiKey });
  return _client;
};

// Mapper nos méthodes de paiement vers les mediums Fapshi
const mediumDe = (methode) => {
  if (methode === 'orange_money') return 'orange money';
  return 'mobile money'; // mtn_momo par défaut
};

/**
 * Initie un paiement Fapshi et renvoie l'URL de paiement (initiatePay).
 * L'utilisateur est redirigé vers une page Fapshi hébergée pour payer.
 * @param {object} p
 * @param {string} p.numero       identifiant marchand unique (numero de facture)
 * @param {number} p.montantXAF   montant en FCFA (minimum 100)
 * @param {string} p.description  message affiché
 * @param {string} [p.email]      email du payeur
 * @param {string} [p.telephone]  non utilisé pour initiatePay (redirection)
 * @param {'mtn_momo'|'orange_money'} [p.methode]
 */
const initierPaiement = async ({ numero, montantXAF, description, email, telephone, methode }) => {
  const client = getClient();

  const returnUrl = process.env.FAPSHI_RETURN_URL
    || 'https://billing-service-36of.onrender.com/billing/retour';

  try {
    // initiatePay génère un lien de paiement hébergé par Fapshi
    const result = await client.initiatePay({
      amount: Math.max(100, Math.round(montantXAF)), // minimum 100 XAF
      email: email || undefined,
      redirectUrl: returnUrl,
      externalId: numero,      // notre reference facture
      userId: numero,          // pour tracking
      message: description || 'Abonnement EduNotify',
    });

    return {
      url:   result.link,      // URL de redirection vers la page de paiement Fapshi
      token: result.transId,   // ID de transaction Fapshi
    };
  } catch (err) {
    console.error('[Fapshi] initierPaiement error:', err.message);
    throw new Error(`Fapshi: ${err.message}`);
  }
};

/**
 * Initie un paiement direct (push vers le téléphone de l'utilisateur).
 * L'utilisateur reçoit une notification sur son téléphone pour confirmer.
 * @param {object} p
 * @param {string} p.numero
 * @param {number} p.montantXAF
 * @param {string} p.description
 * @param {string} [p.email]
 * @param {string} p.telephone   OBLIGATOIRE pour directPay
 * @param {'mtn_momo'|'orange_money'} [p.methode]
 */
const initierPaiementDirect = async ({ numero, montantXAF, description, email, telephone, methode }) => {
  const client = getClient();

  if (!telephone) {
    throw new Error('Le numéro de téléphone est obligatoire pour le paiement direct');
  }

  try {
    const result = await client.directPay({
      amount: Math.max(100, Math.round(montantXAF)),
      phone: telephone,
      medium: mediumDe(methode),
      name: 'EduNotify',
      email: email || undefined,
      externalId: numero,
      userId: numero,
      message: description || 'Abonnement EduNotify',
    });

    return {
      url:   null, // pas d'URL pour directPay — le paiement se fait sur le téléphone
      token: result.transId,
    };
  } catch (err) {
    console.error('[Fapshi] initierPaiementDirect error:', err.message);
    throw new Error(`Fapshi: ${err.message}`);
  }
};

/**
 * Vérifie l'état d'une transaction Fapshi.
 * Retourne un statut normalisé : ACCEPTED | REFUSED | PENDING
 * @param {string} transId  identifiant de transaction Fapshi
 */
const verifierPaiement = async (transId) => {
  const client = getClient();

  try {
    const tx = await client.getPaymentStatus(transId);

    // Statuts Fapshi : CREATED, SUCCESSFUL, FAILED, EXPIRED
    const statut = tx.status === 'SUCCESSFUL' ? 'ACCEPTED'
      : ['FAILED', 'EXPIRED'].includes(tx.status) ? 'REFUSED'
      : 'PENDING';

    return { status: statut, raw: tx };
  } catch (err) {
    console.error('[Fapshi] verifierPaiement error:', err.message);
    throw new Error(`Fapshi: ${err.message}`);
  }
};

module.exports = { initierPaiement, initierPaiementDirect, verifierPaiement };
