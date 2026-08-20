// services/billing-service/src/services/cinetpay.js
// Client CinetPay — paiement Mobile Money (MTN MoMo / Orange Money).
//
// Deux générations d'API sont supportées, détectées automatiquement :
//
//  ── Nouvelle API (clés sk_test_ / sk_live_) ────────────────────────
//     Auth   : POST /v1/oauth/login  { api_key, api_password } → access_token
//     Paiement: POST /v1/payment      (Bearer) → payment_token / payment_url
//     Vérif. : GET  /v1/payment/{merchant_transaction_id}
//     Sandbox : api.cinetpay.net   / secure.cinetpay.net
//     Prod    : api.cinetpay.co    / secure.cinetpay.co
//
//  ── Ancienne API v2 (site_id + apikey) ────────────────────────────
//     Paiement: POST https://api.cinetpay.com/v2/payment
//     Vérif. : POST https://api.cinetpay.com/v2/payment/check
//     ⚠️  Domaine derrière le WAF Cloudflare (challenge anti-bot) —
//     utilisable uniquement depuis certains réseaux. La nouvelle API
//     (clés sk_...) est recommandée.
//
// Env requises :
//   Nouvelle API : CINETPAY_API_KEY (sk_...), CINETPAY_API_PASSWORD
//   Ancienne API : CINETPAY_API_KEY, CINETPAY_SITE_ID
//   Les deux     : CINETPAY_NOTIFY_URL, CINETPAY_RETURN_URL (optionnel)

const axios = require('axios');

// ── Détection de l'API ─────────────────────────────────────────────

const estNouvelleAPI = () =>
  !!(process.env.CINETPAY_API_KEY || '').startsWith('sk_');

const baseUrl = () => {
  if (estNouvelleAPI()) {
    const live = (process.env.CINETPAY_API_KEY || '').startsWith('sk_live_');
    return live ? 'https://api.cinetpay.co' : 'https://api.cinetpay.net';
  }
  // API v2 : api.cinetpay.com (attention, derrière le WAF Cloudflare)
  return 'https://api.cinetpay.com';
};

const creds = () => {
  const apiKey = process.env.CINETPAY_API_KEY;
  if (!apiKey) throw new Error('CINETPAY_API_KEY manquant');

  if (estNouvelleAPI()) {
    if (!process.env.CINETPAY_API_PASSWORD)
      throw new Error('CINETPAY_API_PASSWORD manquant (nouvelle API)');
    return { api_key: apiKey, api_password: process.env.CINETPAY_API_PASSWORD };
  }
  if (!process.env.CINETPAY_SITE_ID)
    throw new Error('CINETPAY_SITE_ID manquant (ancienne API v2)');
  return { apikey: apiKey, site_id: process.env.CINETPAY_SITE_ID };
};

// ── Auth (nouvelle API) ────────────────────────────────────────────

let tokenCache = null;

const obtenirAccessToken = async () => {
  if (tokenCache) return tokenCache;
  const { api_key, api_password } = creds();
  const { data } = await axios.post(
    `${baseUrl()}/v1/oauth/login`,
    { api_key, api_password },
    { timeout: 20000 }
  );
  if (!data?.access_token)
    throw new Error(`CinetPay auth: ${data?.message || 'réponse inattendue'}`);
  tokenCache = data.access_token;
  return tokenCache;
};

// methode: 'mtn_momo' | 'orange_money'
const channelDe = (methode) => (methode === 'orange_money' ? 'ORANGE' : 'MTN');

// ── Initier un paiement ────────────────────────────────────────────

/**
 * Initie un paiement CinetPay et renvoie l'URL de paiement.
 * @param {object} p
 * @param {string} p.numero      identifiant marchand unique (numero de facture)
 * @param {number} p.montantXAF  montant en FCFA
 * @param {string} p.description
 * @param {string} [p.email]
 * @param {string} [p.telephone]
 * @param {'mtn_momo'|'orange_money'} [p.methode]
 */
