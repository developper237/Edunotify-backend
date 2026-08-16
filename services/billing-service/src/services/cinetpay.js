// services/billing-service/src/services/cinetpay.js
// Client CinetPay v2 — paiement Mobile Money (MTN MoMo / Orange Money).
// Docs : https://dev.cinetpay.com (API v2)
//
//   Initier un paiement  : POST https://api.cinetpay.com/v2/payment
//   Vérifier une transac. : POST https://api.cinetpay.com/v2/check
//   IPN (webhook)        : CinetPay appelle notre notify_url avec les
//                          champs cpm_* (cpm_trans_id, cpm_trans_status...)

const axios = require('axios');

const CINETPAY_API = 'https://api.cinetpay.com/v2';

const creds = () => {
  const apikey = process.env.CINETPAY_API_KEY;
  const siteId = process.env.CINETPAY_SITE_ID;
  if (!apikey || !siteId) {
    throw new Error('CINETPAY_API_KEY / CINETPAY_SITE_ID manquants');
  }
  return { apikey, site_id: siteId };
};

// methode: 'mtn_momo' | 'orange_money'
const channelDe = (methode) => (methode === 'orange_money' ? 'ORANGE' : 'MTN');

/**
 * Initie un paiement CinetPay et renvoie l'URL de paiement.
 * @param {object} p
 * @param {string} p.numero      transaction_id unique (numero de facture)
 * @param {number} p.montantXAF  montant en FCFA
 * @param {string} p.description
 * @param {string} [p.email]
 * @param {string} [p.telephone]
 * @param {'mtn_momo'|'orange_money'} [p.methode]
 */
const initierPaiement = async ({ numero, montantXAF, description, email, telephone, methode }) => {
  const body = {
    ...creds(),
    transaction_id: numero,
    amount:         montantXAF,
    currency:       'XAF',
    description:    description || 'Abonnement EduNotify',
    notify_url:     process.env.CINETPAY_NOTIFY_URL,
    return_url:     process.env.CINETPAY_RETURN_URL || process.env.APP_URL || 'https://edunotify.cm',
    channels:       methode ? channelDe(methode) : 'MOBILE_MONEY',
    customer_id:    numero,
    customer_name:  'EduNotify',
    customer_surname: 'Établissement',
    customer_email: email   || 'paiement@edunotify.cm',
    customer_phone: telephone || '',
  };

  const { data } = await axios.post(`${CINETPAY_API}/payment`, body, {
    timeout: 20000,
  });

  const ok = data?.data?.payment_url && (data.code === '201' || data.code === '200');
  if (!ok) {
    throw new Error(`CinetPay: ${data?.message || 'réponse inattendue'} (code ${data?.code})`);
  }

  return {
    url:   data.data.payment_url,
    token: data.data.payment_token || null,
  };
};

/**
 * Vérifie l'état d'une transaction auprès de CinetPay.
 * @returns {Promise<{status: 'ACCEPTED'|'REFUSED'|'PENDING'|string, raw: object}>}
 */
const verifierPaiement = async (transactionId) => {
  const { data } = await axios.post(
    `${CINETPAY_API}/check`,
    { ...creds(), transaction_id: transactionId },
    { timeout: 20000 }
  );

  return {
    status: data?.data?.status || data?.status || 'PENDING',
    raw:    data?.data || data,
  };
};

module.exports = { initierPaiement, verifierPaiement };
