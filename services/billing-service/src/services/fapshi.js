// services/billing-service/src/services/fapshi.js
// Client Fapshi — paiement Mobile Money (MTN MoMo / Orange Money).
//
// Appels HTTP directs (aucune dépendance externe).
//
// Env requises :
//   FAPSHI_API_USER  — identifiant API user (e02a8096-...)
//   FAPSHI_API_KEY   — clé API (FAK_TEST_... ou FAK_...)
//
// Environnement détecté automatiquement :
//   FAK_TEST_xxx → sandbox (https://sandbox.fapshi.com)
//   FAK_xxx      → live   (https://live.fapshi.com)

const https = require('https');
const http = require('http');

// ─── Base URL ───────────────────────────────────────────────────
const _getBaseUrl = () => {
  const apiKey = process.env.FAPSHI_API_KEY || '';
  if (apiKey.startsWith('FAK_') && !apiKey.startsWith('FAK_TEST_')) {
    return 'https://live.fapshi.com';
  }
  return 'https://sandbox.fapshi.com';
};

// ─── Requête HTTP générique ────────────────────────────────────
const _request = (method, path, body) => {
  const apiUser = process.env.FAPSHI_API_USER;
  const apiKey  = process.env.FAPSHI_API_KEY;

  if (!apiUser || !apiKey) {
    return Promise.reject(new Error('FAPSHI_API_USER et FAPSHI_API_KEY sont requis'));
  }

  const baseUrl = _getBaseUrl();
  const url = new URL(`${baseUrl}${path}`);

  const headers = {
    'Content-Type': 'application/json',
    'apiuser': apiUser,
    'apikey': apiKey,
  };

  const payload = body ? JSON.stringify(body) : null;
  if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            const errMsg = json.message || json.error || `HTTP ${res.statusCode}`;
            const err = new Error(`Fapshi API ${res.statusCode}: ${errMsg}`);
            err.statusCode = res.statusCode;
            err.body = json;
            return reject(err);
          }
          resolve(json);
        } catch (e) {
          reject(new Error(`Fapshi: réponse invalide (${data.slice(0, 200)})`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Fapshi réseau: ${err.message}`));
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Fapshi: timeout (30s)'));
    });

    if (payload) req.write(payload);
    req.end();
  });
};

// ─── Mapper nos méthodes vers les mediums Fapshi ───────────────
const mediumDe = (methode) => {
  if (methode === 'orange_money') return 'orange money';
  return 'mobile money'; // mtn_momo par défaut
};

/**
 * Initie un paiement Fapshi et renvoie l'URL de paiement.
 * L'utilisateur est redirigé vers une page Fapshi hébergée pour payer.
 * @param {object} p
 * @param {string}  p.numero       identifiant marchand unique
 * @param {number}  p.montantXAF   montant en FCFA (minimum 100)
 * @param {string}  p.description  message affiché
 * @param {string}  [p.email]      email du payeur
 * @param {'mtn_momo'|'orange_money'} [p.methode]
 */
const initierPaiement = async ({ numero, montantXAF, description, email, methode }) => {
  const returnUrl = process.env.FAPSHI_RETURN_URL
    || 'https://billing-service-efm6.onrender.com/billing/retour';

  try {
    // POST /initiate-pay
    const result = await _request('POST', '/initiate-pay', {
      amount: Math.max(100, Math.round(montantXAF)),
      email: email || undefined,
      redirectUrl: returnUrl,
      externalId: numero,
      userId: numero,
      message: description || 'Abonnement EduNotify',
    });

    return {
      url:   result.link,     // URL de redirection vers la page de paiement Fapshi
      token: result.transId,  // ID de transaction Fapshi
    };
  } catch (err) {
    console.error('[Fapshi] initierPaiement error:', err.message);
    throw err;
  }
};

/**
 * Initie un paiement direct (push vers le téléphone de l'utilisateur).
 * @param {object} p
 * @param {string}  p.numero
 * @param {number}  p.montantXAF
 * @param {string}  p.description
 * @param {string}  [p.email]
 * @param {string}  p.telephone   OBLIGATOIRE pour directPay
 * @param {'mtn_momo'|'orange_money'} [p.methode]
 */
const initierPaiementDirect = async ({ numero, montantXAF, description, email, telephone, methode = 'mtn_momo' }) => {
  if (!telephone) {
    throw new Error('Le numéro de téléphone est obligatoire pour le paiement direct');
  }

  try {
    // POST /direct-pay
    const payload = {
      amount: Math.max(100, Math.round(montantXAF)),
      phone: telephone,
      name: 'EduNotify',
      email: email || undefined,
      externalId: numero,
      userId: numero,
      message: description || 'Abonnement EduNotify',
    };

    // Envoyer le medium pour aider Fapshi à router vers le bon provider
    if (methode === 'orange_money') {
      payload.medium = 'orange money';
    } else {
      payload.medium = 'mobile money';
    }

    console.log('[Fapshi] Direct Pay request:', JSON.stringify({ phone: telephone, amount: payload.amount, medium: payload.medium }));
    const result = await _request('POST', '/direct-pay', payload);
    console.log('[Fapshi] Direct Pay response:', JSON.stringify(result));

    return {
      url:   null, // pas d'URL pour directPay — le paiement se fait sur le téléphone
      token: result.transId,
    };
  } catch (err) {
    console.error('[Fapshi] initierPaiementDirect error:', err.message, err.body || '');
    throw err;
  }
};

/**
 * Vérifie l'état d'une transaction Fapshi.
 * Retourne un statut normalisé : ACCEPTED | REFUSED | PENDING
 * @param {string} transId  identifiant de transaction Fapshi
 */
const verifierPaiement = async (transId) => {
  try {
    // GET /payment-status/{transId}
    const tx = await _request('GET', `/payment-status/${transId}`);
    console.log('[Fapshi] verifierPaiement:', transId, '→', tx.status);

    // Statuts Fapshi : CREATED, SUCCESSFUL, FAILED, EXPIRED
    const statut = tx.status === 'SUCCESSFUL' ? 'ACCEPTED'
      : ['FAILED', 'EXPIRED'].includes(tx.status) ? 'REFUSED'
      : 'PENDING';

    return { status: statut, raw: tx };
  } catch (err) {
    console.error('[Fapshi] verifierPaiement error:', err.message);
    throw err;
  }
};

/**
 * Récupère le solde du service Fapshi.
 */
const getBalance = async () => {
  try {
    return await _request('GET', '/balance');
  } catch (err) {
    console.error('[Fapshi] getBalance error:', err.message);
    throw err;
  }
};

module.exports = { initierPaiement, initierPaiementDirect, verifierPaiement, getBalance };