const initierPaiement = async ({ numero, montantXAF, description, email, telephone, methode }) => {
  const notifyUrl = process.env.CINETPAY_NOTIFY_URL
    || 'https://billing-service-efm6.onrender.com/billing/webhooks/cinetpay';

  const returnUrl =
    process.env.CINETPAY_RETURN_URL || process.env.APP_URL || 'https://billing-service-efm6.onrender.com/billing/retour';

  if (estNouvelleAPI()) {
    const token = await obtenirAccessToken();
    const { data } = await axios.post(
      `${baseUrl()}/v1/payment`,
      {
        currency: 'XAF',
        merchant_transaction_id: numero,
        amount: montantXAF,
        lang: 'fr',
        designation: description || 'Abonnement EduNotify',
        client_email: email || 'paiement@edunotify.cm',
        client_first_name: 'EduNotify',
        client_last_name: 'Établissement',
        client_phone_number: telephone || '',
        success_url: returnUrl,
        failed_url: returnUrl,
        notify_url: notifyUrl,
        channel: methode ? channelDe(methode) : 'PUSH',
        direct_pay: false,
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
    );

    const url   = data?.payment_url || data?.data?.payment_url;
    const tokenPaiement = data?.payment_token || data?.data?.payment_token;
    if (!url)
      throw new Error(`CinetPay: ${data?.message || data?.status || 'réponse inattendue'}`);

    return { url, token: tokenPaiement || null };
  }

  // ── Ancienne API v2 ──
  const body = {
    ...creds(),
    transaction_id: numero,
    amount:         montantXAF,
    currency:       'XAF',
    description:    description || 'Abonnement EduNotify',
    notify_url:     notifyUrl,
    return_url:     returnUrl,
    channels:       methode ? channelDe(methode) : 'MOBILE_MONEY',
    customer_id:    numero,
    customer_name:  'EduNotify',
    customer_surname: 'Établissement',
    customer_email: email   || 'paiement@edunotify.cm',
    customer_phone: telephone || '',
    lang:           'fr',
  };

  let data;
  try {
    const resp = await axios.post(`${baseUrl()}/v2/payment`, body, {
      timeout: 20000,
      headers: {
        'User-Agent': 'EduNotify-Billing/1.0',
        Accept: 'application/json',
      },
    });
    data = resp.data;
  } catch (err) {
    const detail = err.response?.data;
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
    throw new Error(`CinetPay v2: HTTP ${err.response?.status} — ${d}`);
  }

  // v2 répond code '00' (succès), parfois '201'/'200' selon les versions
  const ok = data?.data?.payment_url && ['00', '201', '200'].includes(String(data.code));
  if (!ok) {
    throw new Error(`CinetPay: ${data?.message || 'réponse inattendue'} (code ${data?.code})`);
  }

  return {
    url:   data.data.payment_url,
    token: data.data.payment_token || null,
  };
};

// ── Vérifier une transaction ───────────────────────────────────────

/**
 * Vérifie l'état d'une transaction auprès de CinetPay.
 * Retourne un statut normalisé : ACCEPTED | REFUSED | PENDING | ...
 * @param {string} transactionId  identifiant marchand (numero de facture)
 */
const verifierPaiement = async (transactionId) => {
  if (estNouvelleAPI()) {
    const token = await obtenirAccessToken();
    const { data } = await axios.get(
      `${baseUrl()}/v1/payment/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
    );
    // La nouvelle API répond { code: 100, status: 'SUCCESS', ... }
    const brut = data?.status || 'PENDING';
    const statut = brut === 'SUCCESS' ? 'ACCEPTED'
      : ['FAILED', 'INSUFFICIENT_BALANCE', 'EXPIRED'].includes(brut) ? 'REFUSED'
      : 'PENDING';
    return { status: statut, raw: data || {} };
  }

  // ── Ancienne API v2 ──
  const { data } = await axios.post(
    `${baseUrl()}/v2/payment/check`,
    { ...creds(), transaction_id: transactionId },
    {
      timeout: 20000,
      headers: {
        'User-Agent': 'EduNotify-Billing/1.0',
        Accept: 'application/json',
      },
    }
  );

  return {
    status: data?.data?.status || data?.status || 'PENDING',
    raw:    data?.data || data,
  };
};

module.exports = { initierPaiement, verifierPaiement };
