const admin = require('firebase-admin');
const path  = require('path');

let messaging = null;

const initFirebase = () => {
  try {
    const serviceAccount = require(path.join(__dirname, '../../../secrets/firebase-service-account.json'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    messaging = admin.messaging();
    console.log('[Firebase] Initialise avec succes');
  } catch (err) {
    console.error('[Firebase] Erreur init:', err.message);
  }
};

const sendPushToOne = async (fcmToken, titre, contenu, data = {}) => {
  if (!messaging || !fcmToken) return false;
  try {
    await messaging.send({
      token: fcmToken,
      notification: { title: titre, body: contenu },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'edunotify_default' },
      },
    });
    return true;
  } catch (err) {
    console.warn('[Firebase] Push echec:', err.message);
    return false;
  }
};

const sendPushToMany = async (tokens, titre, contenu, data = {}) => {
  if (!messaging || !tokens.length) return;
  const validTokens = tokens.filter(Boolean);
  if (!validTokens.length) return;

  try {
    // sendMulticast envoie en une seule requête HTTP — évite les ECONNRESET
    const message = {
      tokens: validTokens,
      notification: { title: titre, body: contenu },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'edunotify_default' },
      },
    };

    const response = await messaging.sendEachForMulticast(message);
    console.log(`[Firebase] OK: ${response.successCount} / Echecs: ${response.failureCount}`);

    // Nettoyer les tokens invalides
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.warn(`[Firebase] Token invalide: ${validTokens[idx].substring(0, 20)}... — ${resp.error?.message}`);
        }
      });
    }
  } catch (err) {
    console.error('[Firebase] sendEachForMulticast erreur:', err.message);

    // Fallback : envoi séquentiel avec délai si multicast échoue
    for (const token of validTokens) {
      try {
        await sendPushToOne(token, titre, contenu, data);
        await new Promise(r => setTimeout(r, 100)); // 100ms entre chaque
      } catch (_) {}
    }
  }
};
module.exports = { initFirebase, sendPushToOne, sendPushToMany };

